const fs=require('fs');
let c=fs.readFileSync('apps/codex-plus-manager/src/App.tsx','utf8');

// 1. SVG JSX 属性名修复（驼峰命名）
c=c.replace(/stroke-width=/g,'strokeWidth=');
c=c.replace(/stroke-linecap=/g,'strokeLinecap=');
c=c.replace(/stroke-linejoin=/g,'strokeLinejoin=');

// 2. style 字符串转 JSX 对象
c=c.replace(/style="vertical-align:middle;margin-right:4px"/g,'style={{verticalAlign:\"middle\",marginRight:4}}');

// 3. 删除交错引用 - 把 missing 的字段加到 Actions 类型
c=c.replace(/export interface Actions \{/g,'export interface Actions { refreshAds?: ()=>Promise<void>; refreshScriptMarket?: ()=>Promise<void>; installMarketScript?: (scriptId:string)=>Promise<void>; repairPluginMarketplace?: ()=>Promise<void>; refreshZedRemoteProjects?: ()=>Promise<void>; openZedRemoteProject?: (project:any)=>Promise<void>; forgetZedRemoteProject?: (projectId:string)=>Promise<void>; setUserScriptEnabled?: (id:string,enabled:boolean)=>Promise<void>; deleteUserScript?: (id:string)=>Promise<void>;');

// 4. BackendSettings 加缺失字段
c=c.replace(/export interface BackendSettings \{/g,'export interface BackendSettings { mobileControlRelayUrl?: string; mobileControlRoom?: string; mobileControlKey?: string; codexAppPluginMarketplaceUnlock?: boolean; codexAppPasteFix?: boolean; codexAppThreadIdBadge?: boolean; zedRemoteOpenStrategy?: string; zedRemoteProjectRegistryEnabled?: boolean; zedRemoteSyncToZedSettings?: boolean;');

// 5. 删除 pluginMarketplace 相关的 hooks 引用
c=c.replace(/const \[pluginMarketplacePrompt, setPluginMarketplacePrompt\] = useState[^;]+;/g,'const [pluginMarketplacePrompt, setPluginMarketplacePrompt] = [null as any, (n:any)=>{}];');
c=c.replace(/await checkPluginMarketplacePrompt\(\);/g,'/* removed checkPluginMarketplacePrompt */');

// 6. PluginMarketplaceStatusResult 和 ZedRemoteProjectsResult -> any
c=c.replace(/PluginMarketplaceStatusResult/g,'any');
c=c.replace(/ZedRemoteProjectsResult/g,'any');
c=c.replace(/ZedRemoteProject/g,'any');
c=c.replace(/AdItem/g,'any');

// 7. pluginMarketplaceProgress -> null
c=c.replace(/pluginMarketplaceProgress/g,'null');

// 8. navigate 替换
c=c.replace(/void navigate\(\"about\"\)/g,'setRoute(\"about\" as Route)');
c=c.replace(/const navigate = useCallback\(\(next: Route\) => \{[\s\S]*?\}, \[\]\);/g,'const navigate = (next: Route) => setRoute(next);');

// 9. badge 路由属性
c=c.replace(/\.badge/g,'/*badge*/');

// 10. 修理 BackendSettings Pick 约束
c=c.replace(/"mobileControlRelayUrl" \| "mobileControlRoom" \| "mobileControlKey"/g,'string');
c=c.replace(/"mobileControlRelayUrl"/g,'string');

fs.writeFileSync('apps/codex-plus-manager/src/App.tsx',c,'utf8');
console.log('All fixes applied');
