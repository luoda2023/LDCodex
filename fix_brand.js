const fs = require("fs");
let content = fs.readFileSync("apps/codex-plus-manager/src/App.tsx", "utf8");
let changed = false;

// 1. 移除Zed相关类型定义
let re1 = /type ZedOpenStrategy[\s\S]*?"default";/;
if (re1.test(content)) { content = content.replace(re1, ""); changed = true; console.log("移除 ZedOpenStrategy"); }

let re2 = /type ZedRemoteProject = \{[^}]+\};/;
if (re2.test(content)) { content = content.replace(re2, ""); changed = true; console.log("移除 ZedRemoteProject"); }

let re3 = /type ZedRemoteProjectsResult[\s\S]*?\};/;
if (re3.test(content)) { content = content.replace(re3, ""); changed = true; console.log("移除 ZedRemoteProjectsResult"); }

let re4 = /type ZedRemoteOpenResult[\s\S]*?\};/;
if (re4.test(content)) { content = content.replace(re4, ""); changed = true; console.log("移除 ZedRemoteOpenResult"); }

// 2. 移除Settings接口中的Zed字段
content = content.replace(/  codexAppZedRemoteOpen: boolean;\n/g, "");
content = content.replace(/  zedRemoteOpenStrategy: ZedOpenStrategy;\n/g, "");
content = content.replace(/  zedRemoteProjectRegistryEnabled: boolean;\n/g, "");
content = content.replace(/  zedRemoteSyncToZedSettings: boolean;\n/g, "");

// 3. 移除默认值中的Zed字段
content = content.replace(/  codexAppZedRemoteOpen: true,\n/g, "");
content = content.replace(/  zedRemoteOpenStrategy: "addToFocusedWorkspace",\n/g, "");
content = content.replace(/  zedRemoteProjectRegistryEnabled: true,\n/g, "");
content = content.replace(/  zedRemoteSyncToZedSettings: false,\n/g, "");

// 4. 移除zedRemoteProjects state
content = content.replace(/const \[zedRemoteProjects, setZedRemoteProjects\].*?null\);\n/g, "");

// 5. 替换路由类型
content = content.replace(
  'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings"',
  'type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings"'
);

// 6. 替换侧边栏菜单 - 移除zedRemote/userScripts/recommendations
content = content.replace(
  /  \{ id: "zedRemote", label: "[^"]*", icon: ExternalLink \},\n  \{ id: "userScripts", label: "[^"]*", icon: FileCode2 \},\n  \{ id: "recommendations", label: "[^"]*", icon: ExternalLink \},/g,
  ""
);

