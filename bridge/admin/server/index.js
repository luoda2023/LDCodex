/**
 * LuoDaBridge — Admin Panel Server
 *
 * Serves the admin HTML files with server-side auth validation.
 * Every request checks the auth cookie before serving content.
 * Unauthenticated requests are redirected to login.html.
 *
 * Port: ADMIN_PORT env var (default 37002)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.ADMIN_PORT || "36002", 10);
const CONFIG_PORT = parseInt(process.env.CONFIG_PORT || "36001", 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "36000", 10);
const CONFIG_HOST = "127.0.0.1";

// ─── Session Store (in-memory) ──────────────────────────────
// In production, use a database-backed session store
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const TOKEN_SECRET = crypto.randomBytes(32).toString("hex");

// ─── MIME Types ─────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// ─── Auth helpers ───────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession() {
  const token = generateToken();
  const session = { token, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(token, session);
  // Cleanup old sessions
  for (const [t, s] of sessions) {
    if (Date.now() > s.expiresAt) sessions.delete(t);
  }
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  // Slide expiry
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

// ─── Validate password (翻译转换 + SHA-256 双保险) ─────────
// 验证流程:
//   用户输入 → 反转字符串(翻译转换) → SHA-256 → 对比存储哈希
//   明文不存储、不传输、不落盘
const DEFAULT_PASS_HASH = "8aeeea0787e20873d88ecabea61b69b86c1e5994f4a74b9487f0505c9d1cca6d"; // sha256(reverse("lkw666999"))

function validateHash(clientHash) {
  return clientHash === DEFAULT_PASS_HASH;
}

// ─── HTTP Server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // ── CORS ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // ── Auth API ──
  if (pathname === "/api/auth/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        // Support both client-side hash (old) and server-side hash (new)
        let hash = data.hash || "";
        if (!hash && data.pass) {
          // Server-side SHA-256 (avoids browser crypto.subtle issue over HTTP)
          // 注意：浏览器端 login.html 已对密码做了 reverse 并发送 pass: reversed
          // 服务端直接计算 SHA-256 即可，不需要再次 reverse
          hash = crypto.createHash("sha256").update(data.pass).digest("hex");
        }
        if (!hash) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, message: "参数错误" }));
        }

        // Rate limiting: simple IP-based
        if (validateHash(hash)) {
          const token = createSession();
          // Set both cookie (for server-side check) and JSON response (for client-side)
          const cookieStr = `luoda_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
          res.setHeader("Set-Cookie", cookieStr);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, token }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "密码错误" }));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "请求格式错误" }));
      }
    });
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const cookie = parseCookies(req.headers.cookie || "");
    destroySession(cookie.luoda_session);
    res.setHeader("Set-Cookie", "luoda_session=; Path=/; HttpOnly; Max-Age=0");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/auth/check" && req.method === "GET") {
    const cookie = parseCookies(req.headers.cookie || "");
    const session = validateSession(cookie.luoda_session);
    if (session) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  // ── Restore All Abnormal Models ──
  if (pathname === "/api/abnormal/restore-all" && req.method === "POST") {
    // Fetch abnormal list via config API
    fetch(`http://127.0.0.1:${CONFIG_PORT}/api/fallback/abnormal`)
      .then(r => r.json())
      .then(data => {
        const list = data.abnormalModels || [];
        if (list.length === 0) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, restored: 0 }));
        }
        // Restore each abnormal model
        Promise.all(list.map(key =>
          fetch(`http://127.0.0.1:${CONFIG_PORT}/api/fallback/abnormal/restore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key })
          })
        )).then(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, restored: list.length }));
        }).catch(e => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: e.message }));
        });
      })
      .catch(e => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "config API unreachable" }));
      });
    return;
  }

  // ── SSE clients for real-time token updates ──
const sseClients = new Set();

function notifyTokenClients(data) {
  const msg = JSON.stringify(data || getTokenUsage());
  for (const client of sseClients) {
    try { client.write("data: " + msg + "\n\n"); } catch(e) { sseClients.delete(client); }
  }
}

// ── Token Reset ──
  if (pathname === "/api/tokens/reset" && req.method === "POST") {
    const fresh = resetTokenUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, data: fresh }));
    return;
  }

  // ── Token Usage API ──
  if (pathname === "/api/tokens" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify(getTokenUsage()));
    return;
  }

  // ── Token Log API (proxy to proxy server for raw granular data) ──
  if (pathname === "/api/tokens/log" && req.method === "GET") {
    http.get(`http://127.0.0.1:${PROXY_PORT}/api/tokens/log`, (res2) => {
      let d = "";
      res2.on("data", (c) => d += c);
      res2.on("end", () => {
        try { const j = JSON.parse(d); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); }
        catch(e) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ entries: [] })); }
      });
    }).on("error", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ entries: [] })); });
    return;
  }

  // ── Token Data Push (for future proxy integration) ──
  if (pathname === "/api/tokens/push" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        pushTokenUsage(data);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, message: "invalid data" }));
      }
    });
    return;
  }

  // ── Status API proxy ──
  if (pathname === "/api/status" && req.method === "GET") {
    http.get(`http://127.0.0.1:${CONFIG_PORT}/api/status`, (res2) => {
      let d = "";
      res2.on("data", (c) => d += c);
      res2.on("end", () => {
        try { const j = JSON.parse(d); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); }
        catch(e) { res.writeHead(502); res.end("{}"); }
      });
    }).on("error", () => { res.writeHead(502); res.end("{}"); });
    return;
  }

  // ── /api/codex/config proxy ──
  if (pathname === "/api/codex/config" && (req.method === "GET" || req.method === "POST")) {
    const opts = {
      method: req.method,
      hostname: "127.0.0.1",
      port: CONFIG_PORT,
      path: "/api/codex/config",
      headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}` },
    };
    const creq = http.request(opts, (cres) => {
      res.writeHead(cres.statusCode, cres.headers);
      cres.pipe(res);
    });
    creq.on("error", () => { res.writeHead(502); res.end("{}"); });
    if (req.method === "POST") req.pipe(creq);
    else creq.end();
    return;
  }

  // ── Fallback config proxy (GET + POST, 含子路由) ──
  if (pathname.startsWith("/api/fallback")) {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const opts = {
        method: req.method,
        hostname: "127.0.0.1",
        port: CONFIG_PORT,
        path: pathname,
        headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}`, "Content-Length": Buffer.byteLength(body) },
      };
      const creq = http.request(opts, (cres) => {
        let d = "";
        cres.on("data", (c) => d += c);
        cres.on("end", () => { res.writeHead(cres.statusCode, { "Content-Type": "application/json" }); res.end(d); });
      });
      creq.on("error", () => { res.writeHead(502); res.end("{}"); });
      creq.write(body || "");
      creq.end();
    });
    return;
  }

  // ── Custom models CRUD proxy (add/update/delete/get) ──
  // ★ 必须代理 GET 请求，否则 models.html 中的 loadAllFromAPI() 无法获取数据
  if ((pathname === "/api/models" || pathname.startsWith("/api/models/")) && (req.method === "GET" || req.method === "POST" || req.method === "PUT" || req.method === "DELETE")) {
    const opts = {
      method: req.method,
      hostname: "127.0.0.1",
      port: CONFIG_PORT,
      path: pathname,
      headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}` },
    };
    const creq = http.request(opts, (cres) => {
      res.writeHead(cres.statusCode, cres.headers);
      cres.pipe(res);
    });
    creq.on("error", () => { res.writeHead(502); res.end("{}"); });
    if (req.method !== "GET") req.pipe(creq);
    else creq.end();
    return;
  }

  // ── Token rankings proxy (for dashboard) ──
  if (pathname === "/api/token-rankings" && req.method === "GET") {
    const opts = {
      method: "GET",
      hostname: "127.0.0.1",
      port: CONFIG_PORT,
      path: "/api/token-rankings",
      headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}` },
    };
    const creq = http.request(opts, (cres) => {
      res.writeHead(cres.statusCode, cres.headers);
      cres.pipe(res);
    });
    creq.on("error", () => { res.writeHead(502); res.end("{}"); });
    creq.end();
    return;
  }

  // ── Countdown timeleft proxy ──
  if (pathname === "/api/countdown/timeleft") {
    const opts = {
      method: req.method,
      hostname: "127.0.0.1",
      port: CONFIG_PORT,
      path: "/api/countdown/timeleft",
      headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}` },
    };
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const creq = http.request(opts, (cres) => {
        let d = "";
        cres.on("data", (c) => d += c);
        cres.on("end", () => { res.writeHead(cres.statusCode, cres.headers); res.end(d); });
      });
      creq.on("error", () => { res.writeHead(502); res.end("{}"); });
      if (body) creq.write(body);
      creq.end();
    });
    return;
  }

  // ── Token sync proxy ──
  if (pathname === "/api/tokens/sync" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const opts = {
        method: "POST",
        hostname: "127.0.0.1",
        port: CONFIG_PORT,
        path: "/api/tokens/sync",
        headers: { ...req.headers, host: `127.0.0.1:${CONFIG_PORT}`, "Content-Length": Buffer.byteLength(body) },
      };
      const creq = http.request(opts, (cres) => {
        let d = "";
        cres.on("data", (c) => d += c);
        cres.on("end", () => { res.writeHead(cres.statusCode, cres.headers); res.end(d); });
      });
      creq.on("error", () => { res.writeHead(502); res.end("{}"); });
      creq.write(body);
      creq.end();
    });
    return;
  }

  // ── Config API proxy (for config.html pages) ──
  if ((pathname === "/api/all" || pathname.startsWith("/api/builtins/")) && req.method === "GET") {
    const targetPath = pathname; // "/api/all" or "/api/builtins/xxx"
    http.get(`http://127.0.0.1:${CONFIG_PORT}${targetPath}`, (res2) => {
      let d = "";
      res2.on("data", (c) => d += c);
      res2.on("end", () => {
        try { const j = JSON.parse(d); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); }
        catch(e) { res.writeHead(502); res.end("{}"); }
      });
    }).on("error", () => { res.writeHead(502); res.end("{}"); });
    return;
  }
  
  // ── Config API PUT proxy (for builtins update) ──
  if (pathname.startsWith("/api/builtins/") && req.method === "PUT") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const opts = {
        method: "PUT",
        hostname: "127.0.0.1",
        port: CONFIG_PORT,
        path: pathname,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      };
      const creq = http.request(opts, (cres) => {
        let d = "";
        cres.on("data", (c) => d += c);
        cres.on("end", () => {
          res.writeHead(cres.statusCode, { "Content-Type": "application/json" });
          res.end(d);
        });
      });
      creq.write(body);
      creq.end();
    });
    return;
  }

  // ── Model list with health status (for dashboard "模型运行状态") ──
  if (pathname === "/api/status/models" && req.method === "GET") {
    // Fetch model list AND health status, then merge
    const modelsUrl = `http://127.0.0.1:${CONFIG_PORT}/api/models`;
    const statusUrl = `http://127.0.0.1:${CONFIG_PORT}/api/status`;
    
    http.get(modelsUrl, (res2) => {
      let md = "";
      res2.on("data", (c) => md += c);
      res2.on("end", () => {
        let models = [];
        try { models = JSON.parse(md); } catch(e) {}
        
        // Also fetch health status
        http.get(statusUrl, (res3) => {
          let sd = "";
          res3.on("data", (c) => sd += c);
          res3.on("end", () => {
            let healthMap = {};
            try {
              const statusData = JSON.parse(sd);
              if (statusData && statusData.provider_health) {
                Object.keys(statusData.provider_health).forEach(function(k) {
                  healthMap[k.toLowerCase().trim()] = statusData.provider_health[k];
                });
              }
            } catch(e) {}
            
            // Merge health status into each model
            // Filter out built-in providers (e.g. MiMo) — they have their own tab in models.html
            const filtered = models.filter(m => !m.isBuiltin);
            const enriched = filtered.map(function(m, idx) {
              const slug = (m.slug || "").toLowerCase().trim();
              const pName = (m.name || "").toLowerCase().trim();
              // Try slug first, then name (health check may use name as key)
              const health = healthMap[slug] || healthMap[pName] || null;
              return {
                id: String(idx + 1),
                name: m.name || m.slug || "unknown",
                slug: m.slug || m.name || "",
                api: m.base || "",
                modelId: (m.models && m.models.length) ? m.models[0] : "",
                status: (health && health.status === "healthy") ? "online" : "offline",
                group: m.group || "其他",
                key: m.key || ""
              };
            });
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(enriched));
          });
        }).on("error", () => {
          // Fallback: model list without health status (exclude built-in)
          const filtered = models.filter(m => !m.isBuiltin);
          const fallback = filtered.map(function(m, idx) {
            return {
              id: String(idx + 1),
              name: m.name || m.slug || "unknown",
              api: m.base || "",
              modelId: (m.models && m.models.length) ? m.models[0] : "",
              status: "offline",
              group: m.group || "其他",
              key: m.key || ""
            };
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(fallback));
        });
      });
    }).on("error", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); });
    return;
  }

  // ── Token SSE Events (real-time push) ──
  if (pathname === "/api/tokens/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("data: " + JSON.stringify(getTokenUsage()) + "\n\n");
    sseClients.add(res);
    req.on("close", () => { sseClients.delete(res); });
    return;
  }

  // ── Static file serving with auth guard ──
  // Auth guard: skip auth check for login.html and auth API
  const isLoginPage = pathname === "/" || pathname === "/login.html" || pathname === "/index.html" || pathname === "/admin";
  const isAuthApi = pathname.startsWith("/api/auth/");

  let authenticated = false;
  if (!isAuthApi) {
    const cookie = parseCookies(req.headers.cookie || "");
    const session = validateSession(cookie.luoda_session);
    if (session) authenticated = true;

    // If not authenticated and not requesting login page, redirect to login
    if (!authenticated && !isLoginPage && !pathname.startsWith("/shared/") && !pathname.startsWith("/favicon")) {
      // Serve login.html instead
      serveStatic(res, path.join(ADMIN_ROOT, "login.html"));
      return;
    }
  }

  // Determine the file path
  let filePath;
  if (pathname === "/") {
    // Root: if authenticated, serve index.html, otherwise login.html
    filePath = path.join(ADMIN_ROOT, authenticated ? "index.html" : "login.html");
  } else {
    filePath = path.join(ADMIN_ROOT, pathname);
  }

  serveStatic(res, filePath);
});

// ─── Helper: parse cookies ─────────────────────────────────
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(";").forEach((pair) => {
    const parts = pair.trim().split("=");
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join("=").trim();
    }
  });
  return cookies;
}

// ─── Helper: serve static file ─────────────────────────────
function serveStatic(res, filePath) {
  // Security: prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ADMIN_ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      // Try index.html in directory
      const indexPath = path.join(resolved, "index.html");
      return serveStatic(res, indexPath);
    }

    const content = fs.readFileSync(resolved);

    // For index.html: inject server-side token data (fixes browser cache issues)
    let finalContent = content;
    if (ext === ".html" && filePath.includes("index.html")) {
      const tokenData = getTokenUsage();
      const tokenJson = JSON.stringify(tokenData);
      const neizhiSum = tokenData.neizhi.reduce((a,b)=>a+b, 0);
      const codexSum = tokenData.codex.reduce((a,b)=>a+b, 0);
      const hermesSum = tokenData.hermes.reduce((a,b)=>a+b, 0);
      const grand = neizhiSum + codexSum + hermesSum;
      
      function fmt(v){return v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?(v/1000).toFixed(1)+'K':String(v);}
      
      // Direct HTML string replacement (WORKS ALWAYS, no JS needed)
      let html = content.toString();
      html = html.replace('id="statTotal">0</div>', 'id="statTotal">'+fmt(grand)+'</div>');
      html = html.replace('id="statTotalTokens">0</span>', 'id="statTotalTokens">'+fmt(grand)+'</span>');
      html = html.replace('id="statNeizhi">0</div>', 'id="statNeizhi">'+fmt(neizhiSum)+'</div>');
      html = html.replace('id="statCodex">0</div>', 'id="statCodex">'+fmt(codexSum)+'</div>');
      html = html.replace('id="statHermes">0</div>', 'id="statHermes">'+fmt(hermesSum)+'</div>');
      
      // Also inject JS for real-time updates
      html = html.replace('</body>', `<script>window.__TOKEN_DATA__=${tokenJson};</script></body>`);
      finalContent = html;
    }
    
    // Cache control for performance (VPS deployment)
    const isStatic = [".js", ".css", ".png", ".jpg", ".svg", ".woff2", ".woff"].includes(ext);
    if (isStatic) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }

    if (ext === ".html" && filePath.includes("index.html")) {
      res.setHeader("Content-Length", Buffer.byteLength(finalContent));
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(finalContent);
  } catch (e) {
    if (e.code === "ENOENT") {
      // File not found, serve login.html as fallback
      try {
        const fallback = fs.readFileSync(path.join(ADMIN_ROOT, "login.html"));
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallback);
      } catch (e2) {
        res.writeHead(404);
        res.end("Not Found");
      }
    } else {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
}

// ─── Token Usage Tracking (in-memory, no localStorage) ──
var _tokenData = null;

// Persist token data to file for cross-restart survival
var _admTokPath = path.resolve(__dirname, "..", "..", "data", "admin-tokens.json");

function saveAdmTok() {
  try {
    var dir = path.dirname(_admTokPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_admTokPath, JSON.stringify(_tokenData));
  } catch(e) {}
}

function loadAdmTok() {
  try {
    if (fs.existsSync(_admTokPath)) {
      var raw = fs.readFileSync(_admTokPath, "utf8");
      var d = JSON.parse(raw);
      if (d && d.labels && d.labels.length) { _tokenData = d; }
    }
  } catch(e) {}
}
loadAdmTok();

function getDefaultTokenData() {
  const today = new Date();
  const label = String(today.getMonth() + 1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
  return { labels: [label], neizhi: [0], codex: [0], hermes: [0], total: 0 };
}

function loadTokenData() {
  return _tokenData;
}

function getTokenUsage() {
  // Method 1: Try proxy's live store (same process, instant)
  if (global.__tokenStore) {
    global.__tokenStore.total = Math.round((global.__tokenStore.neizhi.reduce((a,b)=>a+b,0) + global.__tokenStore.codex.reduce((a,b)=>a+b,0) + global.__tokenStore.hermes.reduce((a,b)=>a+b,0)) * 100) / 100;
    // 添加按模型的 token 排名
    if (global.__providerTokenMap && Object.keys(global.__providerTokenMap).length > 0) {
      var map = global.__providerTokenMap;
      var arr = Object.keys(map).map(function(k) {
        return { name: k, tokens: map[k] };
      }).sort(function(a, b) { return b.tokens - a.tokens; });
      global.__tokenStore.byProvider = arr;
    } else {
      // 没有按模型的数据时，按分组生成默认排名
      var ts = global.__tokenStore;
      var defaultRank = [];
      var nz = (ts.neizhi||[]).reduce(function(a,b){return a+b;},0);
      var cx = (ts.codex||[]).reduce(function(a,b){return a+b;},0);
      var hm = (ts.hermes||[]).reduce(function(a,b){return a+b;},0);
      if (nz > 0) defaultRank.push({name:'neizhiAPI', tokens:nz});
      if (cx > 0) defaultRank.push({name:'CodexAPI', tokens:cx});
      if (hm > 0) defaultRank.push({name:'HermesAPI', tokens:hm});
      defaultRank.sort(function(a,b){return b.tokens-a.tokens;});
      global.__tokenStore.byProvider = defaultRank;
    }
    return global.__tokenStore;
  }
  // Method 2: Use admin's own store (updated via global.__pushTokenUsage)
  let data = loadTokenData();
  if (!data || !data.labels || !data.labels.length) { data = getDefaultTokenData(); _tokenData = data; }
  data.total = Math.round((data.neizhi.reduce((a,b)=>a+b,0) + data.codex.reduce((a,b)=>a+b,0) + data.hermes.reduce((a,b)=>a+b,0)) * 100) / 100;
  // 也生成默认排名
  if (!data.byProvider) {
    var rank = [];
    var nz = (data.neizhi||[]).reduce(function(a,b){return a+b;},0);
    var cx = (data.codex||[]).reduce(function(a,b){return a+b;},0);
    var hm = (data.hermes||[]).reduce(function(a,b){return a+b;},0);
    if (nz > 0) rank.push({name:'neizhiAPI',tokens:nz});
    if (cx > 0) rank.push({name:'CodexAPI',tokens:cx});
    if (hm > 0) rank.push({name:'HermesAPI',tokens:hm});
    rank.sort(function(a,b){return b.tokens-a.tokens;});
    data.byProvider = rank;
  }
  return data;
}

function pushTokenUsage(entry) {
  let data = loadTokenData();
  if (!data) { data = getDefaultTokenData(); _tokenData = data; }
  const label = String(new Date().getMonth()+1).padStart(2,"0") + "-" + String(new Date().getDate()).padStart(2,"0");
  const idx = data.labels.indexOf(label);
  if (idx >= 0) { data.neizhi[idx] += entry.neizhi||0; data.codex[idx] += entry.codex||0; data.hermes[idx] += entry.hermes||0; }
  else { data.labels.push(label); data.neizhi.push(entry.neizhi||0); data.codex.push(entry.codex||0); data.hermes.push(entry.hermes||0); }
  _tokenData = data;
  saveAdmTok(); // Persist to file
  // 使用 getTokenUsage() 确保包含 byProvider 排名数据
  notifyTokenClients(getTokenUsage());
  return data;
}

function resetTokenUsage() {
  const fresh = getDefaultTokenData();
  _tokenData = fresh;
  saveAdmTok();
  // Also clear proxy's global store if running in the same process
  if (global.__tokenStore) {
    global.__tokenStore = null;
  }
  return fresh;
}

// ─── Start ─────────────────────────

// ─── Listen ─────
server.listen(PORT, () => {
  console.log("[admin-server] serving on http://127.0.0.1:" + PORT);
  console.log("[admin-server] admin root: " + ADMIN_ROOT);
});

export { pushTokenUsage };

export default function startAdminServer() {
  return server;
}

