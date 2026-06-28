const fs=require('fs');
let c=fs.readFileSync('apps/codex-plus-manager/src/App.tsx','utf8');
// 修复参数解构中的 null
c=c.replace('function EnhanceScreen({\n  form,\n  null,\n  onFormChange,\n  actions,\n}: {\n  form: BackendSettings;\n  null: TaskProgress;\n  onFormChange: (value: BackendSettings) => void;\n  actions: Actions;\n})', 'function EnhanceScreen({\n  form,\n  onFormChange,\n  actions,\n}: {\n  form: BackendSettings;\n  onFormChange: (value: BackendSettings) => void;\n  actions: Actions;\n})');
fs.writeFileSync('apps/codex-plus-manager/src/App.tsx',c,'utf8');
console.log('Fixed null param');
