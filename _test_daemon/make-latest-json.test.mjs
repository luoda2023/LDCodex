// make-latest-json 单测（Node 直接跑，不加 --test）。
//
// latest.json 是自动更新的**更新源**：字段名写错、版本号带了 v 前缀、url 拼错，
// 客户端都不会报错 —— 只会静默地「永远显示已是最新版本」。所以这里逐条钉死格式：
//   · version 必须**去掉 v 前缀**（Tauri 用 semver 比较，带 v 会解析失败）
//   · platforms 的键必须是 `windows-x86_64`（写错就找不到可下载资产）
//   · url 必须指向 releases/download/<tag>/<安装包名>，且文件名要 URL 编码
//   · .sig 缺失时必须**退出码 1** —— 绝不能静默发布一个「没有签名」的更新源
//
// 不动网络、不动 daemon、不动真实数据 —— CLI 用例全在临时目录里跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { buildLatestJson } = await import('../tools/make-latest-json.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'tools', 'make-latest-json.mjs');
const REPO = 'luoda2023/LDCodex';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'latest-json-test-'));
}

function rimraf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function runCli(env) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status == null ? 1 : error.status, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

// ── 纯函数 ──────────────────────────────────────────────────────────────

test('buildLatestJson：version 必须去掉 v 前缀', () => {
  const payload = buildLatestJson({
    version: 'v88.8.6',
    setupName: 'LDCodex_88.8.6_x64-setup.exe',
    signature: 'sig',
    repo: REPO,
  });
  assert.equal(payload.version, '88.8.6');
});

test('buildLatestJson：platforms 键必须是 windows-x86_64，且只有它一个', () => {
  const payload = buildLatestJson({
    version: '88.8.6',
    setupName: 'LDCodex_88.8.6_x64-setup.exe',
    signature: 'sig',
    repo: REPO,
  });
  assert.deepEqual(Object.keys(payload.platforms), ['windows-x86_64']);
  assert.deepEqual(Object.keys(payload.platforms['windows-x86_64']).sort(), ['signature', 'url']);
});

test('buildLatestJson：url 指向 releases/download/<tag>/<安装包名>', () => {
  const payload = buildLatestJson({
    version: '88.8.6',
    setupName: 'LDCodex_88.8.6_x64-setup.exe',
    signature: 'sig',
    repo: REPO,
  });
  assert.equal(
    payload.platforms['windows-x86_64'].url,
    `https://github.com/${REPO}/releases/download/v88.8.6/LDCodex_88.8.6_x64-setup.exe`,
  );
});

test('buildLatestJson：文件名含空格/中文时必须 URL 编码（否则客户端 404）', () => {
  const payload = buildLatestJson({
    version: '88.8.6',
    setupName: 'LDCodex 88.8.6 安装包.exe',
    signature: 'sig',
    repo: REPO,
  });
  const url = payload.platforms['windows-x86_64'].url;
  assert.ok(!url.includes(' '), `url 里有裸空格：${url}`);
  assert.ok(url.includes(encodeURIComponent('安装包')), `中文没被编码：${url}`);
});

test('buildLatestJson：tag 默认 v<version>，可被显式覆盖', () => {
  const base = { version: '88.8.6', setupName: 'a.exe', signature: 'sig', repo: REPO };
  assert.ok(buildLatestJson(base).platforms['windows-x86_64'].url.includes('/download/v88.8.6/'));
  assert.ok(
    buildLatestJson({ ...base, tag: 'v88.8.6-rc1' })
      .platforms['windows-x86_64'].url.includes('/download/v88.8.6-rc1/'),
  );
});

test('buildLatestJson：notes 默认 LDCodex <版本>，signature 两端空白被去掉', () => {
  const payload = buildLatestJson({
    version: '88.8.6',
    setupName: 'a.exe',
    signature: '  untrusted comment: x\nABC==\n',
    repo: REPO,
  });
  assert.equal(payload.notes, 'LDCodex 88.8.6');
  assert.equal(payload.platforms['windows-x86_64'].signature, 'untrusted comment: x\nABC==');
});

test('buildLatestJson：pub_date 原样透传（测试可复现的前提）', () => {
  const payload = buildLatestJson({
    version: '88.8.6',
    setupName: 'a.exe',
    signature: 'sig',
    repo: REPO,
    pubDate: '2026-09-15T00:00:00Z',
  });
  assert.equal(payload.pub_date, '2026-09-15T00:00:00Z');
});

test('buildLatestJson：缺关键入参必须抛错（不能默默产出半个更新源）', () => {
  const ok = { version: '88.8.6', setupName: 'a.exe', signature: 'sig', repo: REPO };
  assert.throws(() => buildLatestJson({ ...ok, version: '' }), /version/);
  assert.throws(() => buildLatestJson({ ...ok, setupName: '' }), /setupName/);
  assert.throws(() => buildLatestJson({ ...ok, signature: '' }), /signature/);
  assert.throws(() => buildLatestJson({ ...ok, repo: '' }), /repo/);
});

// ── CLI ────────────────────────────────────────────────────────────────

test('CLI：正常生成 latest.json，version 不带 v 前缀', () => {
  const dir = tmpDir();
  try {
    const sig = path.join(dir, 'LDCodex_88.8.6_x64-setup.exe.sig');
    fs.writeFileSync(sig, 'untrusted comment: signature\nABC123==\n', 'utf8');
    const out = path.join(dir, 'latest.json');

    const r = runCli({
      VERSION: 'v88.8.6',
      SETUP_NAME: 'LDCodex_88.8.6_x64-setup.exe',
      SIG_FILE: sig,
      REPO,
      TAG: 'v88.8.6',
      OUT: out,
      NOTES: '修好了自动更新',
      PUB_DATE: '2026-09-15T00:00:00Z',
    });

    assert.equal(r.code, 0, r.out);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(payload.version, '88.8.6');
    assert.equal(payload.notes, '修好了自动更新');
    assert.equal(payload.pub_date, '2026-09-15T00:00:00Z');
    assert.equal(
      payload.platforms['windows-x86_64'].url,
      `https://github.com/${REPO}/releases/download/v88.8.6/LDCodex_88.8.6_x64-setup.exe`,
    );
    assert.match(payload.platforms['windows-x86_64'].signature, /ABC123==/);
  } finally { rimraf(dir); }
});

test('CLI：签名文件不存在时必须退出码 1 且不产出文件', () => {
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'latest.json');
    const r = runCli({
      VERSION: '88.8.6',
      SETUP_NAME: 'LDCodex_88.8.6_x64-setup.exe',
      SIG_FILE: path.join(dir, 'missing.sig'),
      REPO,
      OUT: out,
    });
    assert.equal(r.code, 1, `期望失败，实际：${r.out}`);
    assert.match(r.out, /找不到签名文件/);
    assert.equal(fs.existsSync(out), false, '失败时不该留下 latest.json');
  } finally { rimraf(dir); }
});

test('CLI：缺必填环境变量时退出码 1 并点名缺了哪个', () => {
  const r = runCli({ VERSION: '', SETUP_NAME: '', SIG_FILE: '', REPO: '' });
  assert.equal(r.code, 1, `期望失败，实际：${r.out}`);
  assert.match(r.out, /缺少环境变量/);
});
