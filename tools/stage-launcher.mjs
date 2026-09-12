#!/usr/bin/env node
/**
 * 把 LDCodex 启动器（ldcodex.exe / ldcodex）复制进 Tauri 资源目录，
 * 让 NSIS 安装包随包分发启动器（安装后位于 <install>/resources/ldcodex.exe）。
 *
 * 背景：管理器的「启动 / 重启 Codex」以自身可执行文件所在目录为基准查找启动器。
 * 打包配置里没有把启动器纳入 bundle，导致安装版点击「重启 Codex/Chat」时报
 * 「无法启动 ...\ldcodex.exe：系统找不到指定的文件 (os error 2)」。
 * 开发态因为 manager 与 launcher 同在 target/release 下，所以看不出问题。
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const exeName = process.platform === "win32" ? "ldcodex.exe" : "ldcodex";
const source = join(repoRoot, "target", "release", exeName);
const destDir = join(repoRoot, "apps", "codex-plus-manager", "src-tauri", "resources");
const dest = join(destDir, exeName);

if (!existsSync(source)) {
  console.error(`[stage-launcher] 未找到启动器：${source}`);
  console.error("[stage-launcher] 请先执行：cargo build -p codex-plus-launcher --release");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
console.log(`[stage-launcher] 已复制 ${exeName} -> apps/codex-plus-manager/src-tauri/resources (${mb}MB)`);
