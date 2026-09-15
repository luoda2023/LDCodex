// 校验 Tauri updater 的签名链路是否真的能通 —— 只读，不写任何业务文件。
//
// 为什么需要这个脚本：
//   `tauri.conf.json` 里的 pubkey 与构建时用的私钥**配错**时，客户端会
//   检测到新版本 → 下载 → 验签失败。而发版侧**完全看不出来** ——
//   CI 会绿、Release 会发、latest.json 也长得没问题。
//   这类「配错不报错」的坑正是本项目最怕的，所以这里把 Ed25519 验签真跑一遍。
//
// 做四件事（任一条 FAIL 即退出码 1）：
//   ① pubkey 能解析出真正的 Ed25519 公钥；
//   ①b 配置里的 pubkey 与本地 `.key.pub` **逐字节相同**（防手抄错一个字符）；
//   ② 用本地私钥签一段探针数据再用 pubkey 验签 → 证明「私钥与入库公钥配对」；
//   ③ 若 target/release/bundle/nsis 里有构建产物，直接验它的 .sig
//      → 证明「发出去的这个包客户端能验过」。
//
// 用法：node _test_daemon/verify-updater-signature.mjs
//
// ⚠️⚠️ Tauri 的编码约定（踩过才知道）：pubkey / 私钥 / .sig **文件整体都是 base64 文本**，
//   不是裸的 minisign 内容。所以要**解码两层**：
//     外层 base64 → minisign 文本（含 untrusted comment 行）
//     内层 base64（第一个非注释行）→ 真正的二进制块
//   公钥块 = alg(2) + keynum(8) + ed25519 公钥(32) = 42 字节
//   签名块 = alg(2) + keynum(8) + ed25519 签名(64) = 74 字节

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "apps", "codex-plus-manager");
const CONF = path.join(APP_DIR, "src-tauri", "tauri.conf.json");
const BUNDLE_DIR = path.join(REPO_ROOT, "target", "release", "bundle", "nsis");
// ⚠️ 私钥 2026-09-15 已从 `_tmp/updater-keys/` 挪到**仓库外**的 D:\LUODA\_LDCodex-keys\
// —— `_tmp/` 是 .gitignore 的临时目录，清一次磁盘密钥就没了（不可再生）。
// 换机器用 LDCODEX_UPDATER_KEY_DIR 指过去；找不到就跳过，不误报。
const KEY_DIR = process.env.LDCODEX_UPDATER_KEY_DIR || "D:\\LUODA\\_LDCodex-keys";
const KEY_FILE = path.join(KEY_DIR, "ldcodex-updater.key");
const PUB_KEY_FILE = `${KEY_FILE}.pub`;

// Ed25519 的 SPKI 前缀：Node 的 createPublicKey 不吃裸 32 字节，得手工包成
// SubjectPublicKeyInfo（DER）。这是 Ed25519 SPKI 的固定前缀。
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

let failures = 0;
const pass = (msg) => console.log(`PASS ${msg}`);
const fail = (msg) => { failures += 1; console.log(`FAIL ${msg}`); };
const skip = (msg) => console.log(`SKIP ${msg}`);

/** Tauri 的两层 base64：外层解出 minisign 文本，取第一个非注释行再解出二进制块。 */
function decodeTauriBlob(text) {
  const outer = Buffer.from(text.trim(), "base64").toString("utf8");
  const lines = outer.split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !/^(untrusted|trusted) comment/.test(l.trim()));
  if (lines.length === 0) throw new Error("两层 base64 解码后找不到数据行");
  return Buffer.from(lines[0].trim(), "base64");
}

/** 42 字节 minisign 公钥块 → { KeyObject, keyId }。 */
function publicKeyFromBlob(blob) {
  if (blob.length !== 42) throw new Error(`公钥块应为 42 字节，实际 ${blob.length}`);
  if (blob[0] !== 0x45) throw new Error(`公钥算法字节异常：0x${blob[0].toString(16)}`);
  const der = Buffer.concat([ED25519_SPKI_PREFIX, blob.subarray(10)]);
  return {
    key: crypto.createPublicKey({ key: der, format: "der", type: "spki" }),
    keyId: blob.subarray(2, 10),
  };
}

