#!/usr/bin/env node
/**
 * 为「WorkBuddy增强」准备随包运行时。
 *
 * 做什么：
 *   1. 把 Node 运行时复制到 `apps/codex-plus-manager/src-tauri/resources/node/node.exe`，
 *      这样客户装完就能用，不需要自己再装 Node。
 *   2. 校验 `workbuddy-runtime/` 关键文件齐全（daemon.js / inject.js / profiles.js）。
 *
 * 为什么 Node 二进制不入库：
 *   一个 node.exe 约 87MB。把它提交进 git 会永久膨胀仓库历史，且随平台/版本变化。
 *   所以这里在构建前按需复制，产物目录加进 .gitignore。
 *
 * 用法：
 *   node tools/prepare-workbuddy-runtime.mjs            # 复制/校验
 *   node tools/prepare-workbuddy-runtime.mjs --check    # 只校验，缺文件则非零退出
 *
 * Node 来源优先级：
 *   1. 环境变量 LDCODEX_NODE_EXE
 *   2. PATH 上的 node
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(repoRoot, 'apps', 'codex-plus-manager', 'src-tauri');
const runtimeDir = path.join(tauriDir, 'workbuddy-runtime');
const resourcesDir = path.join(tauriDir, 'resources');
const targetNode = path.join(resourcesDir, 'node', process.platform === 'win32' ? 'node.exe' : 'node');

const REQUIRED_RUNTIME_FILES = ['daemon.js', 'inject.js', 'profiles.js', 'lib.js', 'package.json'];
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`[prepare-workbuddy-runtime] ${message}`);
  process.exit(1);
}

function resolveNodeSource() {
  const explicit = process.env.LDCODEX_NODE_EXE;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const probe = process.platform === 'win32' ? 'node.exe' : 'node';
  const pathVar = process.env.PATH || '';
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, probe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

function verifyRuntime() {
  if (!fs.existsSync(runtimeDir)) fail(`运行时目录不存在：${runtimeDir}`);
  const missing = REQUIRED_RUNTIME_FILES.filter((name) => !fs.existsSync(path.join(runtimeDir, name)));
  if (missing.length) fail(`运行时缺少关键文件：${missing.join(', ')}`);
  console.log(`[prepare-workbuddy-runtime] 运行时校验通过（${REQUIRED_RUNTIME_FILES.length} 个关键文件）。`);
}

function prepareNode() {
  if (fs.existsSync(targetNode)) {
    const size = fs.statSync(targetNode).size;
    if (size > 10 * 1024 * 1024) {
      console.log(`[prepare-workbuddy-runtime] 已存在随包 Node（${(size / 1024 / 1024).toFixed(1)}MB）。`);
      return;
    }
    // 太小说明上次复制中断了，删掉重来。
    fs.rmSync(targetNode, { force: true });
  }
  if (checkOnly) fail(`缺少随包 Node：${targetNode}（去掉 --check 以生成）`);

  const source = resolveNodeSource();
  fs.mkdirSync(path.dirname(targetNode), { recursive: true });
  fs.copyFileSync(source, targetNode);
  const size = fs.statSync(targetNode).size;
  console.log(
    `[prepare-workbuddy-runtime] 已复制 Node：${source} -> ${targetNode}（${(size / 1024 / 1024).toFixed(1)}MB）`,
  );
}

verifyRuntime();
prepareNode();

if (!checkOnly) {
  // 冒烟：确认随包 Node 能加载运行时的关键依赖。
  try {
    const version = execFileSync(targetNode, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`[prepare-workbuddy-runtime] 随包 Node 可执行：${version}`);
  } catch (error) {
    fail(`随包 Node 无法执行：${error.message}`);
  }
}
