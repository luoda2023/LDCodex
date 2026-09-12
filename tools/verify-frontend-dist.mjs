#!/usr/bin/env node
/**
 * 前端产物完整性校验（构建流水线中的保险丝）。
 *
 * 背景：Tauri 在编译期把 `apps/codex-plus-manager/dist` 整个嵌进 exe。
 * 如果这时 `dist/assets/` 缺失（例如清目录被安全策略中断、并发构建互相踩），
 * 打出来的 exe 里就只有 index.html，运行时请求 /assets/*.js 会拿到 HTML 回退、
 * 被浏览器的模块 MIME 校验拒绝 —— 表现是**一片空白窗口**，而且构建全程不报错。
 *
 * 这个脚本只做一件事：把 index.html 里真正引用到的 js/css 逐个核实存在。
 * 缺任何一个就立刻失败并说清原因，绝不让白屏包流出。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../apps/codex-plus-manager/dist");
const indexPath = path.join(distDir, "index.html");

function fail(message) {
  console.error(`\n[verify:dist] 前端产物不完整：${message}\n`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  fail(`找不到 ${indexPath}，前端似乎没有构建成功。`);
}

const html = readFileSync(indexPath, "utf8");
// 只认 Tauri 运行时会真正去取的那两类入口资源。
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);

if (refs.length === 0) {
  fail("index.html 里没有引用任何 js/css，说明构建产物异常。");
}

const missing = [];
for (const ref of refs) {
  const clean = ref.split("?")[0].split("#")[0];
  const rel = clean.replace(/^\/+/, "");
  const target = path.join(distDir, rel);
  if (!existsSync(target)) missing.push(`${ref}  ->  ${target}`);
}

if (missing.length > 0) {
  fail(`index.html 引用的资源不存在：\n  - ${missing.join("\n  - ")}`);
}

const jsCount = refs.filter((r) => r.endsWith(".js")).length;
const cssCount = refs.filter((r) => r.endsWith(".css")).length;
console.log(
  `[verify:dist] 前端产物完整：index.html 引用的 ${jsCount} 个 JS / ${cssCount} 个 CSS 均已就位。`,
);
