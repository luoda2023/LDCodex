/*
 * 核对线上 Release 的资产与本地产物是否一致（不下大文件，只比 name + size + latest.json 内容）。
 * 为什么这么验：53MB 直链在这个环境里十多分钟都下不动，而 GitHub **不会改写上传的字节**，
 * 所以「同名 + 同字节数 + latest.json 内容一致」即等价于「线上就是本地那份」。
 * 本地那份的签名链路已由 verify-updater-signature.mjs 验过（4/4）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = process.env.REPO || 'luoda2023/LDCodex';
const VERSION = process.env.VERSION || '88.8.6';
const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
const TOKEN = remoteUrl.match(/https:\/\/([^@]+)@/)[1];
const HDR = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ldcodex-release-script',
};

let failures = 0;
const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { failures += 1; console.log('FAIL ' + m); };

// 路径从脚本自身位置推算，**不准写死 `_tmp/`** —— 那是 .gitignore 的临时目录，
// 清一次就断链（2026-09-15 踩过：脚本写死 `_tmp/inst/latest.json`，清完 _tmp 发版必失败）。
const NSIS = path.join(ROOT, 'target', 'release', 'bundle', 'nsis');
const SETUP = 'LDCodex_' + VERSION + '_x64-setup.exe';
const LOCAL = {
  [SETUP]: path.join(NSIS, SETUP),
  [SETUP + '.sig']: path.join(NSIS, SETUP + '.sig'),
  'latest.json': process.env.LATEST_JSON || path.join(ROOT, 'dist', 'release', 'latest.json'),
};

const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: HDR });
if (!res.ok) { console.error('拉 release 失败 HTTP ' + res.status); process.exit(1); }
const rel = await res.json();
console.log('Release: ' + rel.html_url);
console.log('tag = ' + rel.tag_name + ' / draft = ' + rel.draft + ' / prerelease = ' + rel.prerelease + '\n');

if (rel.tag_name === 'v' + VERSION) pass('tag = v' + VERSION); else fail('tag 不对：' + rel.tag_name);
if (rel.draft === false) pass('不是草稿（草稿不出现在 releases/latest）'); else fail('还是草稿状态，客户端取不到');
if (rel.prerelease === false) pass('不是 prerelease'); else fail('被标成 prerelease');

for (const [name, localPath] of Object.entries(LOCAL)) {
  const a = (rel.assets || []).find((x) => x.name === name);
  if (!a) { fail('线上缺资产 ' + name); continue; }
  const localSize = fs.statSync(localPath).size;
  if (a.size === localSize) { pass(name + ' 线上/本地同大小（' + localSize + ' B）'); continue; }
  // latest.json 是文本，notes 文案 / pub_date 不同都会让字节数变 —— 这不算问题
  // （真正影响客户端的字段在下面单独比）。所以只提示、不判失败。
  if (name === 'latest.json') {
    console.log('     （说明：latest.json 线上 ' + a.size + ' B / 本地 ' + localSize +
      ' B —— 文本差异通常只是 notes 或 pub_date，下面按有意义字段比对）');
  } else {
    fail(name + ' 大小不一致：线上 ' + a.size + ' / 本地 ' + localSize);
  }
}

// latest.json 内容比对（文件小，直接下）
// ⚠️ **不能逐字节比**：`pub_date` 是生成时刻，重新生成一次就变，
// 逐字节比会导致「内容其实一样却永远报不一致」（2026-09-15 踩到）。
// 只比真正影响客户端行为的字段：version + platforms（signature / url）。
const lj = await fetch('https://github.com/' + REPO + '/releases/latest/download/latest.json');
const remoteTxt = await lj.text();
const localTxt = fs.readFileSync(LOCAL['latest.json'], 'utf8');
const remoteJson = JSON.parse(remoteTxt);
const localJson = JSON.parse(localTxt);
const meaningful = (o) => JSON.stringify({ version: o.version, platforms: o.platforms });
if (meaningful(remoteJson) === meaningful(localJson)) {
  pass('线上 latest.json 与本地一致（version + signature + url 全等）');
} else {
  fail('线上 latest.json 与本地不一致（有意义字段）');
  console.log('     线上 = ' + meaningful(remoteJson).slice(0, 160));
  console.log('     本地 = ' + meaningful(localJson).slice(0, 160));
}
if (remoteJson.notes !== localJson.notes) {
  console.log('     （说明：notes 文案不同，不影响更新，仅 Release 页面显示）');
}
if (remoteJson.pub_date !== localJson.pub_date) {
  console.log('     （说明：pub_date 不同属正常 —— 它是生成时刻，不参与比对）');
}

const parsed = JSON.parse(remoteTxt);
if (parsed.version === VERSION) pass('线上 latest.json version = '+VERSION+'（无 v 前缀）');
else fail('线上 version 不对：' + parsed.version);
if (parsed.platforms['windows-x86_64'].url.endsWith(SETUP)) pass('下载直链指向本 Release 的安装包');
else fail('下载直链异常：' + parsed.platforms['windows-x86_64'].url);

console.log('\n=== 线上 Release 核对：' + (failures ? '❌ 失败 ' + failures + ' 项' : '✅ 全部通过') + ' ===');
process.exitCode = failures ? 1 : 0;
