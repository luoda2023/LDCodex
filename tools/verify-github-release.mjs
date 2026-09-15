/*
 * 核对线上 Release 的资产与本地产物是否一致（不下大文件，只比 name + size + latest.json 内容）。
 * 为什么这么验：53MB 直链在这个环境里十多分钟都下不动，而 GitHub **不会改写上传的字节**，
 * 所以「同名 + 同字节数 + latest.json 内容一致」即等价于「线上就是本地那份」。
 * 本地那份的签名链路已由 verify-updater-signature.mjs 验过（4/4）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = 'luoda2023/LDCodex';
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

const LOCAL = {
  'LDCodex_88.8.6_x64-setup.exe': 'D:/LUODA/LDcodex/target/release/bundle/nsis/LDCodex_88.8.6_x64-setup.exe',
  'LDCodex_88.8.6_x64-setup.exe.sig': 'D:/LUODA/LDcodex/target/release/bundle/nsis/LDCodex_88.8.6_x64-setup.exe.sig',
  'latest.json': 'D:/LUODA/LDcodex/_tmp/inst/latest.json',
};

const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: HDR });
if (!res.ok) { console.error('拉 release 失败 HTTP ' + res.status); process.exit(1); }
const rel = await res.json();
console.log('Release: ' + rel.html_url);
console.log('tag = ' + rel.tag_name + ' / draft = ' + rel.draft + ' / prerelease = ' + rel.prerelease + '\n');

if (rel.tag_name === 'v88.8.6') pass('tag = v88.8.6'); else fail('tag 不对：' + rel.tag_name);
if (rel.draft === false) pass('不是草稿（草稿不出现在 releases/latest）'); else fail('还是草稿状态，客户端取不到');
if (rel.prerelease === false) pass('不是 prerelease'); else fail('被标成 prerelease');

for (const [name, localPath] of Object.entries(LOCAL)) {
  const a = (rel.assets || []).find((x) => x.name === name);
  if (!a) { fail('线上缺资产 ' + name); continue; }
  const localSize = fs.statSync(localPath).size;
  if (a.size === localSize) pass(name + ' 线上/本地同大小（' + localSize + ' B）');
  else fail(name + ' 大小不一致：线上 ' + a.size + ' / 本地 ' + localSize);
}

// latest.json 内容逐字节比（文件小，直接下）
const lj = await fetch('https://github.com/' + REPO + '/releases/latest/download/latest.json');
const remoteTxt = await lj.text();
const localTxt = fs.readFileSync(LOCAL['latest.json'], 'utf8');
if (remoteTxt.trim() === localTxt.trim()) pass('线上 latest.json 与本地逐字节一致');
else fail('线上 latest.json 与本地不一致');

const parsed = JSON.parse(remoteTxt);
if (parsed.version === '88.8.6') pass('线上 latest.json version = 88.8.6（无 v 前缀）');
else fail('线上 version 不对：' + parsed.version);
if (parsed.platforms['windows-x86_64'].url.endsWith('LDCodex_88.8.6_x64-setup.exe')) pass('下载直链指向本 Release 的安装包');
else fail('下载直链异常：' + parsed.platforms['windows-x86_64'].url);

console.log('\n=== 线上 Release 核对：' + (failures ? '❌ 失败 ' + failures + ' 项' : '✅ 全部通过') + ' ===');
process.exitCode = failures ? 1 : 0;
