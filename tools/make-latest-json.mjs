#!/usr/bin/env node
/**
 * 生成 Tauri updater 的 `latest.json` —— 客户端「检测新版本」读的就是它。
 *
 * 为什么单独抽一个脚本：
 *   1. 字段名是 Tauri v2 的硬约定，写错客户端就永远检测不到更新（而且不报错，只是「无更新」）；
 *   2. 用 PowerShell 的 ConvertTo-Json 容易带 BOM / 转义问题，Node 写文件最稳；
 *   3. 抽出来就能单测（见 _test_daemon/make-latest-json.test.mjs，由 test-run.sh 直接跑）。
 *
 * 格式（字段名不可改）：
 *   {
 *     "version": "88.8.6",            ← **不带 v 前缀**，插件按 semver 与本地版本比较
 *     "notes": "更新说明",             ← 客户端会展示
 *     "pub_date": "2026-09-15T05:00:00Z",
 *     "platforms": {
 *       "windows-x86_64": { "signature": "<.sig 文件内容>", "url": "<安装包直链>" }
 *     }
 *   }
 *
 * 环境变量：
 *   VERSION     版本号（不带 v），必填
 *   SETUP_NAME  安装包文件名，必填
 *   SIG_FILE    .sig 签名文件路径，必填
 *   REPO        owner/repo，必填
 *   OUT         输出路径（默认 dist/release/latest.json）
 *   TAG         可选，默认 v<VERSION>
 *   NOTES       可选，默认 "LDCodex <VERSION>"
 *   PUB_DATE    可选，默认当前 UTC 时间（测试里固定它以保证可复现）
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['VERSION', 'SETUP_NAME', 'SIG_FILE', 'REPO'];

/** 组装 latest.json 的内容（纯函数，便于单测）。 */
export function buildLatestJson({ version, setupName, signature, repo, tag, notes, pubDate }) {
  if (!version) throw new Error('缺少 version');
  if (!setupName) throw new Error('缺少 setupName');
  if (!signature) throw new Error('缺少 signature');
  if (!repo) throw new Error('缺少 repo');

  // 版本号不带 v 前缀 —— Tauri 用 semver 比较，带 v 会解析失败。
  const cleanVersion = String(version).trim().replace(/^v/i, '');
  const releaseTag = tag || `v${cleanVersion}`;
  const url = `https://github.com/${repo}/releases/download/${releaseTag}/${encodeURIComponent(setupName)}`;

  return {
    version: cleanVersion,
    notes: notes ?? `LDCodex ${cleanVersion}`,
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': {
        signature: String(signature).trim(),
        url,
      },
    },
  };
}

function main() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`[make-latest-json] 缺少环境变量：${missing.join(', ')}`);
    process.exit(1);
  }

  const version = process.env.VERSION;
  const setupName = process.env.SETUP_NAME;
  const sigFile = process.env.SIG_FILE;
  const repo = process.env.REPO;
  const outPath = process.env.OUT || path.join('dist', 'release', 'latest.json');
  const pubDate = process.env.PUB_DATE || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (!fs.existsSync(sigFile)) {
    // 签名文件缺失 = 没配 TAURI_SIGNING_PRIVATE_KEY，绝不能静默发布一个「没有签名」的更新源：
    // 客户端会因校验失败而拒绝安装，表现为「检测到新版本但装不上」。
    console.error(`[make-latest-json] 找不到签名文件：${sigFile}`);
    console.error('  多半是构建时没有设置 TAURI_SIGNING_PRIVATE_KEY。');
    process.exit(1);
  }

  const payload = buildLatestJson({
    version,
    setupName,
    signature: fs.readFileSync(sigFile, 'utf8'),
    repo,
    tag: process.env.TAG,
    notes: process.env.NOTES,
    pubDate,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[make-latest-json] 已写入 ${outPath}`);
  console.log(JSON.stringify(payload, null, 2));
}

// 仅在被直接执行时跑 main（被 import 时只暴露 buildLatestJson）。
// ⚠️ 别用 `file://${process.argv[1]}` 拼字符串比较 —— Windows 盘符与中文路径下不可靠。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
