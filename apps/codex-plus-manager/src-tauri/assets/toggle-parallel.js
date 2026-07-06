/**
 * LDZcode - 并行对话切换辅助脚本
 * 用法: node toggle-parallel.js [parallel|queue]
 * 直接读写 ~/.zcode/v2/setting.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.USERPROFILE || os.homedir();
const settingFile = path.join(homeDir, '.zcode', 'v2', 'setting.json');

// 读取当前设置
let settings = {};
try {
  const raw = fs.readFileSync(settingFile, 'utf-8');
  settings = JSON.parse(raw);
} catch (e) {
  console.error('❌ 读取 setting.json 失败:', e.message);
  process.exit(1);
}

const newMode = process.argv[2];
if (!newMode || (newMode !== 'parallel' && newMode !== 'queue')) {
  console.log('当前 zcodeInteractionBehavior:', settings.zcodeInteractionBehavior || 'queue');
  console.log('');
  console.log('用法:');
  console.log('  node toggle-parallel.js parallel  启用并行对话');
  console.log('  node toggle-parallel.js queue     禁用并行对话（队列模式）');
  process.exit(0);
}

settings.zcodeInteractionBehavior = newMode;

try {
  fs.writeFileSync(settingFile, JSON.stringify(settings, null, 2), 'utf-8');
  console.log('✅ zcodeInteractionBehavior 已设置为: ' + newMode);
  console.log('⚠️  请重启 ZCode 使设置生效');
} catch (e) {
  console.error('❌ 写入 setting.json 失败:', e.message);
  process.exit(1);
}
