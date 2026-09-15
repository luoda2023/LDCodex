/*
 * 建 Release 并上传三个资产（安装包 / .sig / latest.json）。
 *
 * 为什么不走 CI：CI 只是让**以后**发版自动化；首版本地已经有签名好的产物，
 * 直接传上去就行，不必等 Secret 配好。
 *
 * 用法：
 *   VERSION=88.8.7 node tools/create-github-release.mjs
 *   VERSION=88.8.7 LATEST_JSON=dist/release/latest.json node tools/create-github-release.mjs
 *
 * ⚠️ token 只从 `git remote get-url origin` 里现取，**任何输出都不打印它**。
 * ⚠️ 路径一律从脚本自身位置推算，**不准写死 `_tmp/`** —— 那是 .gitignore 的临时目录，
 *    清一次就断链（2026-09-15 真踩过：脚本写死 `_tmp/inst/latest.json`，清完 _tmp 后发版必失败）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const REPO = process.env.REPO || 'luoda2023/LDCodex';
const VERSION = process.env.VERSION || '88.8.6';
const TAG = process.env.TAG || 'v' + VERSION;

const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
const tm = remoteUrl.match(/https:\/\/([^@]+)@/);
if (!tm) {
  console.error('✗ 远端 URL 里没找到凭据，无法调用 GitHub API');
  process.exit(1);
}
const TOKEN = tm[1];

const HDR = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ldcodex-release-script',
};

const NSIS = path.join(ROOT, 'target', 'release', 'bundle', 'nsis');
const SETUP = 'LDCodex_' + VERSION + '_x64-setup.exe';
// latest.json 的默认落点与 tools/make-latest-json.mjs 的 OUT 默认值对齐（dist/release/latest.json）。
const LATEST_JSON = process.env.LATEST_JSON || path.join(ROOT, 'dist', 'release', 'latest.json');
const ASSETS = [
  { file: path.join(NSIS, SETUP), name: SETUP, type: 'application/vnd.microsoft.portable-executable' },
  { file: path.join(NSIS, SETUP + '.sig'), name: SETUP + '.sig', type: 'text/plain' },
  { file: LATEST_JSON, name: 'latest.json', type: 'application/json' },
];

for (const a of ASSETS) {
  if (!fs.existsSync(a.file)) {
    console.error('✗ 缺文件：' + a.file);
    process.exit(1);
  }
}

const BODY = [
  '## LDCodex ' + VERSION,
  '',
  '### ① GitHub Release 自动升级',
  '',
  '- 启动后静默检测新版本，有更新时下载并询问是否重启安装（NSIS `passive` 模式）',
  '- 更新源：`latest.json`（官方格式，minisign 签名校验）',
  '',
  '### ② WorkBuddy 对话管理',
  '',
  '- 国内版 / 国际版会话统一面板：按状态 / 项目 / 时间 / 关键词筛选',
  '- **两档删除**：软删（可恢复）/ 彻底清除（可选先备份）',
  '- 正在对话中的会话：全选、反选自动跳过，手动单选仍然允许（客户选了就照做）',
  '- **跨版本同步**：自动分批（默认 20 条）+ 进度条；重复项默认不复制，弹窗让客户自己选',
  '',
  '> 数据位置：`<home>/workbuddy.db` 的 `sessions` 表 + `<home>/projects/<slug>/<id>.jsonl` 等。',
  '> ⚠️ `~/.workbuddy/sessions/*.json` 是运行时心跳，不是对话。',
  '',
  '---',
  '',
  '**安装**：下载 `LDCodex_' + VERSION + '_x64-setup.exe`，若提示「已存在版本为旧的」，选「请勿卸载」。',
].join('\n');

// ── 1) 建 Release（tag 不存在时 GitHub 会基于默认分支自动创建） ──
let rel;
const createRes = await fetch('https://api.github.com/repos/' + REPO + '/releases', {
  method: 'POST',
  headers: { ...HDR, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: TAG, name: 'LDCodex ' + VERSION, body: BODY, draft: false, prerelease: false }),
});
const createJson = await createRes.json();
if (createRes.ok) {
  rel = createJson;
  console.log('✓ Release 已创建：' + rel.html_url);
} else if (createRes.status === 422 && /already_exists/i.test(JSON.stringify(createJson))) {
  const getRes = await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + TAG, { headers: HDR });
  rel = await getRes.json();
  console.log('• Release 已存在，复用：' + rel.html_url);
} else {
  console.error('✗ 创建失败 HTTP ' + createRes.status + '：' + JSON.stringify(createJson).slice(0, 500));
  process.exit(1);
}

// ── 2) 上传资产 ──
const uploadBase = rel.upload_url.replace('{?name,label}', '');
for (const a of ASSETS) {
  const buf = fs.readFileSync(a.file);
  const up = await fetch(uploadBase + '?name=' + encodeURIComponent(a.name), {
    method: 'POST',
    headers: { ...HDR, 'Content-Type': a.type, 'Content-Length': String(buf.length) },
    body: buf,
  });
  const j = await up.json().catch(() => ({}));
  if (up.ok || up.status === 201) {
    console.log('✓ 已上传 ' + a.name + '（' + buf.length + ' B）');
  } else if (/already_exists/i.test(JSON.stringify(j))) {
    console.log('• ' + a.name + ' 已存在，先删再传');
    const listRes = await fetch('https://api.github.com/repos/' + REPO + '/releases/' + rel.id + '/assets', { headers: HDR });
    const assets = await listRes.json();
    const old = (assets || []).find((x) => x.name === a.name);
    if (old) {
      await fetch('https://api.github.com/repos/' + REPO + '/releases/assets/' + old.id, { method: 'DELETE', headers: HDR });
      const up2 = await fetch(uploadBase + '?name=' + encodeURIComponent(a.name), {
        method: 'POST',
        headers: { ...HDR, 'Content-Type': a.type, 'Content-Length': String(buf.length) },
        body: buf,
      });
      console.log(up2.ok || up2.status === 201 ? '✓ 已替换 ' + a.name : '✗ 替换失败 HTTP ' + up2.status);
    }
  } else {
    console.error('✗ 上传失败 ' + a.name + ' HTTP ' + up.status + '：' + JSON.stringify(j).slice(0, 300));
    process.exitCode = 1;
  }
}

console.log('\n完成：' + rel.html_url);
