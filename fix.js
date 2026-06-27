const fs = require('fs');

// ===== 1. Fix App.tsx =====
let c = fs.readFileSync('apps/codex-plus-manager/src/App.tsx', 'utf-8');

// 1a. Add launchBridge to Actions type
c = c.replace(
  '  openExternalUrl: (url: string) => Promise<void>;',
  '  openExternalUrl: (url: string) => Promise<void>;\n  launchBridge: () => Promise<void>;'
);
console.log('1a done - launchBridge added to Actions type');

// 1b. Add launchBridge function
const marker = '  const showNotice = (title: string, message: string';
const bridgeFn = [
  '  };',
  '',
  '  const launchBridge = async () => {',
  '    const result = await run(() => call<CommandResult<Record<string, unknown>>>("launch_bridge"));',
  '    if (result) {',
  '      showResultNotice("启动代理", result, { silentSuccess: true });',
  '    }',
  '  };',
  '',
  '  const showNotice = (title: string, message: string'
].join('\n');
c = c.replace(marker, bridgeFn);
console.log('1b done - launchBridge function added');

// 1c. Add launchBridge to actions object
c = c.replace(
  '      openExternalUrl,\n      applyRelayInjection,',
  '      openExternalUrl,\n      launchBridge,\n      applyRelayInjection,'
);
console.log('1c done - launchBridge added to actions object');

// 1d. Fix 模型测试模型 -> 测试模型
let cnt = 0;
while (c.includes('模型测试模型')) {
  c = c.replace('模型测试模型', '测试模型');
  cnt++;
}
console.log('1d done - fixed', cnt, 'occurrences of 模型测试模型');

// 1e. Fix About page project URL
const oldUrl = 'https://github.com/BigPizzaV3/CodexPlusPlus';
if (c.includes(oldUrl)) {
  c = c.replace(new RegExp(oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'https://github.com/luoda2023/LDCodex');
  console.log('1e done - project URL fixed');
} else {
  console.log('1e - URL not found, checking...');
  // Check what URLs are in the about section
  let urlIdx = c.indexOf('github.com');
  while (urlIdx >= 0) {
    console.log('Found URL:', c.substring(urlIdx, urlIdx+60));
    urlIdx = c.indexOf('github.com', urlIdx+1);
    if (urlIdx > 110000) break;
  }
}

// 1f. Add sidebar footer
let navEndIdx = c.lastIndexOf('</nav>');
let asideEndIdx = c.indexOf('</aside>', navEndIdx);
const footer = [
  '',
  '            <div className="sidebar-footer">',
  '              <div className="sidebar-footer-brand">',
  '                <span className="sidebar-footer-link">Dicad.cn</span>',
  '                <span className="sidebar-footer-text">AI赋能工程设计</span>',
  '                <span className="sidebar-footer-en">LET IMAGINATION BECOME REALITY</span>',
  '              </div>',
  '            </div>'
].join('\n');
c = c.substring(0, asideEndIdx) + footer + c.substring(asideEndIdx);
console.log('1f done - sidebar footer added');

// 1g. Fix Codex 版本 check - find the AboutScreen
let aboutIdx = c.indexOf('Codex 版本');
console.log('Codex 版本 location:', aboutIdx);
if (aboutIdx >= 0) {
  console.log('About context:', c.substring(aboutIdx-20, aboutIdx+80));
}

fs.writeFileSync('apps/codex-plus-manager/src/App.tsx', c, 'utf-8');
console.log('App.tsx saved successfully');
