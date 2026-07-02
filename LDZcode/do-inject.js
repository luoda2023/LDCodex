const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ASAR = 'C:/Users/Administrator/AppData/Local/Programs/ZCode/resources/app.asar';
const TMP = 'J:\\WorkBuddy-work\\LDZcode\\_tmp';
const SRC = 'J:\\WorkBuddy-work\\LDZcode\\zcode-customize.js';

if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
fs.mkdirSync(path.join(TMP, 'out\\renderer\\assets'), { recursive: true });

console.log('[1] 解压...');
execSync(`"${process.env.comspec}" /c "cd /d "${TMP}" && npx asar e "${ASAR}" ."`, { stdio: 'pipe' });

const htmlFile = path.join(TMP, 'out\\renderer\\index.html');
const html = fs.readFileSync(htmlFile, 'utf8');
console.log(`  大小: ${html.length} 字节`);

if (!html.includes('zcode-customize')) {
  const newHtml = html.replace('</body>', '    <script defer src="./assets/zcode-customize.js"></script>\n</body>');
  fs.writeFileSync(htmlFile, newHtml, 'utf8');
  console.log('[2] ✅ 引用已写入');
} else {
  console.log('[2] 引用已存在');
}

fs.copyFileSync(SRC, path.join(TMP, 'out\\renderer\\assets\\zcode-customize.js'));
console.log('[3] ✅ 插件已复制');

console.log('[4] 打包...');
execSync(`"${process.env.comspec}" /c "cd /d "${TMP}" && npx asar p . "${ASAR}""`, { stdio: 'pipe' });

fs.rmSync(TMP, { recursive: true });
console.log('✅ 全部完成');
