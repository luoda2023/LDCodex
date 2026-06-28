const fs = require('fs');
const p = 'apps/codex-plus-manager/src/App.tsx';
let c = fs.readFileSync(p, 'utf-8');

c = c.replace('const SCRIPT_MARKET_REPOSITORY_URL = "https://github.com/luoda2023/LDCodexScriptMarket";\n', '');
c = c.replace('type ZedRemoteProject = {\n  host: string;\n  path: string;\n  source: string;\n  label?: string;\n};\n', '');
c = c.replace('type ZedRemoteProjectsResult = CommandResult<{\n  projects: ZedRemoteProject[];\n}>;\n', '');
c = c.replace('type ZedRemoteOpenResult = CommandResult<{\n  projects: string[];\n}>;\n', '');

// Remove state declarations
c = c.replace('  const [zedRemoteProjects, setZedRemoteProjects] = useState<ZedRemoteProjectsResult | null>(null);\n', '');
c = c.replace('  const [scriptMarket, setScriptMarket] = useState<ScriptMarketResult | null>(null);\n', '');

// Remove FeatureToggles - simpler approach: find lines containing Zed/Remote/script market
const lines = c.split('\n');
const filtered = lines.filter(line => {
  const trimmed = line.trim();
  // Remove FeatureToggle lines containing Zed or script market
  if (trimmed.includes('FeatureToggle') && (trimmed.includes('Zed') || trimmed.includes('ScriptMarket'))) return false;
  // Remove CardHead containing Zed
  if (trimmed.includes('CardHead') && trimmed.includes('Zed')) return false;
  // Remove select dropdown for Zed
  if (trimmed.includes('select') && trimmed.includes('zed')) return false;
  // Remove function definitions
  if (trimmed.startsWith('function') && (
    trimmed.includes('ZedRemote') || 
    trimmed.includes('UserScripts') || 
    trimmed.includes('Recommendations') || 
    trimmed.includes('ScriptMarket') || 
    trimmed.includes('MarketScript') ||
    trimmed.includes('zedRemote')
  )) {
    // Remove the entire function until }
    return false;
  }
  return true;
});

c = filtered.join('\n');

fs.writeFileSync(p, c, 'utf-8');
console.log('Phase 2 done - filtered');