// 7. 移除openZedRemoteProject函数
let idx = content.indexOf("const openZedRemoteProject");
if (idx >= 0) {
  let braceCount = 0, foundStart = false, endIdx = idx;
  for (let i = idx; i < content.length; i++) {
    if (content[i] === "{") { braceCount++; foundStart = true; }
    if (content[i] === "}") { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  let before = content.substring(0, idx);
  let prevLineEnd = before.lastIndexOf(";\n", idx - 2);
  if (prevLineEnd < 0) prevLineEnd = before.lastIndexOf("}\n", idx - 2);
  if (prevLineEnd >= 0) {
    content = before.substring(0, prevLineEnd + 2) + content.substring(endIdx);
  } else {
    content = before + content.substring(endIdx);
  }
  changed = true;
  console.log("移除 openZedRemoteProject");
}

// 8. 移除forgetZedRemoteProject函数  
idx = content.indexOf("const forgetZedRemoteProject");
if (idx >= 0) {
  let braceCount = 0, foundStart = false, endIdx = idx;
  for (let i = idx; i < content.length; i++) {
    if (content[i] === "{") { braceCount++; foundStart = true; }
    if (content[i] === "}") { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  let before = content.substring(0, idx);
  let prevLineEnd = before.lastIndexOf(";\n", idx - 2);
  if (prevLineEnd < 0) prevLineEnd = before.lastIndexOf("}\n", idx - 2);
  if (prevLineEnd >= 0) {
    content = before.substring(0, prevLineEnd + 2) + content.substring(endIdx);
  } else {
    content = before.substring(0, idx) + content.substring(endIdx);
  }
  changed = true;
  console.log("移除 forgetZedRemoteProject");
}

// 9. 移除refreshZedRemoteProjects引用
content = content.replace(/await refreshZedRemoteProjects\([^)]*\);\n/g, "");
content = content.replace(/await refreshZedRemoteProjects\(\);\n/g, "");
content = content.replace(/refreshZedRemoteProjects\(true\);\n/g, "");
content = content.replace(/refreshZedRemoteProjects: [^,]+,/g, "");

// 10. 处理zedRemote路由跳转
content = content.replace(/if \(next === "zedRemote"\) \{[\s\S]*?\}/g, "");
content = content.replace(/if \(next === "userScripts"\) \{[\s\S]*?\}/g, "");
content = content.replace(/if \(next === "recommendations"\) [^;]+;/g, "");

// 11. 移除路由描述
content = content.replace(
  /zedRemote: "[^"]*",\s*userScripts: "[^"]*",\s*recommendations: "[^"]*",/g,
  ""
);

// 12. 品牌化替换
content = content.replace(/供应商配置/g, "模型配置");
content = content.replace(/启动 LDCodex/g, "启动代理");
content = content.replace(/启动Codex/g, "启动代理");
content = content.replace(/打开管理面板/g, "打开代理信息页");
content = content.replace(/github\.com\/BigPizzaV3\/CodexPlusPlus/g, "github.com/luoda2023/LDCodex");

// 13. Debug/Helper标签
content = content.replace(
  '<Metric label="Debug" value={String(status.debug_port ?? "-")} />',
  '<Metric label="调试端口" value={String(status.debug_port ?? "-")} />'
);
content = content.replace(
  '<Metric label="Helper" value={String(status.helper_port ?? "-")} />',
  '<Metric label="辅助端口" value={String(status.helper_port ?? "-")} />'
);

// 14. 移除Zed远程项目页面渲染
let zedRenderIdx = content.indexOf('{activeRoute === "zedRemote"');
if (zedRenderIdx >= 0) {
  let braceCount = 0, foundStart = false, endIdx = zedRenderIdx;
  for (let i = zedRenderIdx; i < content.length; i++) {
    if (content[i] === "{") { braceCount++; foundStart = true; }
    if (content[i] === "}") { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  content = content.substring(0, zedRenderIdx) + content.substring(endIdx);
  changed = true;
  console.log("移除 zedRemote 页面渲染");
}

// 15. 移除userScripts渲染
let usIdx = content.indexOf('{activeRoute === "userScripts"');
if (usIdx >= 0) {
  let braceCount = 0, foundStart = false, endIdx = usIdx;
  for (let i = usIdx; i < content.length; i++) {
    if (content[i] === "{") { braceCount++; foundStart = true; }
    if (content[i] === "}") { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  content = content.substring(0, usIdx) + content.substring(endIdx);
  changed = true;
  console.log("移除 userScripts 页面渲染");
}

// 16. 移除recommendations渲染
let recIdx = content.indexOf('{activeRoute === "recommendations"');
if (recIdx >= 0) {
  let braceCount = 0, foundStart = false, endIdx = recIdx;
  for (let i = recIdx; i < content.length; i++) {
    if (content[i] === "{") { braceCount++; foundStart = true; }
    if (content[i] === "}") { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  content = content.substring(0, recIdx) + content.substring(endIdx);
  changed = true;
  console.log("移除 recommendations 页面渲染");
}

if (changed) {
  fs.writeFileSync("apps/codex-plus-manager/src/App.tsx", content, "utf8");
  console.log("已保存更改");
} else {
  console.log("无更改");
}