/**
 * 按 minisign 的约定算出「真正被签名的那段数据」。
 *
 * ⚠️ 本脚本最容易写错的地方（已踩过）：签名块头两字节决定签的是什么
 *   `Ed`(0x45 0x64) = 直接签**文件原始字节**
 *   `ED`(0x45 0x44) = **预哈希**：先算 BLAKE2b-512（64 字节），再签这个摘要
 * Tauri 默认走预哈希。不做这层判断会永远验签 false ——
 * 看起来像「密钥配错了」，实际是签的东西不对。
 */
function signedMessage(data, blob) {
  if (blob[0] !== 0x45) throw new Error(`签名算法字节异常：0x${blob[0].toString(16)}`);
  if (blob[1] === 0x44) return crypto.createHash("blake2b512").update(data).digest();
  if (blob[1] === 0x64) return data;
  throw new Error(`不支持的签名算法：0x${blob[0].toString(16)} 0x${blob[1].toString(16)}`);
}

/** 74 字节签名块 + 文件字节 → 验签结果。 */
function verifyBlob(publicKey, fileBytes, blob) {
  if (blob.length !== 74) throw new Error(`签名块应为 74 字节，实际 ${blob.length}`);
  return crypto.verify(null, signedMessage(fileBytes, blob), publicKey, blob.subarray(10));
}

const keyIdOf = (blob) => blob.subarray(2, 10).toString("hex").toUpperCase();

// ── ① pubkey 能不能解析成真公钥 ─────────────────────────────────────────────
let conf;
try {
  conf = JSON.parse(fs.readFileSync(CONF, "utf8"));
} catch (error) {
  fail(`读不到 / 解析不了 tauri.conf.json：${error.message}`);
  process.exit(1);
}
const pubkeyField = conf.plugins?.updater?.pubkey || "";
if (!pubkeyField) {
  fail("tauri.conf.json 里没有 plugins.updater.pubkey");
  process.exit(1);
}

let publicKey;
let pubKeyId;
try {
  const parsed = publicKeyFromBlob(decodeTauriBlob(pubkeyField));
  publicKey = parsed.key;
  pubKeyId = parsed.keyId.toString("hex").toUpperCase();
  pass(`pubkey 解析成功（keyId ${pubKeyId}）`);
} catch (error) {
  fail(`pubkey 解析失败：${error.message}`);
  process.exit(1);
}

// ── ①b 配置里的公钥必须与本地 .key.pub 逐字节相同 ────────────────────────────
// 为什么单独再查一遍：base64 手抄错**一个字符**时 keyId 往往仍然对得上
// （keyId 只占前 10 字节），下面那条「密钥对不匹配」不会触发，
// 只会表现成「验签失败」—— 极难定位。
if (!fs.existsSync(PUB_KEY_FILE)) {
  skip(`本地没有 ${path.relative(REPO_ROOT, PUB_KEY_FILE)}，跳过「配置公钥 == 本地公钥」比对`);
} else {
  const localPub = fs.readFileSync(PUB_KEY_FILE, "utf8").trim();
  if (localPub === pubkeyField) {
    pass("tauri.conf.json 的 pubkey 与本地 .key.pub 逐字节一致");
  } else {
    // 公钥绝不能靠手抄 —— 直接给可复制的正确值，避免再抄错一次。
    fail(
      "tauri.conf.json 的 pubkey 与本地 .key.pub 不一致（keyId 可能仍然相同，极具迷惑性）。\n" +
        "      请把 plugins.updater.pubkey 整段替换为：\n      " + localPub,
    );
  }
}

