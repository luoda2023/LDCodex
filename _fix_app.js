const fs = require('fs');
let content = fs.readFileSync('apps/codex-plus-manager/src/App.tsx', 'utf8');
let count = 0;

// Fix 1: Debug -> 调试端口 in LatestLaunch
const re1 = /<Metric label="Debug" value=\{String\(status\.debug_port \?\? ".*?"\)\} \/>/;
if (re1.test(content)) {
  content = content.replace(re1, '<Metric label="调试端口" value={String(status.debug_port ?? "-")} />');
  count++; console.log('Fix1: Debug -> 调试端口');
}

// Fix 2: Helper -> 辅助端口 in LatestLaunch
const re2 = /<Metric label="Helper" value=\{String\(status\.helper_port \?\? ".*?"\)\} \/>/;
if (re2.test(content)) {
  content = content.replace(re2, '<Metric label="辅助端口" value={String(status.helper_port ?? "-")} />');
  count++; console.log('Fix2: Helper -> 辅助端口');
}

// Fix 3: Add "打开管理面板" button to ProxyScreen
// Find the Toolbar section in ProxyScreen and add a button
const oldProxyToolbar = <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
               启动代理
            </Button>
          </Toolbar>;

const newProxyToolbar = <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
               启动代理
            </Button>
            <Button variant="secondary" onClick={() => void actions.openExternalUrl("http://127.0.0.1:36002")}>
              <ExternalLink className="h-4 w-4" />
               打开管理面板
            </Button>
          </Toolbar>;

if (content.includes(oldProxyToolbar)) {
  content = content.replace(oldProxyToolbar, newProxyToolbar);
  count++; console.log('Fix3: Added 打开管理面板 button');
} else {
  console.log('Fix3: Pattern not found for proxy toolbar');
}

// Fix 4: Also add 打开管理面板 button in OverviewScreen proxy status panel
const oldOverviewToolbar = <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              启动代理
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              打开关于
            </Button>
          </Toolbar>;

const newOverviewToolbar = <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              启动代理
            </Button>
            <Button variant="secondary" onClick={() => void actions.openExternalUrl("http://127.0.0.1:36002")}>
              <ExternalLink className="h-4 w-4" />
              打开管理面板
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              打开关于
            </Button>
          </Toolbar>;

if (content.includes(oldOverviewToolbar)) {
  content = content.replace(oldOverviewToolbar, newOverviewToolbar);
  count++; console.log('Fix4: Added 打开管理面板 button to overview');
} else {
  console.log('Fix4: Overview toolbar pattern not found, trying alternate...');
}

fs.writeFileSync('apps/codex-plus-manager/src/App.tsx', content, 'utf8');
console.log('Total: ' + count + ' changes');
