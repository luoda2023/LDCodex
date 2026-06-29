const fs = require("fs");
const path = "apps/codex-plus-manager/src/App.tsx";
let content = fs.readFileSync(path, "utf8");
let log = [];

// ===== 1. 移除Zed类型定义 =====
let r;
r = /type ZedOpenStrategy[\s\S]*?"default";/; 
if (r.test(content)) { content = content.replace(r, ""); log.push("移除ZedOpenStrategy"); }

r = /type ZedRemoteProject = \{[^}]+\};/;
if (r.test(content)) { content = content.replace(r, ""); log.push("移除ZedRemoteProject"); }

r = /type ZedRemoteProjectsResult[\s\S]*?\};/;
if (r.test(content)) { content = content.replace(r, ""); log.push("移除ZedRemoteProjectsResult"); }

r = /type ZedRemoteOpenResult[\s\S]*?\};/;
if (r.test(content)) { content = content.replace(r, ""); log.push("移除ZedRemoteOpenResult"); }

// ===== 2. 移除Settings接口中的Zed字段 =====
["codexAppZedRemoteOpen: boolean;", "zedRemoteOpenStrategy: ZedOpenStrategy;", "zedRemoteProjectRegistryEnabled: boolean;", "zedRemoteSyncToZedSettings: boolean;"].forEach(f => {
  const re = new RegExp(`  ${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`, "g");
  content = content.replace(re, "");
});

// ===== 3. 移除默认值中的Zed字段 =====
["codexAppZedRemoteOpen: true,", "zedRemoteOpenStrategy: \"addToFocusedWorkspace\",", "zedRemoteProjectRegistryEnabled: true,", "zedRemoteSyncToZedSettings: false,"].forEach(f => {
  const re = new RegExp(`  ${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`, "g");
  content = content.replace(re, "");
});

// ===== 4. 移除zedRemoteProjects state =====
content = content.replace(/const \[zedRemoteProjects, setZedRemoteProjects\][^;]+;\n/g, "");

// ===== 5. 替换路由类型 =====
content = content.replace(
  `type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings"`,
  `type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings"`
);
log.push("路由类型清理");

// ===== 6. 侧边栏菜单移除 =====
content = content.replace(
  /  \{ id: "zedRemote", label: "[^"]*", icon: ExternalLink \},\n  \{ id: "userScripts", label: "[^"]*", icon: FileCode2 \},\n  \{ id: "recommendations", label: "[^"]*", icon: ExternalLink \},/g,
  ""
);
log.push("侧边栏菜单移除");

// ===== 7. 移除函数（用大括号匹配） =====
["openZedRemoteProject", "forgetZedRemoteProject", "refreshZedRemoteProjects"].forEach(funcName => {
  let idx = content.indexOf(`const ${funcName}`);
  if (idx >= 0) {
    let braceCount = 0, foundStart = false, endIdx = idx;
    for (let i = idx; i < content.length; i++) {
      if (content[i] === "{") { braceCount++; foundStart = true; }
      if (content[i] === "}") { braceCount--; }
      if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
    }
    // 找到前面的变量声明/分号等
    let before = content.substring(0, idx);
    let prevEnd = Math.max(before.lastIndexOf(";\n", idx-2), before.lastIndexOf("}\n", idx-2));
    if (prevEnd < 0) prevEnd = idx;
    // 如果是函数调用后的分号，向上找到函数结束
    content = before.substring(0, prevEnd + 2) + content.substring(endIdx);
    log.push(`移除函数 ${funcName}`);
  }
});

// ===== 8. 移除对删除函数的引用 =====
content = content.replace(/await refreshZedRemoteProjects\([^)]*\);\n/g, "");
content = content.replace(/refreshZedRemoteProjects\(true\);\n/g, "");
content = content.replace(/,?\s*refreshZedRemoteProjects[^,]*/g, "");
content = content.replace(/,?\s*openZedRemoteProject[^,]*/g, "");
content = content.replace(/,?\s*forgetZedRemoteProject[^,]*/g, "");

// ===== 9. 移除路由跳转 =====
content = content.replace(/if \(next === "zedRemote"\) \{[\s\S]*?\}\n/g, "");
content = content.replace(/if \(next === "userScripts"\) \{[\s\S]*?\}\n/g, "");
content = content.replace(/if \(next === "recommendations"\) [^;]+;\n/g, "");

// ===== 10. 移除路由描述 =====
content = content.replace(
  /zedRemote: "[^"]*",\s*userScripts: "[^"]*",\s*recommendations: "[^"]*",/g,
  ""
);

// ===== 11. 品牌化替换 =====
content = content.replace(/供应商配置/g, "模型配置");
content = content.replace(/启动 LDCodex/g, "启动代理");
content = content.replace(/启动Codex/g, "启动代理");
content = content.replace(/打开管理面板/g, "打开代理信息页");
content = content.replace(/github\.com\/BigPizzaV3\/CodexPlusPlus/g, "github.com/luoda2023/LDCodex");
log.push("品牌化替换完成");

// ===== 12. Debug/Helper标签 =====
content = content.replace(
  "<Metric label=\"Debug\" value={String(status.debug_port ?? \"-\")} />",
  "<Metric label=\"调试端口\" value={String(status.debug_port ?? \"-\")} />"
);
content = content.replace(
  "<Metric label=\"Helper\" value={String(status.helper_port ?? \"-\")} />",
  "<Metric label=\"辅助端口\" value={String(status.helper_port ?? \"-\")} />"
);

// ===== 13. 移除页面渲染区块 =====
["zedRemote", "userScripts", "recommendations"].forEach(route => {
  let idx = content.indexOf(`{activeRoute === "${route}"`);
  if (idx >= 0) {
    let braceCount = 0, foundStart = false, endIdx = idx;
    for (let i = idx; i < content.length; i++) {
      if (content[i] === "{") { braceCount++; foundStart = true; }
      if (content[i] === "}") { braceCount--; }
      if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
    }
    content = content.substring(0, idx) + content.substring(endIdx);
    log.push(`移除 ${route} 页面渲染`);
  }
});

// ===== 14. 版本号3.0.2 =====
content = content.replace(/"version": "\d+\.\d+\.\d+"/g, '"version": "3.0.2"');

fs.writeFileSync(path, content, "utf8");
console.log("完成！\n" + log.join("\n"));