// ── ② 私钥 ↔ 公钥 配对（不需要安装包）────────────────────────────────────────
const cliJs = path.join(APP_DIR, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!fs.existsSync(KEY_FILE)) {
  skip(`本地没有私钥（${path.relative(REPO_ROOT, KEY_FILE)}），跳过配对校验`);
} else if (!fs.existsSync(cliJs)) {
  skip("找不到 tauri CLI，跳过配对校验");
} else {
  // ⚠️ 探针文件放**系统临时目录**，不要放仓库里的 `_tmp/`
  // —— `_tmp/` 是 .gitignore 的临时目录，被清掉后这里直接 ENOENT（2026-09-15 踩到）。
  const probe = path.join(os.tmpdir(), `ldcodex-updater-probe-${Date.now()}.txt`);
  try {
    fs.writeFileSync(probe, `ldcodex-updater-probe:${pubKeyId}\n`, "utf8");
    // ⚠️ -f 的路径必须是 **Windows 风格**（`D:/…`）—— Git Bash 的 `/d/…` 会被
    //    CLI 当成相对路径，报 `Unable to extract private key: Os { code: 3 }`。
    // ⚠️ 口令要写成 `--password=`（等号形式），**不能**写成 `"-p", ""`：
    //    空字符串参数会被吞掉，clap 就把下一个 token（待签文件路径）当成口令吃掉，
    //    最后报「required arguments were not provided: <FILE>」—— 看起来像 CLI 坏了。
    // ⚠️ 也别用 .bin/tauri.cmd + shell:true：Windows 下参数拼接后同样会错位。
    //    直接 node 跑它的 JS 入口最稳。
    const winPath = (p) => p.replace(/\\/g, "/");
    const res = spawnSync(
      process.execPath,
      [cliJs, "signer", "sign", "-f", winPath(KEY_FILE), "--password=", winPath(probe)],
      { encoding: "utf8", timeout: 60_000 },
    );
    const sigPath = `${probe}.sig`;
    if (res.status !== 0 || !fs.existsSync(sigPath)) {
      fail(`调用 tauri signer sign 失败（status=${res.status}）：${(res.stderr || res.stdout || "").trim().slice(0, 200)}`);
    } else {
      const blob = decodeTauriBlob(fs.readFileSync(sigPath, "utf8"));
      const sigKeyId = keyIdOf(blob);
      if (sigKeyId !== pubKeyId) {
        fail(`keyId 不一致：签名 ${sigKeyId} / 公钥 ${pubKeyId} —— 这俩根本不是一对，客户端会全部验签失败`);
      } else if (verifyBlob(publicKey, fs.readFileSync(probe), blob)) {
        pass(`本地私钥与 tauri.conf.json 的 pubkey 是同一对（keyId ${pubKeyId}，实测签验通过）`);
      } else {
        fail("私钥签出的数据无法被 pubkey 验证 —— 密钥对不匹配");
      }
    }
  } catch (error) {
    fail(`配对校验异常：${error.message}`);
  } finally {
    fs.rmSync(probe, { force: true });
    fs.rmSync(`${probe}.sig`, { force: true });
  }
}

// ── ③ 构建产物自带的 .sig 能不能验过 ────────────────────────────────────────
let setup = null;
try {
  setup = fs.readdirSync(BUNDLE_DIR)
    .filter((f) => /^LDCodex_.+_x64-setup\.exe$/.test(f))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(BUNDLE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.name ?? null;
} catch (_) {
  setup = null;
}

if (!setup) {
  skip(`没有构建产物（${path.relative(REPO_ROOT, BUNDLE_DIR)}），跳过安装包验签`);
} else {
  const exePath = path.join(BUNDLE_DIR, setup);
  const sigPath = `${exePath}.sig`;
  if (!fs.existsSync(sigPath)) {
    fail(`${setup} 存在但没有 .sig —— 这个包发出去客户端会拒绝安装`);
  } else {
    try {
      const blob = decodeTauriBlob(fs.readFileSync(sigPath, "utf8"));
      const sigKeyId = keyIdOf(blob);
      if (sigKeyId !== pubKeyId) {
        fail(`${setup} 的 .sig keyId(${sigKeyId}) 与 pubkey(${pubKeyId}) 不一致`);
      } else if (verifyBlob(publicKey, fs.readFileSync(exePath), blob)) {
        pass(`${setup} 的 .sig 对安装包本体验签通过`);
      } else {
        fail(`${setup} 的 .sig 验签失败 —— 签名与 pubkey 不匹配`);
      }
    } catch (error) {
      fail(`${setup} 验签异常：${error.message}`);
    }
  }
}

console.log("");
if (failures > 0) {
  console.error(`=== 更新签名校验：${failures} 项失败 ❌ ===`);
  process.exit(1);
}
console.log("=== 更新签名校验：全部通过 ✅ ===");
