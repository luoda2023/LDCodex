/**
 * LDZcode 注入脚本（Node.js）
 * 使用 @electron/asar 原生 API 解包/修改/打包 app.asar
 * 比 .bat 调用 asar CLI 更可靠（没有 PowerShell 转义问题）
 *
 * 用法: node do-inject.js [asar路径] [插件js路径]
 */
const fs = require('fs');
const path = require('path');

// 自动查找 @electron/asar 包
function findAsar() {
  const searchDirs = [
    __dirname,
    path.join(__dirname, '..'),
    path.join(__dirname, '..', '..'),
    process.cwd(),
  ];
  for (const d of searchDirs) {
    const p = path.join(d, 'node_modules', '@electron', 'asar');
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
  }
  return null;
}

async function main() {
  const ASAR = process.argv[2] || 'C:/Users/Administrator/AppData/Local/Programs/ZCode/resources/app.asar';
  const SRC = process.argv[3] || path.join(__dirname, 'zcode-customize.js');
  const TMP = path.join(__dirname, '_tmp_inject');

  // 检查文件
  if (!fs.existsSync(ASAR)) {
    console.error('[错误] 找不到 app.asar:', ASAR);
    process.exit(1);
  }
  if (!fs.existsSync(SRC)) {
    console.error('[错误] 找不到插件文件:', SRC);
    process.exit(1);
  }

  // 加载 @electron/asar
  const asarPkgDir = findAsar();
  if (!asarPkgDir) {
    console.error('[错误] 未找到 @electron/asar 包。');
    console.error('  请运行: npm install @electron/asar');
    process.exit(1);
  }
  const { extractAll, createPackageWithOptions } = require(path.join(asarPkgDir));

  // 清理旧临时目录
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });

  // 步骤1：解包
  console.log('[1/4] 解压 app.asar...');
  await extractAll(ASAR, TMP);
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
  await createPackageWithOptions(TMP, ASAR, { integrity: {} });
  console.log('      完成 ✅');

  // 清理
  fs.rmSync(TMP, { recursive: true });
  console.log('\n✅ LDZcode 插件注入成功！');
  console.log('  重启 ZCode 后按 Alt+L 打开面板。');
}

main().catch(err => {
  console.error('\n❌ 注入失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
