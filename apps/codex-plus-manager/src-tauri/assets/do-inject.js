/**
 * LDZcode 注入脚本（Node.js CLI 方式）
 * 调用 @electron/asar 的 CLI（bin/asar.mjs）解包/修改/打包 app.asar
 * 用 child_process 执行，避开 ESM/CJS 兼容问题
 *
 * 用法: node do-inject.js [asar路径] [插件js路径]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findAsarCli() {
  const searchDirs = [__dirname, path.join(__dirname, '..'), path.join(__dirname, '..', '..'), process.cwd()];
  for (const d of searchDirs) {
    const p = path.join(d, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs');
    if (fs.existsSync(p)) return { cli: p, dir: path.dirname(path.dirname(path.dirname(p))) };
    const p2 = path.join(d, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
    if (fs.existsSync(p2)) return { cli: p2, dir: path.dirname(path.dirname(path.dirname(p2))) };
  }
  return null;
}

function main() {
  const ASAR = process.argv[2] || 'C:/Users/Administrator/AppData/Local/Programs/ZCode/resources/app.asar';
  const SRC = process.argv[3] || path.join(__dirname, 'zcode-customize.js');
  const TMP = path.join(__dirname, '_tmp_inject');

  // 检查文件
  if (!fs.existsSync(ASAR)) { console.error('[错误] 找不到 app.asar:', ASAR); process.exit(1); }
  if (!fs.existsSync(SRC)) { console.error('[错误] 找不到插件文件:', SRC); process.exit(1); }

  const asarInfo = findAsarCli();
  if (!asarInfo) {
    console.error('[错误] 未找到 @electron/asar CLI。请在 LDZcode 目录运行: npm install @electron/asar');
    process.exit(1);
  }

  const node = process.execPath;
  const asarCli = asarInfo.cli;

  // 清理旧临时目录
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });

  // 步骤1：解包
  console.log('[1/4] 解压 app.asar...');
  execFileSync(node, [asarCli, 'e', ASAR, TMP], { stdio: 'pipe' });
  console.log('      完成');

  // 步骤2：注入 script 引用
  const indexPath = path.join(TMP, 'out', 'renderer', 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('[错误] 未找到 index.html:', indexPath);
    process.exit(1);
  }

  let html = fs.readFileSync(indexPath, 'utf8');
  const marker = '<script defer src="./assets/zcode-customize.js"></script>';
  if (html.includes(marker)) {
    console.log('[2/4] script 引用已存在，跳过');
  } else {
    html = html.replace('</body>', `    ${marker}\n</body>`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('[2/4] script 引用已写入 ✅');
  }

  // 步骤3：复制插件脚本
  const assetsDir = path.join(TMP, 'out', 'renderer', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(SRC, path.join(assetsDir, 'zcode-customize.js'));
  console.log('[3/4] 插件脚本已复制 ✅');

  // 步骤4：打包回 app.asar
  console.log('[4/4] 打包 app.asar...');
  execFileSync(node, [asarCli, 'p', TMP, ASAR], { stdio: 'pipe' });
  console.log('      完成 ✅');

  // 清理
  fs.rmSync(TMP, { recursive: true });
  console.log('\n✅ LDZcode 插件注入成功！');
  console.log('  重启 ZCode 后按 Alt+L 打开面板。');
}

main();
