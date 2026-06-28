import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  CircleArrowUp,
  Copy,
  Download,
  Edit3,
  GripVertical,
  Info,
  ExternalLink,
  Hammer,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  FileCode2,
  Moon,
  Network,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sun,
  TestTube,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ProviderPresetSelector } from "@/components/ProviderPresetSelector";
import type { PresetPatch } from "@/components/ProviderPresetSelector";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Badge as UiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  modelWindowRowsFromProfile,
  serializeModelWindowRows,
  type ModelWindowRow,
} from "./model-windows";

type Status = "ok" | "failed" | "not_implemented" | "not_checked" | string;

type CommandResult<T> = T & {
  status: Status;
  message: string;
};

type PathState = {
  status: string;
  path: string | null;
};

type LaunchStatus = {
  status: string;
  message: string;
  started_at_ms: number;
  debug_port: number | null;
  helper_port: number | null;
  codex_app: string | null;
};

type OverviewResult = CommandResult<{
  codex_app: PathState;
  codex_version: string | null;
  silent_shortcut: PathState;
  management_shortcut: PathState;
  latest_launch: LaunchStatus | null;
  current_version: string;
  update_status: string;
  settings_path: string;
  logs_path: string;
}>;

type PluginMarketplaceRepairResult = CommandResult<{
  codexHome: string;
  marketplaceRoot?: string | null;
  initialized: boolean;
  configured: boolean;
  needsRepair: boolean;
}>;

type PluginMarketplaceStatusResult = CommandResult<{
  codexHome: string;
  marketplaceRoot?: string | null;
  configRegistered: boolean;
  needsRepair: boolean;
}>;

type BackendSettings = {
  codexAppPath: string;
  codexExtraArgs: string[];
  providerSyncEnabled: boolean;
  providerSyncSavedProviders: string[];
  providerSyncManualProviders: string[];
  providerSyncLastSelectedProvider: string;
  relayProfilesEnabled: boolean;
  enhancementsEnabled: boolean;
  computerUseGuardEnabled: boolean;
  codexAppPluginMarketplaceUnlock: boolean;
  codexAppForcePluginInstall: boolean;
  codexAppPluginAutoExpand: boolean;
  codexAppModelWhitelistUnlock: boolean;
  codexAppSessionDelete: boolean;
  codexAppMarkdownExport: boolean;
  codexAppPasteFix: boolean;
  codexAppProjectMove: boolean;
  codexAppThreadIdBadge: boolean;
  codexAppConversationView: boolean;
  codexAppThreadScrollRestore: boolean;
  codexAppZedRemoteOpen: boolean;
  zedRemoteOpenStrategy: ZedOpenStrategy;
  zedRemoteProjectRegistryEnabled: boolean;
  zedRemoteSyncToZedSettings: boolean;
  codexAppUpstreamWorktreeCreate: boolean;
  codexAppNativeMenuPlacement: boolean;
  codexAppNativeMenuLocalization: boolean;
  codexAppServiceTierControls: boolean;
  codexAppImageOverlayEnabled: boolean;
  codexAppImageOverlayPath: string;
  codexAppImageOverlayOpacity: number;
  codexGoalsEnabled: boolean;
  mobileControlEnabled: boolean;
  mobileControlRelayUrl: string;
  mobileControlRoom: string;
  mobileControlKey: string;
  launchMode: LaunchMode;
  relayBaseUrl: string;
  relayApiKey: string;
  relayProfiles: RelayProfile[];
  aggregateRelayProfiles: AggregateRelayProfile[];
  activeAggregateRelayId: string;
  relayCommonConfigContents: string;
  relayContextConfigContents: string;
  activeRelayId: string;
  relayTestModel: string;
  cliWrapperEnabled: boolean;
  cliWrapperBaseUrl: string;
  cliWrapperApiKey: string;
  cliWrapperApiKeyEnv: string;
};

type ZedOpenStrategy = "addToFocusedWorkspace" | "reuseWindow" | "newWindow" | "default";
type LaunchMode = "patch" | "relay";

export type RelayProfile = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  upstreamBaseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  relayMode: RelayMode;
  officialMixApiKey: boolean;
  testModel: string;
  configContents: string;
  authContents: string;
  useCommonConfig: boolean;
  contextSelection: RelayContextSelection;
  contextSelectionInitialized: boolean;
  contextWindow: string;
  autoCompactLimit: string;
  modelList: string;
  modelWindows: string;
  userAgent: string;
  aggregate?: RelayAggregateConfig | null;
};

type RelayAggregateStrategy = "failover" | "conversationRoundRobin" | "requestRoundRobin" | "weightedRoundRobin";
type RelayAggregateMember = {
  profileId: string;
  weight: number;
};
type RelayAggregateConfig = {
  strategy: RelayAggregateStrategy;
  members: RelayAggregateMember[];
};
type AggregateRelayMember = {
  relayId: string;
  weight: number;
};
type AggregateRelayProfile = {
  id: string;
  name: string;
  strategy: RelayAggregateStrategy;
  members: AggregateRelayMember[];
};

type RelayContextSelection = {
  mcpServers: string[];
  skills: string[];
  plugins: string[];
};

type ContextKind = "mcp" | "skill" | "plugin";

type CodexContextEntry = {
  id: string;
  kind: ContextKind;
  title: string;
  summary: string;
  tomlBody: string;
  enabled: boolean;
};

type CodexContextEntries = {
  mcpServers: CodexContextEntry[];
  skills: CodexContextEntry[];
  plugins: CodexContextEntry[];
};

type RelayProtocol = "responses" | "chatCompletions";
type RelayMode = "official" | "mixedApi" | "pureApi" | "aggregate";
const PROTOCOL_PROXY_BASE_URL = "http://127.0.0.1:57321/v1";
const CHAT_UPSTREAM_BASE_URL_KEY = "codex_plus_chat_base_url";
const SCRIPT_MARKET_REPOSITORY_URL = "https://github.com/luoda2023/LDCodexScriptMarket";
const LOCAL_MOBILE_RELAY_URL = "ws://127.0.0.1:57323";
const PUBLIC_MOBILE_RELAY_URL = "ws://154.201.90.76:57323";

const mobileRelayServers = [
  { id: "local", label: "鏈満娴嬭瘯", url: LOCAL_MOBILE_RELAY_URL, capacity: 100 },
  { id: "public-154", label: "鍏叡鏈嶅姟鍣?1", url: PUBLIC_MOBILE_RELAY_URL, capacity: 100 },
];

const emptyContextSelection = (): RelayContextSelection => ({
  mcpServers: [],
  skills: [],
  plugins: [],
});

type UserScriptInventory = {
  enabled?: boolean;
  scripts?: Array<{
    key: string;
    name: string;
    source: string;
    enabled: boolean;
    status: string;
    error: string;
    market_id?: string;
    version?: string;
    installed?: boolean;
    source_url?: string;
    homepage?: string;
  }>;
};

type SettingsResult = CommandResult<{
  settings: BackendSettings;
  settings_path: string;
  user_scripts: UserScriptInventory;
}>;

type RelayResult = CommandResult<{
  authenticated: boolean;
  authSource: string;
  accountLabel: string | null;
  configPath: string;
  configured: boolean;
  requiresOpenaiAuth: boolean;
  hasBearerToken: boolean;
  backupPath: string | null;
}>;

type RelayPayload = Omit<RelayResult, "status" | "message">;

type RelayFilesResult = CommandResult<{
  configPath: string;
  authPath: string;
  configContents: string;
  authContents: string;
}>;

type LocalSession = {
  id: string;
  title: string;
  cwd: string;
  modelProvider: string;
  archived: boolean;
  updatedAtMs: number | null;
  rolloutPath: string;
  dbPath: string;
};

type LocalSessionsResult = CommandResult<{
  dbPath: string;
  dbPaths: string[];
  sessions: LocalSession[];
}>;

type ZedRemoteProject = {
  id: string;
  label: string;
  hostId: string;
  ssh: {
    user: string;
    host: string;
    port: number | null;
  };
  path: string;
  url: string;
  source: "currentThread" | "codexRemoteProject" | "threadWorkspaceHint" | "sqliteThreadCwd" | "recent" | string;
  lastOpenedAtMs: number | null;
  isCurrent: boolean;
};

type ZedRemoteProjectsResult = CommandResult<{
  projects: ZedRemoteProject[];
}>;

type ZedRemoteOpenResult = CommandResult<{
  url: string;
  strategy: ZedOpenStrategy;
}>;

type DeleteLocalSessionResult = CommandResult<{
  status: string;
  session_id: string;
  message: string;
  undo_token: string | null;
  backup_path: string | null;
}>;

type ContextEntriesResult = CommandResult<{
  settings: BackendSettings;
  entries: CodexContextEntries;
}>;

type LiveContextEntriesResult = CommandResult<{
  entries: CodexContextEntries;
}>;

type ExtractRelayCommonConfigResult = CommandResult<{
  commonConfigContents: string;
  profileConfigContents: string;
}>;

type RelaySwitchResult = CommandResult<{
  settings: BackendSettings;
  settingsPath: string;
  user_scripts: unknown;
  relay: RelayPayload;
}>;

type SettingsBackfillResult = CommandResult<{
  settings: BackendSettings;
}>;

type RelayProfileTestResult = CommandResult<{
  httpStatus: number;
  endpoint: string;
  responsePreview: string;
}>;

type RelayProfileModelsResult = CommandResult<{
  models: string[];
  endpoint: string;
}>;

type CcsProviderImport = {
  sourceId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  configContents: string;
  authContents: string;
};

type CcsProvidersResult = CommandResult<{
  dbPath: string;
  providers: CcsProviderImport[];
}>;

type ProviderImportRequest = {
  name: string;
  baseUrl: string;
  apiKey: string;
  wireApi: string;
  relayMode: string;
  configContents: string;
  authContents: string;
};

type PendingProviderImportResult = CommandResult<{
  pending: ProviderImportRequest | null;
}>;

type EnvConflict = {
  name: string;
  source: "process" | "user" | string;
  valuePresent: boolean;
};

type EnvConflictsResult = CommandResult<{
  conflicts: EnvConflict[];
}>;

type RemoveEnvConflictsResult = CommandResult<{
  removed: Array<{
    name: string;
    removedProcess: boolean;
    removedUser: boolean;
  }>;
  backupPath: string | null;
  remaining: EnvConflict[];
}>;

type ProviderSyncPayload = {
  syncStatus?: string;
  targetProvider?: string;
  changedSessionFiles?: number;
  skippedLockedRolloutFiles?: string[];
  sqliteRowsUpdated?: number;
  sqliteProviderRowsUpdated?: number;
  sqliteUserEventRowsUpdated?: number;
  sqliteCwdRowsUpdated?: number;
  updatedWorkspaceRoots?: number;
  encryptedContentWarning?: string | null;
};

type ProviderSyncTargetSource = "config" | "rollout" | "sqlite" | "manual";

type ProviderSyncTargetOption = {
  id: string;
  sources: ProviderSyncTargetSource[];
  isCurrentProvider: boolean;
  isManual: boolean;
  isSaved: boolean;
};

type ProviderSyncTargetsPayload = {
  currentProvider: string;
  targets: ProviderSyncTargetOption[];
};

type ProviderSyncTargetsResult = CommandResult<ProviderSyncTargetsPayload>;

type ProviderSyncProgress = {
  active: boolean;
  percent: number;
  message: string;
  result: CommandResult<ProviderSyncPayload> | null;
};

type TaskProgress = {
  active: boolean;
  percent: number;
  message: string;
};

type LogsResult = CommandResult<{
  path: string;
  text: string;
  lines: number;
}>;

type DiagnosticsResult = CommandResult<{
  report: string;
}>;

type WatcherResult = CommandResult<{
  enabled: boolean;
  disabled_flag: string;
}>;

type InstallResult = CommandResult<{
  silent_shortcut: { installed: boolean; path: string | null };
  management_shortcut: { installed: boolean; path: string | null };
}>;

type UpdateResult = CommandResult<{
  currentVersion: string;
  latestVersion?: string | null;
  releaseSummary?: string;
  assetName?: string | null;
  assetUrl?: string | null;
  updateAvailable?: boolean;
  installedPath?: string;
  progress?: number;
}>;

type AdItem = {
  id?: string;
  type: "sponsor" | "normal" | string;
  title: string;
  description: string;
  url: string;
  highlights?: string[];
  expires_at?: string;
};

type AdsResult = CommandResult<{
  version: number;
  ads: AdItem[];
}>;

type ScriptMarketItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  homepage: string;
  script_url: string;
  sha256: string;
  installed: boolean;
  installedVersion: string;
  updateAvailable: boolean;
};

type ScriptMarketResult = CommandResult<{
  market: {
    status: string;
    message: string;
    indexUrl: string;
    updatedAt: string;
    scripts: ScriptMarketItem[];
  };
  user_scripts: UserScriptInventory;
}>;

function providerSyncProgressMessage(result: CommandResult<ProviderSyncPayload>): string {
  const changed = result.changedSessionFiles ?? 0;
  const rows = result.sqliteRowsUpdated ?? 0;
  const target = result.targetProvider || "褰撳墠 provider";
  const skipped = result.skippedLockedRolloutFiles?.length ?? 0;
  const skippedText = skipped ? `锛岃烦杩?${skipped} 涓崰鐢ㄦ枃浠禶 : "";
  return `宸插悓姝ュ埌 ${target}锛氫慨澶?${changed} 涓細璇濇枃浠讹紝鏇存柊 ${rows} 琛岀储寮?{skippedText}銆俙;
}

const providerSyncSourceLabels: Record<ProviderSyncTargetSource, string> = {
  config: "閰嶇疆",
  rollout: "浼氳瘽",
  sqlite: "绱㈠紩",
  manual: "鎵嬪姩",
};

function providerSyncTargetLabel(target: ProviderSyncTargetOption): string {
  const labels = target.sources.map((source) => providerSyncSourceLabels[source]).filter(Boolean);
  const current = target.isCurrentProvider ? ["褰撳墠"] : [];
  return [...labels, ...current].join(" / ") || "鍙戠幇";
}

function syncMarketInstalledState(current: ScriptMarketResult | null, userScripts: UserScriptInventory): ScriptMarketResult | null {
  if (!current) return current;
  const installed = new Map(
    (userScripts.scripts ?? [])
      .filter((script) => script.market_id)
      .map((script) => [script.market_id || "", script.version || ""]),
  );
  return {
    ...current,
    user_scripts: userScripts,
    market: {
      ...current.market,
      scripts: current.market.scripts.map((script) => {
        const installedVersion = installed.get(script.id) || "";
        return {
          ...script,
          installed: Boolean(installedVersion),
          installedVersion,
          updateAvailable: Boolean(installedVersion) && installedVersion !== script.version,
        };
      }),
    },
  };
}

type StartupResult = CommandResult<{
  showUpdate: boolean;
}>;

type Route = "overview" | "relay" | "mobileControl" | "sessions" | "context" | "enhance" | "zedRemote" | "userScripts" | "recommendations" | "maintenance" | "about" | "settings";
type Theme = "dark" | "light";

const routes: Array<{ id: Route; label: string; icon: LucideIcon; badge?: string }> = [
  { id: "overview", label: "姒傝", icon: LayoutDashboard },
  { id: "relay", label: "妯″瀷閰嶇疆", icon: KeyRound },
  { id: "mobileControl", label: "鎵嬫満鎺у埗", icon: MessageCircle, badge: "娴嬭瘯鐗? },
  { id: "sessions", label: "浼氳瘽绠＄悊", icon: MessageCircle },
  { id: "context", label: "宸ュ叿涓庢彃浠?, icon: Network },
  { id: "enhance", label: "Codex澧炲己", icon: Hammer },
  { id: "zedRemote", label: "Zed 杩滅▼椤圭洰", icon: ExternalLink },
  { id: "userScripts", label: "鑴氭湰甯傚満", icon: FileCode2 },
  { id: "recommendations", label: "鎺ㄨ崘鍐呭", icon: ExternalLink },
  { id: "maintenance", label: "瀹夎缁存姢", icon: Wrench },
  { id: "about", label: "鍏充簬", icon: Info },
  { id: "settings", label: "璁剧疆", icon: Settings },
];

const defaultSettings: BackendSettings = {
  codexAppPath: "",
  codexExtraArgs: [],
  providerSyncEnabled: false,
  providerSyncSavedProviders: [],
  providerSyncManualProviders: [],
  providerSyncLastSelectedProvider: "",
  relayProfilesEnabled: true,
  enhancementsEnabled: true,
  computerUseGuardEnabled: false,
  codexAppPluginMarketplaceUnlock: true,
  codexAppForcePluginInstall: true,
  codexAppPluginAutoExpand: true,
  codexAppModelWhitelistUnlock: true,
  codexAppSessionDelete: true,
  codexAppMarkdownExport: true,
  codexAppPasteFix: false,
  codexAppProjectMove: true,
  codexAppThreadIdBadge: false,
  codexAppConversationView: false,
  codexAppThreadScrollRestore: true,
  codexAppZedRemoteOpen: true,
  zedRemoteOpenStrategy: "addToFocusedWorkspace",
  zedRemoteProjectRegistryEnabled: true,
  zedRemoteSyncToZedSettings: false,
  codexAppUpstreamWorktreeCreate: true,
  codexAppNativeMenuPlacement: true,
  codexAppNativeMenuLocalization: true,
  codexAppServiceTierControls: false,
  codexAppImageOverlayEnabled: false,
  codexAppImageOverlayPath: "",
  codexAppImageOverlayOpacity: 35,
  codexGoalsEnabled: false,
  mobileControlEnabled: false,
  mobileControlRelayUrl: LOCAL_MOBILE_RELAY_URL,
  mobileControlRoom: "",
  mobileControlKey: "",
  launchMode: "patch",
  relayBaseUrl: "",
  relayApiKey: "",
  relayProfiles: [
    {
      id: "default",
      name: "榛樿涓浆",
      model: "",
      baseUrl: "",
      upstreamBaseUrl: "",
      apiKey: "",
      protocol: "responses",
      relayMode: "official",
      officialMixApiKey: false,
      testModel: "",
      configContents: "",
      authContents: "",
      useCommonConfig: true,
      contextSelection: emptyContextSelection(),
      contextSelectionInitialized: true,
      contextWindow: "",
      autoCompactLimit: "",
      modelList: "",
      modelWindows: "",
      userAgent: "",
    },
  ],
  relayCommonConfigContents: "",
  relayContextConfigContents: "",
  activeRelayId: "default",
  aggregateRelayProfiles: [],
  activeAggregateRelayId: "",
  relayTestModel: "gpt-5.4-mini",
  cliWrapperEnabled: false,
  cliWrapperBaseUrl: "",
  cliWrapperApiKey: "",
  cliWrapperApiKeyEnv: "CUSTOM_OPENAI_API_KEY",
};

export function App() {
  const [theme, setTheme] = useState<Theme>(() => loadInitialTheme());
  const [route, setRoute] = useState<Route>(() => loadInitialRoute());
  const [notice, setNotice] = useState<{ title: string; message: string; status?: Status } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [relay, setRelay] = useState<RelayResult | null>(null);
  const [relayFiles, setRelayFiles] = useState<RelayFilesResult | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflictsResult | null>(null);
  const [ccsProviders, setCcsProviders] = useState<CcsProvidersResult | null>(null);
  const [pendingProviderImport, setPendingProviderImport] = useState<ProviderImportRequest | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSessionsResult | null>(null);
  const [zedRemoteProjects, setZedRemoteProjects] = useState<ZedRemoteProjectsResult | null>(null);
  const [liveContextEntries, setLiveContextEntries] = useState<CodexContextEntries | null>(null);
  const [logs, setLogs] = useState<LogsResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [watcher, setWatcher] = useState<WatcherResult | null>(null);
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [ads, setAds] = useState<AdsResult | null>(null);
  const [scriptMarket, setScriptMarket] = useState<ScriptMarketResult | null>(null);
  const [launchForm, setLaunchForm] = useState({
    appPath: "",
    debugPort: "9229",
    helperPort: "57321",
  });
  const prevLaunchStatusRef = useRef<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<BackendSettings>({ ...defaultSettings });
  const [providerSyncProgress, setProviderSyncProgress] = useState<ProviderSyncProgress>({
    active: false,
    percent: 0,
    message: "灏氭湭杩愯鍘嗗彶浼氳瘽淇銆?,
    result: null,
  });
  const [pluginMarketplaceProgress, setPluginMarketplaceProgress] = useState<TaskProgress>({
    active: false,
    percent: 0,
    message: "灏氭湭杩愯鎻掍欢甯傚満淇銆?,
  });
  const [pluginMarketplacePrompt, setPluginMarketplacePrompt] = useState<PluginMarketplaceStatusResult | null>(null);
  const [providerSyncTargets, setProviderSyncTargets] = useState<ProviderSyncTargetsResult | null>(null);
  const [selectedProviderSyncTarget, setSelectedProviderSyncTarget] = useState("");
  const [removeOwnedData, setRemoveOwnedData] = useState(false);
  const [relaySwitching, setRelaySwitching] = useState(false);

  const call = <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

  const logDiagnostic = (event: string, detail: Record<string, unknown> = {}) => {
    void invoke("write_diagnostic_event", { event, detail }).catch(() => {});
  };

  const run = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    try {
      return await task();
    } catch (error) {
      showNotice("璋冪敤澶辫触", stringifyError(error), "failed");
      return null;
    }
  };

  const refreshOverview = async (silent = false) => {
    const result = await run(() => call<OverviewResult>("load_overview"));
    if (result) {
      // 宕╂簝妫€娴嬶細杩涚▼浠庤繍琛岀姸鎬佸彉涓哄仠姝?澶辫触 鈫?寮瑰嚭閫氱煡
      const prev = prevLaunchStatusRef.current;
      const current = result.latest_launch?.status;
      if (prev && prev === "running" && current && (current === "stopped" || current === "failed" || current === "crashed")) {
        showNotice("Codex 鎰忓鍋滄", `杩涚▼鐘舵€侊細${current}銆傛槸鍚﹁閲嶆柊鍚姩锛焋, "failed");
      }
      prevLaunchStatusRef.current = current ?? null;
      setOverview(result);
      if (!silent) showResultNotice("姒傝宸叉鏌?, result, { silentSuccess: true });
    }
  };

  const refreshSettings = async (silent = false) => {
    const result = await run(() => call<SettingsResult>("load_settings"));
    if (result) {
      setSettings(result);
      const normalized = normalizeSettings(result.settings);
      setSettingsForm(normalized);
      setLaunchForm((current) => ({
        ...current,
        appPath: current.appPath || result.settings.codexAppPath || "",
      }));
      if (!silent) showResultNotice("璁剧疆宸插姞杞?, result, { silentSuccess: true });
      return normalized;
    }
    return null;
  };

  const refreshScriptMarket = async (silent = false) => {
    const result = await run(() => call<ScriptMarketResult>("refresh_script_market"));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("鑴氭湰甯傚満", result, { silentSuccess: true });
    }
  };

  const installMarketScript = async (id: string) => {
    const result = await run(() => call<ScriptMarketResult>("install_market_script", { id }));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      showResultNotice("鑴氭湰甯傚満", result);
    }
  };

  const setUserScriptEnabled = async (key: string, enabled: boolean) => {
    const result = await run(() => call<SettingsResult>("set_user_script_enabled", { key, enabled }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("鏈湴鑴氭湰", result);
    }
  };

  const deleteUserScript = async (key: string) => {
    const script = settings?.user_scripts?.scripts?.find((item) => item.key === key);
    const name = script?.name || key;
    if (!window.confirm(`鍒犻櫎鑴氭湰鈥?{name}鈥濓紵姝ゆ搷浣滀細绉婚櫎鏈湴鑴氭湰鏂囦欢銆俙)) return;
    const result = await run(() => call<SettingsResult>("delete_user_script", { key }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("鏈湴鑴氭湰", result);
    }
  };

  const refreshRelay = async (silent = false) => {
    const result = await run(() => call<RelayResult>("relay_status"));
    if (result) {
      setRelay(result);
      if (!silent) showResultNotice("鐧诲綍鐘舵€?, result, { silentSuccess: true });
    }
  };

  const refreshRelayFiles = async (silent = false) => {
    const result = await run(() => call<RelayFilesResult>("read_relay_files"));
    if (result) {
      setRelayFiles(result);
      if (!silent) showResultNotice("閰嶇疆鏂囦欢", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshEnvConflicts = async (silent = false) => {
    const result = await run(() => call<EnvConflictsResult>("check_env_conflicts"));
    if (result) {
      setEnvConflicts(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("鐜鍙橀噺妫€娴?, result, { silentSuccess: true });
    }
    return result;
  };

  const removeEnvConflicts = async (names: string[]) => {
    const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    if (!uniqueNames.length) return;
    if (!window.confirm(`鍒犻櫎杩欎簺鐜鍙橀噺锛焅n\n${uniqueNames.join("\n")}\n\n鍒犻櫎鍓嶄細鍐欏叆澶囦唤銆俙)) return;
    const result = await run(() => call<RemoveEnvConflictsResult>("remove_env_conflicts", { request: { names: uniqueNames } }));
    if (result) {
      setEnvConflicts({
        status: result.status,
        message: result.message,
        conflicts: result.remaining,
      });
      showNotice("鐜鍙橀噺娓呯悊", result.message, result.status);
    }
  };

  const refreshCcsProviders = async (silent = false) => {
    const result = await run(() => call<CcsProvidersResult>("load_ccs_providers"));
    if (result) {
      setCcsProviders(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("cc-switch 瀵煎叆", result, { silentSuccess: true });
    }
    return result;
  };

  const importCcsProviders = async () => {
    const result = await run(() => call<SettingsResult>("import_ccs_providers"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showResultNotice("cc-switch 瀵煎叆", result);
      await refreshCcsProviders(true);
    }
  };

  const refreshPendingProviderImport = async (silent = true) => {
    const result = await run(() => call<PendingProviderImportResult>("load_pending_provider_import"));
    if (result) {
      setPendingProviderImport(result.pending);
      if (!silent && !isSuccessStatus(result.status)) showResultNotice("Codex++ 瀵煎叆", result, { silentSuccess: true });
    }
    return result;
  };

  const confirmPendingProviderImport = async () => {
    const result = await run(() => call<SettingsResult>("confirm_pending_provider_import"));
    if (result) {
      setPendingProviderImport(null);
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showResultNotice("Codex++ 瀵煎叆", result);
      await refreshCcsProviders(true);
    }
  };

  const dismissPendingProviderImport = async () => {
    const result = await run(() => call<PendingProviderImportResult>("dismiss_pending_provider_import"));
    if (result) {
      setPendingProviderImport(null);
      showResultNotice("Codex++ 瀵煎叆", result, { silentSuccess: true });
    }
  };

  const refreshLocalSessions = async (silent = false) => {
    const result = await run(() => call<LocalSessionsResult>("list_local_sessions"));
    if (result) {
      setLocalSessions(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("浼氳瘽绠＄悊", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshZedRemoteProjects = async (silent = false) => {
    const result = await run(() => call<ZedRemoteProjectsResult>("list_zed_remote_projects"));
    if (result) {
      setZedRemoteProjects(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("Zed 杩滅▼椤圭洰", result, { silentSuccess: true });
    }
    return result;
  };

  const openZedRemoteProject = async (
    project: ZedRemoteProject,
    strategy: ZedOpenStrategy = settingsForm.zedRemoteOpenStrategy || "addToFocusedWorkspace",
  ) => {
    const result = await run(() =>
      call<ZedRemoteOpenResult>("open_zed_remote", {
        payload: {
          ssh: project.ssh,
          hostId: project.hostId,
          path: project.path,
          strategy,
          remember: settingsForm.zedRemoteProjectRegistryEnabled !== false,
        },
      }),
    );
    if (result) {
      showResultNotice("Zed 杩滅▼鎵撳紑", result);
      await refreshZedRemoteProjects(true);
    }
  };

  const forgetZedRemoteProject = async (project: ZedRemoteProject) => {
    const result = await run(() => call<ZedRemoteProjectsResult>("forget_zed_remote_project", { id: project.id }));
    if (result) {
      setZedRemoteProjects(result);
      showResultNotice("Zed 杩滅▼椤圭洰", result);
    }
  };

  const requestDeleteLocalSession = (session: LocalSession) =>
    call<DeleteLocalSessionResult>("delete_local_session", {
      request: { sessionId: session.id, title: session.title, dbPath: session.dbPath },
    });

  const confirmSessionDelete = (title: string, message: string) =>
    new Promise<boolean>((resolve) => {
      setConfirmDialog({
        title,
        message,
        confirmText: "纭鍒犻櫎",
        cancelText: "鍙栨秷",
        resolve,
      });
    });

  const deleteLocalSession = async (session: LocalSession) => {
    const title = session.title || session.id;
    const confirmed = await confirmSessionDelete("鍒犻櫎浼氳瘽", `鍒犻櫎浼氳瘽鈥?{title}鈥濓紵姝ゆ搷浣滀細鍒犻櫎鏈湴鏁版嵁搴撹褰曞拰 rollout 鏂囦欢锛屽苟鍒涘缓澶囦唤銆俙);
    if (!confirmed) return;
    const result = await run(() => requestDeleteLocalSession(session));
    if (result) {
      showResultNotice("浼氳瘽鍒犻櫎", result);
      await refreshLocalSessions(true);
    }
  };

  const deleteLocalSessions = async (sessions: LocalSession[]) => {
    const uniqueSessions = Array.from(new Map(sessions.map((session) => [session.id, session])).values());
    if (!uniqueSessions.length) {
      showNotice("鎵归噺鍒犻櫎浼氳瘽", "璇峰厛閫夋嫨瑕佸垹闄ょ殑浼氳瘽銆?, "failed");
      return;
    }
    const preview = uniqueSessions
      .slice(0, 6)
      .map((session) => `- ${truncateSessionDeletePreview(session.title || session.id)}`)
      .join("\n");
    const extraCount = uniqueSessions.length > 6 ? `\n...浠ュ強鍙﹀ ${uniqueSessions.length - 6} 涓細璇漙 : "";
    const confirmed = await confirmSessionDelete(
      "鎵归噺鍒犻櫎浼氳瘽",
      `鍒犻櫎閫変腑鐨?${uniqueSessions.length} 涓細璇濓紵姝ゆ搷浣滀細鍒犻櫎鏈湴鏁版嵁搴撹褰曞拰 rollout 鏂囦欢锛屽苟涓烘瘡涓細璇濆垱寤哄浠姐€俓n\n${preview}${extraCount}`,
    );
    if (!confirmed) return;

    let succeeded = 0;
    const failed: string[] = [];
    for (const session of uniqueSessions) {
      const result = await run(() => requestDeleteLocalSession(session));
      if (result && isSuccessStatus(result.status)) {
        succeeded += 1;
      } else {
        failed.push(session.title || session.id);
      }
    }

    if (failed.length) {
      showNotice(
        "鎵归噺鍒犻櫎浼氳瘽",
        `宸插垹闄?${succeeded} 涓紝澶辫触 ${failed.length} 涓細${failed.slice(0, 3).map(truncateSessionDeletePreview).join("銆?)}`,
        succeeded ? "ok" : "failed",
      );
    } else {
      showNotice("鎵归噺鍒犻櫎浼氳瘽", `宸插垹闄?${succeeded} 涓細璇濄€俙, "ok");
    }
    await refreshLocalSessions(true);
  };

  const refreshLiveContextEntries = async (silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("read_live_context_entries"));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("宸ュ叿涓庢彃浠?, result, { silentSuccess: true });
    }
    return result;
  };

  const syncLiveContextEntries = async (next: BackendSettings, silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("sync_live_context_entries", { request: { settings: next } }));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("宸ュ叿涓庢彃浠?, result, { silentSuccess: true });
    }
    return result;
  };

  const refreshLogs = async (silent = false) => {
    const result = await run(() => call<LogsResult>("read_latest_logs", { request: { lines: 240 } }));
    if (result) {
      setLogs(result);
      if (!silent) showResultNotice("鏃ュ織宸插埛鏂?, result, { silentSuccess: true });
    }
  };

  const refreshDiagnostics = async (silent = false) => {
    const result = await run(() => call<DiagnosticsResult>("copy_diagnostics"));
    if (result) {
      setDiagnostics(result);
      if (!silent) showResultNotice("璇婃柇宸茬敓鎴?, result, { silentSuccess: true });
    }
  };

  const refreshWatcher = async (silent = false) => {
    const result = await run(() => call<WatcherResult>("load_watcher_state"));
    if (result) {
      setWatcher(result);
      if (!silent) showResultNotice("Watcher 鐘舵€?, result, { silentSuccess: true });
    }
  };

  const navigate = async (next: Route) => {
    setRoute(next);
    if (next === "overview") await refreshOverview(true);
    if (next === "relay") {
      await refreshSettings(true);
      await refreshRelay(true);
      await refreshRelayFiles(true);
      await refreshEnvConflicts(true);
      await refreshCcsProviders(true);
    }
    if (next === "sessions") {
      await refreshSettings(true);
      await refreshLocalSessions(true);
      await refreshProviderSyncTargets(true);
    }
    if (next === "zedRemote") {
      await refreshSettings(true);
      await refreshZedRemoteProjects(true);
    }
    if (next === "context") {
      await refreshSettings(true);
      await refreshRelayFiles(true);
      await refreshLiveContextEntries(true);
    }
    if (next === "settings") await refreshSettings(true);
    if (next === "userScripts") {
      await refreshSettings(true);
      await refreshScriptMarket(true);
    }
    if (next === "recommendations") await refreshAds(true);
    if (next === "about") {
      await refreshOverview(true);
      await refreshLogs(true);
      await refreshDiagnostics(true);
    }
    if (next === "maintenance") {
      await refreshOverview(true);
      await refreshWatcher(true);
    }
  };

  const launch = async () => {
    const result = await launchCommand("launch_codex_plus");
    if (result) {
      showNotice("鍚姩浠诲姟", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const restart = async () => {
    const result = await launchCommand("restart_codex_plus");
    if (result) {
      showNotice("閲嶅惎 Codex++", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const launchCommand = async (command: "launch_codex_plus" | "restart_codex_plus") => {
    const result = await run(() =>
      call<CommandResult<Record<string, unknown>>>(command, {
        request: {
          appPath: launchForm.appPath,
          debugPort: numberOrDefault(launchForm.debugPort, 9229),
          helperPort: numberOrDefault(launchForm.helperPort, 57321),
        },
      }),
    );
    return result;
  };

  const repairBackend = async () => {
    const result = await run(() => call<SettingsResult>("repair_backend"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("鍚庣淇", result.message, result.status);
    }
  };

  const repairPluginMarketplace = async () => {
    if (pluginMarketplaceProgress.active) return;
    setPluginMarketplacePrompt(null);
    setPluginMarketplaceProgress({ active: true, percent: 8, message: "姝ｅ湪妫€鏌ユ湰鍦版彃浠跺競鍦衡€? });
    const progressTimer = window.setInterval(() => {
      setPluginMarketplaceProgress((current) => {
        if (!current.active) return current;
        const nextPercent = Math.min(92, current.percent + 9);
        const message =
          nextPercent < 28
            ? "姝ｅ湪杩炴帴 openai/plugins鈥?
            : nextPercent < 62
              ? "姝ｅ湪涓嬭浇鎻掍欢甯傚満蹇収鈥?
              : nextPercent < 84
                ? "姝ｅ湪瑙ｅ帇骞舵牎楠屾彃浠舵枃浠垛€?
                : "姝ｅ湪鍐欏叆 Codex 閰嶇疆鈥?;
        return { ...current, percent: nextPercent, message };
      });
    }, 500);
    try {
      const result = await run(() => call<PluginMarketplaceRepairResult>("repair_plugin_marketplace"));
      if (result) {
        setPluginMarketplaceProgress({
          active: false,
          percent: 100,
          message: result.message,
        });
        showNotice("鎻掍欢甯傚満淇", result.message, result.status);
      } else {
        setPluginMarketplaceProgress({
          active: false,
          percent: 100,
          message: "鎻掍欢甯傚満淇澶辫触锛岃鏌ョ湅閿欒鎻愮ず鍚庨噸璇曘€?,
        });
      }
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const checkPluginMarketplacePrompt = async () => {
    const result = await run(() => call<PluginMarketplaceStatusResult>("plugin_marketplace_status"));
    if (result?.needsRepair) setPluginMarketplacePrompt(result);
    return result;
  };

  const installEntrypoints = async () => {
    const result = await run(() => call<InstallResult>("install_entrypoints"));
    if (result) {
      showNotice("鍏ュ彛瀹夎", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const uninstallEntrypoints = async () => {
    const result = await run(() =>
      call<InstallResult>("uninstall_entrypoints", {
        options: { removeOwnedData },
      }),
    );
    if (result) {
      showNotice("鍏ュ彛鍗歌浇", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const repairShortcuts = async () => {
    const result = await run(() => call<InstallResult>("repair_shortcuts"));
    if (result) {
      showNotice("蹇嵎鏂瑰紡淇", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const watcherAction = async (command: string) => {
    const result = await run(() => call<WatcherResult>(command));
    if (result) {
      setWatcher(result);
      showNotice("Watcher 鎿嶄綔", result.message, result.status);
    }
  };

  const checkUpdate = async (silent = false) => {
    const result = await run(() => call<UpdateResult>("check_update"));
    if (result) {
      setUpdate(result);
      if (!silent || result.updateAvailable) {
        showNotice("GitHub Release 妫€鏌?, result.message, result.status);
      }
    }
  };

  const performUpdate = async () => {
    const release =
      update?.latestVersion && update.assetName && update.assetUrl
        ? {
            version: update.latestVersion,
            url: "",
            body: update.releaseSummary ?? "",
            asset_name: update.assetName,
            asset_url: update.assetUrl,
          }
        : null;
    const result = await run(() => call<UpdateResult>("perform_update", { release }));
    if (result) {
      setUpdate(result);
      showNotice("鏇存柊瀹夎", result.message, result.status);
    }
  };

  const saveSettings = async () => {
    const next = normalizeSettings(settingsForm);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("璁剧疆淇濆瓨", result.message, result.status);
    }
  };

  const saveSettingsValue = async (next: BackendSettings, silent = true) => {
    const normalized = normalizeSettings(next);
    setSettingsForm(normalized);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      if (!silent || !isSuccessStatus(result.status)) showNotice("璁剧疆淇濆瓨", result.message, result.status);
    }
  };

  const resetSettings = async () => {
    const result = await run(() => call<SettingsResult>("reset_settings"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("璁剧疆閲嶇疆", result.message, result.status);
    }
  };

  const resetImageOverlaySettings = async () => {
    const result = await run(() => call<SettingsResult>("reset_image_overlay_settings"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("鍥剧墖瑕嗙洊灞?, result.message, result.status);
    }
  };

  const refreshAds = async (silent = false) => {
    const result = await run(() => call<AdsResult>("load_ads"));
    if (result) {
      setAds(result);
      if (!silent) showResultNotice("鎺ㄨ崘鍐呭", result, { silentSuccess: true });
    }
  };

  const refreshProviderSyncTargets = async (silent = false) => {
    const result = await run(() => call<ProviderSyncTargetsResult>("load_provider_sync_targets"));
    if (result) {
      setProviderSyncTargets(result);
      const targets = result.targets ?? [];
      const saved = settingsForm.providerSyncLastSelectedProvider;
      const preferred =
        targets.find((target) => target.id === saved)?.id ||
        targets.find((target) => target.isCurrentProvider)?.id ||
        targets[0]?.id ||
        "openai";
      setSelectedProviderSyncTarget((current) => (targets.some((target) => target.id === current) ? current : preferred));
      if (!silent && !isSuccessStatus(result.status)) showNotice("Provider 鍚屾鐩爣", result.message, result.status);
    }
    return result;
  };

  const syncProvidersNow = async () => {
    if (providerSyncProgress.active) return;
    setProviderSyncProgress({
      active: true,
      percent: 12,
      message: selectedProviderSyncTarget ? `姝ｅ湪鍚屾鍒?${selectedProviderSyncTarget}鈥 : "姝ｅ湪鎵弿鍘嗗彶浼氳瘽涓庣储寮曗€?,
      result: null,
    });
    const progressTimer = window.setInterval(() => {
      setProviderSyncProgress((current) => {
        if (!current.active) return current;
        return {
          ...current,
          percent: Math.min(88, current.percent + 8),
          message: current.percent < 40 ? "姝ｅ湪妫€鏌ヤ細璇?provider 鏍囪鈥? : "姝ｅ湪鍐欏叆淇涓庡浠解€?,
        };
      });
    }, 350);
    try {
      const targetProvider = selectedProviderSyncTarget || undefined;
      const result = await run(() =>
        call<CommandResult<ProviderSyncPayload>>("sync_providers_now", { targetProvider }),
      );
      if (result) {
        setProviderSyncProgress({
          active: false,
          percent: 100,
          message: providerSyncProgressMessage(result),
          result,
        });
        if (targetProvider) {
          const next = {
            ...settingsForm,
            providerSyncLastSelectedProvider: targetProvider,
            providerSyncSavedProviders: Array.from(
              new Set([...(settingsForm.providerSyncSavedProviders ?? []), targetProvider]),
            ).sort(),
          };
          setSettingsForm(next);
        }
        await refreshProviderSyncTargets(true);
        showNotice("鍘嗗彶浼氳瘽淇", result.message, result.status);
      } else {
        setProviderSyncProgress({
          active: false,
          percent: 100,
          message: "鍘嗗彶浼氳瘽淇澶辫触锛岃鏌ョ湅閿欒鎻愮ず鍚庨噸璇曘€?,
          result: null,
        });
      }
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const applyRelayInjection = async (silent = false) => {
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: settingsForm }));
    if (settingsResult) {
      setSettings(settingsResult);
      setSettingsForm(normalizeSettings(settingsResult.settings));
      if (!isSuccessStatus(settingsResult.status)) {
        showNotice("璁剧疆淇濆瓨", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("瀹樻柟娣峰叆 API Key", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && result.configured;
  };

  const saveLaunchMode = async (launchMode: LaunchMode, silent = false, baseSettings: BackendSettings = settingsForm) => {
    const next = { ...baseSettings, launchMode };
    setSettingsForm(next);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      if (!silent) showNotice("Codex澧炲己妯″紡", result.message, result.status);
    }
    return result;
  };

  const applyPureApiInjection = async (silent = false) => {
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: settingsForm }));
    if (settingsResult) {
      setSettings(settingsResult);
      setSettingsForm(normalizeSettings(settingsResult.settings));
      if (!isSuccessStatus(settingsResult.status)) {
        showNotice("璁剧疆淇濆瓨", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_pure_api_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("绾?API 妯″紡", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && result.configured;
  };

  const clearRelayInjection = async (silent = false) => {
    const result = await run(() => call<RelayResult>("clear_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("瀹樻柟鐧诲綍妯″紡", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && !result.configured;
  };

  const saveRelayFile = async (kind: "config" | "auth", contents: string, silent = false) => {
    const result = await run(() => call<RelayFilesResult>("save_relay_file", { request: { kind, contents } }));
    if (result) {
      setRelayFiles(result);
      if (!silent || !isSuccessStatus(result.status)) {
        showNotice(kind === "config" ? "config.toml" : "auth.json", result.message, result.status);
      }
      await refreshRelay(true);
    }
  };

  const upsertContextEntry = async (next: BackendSettings, kind: ContextKind, id: string, tomlBody: string) => {
    const result = await run(() =>
      call<ContextEntriesResult>("upsert_context_entry", {
        request: { settings: next, kind, id, tomlBody },
      }),
    );
    if (!result) return null;
    let normalized = normalizeSettings(result.settings);
    const saveResult = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (saveResult) {
      setSettings(saveResult);
      normalized = normalizeSettings(saveResult.settings);
    }
    setSettingsForm(normalized);
    if (!isSuccessStatus(result.status)) showResultNotice("宸ュ叿涓庢彃浠?, result);
    return normalized;
  };

  const deleteContextEntry = async (next: BackendSettings, kind: ContextKind, id: string) => {
    const result = await run(() =>
      call<ContextEntriesResult>("delete_context_entry", {
        request: { settings: next, kind, id },
      }),
    );
    if (!result) return null;
    let normalized = normalizeSettings(result.settings);
    const saveResult = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (saveResult) {
      setSettings(saveResult);
      normalized = normalizeSettings(saveResult.settings);
    }
    setSettingsForm(normalized);
    if (!isSuccessStatus(result.status)) showResultNotice("宸ュ叿涓庢彃浠?, result);
    return normalized;
  };

  const extractRelayCommonConfig = async (configContents: string) => {
    const result = await run(() =>
      call<ExtractRelayCommonConfigResult>("extract_relay_common_config", {
        request: { configContents },
      }),
    );
    if (result) showResultNotice("閫氱敤閰嶇疆鏂囦欢", result);
    return result && isSuccessStatus(result.status) ? result : null;
  };

  const testRelayProfile = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileTestResult>("test_relay_profile", { profile }));
    if (result) showNotice("妯″瀷娴嬭瘯", result.message, result.status);
  };

  const fetchRelayProfileModels = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileModelsResult>("fetch_relay_profile_models", { profile }));
    if (result) showNotice("妯″瀷鍒楄〃", result.message, result.status);
    return result && isSuccessStatus(result.status) ? result.models : null;
  };

  const switchOfficialMode = async () => {
    const switched = await clearRelayInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("relay", true);
    if (result) showNotice("瀹樻柟鐧诲綍妯″紡", "宸插垏鍥炲畼鏂圭櫥褰曪紱Codex澧炲己宸茶涓哄吋瀹瑰寮恒€?, result.status);
  };

  const switchPureApiMode = async () => {
    const switched = await applyPureApiInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("patch", true);
    if (result) showNotice("绾?API 妯″紡", "宸插垏鎹㈠埌绾?API锛汣odex澧炲己宸茶涓哄畬鏁村寮恒€?, result.status);
  };

  const switchRelayProfile = async (next: BackendSettings, previousActiveRelayId = settingsForm.activeRelayId) => {
    if (relaySwitching) {
      showNotice("妯″瀷鍒囨崲涓?, "涓婁竴娆″垏鎹㈣繕娌℃湁瀹屾垚锛岃绋嶅悗鍐嶈瘯銆?, "failed");
      return;
    }
    let switchSettings = normalizeSettings(next);
    if (!switchSettings.relayProfilesEnabled) {
      showNotice("妯″瀷閰嶇疆宸插叧闂?, "褰撳墠涓嶄細鍐欏叆 Codex config.toml / auth.json銆傛墦寮€妯″瀷閰嶇疆鎬诲紑鍏冲悗鍐嶅垏鎹€?, "failed");
      return;
    }
    const targetBeforeSnapshot = activeRelayProfile(switchSettings);
    logDiagnostic("switchRelayProfile.start", {
      currentRelayId: settingsForm.activeRelayId,
      targetRelayId: switchSettings.activeRelayId,
      targetRelayName: targetBeforeSnapshot.name,
      targetRelayMode: targetBeforeSnapshot.relayMode,
    });
    const selectedBeforeSave = activeRelayProfile(switchSettings);
    const validationError = relayProfileSwitchValidation(selectedBeforeSave);
    if (validationError) {
      logDiagnostic("switchRelayProfile.validation_failed", {
        targetRelayId: selectedBeforeSave.id,
        targetRelayName: selectedBeforeSave.name,
        error: validationError,
      });
      showNotice("妯″瀷閰嶇疆鍙兘涓嶆纭?, validationError, "failed");
      return;
    }
    switchSettings = await snapshotActiveRelayFilesBeforeSwitch(switchSettings, previousActiveRelayId);
    const selectedAfterSave = activeRelayProfile(switchSettings);
    const command = relayProfileSwitchCommand(selectedAfterSave);

    logDiagnostic("switchRelayProfile.apply_start", {
      targetRelayId: selectedAfterSave.id,
      targetRelayName: selectedAfterSave.name,
      previousActiveRelayId,
      command,
    });
    setRelaySwitching(true);
    try {
      const result = await run(() =>
        call<RelaySwitchResult>("switch_relay_profile", {
          request: { settings: switchSettings, previousActiveRelayId },
        }),
      );
      if (!result) {
        logDiagnostic("switchRelayProfile.apply_no_result", {
          targetRelayId: selectedAfterSave.id,
        });
        return;
      }
      const selectedSettings = normalizeSettings(result.settings);
      setSettings({
        status: result.status,
        message: result.message,
        settings: selectedSettings,
        settings_path: result.settingsPath,
        user_scripts: result.user_scripts as UserScriptInventory,
      });
      setSettingsForm(selectedSettings);
      setRelay({
        status: result.status,
        message: result.message,
        ...result.relay,
      });
      await refreshRelayFiles(true);
      if (!isSuccessStatus(result.status)) {
        logDiagnostic("switchRelayProfile.apply_failed", {
          targetRelayId: selectedAfterSave.id,
          status: result.status,
          message: result.message,
          activeRelayId: selectedSettings.activeRelayId,
        });
        showNotice("妯″瀷鍒囨崲", result.message, result.status);
        return;
      }
      const currentSelected = activeRelayProfile(selectedSettings);
      logDiagnostic("switchRelayProfile.ok", {
        targetRelayId: currentSelected.id,
        launchMode: selectedSettings.launchMode,
        status: result.status,
      });
      showNotice("妯″瀷鍒囨崲", relayProfileModeSwitchedText(currentSelected), result.status);
    } finally {
      setRelaySwitching(false);
    }
  };

  const snapshotActiveRelayFilesBeforeSwitch = async (
    next: BackendSettings,
    previousActiveRelayId: string,
  ): Promise<BackendSettings> => {
    const profileId = previousActiveRelayId.trim();
    if (!profileId) return next;
    const result = await run(() =>
      call<SettingsBackfillResult>("backfill_relay_profile_from_live", {
        request: { settings: next, profileId },
      }),
    );
    if (!result) return next;
    const normalized = normalizeSettings(result.settings);
    if (!isSuccessStatus(result.status)) {
      showNotice("妯″瀷鍒囨崲", result.message, result.status);
      return next;
    }
    return normalized;
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      showNotice("澶嶅埗澶辫触", stringifyError(error), "failed");
    }
  };

  const openExternalUrl = async (url: string) => {
    const result = await run(() => call<CommandResult<Record<string, unknown>>>("open_external_url", { url }));
    if (result) {
      showResultNotice("鎵撳紑閾炬帴", result, { silentSuccess: true });
    }
  };

  const showNotice = (title: string, message: string, status?: Status) => {
    setNotice({ title, message, status });
  };

  const showResultNotice = (
    title: string,
    result: Pick<CommandResult<unknown>, "message" | "status">,
    options: { silentSuccess?: boolean } = {},
  ) => {
    if (options.silentSuccess && isSuccessStatus(result.status)) return;
    showNotice(title, result.message, result.status);
  };

  useEffect(() => {
    void (async () => {
      const startup = await run(() => call<StartupResult>("startup_options"));
      if (startup?.showUpdate) {
        setRoute("about");
        void checkUpdate(false);
      } else {
        void checkUpdate(true);
      }
      await refreshOverview(true);
      await refreshSettings(true);
      await refreshRelay(true);
      await refreshEnvConflicts(true);
      await refreshProviderSyncTargets(true);
      await refreshPendingProviderImport(true);
      await checkPluginMarketplacePrompt();
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshPendingProviderImport(true);
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    window.localStorage.setItem("codex-plus-theme", theme);
  }, [theme]);

  const saveCodexAppPath = async (appPath: string) => {
    const next = { ...settingsForm, codexAppPath: appPath };
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      const normalized = normalizeSettings(result.settings);
      setSettingsForm(normalized);
      setLaunchForm((current) => ({ ...current, appPath: normalized.codexAppPath }));
      await refreshOverview(true);
    }
    return result;
  };

  const actions = useMemo(
    () => ({
      refreshCurrent: () => navigate(route),
      launch,
      restart,
      repairBackend,
      repairPluginMarketplace,
      checkPluginMarketplacePrompt,
      installEntrypoints,
      uninstallEntrypoints,
      repairShortcuts,
      checkUpdate,
      performUpdate,
      saveSettings,
      saveSettingsValue,
      refreshSettings,
      resetSettings,
      resetImageOverlaySettings,
      chooseCodexAppPath: async (mode: "folder" | "file") => {
        let selected: unknown;
        try {
          selected = await open(
            mode === "folder"
              ? { directory: true, multiple: false, title: "閫夋嫨 Codex 搴旂敤鐩綍" }
              : {
                  directory: false,
                  multiple: false,
                  title: "閫夋嫨 Codex.exe 鎴?Codex.app",
                  filters: [{ name: "Codex 搴旂敤", extensions: ["exe", "app"] }],
                },
          );
        } catch (error) {
          // Surface plugin failures (e.g. missing capability permission) so the
          // buttons no longer appear unresponsive 鈥?see #345.
          const message = error instanceof Error ? error.message : String(error);
          showNotice("Codex 搴旂敤璺緞", `鎵撳紑閫夋嫨鍣ㄥけ璐ワ細${message}`, "failed");
          return;
        }
        if (typeof selected === "string" && selected.trim()) {
          const result = await saveCodexAppPath(selected.trim());
          if (result) {
            showNotice("Codex 搴旂敤璺緞", "搴旂敤璺緞宸蹭繚瀛橈紝涔嬪悗鍚姩浼氳嚜鍔ㄥ鐢ㄣ€?, result.status);
          }
        }
      },
      clearCodexAppPath: async () => {
        const next = { ...settingsForm, codexAppPath: "" };
        const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
        if (result) {
          setSettings(result);
          setSettingsForm(normalizeSettings(result.settings));
          setLaunchForm((current) => ({ ...current, appPath: "" }));
          showNotice("Codex 搴旂敤璺緞", "宸叉竻闄や繚瀛樿矾寰勶紝鍚庣画鍚姩浼氬洖鍒拌嚜鍔ㄦ帰娴嬨€?, result.status);
          await refreshOverview(true);
        }
      },
      chooseImageOverlayPath: async () => {
        let selected: unknown;
        try {
          selected = await open({
            directory: false,
            multiple: false,
            title: "閫夋嫨瑕嗙洊鍥剧墖",
            filters: [{ name: "鍥剧墖", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          showNotice("鍥剧墖瑕嗙洊灞?, `鎵撳紑閫夋嫨鍣ㄥけ璐ワ細${message}`, "failed");
          return;
        }
        if (typeof selected === "string" && selected.trim()) {
          setSettingsForm((current) => ({
            ...current,
            codexAppImageOverlayEnabled: true,
            codexAppImageOverlayPath: selected.trim(),
          }));
        }
      },
      saveManualCodexAppPath: async () => {
        const appPath = launchForm.appPath.trim();
        if (!appPath) {
          showNotice("Codex 搴旂敤璺緞", "璇峰厛濉啓鎴栭€夋嫨搴旂敤璺緞銆?, "failed");
          return;
        }
        const result = await saveCodexAppPath(appPath);
        if (result) {
          showNotice("Codex 搴旂敤璺緞", "搴旂敤璺緞宸蹭繚瀛橈紝涔嬪悗鍚姩浼氳嚜鍔ㄥ鐢ㄣ€?, result.status);
        }
      },
      syncProvidersNow,
      refreshProviderSyncTargets,
      setProviderSyncTarget: (provider: string) => {
        setSelectedProviderSyncTarget(provider);
        setSettingsForm((current) => ({ ...current, providerSyncLastSelectedProvider: provider }));
      },
      setLaunchMode: async (launchMode: LaunchMode) => {
        await saveLaunchMode(launchMode);
      },
      refreshRelay,
      refreshRelayFiles,
      refreshEnvConflicts,
      removeEnvConflicts,
      refreshCcsProviders,
      importCcsProviders,
      refreshLiveContextEntries,
      syncLiveContextEntries,
      refreshAds,
      refreshScriptMarket,
      installMarketScript,
      setUserScriptEnabled,
      deleteUserScript,
      refreshLocalSessions,
      deleteLocalSession,
      deleteLocalSessions,
      refreshZedRemoteProjects,
      openZedRemoteProject,
      forgetZedRemoteProject,
      openExternalUrl,
      applyRelayInjection,
      applyPureApiInjection,
      clearRelayInjection,
      saveRelayFile,
      upsertContextEntry,
      deleteContextEntry,
      extractRelayCommonConfig,
      testRelayProfile,
      fetchRelayProfileModels,
      switchRelayProfile,
      relaySwitching,
      switchOfficialMode,
      switchPureApiMode,
      refreshLogs,
      refreshDiagnostics,
      showMessage: async (title: string, message: string, status?: Status) => showNotice(title, message, status),
      copyLogs: () => copyText(logs?.text ?? "", "鏃ュ織宸插鍒躲€?),
      copyDiagnostics: () => copyText(diagnostics?.report ?? "", "璇婃柇鎶ュ憡宸插鍒躲€?),
      goLogs: () => navigate("about"),
      checkHealth: async () => {
        await refreshOverview(true);
        await refreshRelay(true);
        await refreshWatcher(true);
        showNotice("妫€鏌ュ畬鎴?, "宸插埛鏂?Codex 搴旂敤銆佸叆鍙ｅ拰 Watcher 鐘舵€併€?, "ok");
      },
      installWatcher: () => watcherAction("install_watcher"),
      uninstallWatcher: () => watcherAction("uninstall_watcher"),
      enableWatcher: () => watcherAction("enable_watcher"),
      disableWatcher: () => watcherAction("disable_watcher"),
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [route, launchForm, settingsForm, settings, removeOwnedData, update, logs, diagnostics, theme, relayFiles, localSessions, zedRemoteProjects, selectedProviderSyncTarget, envConflicts, ccsProviders],
  );
  const hasUpdate = update?.updateAvailable === true;

  return (
    <div className={`shell ${theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C++</div>
          <div className="brand-copy">
            <div className="brand-title-row">
              <div className="brand-title">Codex++</div>
              {hasUpdate ? (
                <button
                  className="update-dot"
                  onClick={() => {
                    setRoute("about");
                    void checkUpdate(false);
                  }}
                  title={`鍙戠幇鏂扮増鏈?${update?.latestVersion ?? ""}`}
                  type="button"
                >
                  <CircleArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="brand-subtitle">绠＄悊鎺у埗鍙?/div>
          </div>
        </div>
        <nav className="nav">
          {routes.map((item) => {
            const Icon = item.icon;
            return (
            <button
              className={`nav-item ${route === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => void navigate(item.id)}
              title={item.label}
              type="button"
            >
              <span className="nav-icon">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="nav-label">{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </button>
          );
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar" key={`topbar-${route}`}>
          <div>
            <h1>{routeTitle(route)}</h1>
            <p>{routeSubtitle(route)}</p>
          </div>
          <div className="topbar-actions">
            <Button
              onClick={actions.toggleTheme}
              size="icon"
              title={theme === "dark" ? "鍒囨崲鍒版祬鑹? : "鍒囨崲鍒版繁鑹?}
              variant="outline"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button onClick={() => void actions.restart()} title="閲嶅惎 Codex++" variant="outline">
              <Rocket className="h-4 w-4" />
              閲嶅惎 Codex++
            </Button>
            <Button onClick={() => void actions.refreshCurrent()} size="icon" title="鍒锋柊褰撳墠椤甸潰" variant="outline">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <section className="screen" key={route}>
          {route === "overview" ? (
            <OverviewScreen
              overview={overview}
              pluginMarketplaceProgress={pluginMarketplaceProgress}
              actions={actions}
            />
          ) : null}
          {route === "relay" ? (
            <RelayScreen
              settings={settings}
              relayFiles={relayFiles}
              envConflicts={envConflicts}
              ccsProviders={ccsProviders}
              form={settingsForm}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "mobileControl" ? (
            <MobileControlScreen form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}
          {route === "sessions" ? (
            <SessionsScreen
              settings={settings}
              form={settingsForm}
              sessions={localSessions}
              providerSyncProgress={providerSyncProgress}
              providerSyncTargets={providerSyncTargets}
              selectedProviderSyncTarget={selectedProviderSyncTarget}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "context" ? (
            <ContextScreen
              form={settingsForm}
              liveEntries={liveContextEntries}
              relayFiles={relayFiles}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "enhance" ? (
            <EnhanceScreen
              form={settingsForm}
              pluginMarketplaceProgress={pluginMarketplaceProgress}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "zedRemote" ? (
            <ZedRemoteScreen projects={zedRemoteProjects} form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}
          {route === "userScripts" ? <UserScriptsScreen settings={settings} market={scriptMarket} actions={actions} /> : null}
          {route === "recommendations" ? <RecommendationsScreen ads={ads} actions={actions} /> : null}
          {route === "maintenance" ? (
            <MaintenanceScreen
              overview={overview}
              watcher={watcher}
              settings={settings}
              launchForm={launchForm}
              onLaunchFormChange={setLaunchForm}
              removeOwnedData={removeOwnedData}
              onRemoveOwnedDataChange={setRemoveOwnedData}
              actions={actions}
            />
          ) : null}
          {route === "about" ? <AboutScreen overview={overview} update={update} logs={logs} diagnostics={diagnostics} actions={actions} /> : null}
          {route === "settings" ? (
            <SettingsScreen settings={settings} theme={theme} form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}
        </section>
      </main>
      {notice ? (
        <NoticeDialog
          key={`${notice.title}-${notice.message}-${notice.status ?? ""}`}
          notice={notice}
          onClose={() => setNotice(null)}
        />
      ) : null}
      {confirmDialog ? (
        <ConfirmDialog
          confirm={confirmDialog}
          onCancel={() => {
            confirmDialog.resolve(false);
            setConfirmDialog(null);
          }}
          onConfirm={() => {
            confirmDialog.resolve(true);
            setConfirmDialog(null);
          }}
        />
      ) : null}
      {pluginMarketplacePrompt ? (
        <PluginMarketplacePromptDialog
          progress={pluginMarketplaceProgress}
          status={pluginMarketplacePrompt}
          onClose={() => setPluginMarketplacePrompt(null)}
          onRepair={() => void actions.repairPluginMarketplace()}
        />
      ) : null}
      {pendingProviderImport ? (
        <PendingProviderImportDialog
          request={pendingProviderImport}
          onConfirm={() => void confirmPendingProviderImport()}
          onDismiss={() => void dismissPendingProviderImport()}
        />
      ) : null}
    </div>
  );
}

type Actions = {
  refreshCurrent: () => Promise<void>;
  launch: () => Promise<void>;
  restart: () => Promise<void>;
  repairBackend: () => Promise<void>;
  repairPluginMarketplace: () => Promise<void>;
  checkPluginMarketplacePrompt: () => Promise<PluginMarketplaceStatusResult | null>;
  installEntrypoints: () => Promise<void>;
  uninstallEntrypoints: () => Promise<void>;
  repairShortcuts: () => Promise<void>;
  checkUpdate: () => Promise<void>;
  performUpdate: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveSettingsValue: (settings: BackendSettings, silent?: boolean) => Promise<void>;
  refreshSettings: (silent?: boolean) => Promise<BackendSettings | null>;
  resetSettings: () => Promise<void>;
  resetImageOverlaySettings: () => Promise<void>;
  chooseCodexAppPath: (mode: "folder" | "file") => Promise<void>;
  clearCodexAppPath: () => Promise<void>;
  chooseImageOverlayPath: () => Promise<void>;
  saveManualCodexAppPath: () => Promise<void>;
  syncProvidersNow: () => Promise<void>;
  refreshProviderSyncTargets: (silent?: boolean) => Promise<ProviderSyncTargetsResult | null>;
  setProviderSyncTarget: (provider: string) => void;
  setLaunchMode: (launchMode: LaunchMode) => Promise<void>;
  refreshRelay: () => Promise<void>;
  refreshRelayFiles: () => Promise<RelayFilesResult | null>;
  refreshEnvConflicts: (silent?: boolean) => Promise<EnvConflictsResult | null>;
  removeEnvConflicts: (names: string[]) => Promise<void>;
  refreshCcsProviders: (silent?: boolean) => Promise<CcsProvidersResult | null>;
  importCcsProviders: () => Promise<void>;
  refreshLiveContextEntries: () => Promise<LiveContextEntriesResult | null>;
  syncLiveContextEntries: (settings: BackendSettings, silent?: boolean) => Promise<LiveContextEntriesResult | null>;
  refreshAds: () => Promise<void>;
  refreshScriptMarket: () => Promise<void>;
  installMarketScript: (id: string) => Promise<void>;
  setUserScriptEnabled: (key: string, enabled: boolean) => Promise<void>;
  deleteUserScript: (key: string) => Promise<void>;
  refreshLocalSessions: () => Promise<LocalSessionsResult | null>;
  deleteLocalSession: (session: LocalSession) => Promise<void>;
  deleteLocalSessions: (sessions: LocalSession[]) => Promise<void>;
  refreshZedRemoteProjects: () => Promise<ZedRemoteProjectsResult | null>;
  openZedRemoteProject: (project: ZedRemoteProject, strategy?: ZedOpenStrategy) => Promise<void>;
  forgetZedRemoteProject: (project: ZedRemoteProject) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  applyRelayInjection: () => Promise<boolean>;
  applyPureApiInjection: () => Promise<boolean>;
  clearRelayInjection: () => Promise<boolean>;
  saveRelayFile: (kind: "config" | "auth", contents: string, silent?: boolean) => Promise<void>;
  upsertContextEntry: (
    settings: BackendSettings,
    kind: ContextKind,
    id: string,
    tomlBody: string,
  ) => Promise<BackendSettings | null>;
  deleteContextEntry: (settings: BackendSettings, kind: ContextKind, id: string) => Promise<BackendSettings | null>;
  extractRelayCommonConfig: (configContents: string) => Promise<ExtractRelayCommonConfigResult | null>;
  testRelayProfile: (profile: RelayProfile) => Promise<void>;
  fetchRelayProfileModels: (profile: RelayProfile) => Promise<string[] | null>;
  switchRelayProfile: (settings: BackendSettings, previousActiveRelayId?: string) => Promise<void>;
  relaySwitching: boolean;
  switchOfficialMode: () => Promise<void>;
  switchPureApiMode: () => Promise<void>;
  refreshLogs: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  showMessage: (title: string, message: string, status?: Status) => Promise<void>;
  copyLogs: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
  goLogs: () => Promise<void>;
  installWatcher: () => Promise<void>;
  uninstallWatcher: () => Promise<void>;
  enableWatcher: () => Promise<void>;
  disableWatcher: () => Promise<void>;
  toggleTheme: () => void;
  checkHealth: () => Promise<void>;
};

type MobileRelayRoomStatus = {
  room: string;
  hostOnline: boolean;
  clientOnline: boolean;
  connections: number;
  ageSeconds: number;
  forwardedMessages: number;
  forwardedBytes: number;
};

type MobileRelayStatus = {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  rooms: number;
  activeConnections: number;
  totalConnections: number;
  forwardedMessages: number;
  forwardedBytes: number;
  roomDetails: MobileRelayRoomStatus[];
};

function MobileControlScreen({
  form,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const [serverStatuses, setServerStatuses] = useState<Record<string, MobileRelayStatus | null>>({});
  const [statusMessage, setStatusMessage] = useState("灏氭湭鍒锋柊");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const mobileUrl = mobileRelayShareUrl(form);
  const selectedServerId =
    mobileRelayServers.find((server) => server.url === form.mobileControlRelayUrl)?.id || mobileRelayServers[0].id;
  const selectedServer = mobileRelayServers.find((server) => server.id === selectedServerId) ?? mobileRelayServers[0];
  const selectedStatus = serverStatuses[selectedServer.id] ?? null;
  const serverCapacity = selectedServer?.capacity ?? 100;
  const serverLoad = selectedStatus?.activeConnections ?? 0;
  const saveMobileSettings = async (next: BackendSettings, silent = true) => {
    onFormChange(next);
    await actions.saveSettingsValue(next, silent);
  };
  const selectRelayServer = (serverId: string) => {
    const server = mobileRelayServers.find((item) => item.id === serverId);
    if (!server) return;
    onFormChange({ ...form, mobileControlRelayUrl: server.url });
  };
  const startAndCopyMobileLink = async () => {
    const room = form.mobileControlRoom.trim() || randomToken(8);
    const key = form.mobileControlKey.trim() || randomToken(32);
    const relayUrl = selectedServer.url;
    const next = {
      ...form,
      mobileControlEnabled: true,
      mobileControlRelayUrl: relayUrl,
      mobileControlRoom: room,
      mobileControlKey: key,
    };
    await saveMobileSettings(next, true);
    const link = mobileRelayShareUrl(next);
    if (!link) {
      await actions.showMessage("鎵嬫満鎺у埗", "鏈嶅姟鍣ㄥ湴鍧€鏃犳晥锛屾棤娉曠敓鎴愭墜鏈洪摼鎺ャ€?, "failed");
      return;
    }
    await actions.launch();
    try {
      await navigator.clipboard?.writeText(link);
      await actions.showMessage("鎵嬫満鎺у埗", "宸插惎鍔ㄥ苟澶嶅埗鎵嬫満閾炬帴銆?);
    } catch (error) {
      await actions.showMessage("鎵嬫満鎺у埗", `宸插惎鍔紝浣嗗鍒堕摼鎺ュけ璐ワ細${stringifyError(error)}`, "failed");
    }
  };
  const refreshRelayStatus = async () => {
    setLoadingStatus(true);
    const entries = await Promise.all(mobileRelayServers.map(async (server) => {
      const httpUrl = mobileRelayHttpUrl(server.url);
      try {
        const response = await fetch(`${httpUrl}/status`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return [server.id, (await response.json()) as MobileRelayStatus, ""] as const;
      } catch (error) {
        return [server.id, null, `${server.label}: ${error instanceof Error ? error.message : "鍒锋柊澶辫触"}`] as const;
      }
    }));
    setServerStatuses(Object.fromEntries(entries.map(([id, data]) => [id, data])));
    const failed = entries.map(([, , error]) => error).filter(Boolean);
    setStatusMessage(failed.length ? failed.join("锛?) : "鐘舵€佸凡鍒锋柊");
    setLoadingStatus(false);
  };
  useEffect(() => {
    void refreshRelayStatus();
  }, []);
  useEffect(() => {
    if (!mobileRelayServers.some((server) => server.url === form.mobileControlRelayUrl)) {
      onFormChange({ ...form, mobileControlRelayUrl: mobileRelayServers[0].url });
    }
  }, [form.mobileControlRelayUrl]);
  return (
    <>
      <Panel>
        <CardHead title="鎵嬫満鎺у埗" detail="閫夋嫨 relay 鏈嶅姟鍣ㄥ悗鍚姩锛岀郴缁熶細鐢熸垚闅忔満鎴块棿鍜?Key锛屽苟澶嶅埗鎵嬫満鍙洿鎺ユ墦寮€鐨勯摼鎺ャ€? />
        <CardContent>
          <div className="mobile-server-grid">
            {mobileRelayServers.map((server) => {
              const isActive = selectedServerId === server.id;
              const itemStatus = serverStatuses[server.id] ?? null;
              const load = itemStatus?.activeConnections ?? 0;
              return (
                <button
                  className={`mobile-server-card ${isActive ? "active" : ""}`}
                  key={server.id}
                  onClick={() => selectRelayServer(server.id)}
                  type="button"
                >
                  <span>
                    <strong>{server.label}</strong>
                    <small>{server.url}</small>
                    <small>{itemStatus ? `鍦ㄧ嚎 路 ${itemStatus.rooms} 涓埧闂?路 ${formatBytes(itemStatus.forwardedBytes)}` : "鏈繛鎺ユ垨鏈埛鏂?}</small>
                  </span>
                  <em>{load}/{server.capacity}</em>
                </button>
              );
            })}
          </div>
          <div className="form-row">
            <Label className="field">
              <span>褰撳墠鏈嶅姟鍣?/span>
              <Input readOnly value={selectedServer.url} />
            </Label>
            <Label className="field">
              <span>瀹归噺</span>
              <Input
                readOnly
                value={`${serverLoad}/${serverCapacity}`}
              />
            </Label>
          </div>
          <Toolbar>
            <Button onClick={() => void startAndCopyMobileLink()} type="button">
              <Rocket className="h-4 w-4" />
              鍚姩骞跺鍒舵墜鏈洪摼鎺?
            </Button>
            <Button
              onClick={() => void saveMobileSettings({
                ...form,
                mobileControlEnabled: true,
                mobileControlRoom: randomToken(8),
                mobileControlKey: randomToken(32),
              }, false)}
              type="button"
              variant="secondary"
            >
              <KeyRound className="h-4 w-4" />
              閲嶆柊鐢熸垚 Token
            </Button>
            <Button onClick={() => void refreshRelayStatus()} type="button" variant="secondary">
              <RefreshCw className="h-4 w-4" />
              {loadingStatus ? "姝ｅ湪鍒锋柊" : "鍒锋柊鏈嶅姟鍣ㄧ姸鎬?}
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鎵嬫満鍏ュ彛" detail="澶嶅埗鍑虹殑閾炬帴鍖呭惈闅忔満鎴块棿鍜?Key锛況elay 鏈嶅姟鍣ㄥ彧鑳界湅鍒版埧闂淬€佽繛鎺ユ暟鍜屾祦閲忕粺璁°€? />
        <CardContent>
          <div className="relay-file-panel">
            <div className="relay-file-head">
              <div>
                <strong>{mobileUrl || "鏈敓鎴愭墜鏈哄叆鍙?}</strong>
                <span>{mobileUrl ? "鎵嬫満鎵撳紑鍚庝細鑷姩濉叆鎴块棿鍜?Key 骞跺皾璇曡繛鎺ャ€? : "閫夋嫨鏈嶅姟鍣ㄥ苟鍚姩鍚庝細鐢熸垚鎵嬫満鍏ュ彛銆?}</span>
              </div>
              {mobileUrl ? (
                <Button
                  onClick={() => {
                    void navigator.clipboard?.writeText(mobileUrl);
                    void actions.showMessage("鎵嬫満鍏ュ彛", "宸插鍒舵墜鏈哄叆鍙ｅ湴鍧€銆?);
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Copy className="h-4 w-4" />
                  澶嶅埗
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鏈嶅姟鍣ㄧ姸鎬? detail={statusMessage} />
        <CardContent>
          {selectedStatus ? (
            <>
              <div className="health-grid">
                <div className="health-item ok">
                  <CheckCircle2 className="h-4 w-4" />
                  <div>
                    <strong>鍦ㄧ嚎杩炴帴</strong>
                    <span>{selectedStatus.activeConnections} 涓湪绾胯繛鎺ワ紝绱 {selectedStatus.totalConnections} 娆¤繛鎺ャ€?/span>
                  </div>
                  <Badge status="ok" />
                </div>
                <div className="health-item ok">
                  <Network className="h-4 w-4" />
                  <div>
                    <strong>鎴块棿鏁伴噺</strong>
                    <span>{selectedStatus.rooms} 涓埧闂达紝宸茶浆鍙?{selectedStatus.forwardedMessages} 鏉℃秷鎭€?/span>
                  </div>
                  <Badge status="ok" />
                </div>
              </div>
              <div className="relay-file-grid">
                {selectedStatus.roomDetails.map((room) => (
                  <div className="relay-file-panel" key={room.room}>
                    <div className="relay-file-head">
                      <div>
                        <strong>{room.room}</strong>
                        <span>
                          host {room.hostOnline ? "鍦ㄧ嚎" : "绂荤嚎"} / client {room.clientOnline ? "鍦ㄧ嚎" : "绂荤嚎"}锛?
                          {room.connections} 涓繛鎺ワ紝{formatBytes(room.forwardedBytes)}
                        </span>
                      </div>
                      <Badge status={room.hostOnline && room.clientOnline ? "ok" : "not_checked"} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="field-hint">鐐瑰嚮鈥滃埛鏂版湇鍔″櫒鐘舵€佲€濇煡鐪?relay 璐熻浇銆佸湪绾跨敤鎴峰拰鎴块棿杩炴帴鎯呭喌銆?/p>
          )}
        </CardContent>
      </Panel>
    </>
  );
}

function OverviewScreen({
  overview,
  pluginMarketplaceProgress,
  actions,
}: {
  overview: OverviewResult | null;
  pluginMarketplaceProgress: TaskProgress;
  actions: Actions;
}) {
  const health = healthItems(overview);
  return (
    <>
      <Panel className="jojocode-overview">
        <CardContent>
          <div className="jojocode-overview-layout">
            <div className="jojocode-overview-main">
              <div className="jojocode-overview-mark">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <span className="eyebrow">瀹樻柟涓浆绔?/span>
                <h2>JOJO Code</h2>
                <p>
                  Codex++ 瀹樻柟涓浆绔欙紝涓绘墦绋冲畾鎺ュ叆鍜屽垝绠椾环鏍硷紝鏀寔 GPT-5.5銆丟PT-5.4銆丆laude Opus 4.8銆丆laude Opus 4.7銆乬pt-image-2 绛夋ā鍨嬩笌鍥惧儚鑳藉姏銆?
                </p>
              </div>
            </div>
            <div className="jojocode-overview-side">
              <div className="jojocode-model-tags">
                <span>GPT-5.5</span>
                <span>GPT-5.4</span>
                <span>Opus 4.8</span>
                <span>Opus 4.7</span>
                <span>gpt-image-2</span>
              </div>
              <Button onClick={() => void actions.openExternalUrl("https://jojocode.com/")}>
                <ExternalLink className="h-4 w-4" />
                鎵撳紑 JOJO Code
              </Button>
            </div>
          </div>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鍋ュ悍妫€鏌? detail="姒傝鍙睍绀哄叧閿棶棰橈紝鍏蜂綋閰嶇疆鍦ㄥ搴旈〉闈㈠鐞? />
        <CardContent>
          <div className="health-grid">
            <div className={`health-item ${overview?.codex_version ? "ok" : "needs-fix"}`}>
              {overview?.codex_version ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              <div>
                <strong>Codex 鐗堟湰</strong>
                <span>{overview?.codex_version ?? "鏈娴嬪埌 Codex 搴旂敤鐗堟湰銆?}</span>
              </div>
              <Badge status={overview?.codex_version ? "ok" : "not_checked"} />
            </div>
            {health.map((item) => (
              <div className={`health-item ${item.ok ? "ok" : "needs-fix"}`} key={item.title}>
                {item.ok ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <Badge status={item.status} />
              </div>
            ))}
          </div>
          <Toolbar>
            <Button onClick={() => void actions.checkHealth()}>
              <RefreshCw className="h-4 w-4" />
              妫€鏌?
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>
              <Wrench className="h-4 w-4" />
              淇鍏ュ彛
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>
              淇鍚庣
            </Button>
            <Button disabled={pluginMarketplaceProgress.active} variant="secondary" onClick={() => void actions.repairPluginMarketplace()}>
              {pluginMarketplaceProgress.active ? "姝ｅ湪淇鈥? : "淇鎻掍欢甯傚満"}
            </Button>
          </Toolbar>
          <TaskProgressBox progress={pluginMarketplaceProgress} title="鎻掍欢甯傚満淇杩涘害" />
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鏈€杩戝惎鍔? detail={overview?.logs_path ?? "鏆傛棤鐘舵€佹枃浠?} />
        <CardContent>
          <LatestLaunch status={overview?.latest_launch ?? null} />
          <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              鍚姩 Codex++
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              鎵撳紑鍏充簬
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function RelayScreen({
  settings: _settings,
  relayFiles,
  envConflicts,
  ccsProviders,
  form,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  relayFiles: RelayFilesResult | null;
  envConflicts: EnvConflictsResult | null;
  ccsProviders: CcsProvidersResult | null;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const normalized = normalizeSettings(form);
  const [detailProfileId, setDetailProfileId] = useState<string | null>(null);
  const [newProfileDraft, setNewProfileDraft] = useState<RelayProfile | null>(null);
  const [thirdPartyImportOpen, setThirdPartyImportOpen] = useState(false);
  const detailProfile = newProfileDraft || (detailProfileId
    ? normalized.relayProfiles.find((profile) => profile.id === detailProfileId) || null
    : null);
  const isNewProfile = !!newProfileDraft;
  const saveRelaySettings = async (next: BackendSettings) => {
    onFormChange(next);
    await actions.saveSettingsValue(next, true);
  };
  const createNewAggregateProfile = () => {
    const draft = createAggregateRelayProfile(normalized);
    setDetailProfileId(null);
    setNewProfileDraft(draft);
    if (!normalizeAggregateConfig(draft.aggregate, aggregateMemberCandidates(normalized, draft.id)).members.length) {
      void actions.showMessage(
        "娣诲姞鑱氬悎妯″瀷",
        "宸叉墦寮€鑱氬悎妯″瀷璇︽儏锛涜鍏堟坊鍔犳垨瀹屽杽鑷冲皯 1 涓櫘閫?API 妯″瀷鐨?Base URL / Key锛屽啀鍕鹃€変负鎴愬憳銆?,
        "failed",
      );
    }
  };
  const editRelayProfile = async (profileId: string) => {
    setNewProfileDraft(null);
    setDetailProfileId(
      normalized.relayProfiles.some((item) => item.id === profileId) ? profileId : null,
    );
  };
  useEffect(() => {
    if (!newProfileDraft && detailProfileId && !normalized.relayProfiles.some((profile) => profile.id === detailProfileId)) {
      setDetailProfileId(null);
    }
  }, [detailProfileId, newProfileDraft, normalized.relayProfiles]);
  useEffect(() => {
    if (!newProfileDraft && detailProfileId === normalized.activeRelayId) {
      void actions.refreshRelayFiles();
    }
  }, [detailProfileId, newProfileDraft, normalized.activeRelayId]);
  const openThirdPartyImport = () => {
    setThirdPartyImportOpen((open) => !open);
    if (!ccsProviders) void actions.refreshCcsProviders(true);
  };

  if (detailProfile) {
    return (
      <RelayProfileDetail
        profile={detailProfile}
        relayFiles={!isNewProfile && detailProfile.id === normalized.activeRelayId ? relayFiles : null}
        form={normalized}
        isNew={isNewProfile}
        onBack={() => {
          setNewProfileDraft(null);
          setDetailProfileId(null);
        }}
        onFormChange={saveRelaySettings}
        onSaved={() => {
          setNewProfileDraft(null);
          setDetailProfileId(null);
        }}
        actions={actions}
      />
    );
  }

  return (
    <>
      <Panel>
        <CardHead title="妯″瀷鍒楄〃" detail={`${normalized.relayProfiles.length} 涓ā鍨嬮厤缃紱鍙嫋鍔ㄦ帓搴忥紝鐐圭紪杈戣繘鍏ヨ鎯卄} />
        <CardContent>
          <EnvConflictNotice envConflicts={envConflicts} actions={actions} />
          <label className="switch-row relay-master-switch">
            <input
              checked={normalized.relayProfilesEnabled}
              onChange={(event) => {
                const next = { ...normalized, relayProfilesEnabled: event.currentTarget.checked };
                void saveRelaySettings(next);
              }}
              type="checkbox"
            />
            <span>
              <strong>鍚敤妯″瀷閰嶇疆鍒囨崲</strong>
              <small>鍏抽棴鍚庢湰宸ュ叿涓嶄細鍦ㄦ墜鍔ㄥ垏鎹㈡椂鍐欏叆 Codex 鐨?config.toml / auth.json锛涘惎鍔?Codex 鏃跺缁堜笉浼氳嚜鍔ㄦ敼杩欎簺鏂囦欢銆?/small>
            </span>
          </label>
          <div className="relay-add-row">
            <Button
              variant="secondary"
              onClick={() => {
                setNewProfileDraft(createRelayProfile(normalized));
                setDetailProfileId(null);
              }}
            >
              <Plus className="h-4 w-4" />
              娣诲姞妯″瀷
            </Button>
            <Button
              variant="secondary"
              onClick={createNewAggregateProfile}
            >
              <Plus className="h-4 w-4" />
              娣诲姞鑱氬悎妯″瀷
            </Button>
            <div className="third-party-import">
              <Button
                onClick={openThirdPartyImport}
                variant="secondary"
              >
                <Download className="h-4 w-4" />
                浠庣涓夋柟瀵煎叆
              </Button>
              {thirdPartyImportOpen ? (
                <div className="third-party-import-menu">
                  <button
                    disabled={!ccsProviders?.providers.length}
                    onClick={() => {
                      setThirdPartyImportOpen(false);
                      void actions.importCcsProviders();
                    }}
                    type="button"
                  >
                    <strong>ccswitch</strong>
                    <span>{ccsProviderSummary(ccsProviders)}</span>
                  </button>
                  <button
                    onClick={() => void actions.refreshCcsProviders()}
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4" />
                    鍒锋柊鍒楄〃
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <RelayProfileList
            form={normalized}
            onEdit={(profileId) => void editRelayProfile(profileId)}
            onFormChange={saveRelaySettings}
            disabled={!normalized.relayProfilesEnabled || actions.relaySwitching}
            actions={actions}
          />
        </CardContent>
      </Panel>
    </>
  );
}

function EnvConflictNotice({
  envConflicts,
  actions,
}: {
  envConflicts: EnvConflictsResult | null;
  actions: Actions;
}) {
  const conflicts = envConflicts?.conflicts ?? [];
  if (!conflicts.length) return null;
  const names = Array.from(new Set(conflicts.map((conflict) => conflict.name))).sort();
  return (
    <div className="env-conflict-notice">
      <div className="env-conflict-icon">
        <ShieldAlert className="h-4 w-4" />
      </div>
      <div className="env-conflict-body">
        <strong>妫€娴嬪埌 OPENAI 鐜鍙橀噺</strong>
        <p>杩欎簺鍙橀噺鍙兘瑕嗙洊褰撳墠妯″瀷鍐欏叆鐨?config.toml / auth.json锛汣ODEX_HOME 涓嶄細琚竻鐞嗐€?/p>
        <div className="env-conflict-tags">
          {conflicts.map((conflict) => (
            <span key={`${conflict.source}-${conflict.name}`}>
              {conflict.name}
              <small>{envConflictSourceLabel(conflict.source)}</small>
            </span>
          ))}
        </div>
      </div>
      <div className="env-conflict-actions">
        <Button onClick={() => void actions.removeEnvConflicts(names)} size="sm">
          <Trash2 className="h-4 w-4" />
          鍒犻櫎
        </Button>
        <Button onClick={() => void actions.refreshEnvConflicts(false)} size="sm" variant="secondary">
          <RefreshCw className="h-4 w-4" />
          妫€娴?
        </Button>
      </div>
    </div>
  );
}

function envConflictSourceLabel(source: string): string {
  if (source === "process") return "褰撳墠杩涚▼";
  if (source === "user") return "鐢ㄦ埛鐜";
  return source || "鐜鍙橀噺";
}

function EnhanceScreen({
  form,
  pluginMarketplaceProgress,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  pluginMarketplaceProgress: TaskProgress;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const setEnhanceFlag = (key: keyof BackendSettings, value: boolean) => onFormChange({ ...form, [key]: value });
  const masterEnabled = form.enhancementsEnabled;
  const patchMode = form.launchMode === "patch";
  return (
    <>
      <Panel>
        <CardHead title="Codex澧炲己" detail="浼氳瘽鍒犻櫎銆佸鍑恒€侀」鐩Щ鍔ㄥ拰鐢ㄦ埛鑴氭湰绛夌晫闈㈣兘鍔? />
        <CardContent>
          <label className="switch-row">
            <input
              checked={form.enhancementsEnabled}
              onChange={(event) => onFormChange({ ...form, enhancementsEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>鍚敤 Codex澧炲己</strong>
              <small>鍏抽棴鍚庝細鍋滅敤鍒犻櫎銆佸鍑恒€侀」鐩Щ鍔ㄣ€佹彃浠剁浉鍏冲拰鑿滃崟浣嶇疆澧炲己銆?/small>
            </span>
          </label>
          <label className="switch-row">
            <input
              checked={form.computerUseGuardEnabled}
              onChange={(event) => onFormChange({ ...form, computerUseGuardEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>鍚敤 Windows Computer Use Guard</strong>
              <small>榛樿鍏抽棴锛涘紑鍚悗鍚姩 Codex 鏃朵細鑷姩淇濈暀瀹樻柟 Computer Use 鎻掍欢鎵€闇€鐨?config.toml銆乥undled 鎻掍欢鍜?notify 閰嶇疆銆?/small>
            </span>
          </label>
          <ModeSelector launchMode={form.launchMode} actions={actions} />
          {form.launchMode === "relay" ? (
            <div className="hint-line">
              <ShieldCheck className="h-4 w-4" />
              <span>褰撳墠涓哄吋瀹瑰寮烘ā寮忥紝鎻掍欢甯傚満瑙ｉ攣鍜岀壒娈婃彃浠跺己鍒跺畨瑁呬笉浼氬惎鐢紱鍏朵粬椤甸潰鍔熻兘浠嶅彲鐢ㄣ€?/span>
            </div>
          ) : null}
          <div className="feature-switch-grid">
            <FeatureToggle title="鎻掍欢甯傚満瑙ｉ攣" detail="API Key 妯″紡涓嬫墿灞曟彃浠跺競鍦鸿姹傦紝灏介噺鏄剧ず瀹屾暣鎻掍欢鍒楄〃锛涘畼鏂?娣峰悎妯″紡閫氬父涓嶉渶瑕併€? checked={form.codexAppPluginMarketplaceUnlock} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppPluginMarketplaceUnlock", value)} />
            <FeatureToggle title="鐗规畩鎻掍欢寮哄埗瀹夎" detail="瑙ｉ櫎 App unavailable / 搴旂敤涓嶅彲鐢ㄥ鑷寸殑鍓嶇瀹夎绂佺敤銆? checked={form.codexAppForcePluginInstall} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppForcePluginInstall", value)} />
            <FeatureToggle title="鎻掍欢鍒楄〃鍏ㄩ噺灞曠ず" detail="杩涘叆鎻掍欢椤靛悗鑷姩杩炵画灞曞紑鈥滄洿澶氣€濓紝灏介噺涓€娆℃樉绀哄畬鏁存彃浠跺垪琛ㄣ€? checked={form.codexAppPluginAutoExpand} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppPluginAutoExpand", value)} />
            <FeatureToggle title="妯″瀷鐧藉悕鍗曡В閿? detail="浠庣幆澧冨彉閲忓拰 config.toml 鐨?/v1/models 鎷夊彇妯″瀷骞惰ˉ杩涙ā鍨嬪垪琛ㄣ€? checked={form.codexAppModelWhitelistUnlock} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppModelWhitelistUnlock", value)} />
            <FeatureToggle title="Fast 鎸夐挳" detail="鏄剧ず鏈嶅姟妯″紡鍒囨崲鎸夐挳锛汧ast 浠呮敮鎸?gpt-5.4 / gpt-5.5锛屽叾浠栨ā鍨嬫寜 Standard 鍙戦€併€? checked={form.codexAppServiceTierControls} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppServiceTierControls", value)} />
            <FeatureToggle title="浼氳瘽鍒犻櫎" detail="鍦ㄤ細璇濆垪琛ㄦ偓鍋滄樉绀哄垹闄ゆ寜閽紝骞舵敮鎸佹挙閿€銆? checked={form.codexAppSessionDelete} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppSessionDelete", value)} />
            <FeatureToggle title="Markdown 瀵煎嚭" detail="鍦ㄤ細璇濆垪琛ㄦ樉绀哄鍑烘寜閽紝瀵煎嚭甯︽椂闂存埑鐨?Markdown銆? checked={form.codexAppMarkdownExport} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppMarkdownExport", value)} />
            <FeatureToggle title="绮樿创淇" detail="浠?Word 绛夊瘜鏂囨湰绮樿创鍒?Codex composer 鏃跺彧淇濈暀绾枃鏈紝閬垮厤琚瘑鍒负鍥剧墖/鏂囦欢闄勪欢銆傞渶閲嶅惎 Codex 鎵嶇敓鏁堛€? checked={form.codexAppPasteFix} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppPasteFix", value)} />
            <FeatureToggle title="浼氳瘽椤圭洰绉诲姩" detail="鎶婁細璇濈Щ鍔ㄥ埌鏅€氬璇濇垨鍏朵粬鏈湴椤圭洰銆? checked={form.codexAppProjectMove} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppProjectMove", value)} />
            <FeatureToggle title="浼氳瘽 ID 鏍囪瘑" detail="鍦ㄤ晶杈规爮浼氳瘽鏍囬鍓嶆樉绀虹煭 ID 鍜?UUIDv7 鍒涘缓鏃堕棿锛屾柟渚垮畾浣嶅巻鍙蹭細璇濄€? checked={form.codexAppThreadIdBadge} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppThreadIdBadge", value)} />
            <FeatureToggle title="瀵硅瘽灞呬腑瀹藉害" detail="鎶婁富瀵硅瘽鍜岃緭鍏ユ闄愬埗鍒板浐瀹氭渶澶у搴︼紝閫傚悎澶у睆闃呰銆? checked={form.codexAppConversationView} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppConversationView", value)} />
            <FeatureToggle title="鍒囨崲瀵硅瘽淇濈暀浣嶇疆" detail="鍒囨崲 thread 鏃舵仮澶嶄笂涓€娆℃祻瑙堜綅缃€? checked={form.codexAppThreadScrollRestore} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppThreadScrollRestore", value)} />
            <FeatureToggle title="Zed Remote open" detail="杩滅▼ SSH 鏂囦欢寮曠敤鍙洿鎺ョ敤 Zed Remote Development 鎵撳紑銆? checked={form.codexAppZedRemoteOpen} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppZedRemoteOpen", value)} />
            <FeatureToggle title="Zed 椤圭洰璁板綍" detail="缁存姢 Codex++ 鑷繁鐨勮繙绋嬮」鐩渶杩戝垪琛ㄣ€? checked={form.zedRemoteProjectRegistryEnabled} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("zedRemoteProjectRegistryEnabled", value)} />
            <FeatureToggle title="鍚屾 Zed settings" detail="楂樼骇閫夐」锛岄粯璁ゅ叧闂紱褰撳墠瀹炵幇涓嶄富鍔ㄦ敼鍐?Zed settings銆? checked={form.zedRemoteSyncToZedSettings} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("zedRemoteSyncToZedSettings", value)} />
            <FeatureToggle title="Upstream worktree" detail="浠庢渶鏂?upstream 鍒嗘敮鍒涘缓 Git worktree銆? checked={form.codexAppUpstreamWorktreeCreate} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppUpstreamWorktreeCreate", value)} />
            <FeatureToggle title="鍘熺敓鑿滃崟鏍忎綅缃? detail="鎶?Codex++ 鑿滃崟鎻掑叆 Codex 椤堕儴鍘熺敓鑿滃崟鏍忋€? checked={form.codexAppNativeMenuPlacement} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppNativeMenuPlacement", value)} />
            <FeatureToggle title="鍘熺敓鑿滃崟姹夊寲" detail="鍚姩鏃堕€氳繃鏈湴涓昏繘绋嬭皟璇曠鍙ｆ眽鍖?Codex 鍘熺敓鑿滃崟锛涗笉淇敼瀹夎鍖呫€傞渶閲嶅惎 Codex 鎵嶇敓鏁堛€? checked={form.codexAppNativeMenuLocalization} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppNativeMenuLocalization", value)} />
          </div>
          <div className="hint-line">
            <Wrench className="h-4 w-4" />
            <span>鏂版満鍣ㄦ病鏈夋湰鍦版彃浠跺競鍦烘椂锛屽彲浠?openai/plugins 鍒濆鍖栧埌褰撳墠 CODEX_HOME銆?/span>
            <Button disabled={pluginMarketplaceProgress.active} variant="secondary" onClick={() => void actions.repairPluginMarketplace()}>
              {pluginMarketplaceProgress.active ? "姝ｅ湪淇鈥? : "淇鎻掍欢甯傚満"}
            </Button>
          </div>
          <TaskProgressBox progress={pluginMarketplaceProgress} title="鎻掍欢甯傚満淇杩涘害" />
          <div className="zed-remote-settings">
            <Field label="Zed 榛樿鎵撳紑绛栫暐">
              <select
                className="select-input"
                disabled={!masterEnabled}
                onChange={(event) => onFormChange({ ...form, zedRemoteOpenStrategy: event.currentTarget.value as ZedOpenStrategy })}
                value={form.zedRemoteOpenStrategy}
              >
                <option value="addToFocusedWorkspace">鍔犲叆褰撳墠宸ヤ綔鍖?/option>
                <option value="reuseWindow">澶嶇敤绐楀彛</option>
                <option value="newWindow">鏂扮獥鍙?/option>
                <option value="default">Zed 榛樿琛屼负</option>
              </select>
            </Field>
          </div>
          <div className="hint-line">
            <Info className="h-4 w-4" />
            <span>濡傛灉浣跨敤瀹樻柟妯″紡鎴栧畼鏂规贩鍏?API 妯″紡锛岄€氬父涓嶉渶瑕佸紑鍚彃浠跺競鍦鸿В閿佸拰鐗规畩鎻掍欢寮哄埗瀹夎銆?/span>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>淇濆瓨澧炲己璁剧疆</Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function ZedRemoteScreen({
  projects,
  form,
  onFormChange,
  actions,
}: {
  projects: ZedRemoteProjectsResult | null;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const allProjects = projects?.projects ?? [];
  const currentProjects = allProjects.filter((project) => project.isCurrent);
  const currentIds = new Set(currentProjects.map((project) => project.id));
  const recentProjects = allProjects.filter((project) => !currentIds.has(project.id) && (project.source === "recent" || project.lastOpenedAtMs));
  const recentIds = new Set(recentProjects.map((project) => project.id));
  const discoveredProjects = allProjects.filter((project) => !currentIds.has(project.id) && !recentIds.has(project.id));
  const copyUrl = async (project: ZedRemoteProject) => {
    try {
      await navigator.clipboard.writeText(project.url);
      await actions.showMessage("Zed Remote URL", "ssh:// URL 宸插鍒躲€?, "ok");
    } catch (error) {
      await actions.showMessage("澶嶅埗澶辫触", stringifyError(error), "failed");
    }
  };
  return (
    <>
      <Panel>
        <CardHead title="Zed 杩滅▼椤圭洰" detail={`${allProjects.length} 涓?Codex++ 鍙瘑鍒」鐩紝榛樿绛栫暐锛?{zedStrategyLabel(form.zedRemoteOpenStrategy)}`} />
        <CardContent>
          <div className="metric-list">
            <Metric label="Current" value={String(currentProjects.length)} />
            <Metric label="Recent" value={String(recentProjects.length)} />
            <Metric label="Discovered" value={String(discoveredProjects.length)} />
          </div>
          <div className="zed-remote-settings">
            <Field label="榛樿鎵撳紑绛栫暐">
              <select
                className="select-input"
                onChange={(event) => onFormChange({ ...form, zedRemoteOpenStrategy: event.currentTarget.value as ZedOpenStrategy })}
                value={form.zedRemoteOpenStrategy}
              >
                <option value="addToFocusedWorkspace">鍔犲叆褰撳墠宸ヤ綔鍖?/option>
                <option value="reuseWindow">澶嶇敤绐楀彛</option>
                <option value="newWindow">鏂扮獥鍙?/option>
                <option value="default">Zed 榛樿琛屼负</option>
              </select>
            </Field>
            <label className="switch-row compact">
              <input
                checked={form.zedRemoteProjectRegistryEnabled}
                onChange={(event) => onFormChange({ ...form, zedRemoteProjectRegistryEnabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>璁板綍鏈€杩戞墦寮€</strong>
                <small>淇濆瓨鍒?Codex++ state锛屼笉鏀瑰啓 Zed settings銆?/small>
              </span>
            </label>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshZedRemoteProjects()}>
              <RefreshCw className="h-4 w-4" />
              鍒锋柊椤圭洰
            </Button>
            <Button variant="secondary" onClick={() => void actions.saveSettingsValue(form, false)}>
              <Save className="h-4 w-4" />
              淇濆瓨绛栫暐
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <ZedRemoteProjectSection title="Current" projects={currentProjects} actions={actions} onCopyUrl={copyUrl} />
      <ZedRemoteProjectSection title="Recent" projects={recentProjects} actions={actions} onCopyUrl={copyUrl} />
      <ZedRemoteProjectSection title="Discovered from Codex" projects={discoveredProjects} actions={actions} onCopyUrl={copyUrl} />
    </>
  );
}

function ZedRemoteProjectSection({
  title,
  projects,
  actions,
  onCopyUrl,
}: {
  title: string;
  projects: ZedRemoteProject[];
  actions: Actions;
  onCopyUrl: (project: ZedRemoteProject) => Promise<void>;
}) {
  return (
    <Panel>
      <CardHead title={title} detail={`${projects.length} 涓」鐩甡} />
      <CardContent>
        {projects.length ? (
          <div className="zed-remote-project-list">
            {projects.map((project) => (
              <div className="zed-remote-project-row" key={project.id}>
                <div className="zed-remote-project-main">
                  <div>
                    <strong>{project.label}</strong>
                    <span>{zedRemoteHostLabel(project)}</span>
                  </div>
                  <code>{project.path}</code>
                  <small>
                    {zedRemoteSourceLabel(project.source)}
                    {project.lastOpenedAtMs ? ` 路 ${formatTime(project.lastOpenedAtMs)}` : ""}
                  </small>
                </div>
                <div className="zed-remote-project-actions">
                  <Button onClick={() => void actions.openZedRemoteProject(project, "addToFocusedWorkspace")} size="sm">
                    <ExternalLink className="h-4 w-4" />
                    鍔犲叆褰撳墠宸ヤ綔鍖?
                  </Button>
                  <Button onClick={() => void actions.openZedRemoteProject(project, "reuseWindow")} size="sm" variant="outline">
                    澶嶇敤绐楀彛
                  </Button>
                  <Button onClick={() => void actions.openZedRemoteProject(project, "newWindow")} size="sm" variant="outline">
                    鏂扮獥鍙?
                  </Button>
                  <Button onClick={() => void onCopyUrl(project)} size="icon" title="澶嶅埗 ssh:// URL" variant="ghost">
                    <Copy className="h-4 w-4" />
                  </Button>
                  {project.source === "recent" ? (
                    <Button onClick={() => void actions.forgetZedRemoteProject(project)} size="icon" title="绉婚櫎鏈€杩戣褰? variant="ghost">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">鏆傛棤椤圭洰銆?/div>
        )}
      </CardContent>
    </Panel>
  );
}

function UserScriptsScreen({ settings, market, actions }: { settings: SettingsResult | null; market: ScriptMarketResult | null; actions: Actions }) {
  const inventory = settings?.user_scripts;
  const scripts = inventory?.scripts ?? [];
  const marketScripts = market?.market.scripts ?? [];
  const installedCount = marketScripts.filter((script) => script.installed).length;
  return (
    <>
      <Panel>
        <CardHead title="鑴氭湰甯傚満" detail={`${marketScripts.length} 涓競鍦鸿剼鏈紝宸插畨瑁?${installedCount} 涓紝鏈湴鏁翠綋 ${inventory?.enabled === false ? "鍏抽棴" : "寮€鍚?}`} />
        <CardContent>
          <div className="metric-list">
            <Metric label="甯傚満鐘舵€? value={market?.market.message ?? "灏氭湭鍒锋柊"} />
            <Metric label="杩滅▼鑴氭湰" value={`${marketScripts.length} 涓猔} />
            <Metric label="宸插畨瑁? value={`${installedCount} 涓猔} />
            <Metric label="鏈湴鏁翠綋" value={inventory?.enabled === false ? "鍏抽棴" : "寮€鍚?} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshScriptMarket()}>
              <RefreshCw className="h-4 w-4" />
              鍒锋柊甯傚満
            </Button>
            <Button onClick={() => void actions.openExternalUrl(SCRIPT_MARKET_REPOSITORY_URL)} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              鎶曠
            </Button>
            <Button onClick={() => void actions.refreshCurrent()} variant="secondary">
              <RefreshCw className="h-4 w-4" />
              鍒锋柊鏈湴
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="甯傚満鑴氭湰" detail={market?.market.updatedAt ? `娓呭崟鏇存柊鏃堕棿锛?{market.market.updatedAt}` : "浠?GitHub 闈欐€佹竻鍗曞姞杞?} />
        <CardContent>
          {marketScripts.length ? (
            <div className="script-market-grid">
              {marketScripts.map((script) => (
                <MarketScriptCard key={script.id} script={script} actions={actions} />
              ))}
            </div>
          ) : (
            <div className="empty">{market?.status === "failed" ? market.message : "鐐瑰嚮鍒锋柊甯傚満鍔犺浇杩滅▼鑴氭湰銆?}</div>
          )}
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鏈湴鑴氭湰" detail="鍐呯疆銆佹墜鍔ㄥ拰甯傚満瀹夎鑴氭湰锛涘彲鍦ㄨ繖閲屽惎鍋滄垨鍒犻櫎鐢ㄦ埛鑴氭湰" />
        <CardContent>
          <div className="table">
            {scripts.length ? scripts.map((script) => <ScriptRow key={script.key} script={script} actions={actions} />) : <div className="empty">鏈彂鐜扮敤鎴疯剼鏈€?/div>}
          </div>
        </CardContent>
      </Panel>
    </>
  );
}

function SessionsScreen({
  settings,
  form,
  sessions,
  providerSyncProgress,
  providerSyncTargets,
  selectedProviderSyncTarget,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  form: BackendSettings;
  sessions: LocalSessionsResult | null;
  providerSyncProgress: ProviderSyncProgress;
  providerSyncTargets: ProviderSyncTargetsResult | null;
  selectedProviderSyncTarget: string;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const items = sessions?.sessions ?? [];
  const activeCount = items.filter((item) => !item.archived).length;
  const archivedCount = items.length - activeCount;
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectedSessions = useMemo(() => items.filter((session) => selectedSessionIds.has(session.id)), [items, selectedSessionIds]);
  const selectedCount = selectedSessions.length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  useEffect(() => {
    const itemIds = new Set(items.map((session) => session.id));
    setSelectedSessionIds((current) => {
      const next = new Set(Array.from(current).filter((id) => itemIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const toggleSessionSelection = (sessionId: string, checked: boolean) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  };

  const selectAllSessions = () => {
    setSelectionMode(true);
    setSelectedSessionIds(new Set(items.map((session) => session.id)));
  };

  const clearSelectedSessions = () => setSelectedSessionIds(new Set());

  const deleteSelectedSessions = async () => {
    if (!selectionMode) {
      setSelectionMode(true);
      return;
    }
    setBulkDeleting(true);
    try {
      await actions.deleteLocalSessions(selectedSessions);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <>
      <Panel>
        <CardHead title="浼氳瘽绠＄悊" detail="璇诲彇 Codex 鏈湴 SQLite 浼氳瘽搴擄紝浼氬垹闄ゆ暟鎹簱璁板綍鍜屽搴?rollout 鏂囦欢" />
        <CardContent>
          <div className="metric-list">
            <Metric label="浼氳瘽鎬绘暟" value={`${items.length} 涓猔} />
            <Metric label="鏈綊妗? value={`${activeCount} 涓猔} />
            <Metric label="宸插綊妗? value={`${archivedCount} 涓猔} />
            <Metric label="鏁版嵁搴? value={sessions?.dbPath ?? "~/.codex/sqlite/*.db"} />
          </div>
          <div className="form-row">
            <Field label="鍚屾鐩爣">
              <select
                className="select-input"
                disabled={providerSyncProgress.active || !(providerSyncTargets?.targets ?? []).length}
                value={selectedProviderSyncTarget}
                onChange={(event) => actions.setProviderSyncTarget(event.currentTarget.value)}
              >
                {(providerSyncTargets?.targets ?? []).map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.id}锛坽providerSyncTargetLabel(target)}锛?
                  </option>
                ))}
                {!(providerSyncTargets?.targets ?? []).length ? <option value="">褰撳墠閰嶇疆 provider</option> : null}
              </select>
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshLocalSessions()}>
              <RefreshCw className="h-4 w-4" />
              鍒锋柊浼氳瘽
            </Button>
            <Button disabled={providerSyncProgress.active} onClick={() => void actions.syncProvidersNow()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              {providerSyncProgress.active ? "姝ｅ湪淇鈥? : "绔嬪埢淇鍘嗗彶浼氳瘽"}
            </Button>
          </Toolbar>
          <div className="provider-sync-progress" data-active={providerSyncProgress.active}>
            <div className="provider-sync-progress-head">
              <strong>{providerSyncProgress.active ? "姝ｅ湪淇鍘嗗彶浼氳瘽" : "鍘嗗彶浼氳瘽淇杩涘害"}</strong>
              <span>{providerSyncProgress.percent}%</span>
            </div>
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={providerSyncProgress.percent}
              className="provider-sync-progress-bar"
              role="progressbar"
            >
              <div className="provider-sync-progress-fill" style={{ width: `${providerSyncProgress.percent}%` }} />
            </div>
            <small>{providerSyncProgress.message}</small>
          </div>
          <div className="hint-line">
            <Info className="h-4 w-4" />
            <span>鍒犻櫎浼氬垱寤烘湰鍦板浠斤紱濡傛灉 Codex App 姝ｅ湪浣跨敤璇ヤ細璇濓紝寤鸿鍏堝叧闂搴斾細璇濈獥鍙ｅ啀鎿嶄綔銆?/span>
          </div>
          <label className="switch-row">
            <input
              checked={form.providerSyncEnabled}
              onChange={(event) => onFormChange({ ...form, providerSyncEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>鍚姩鍓嶈嚜鍔ㄤ慨澶嶅巻鍙蹭細璇?/strong>
              <small>寮€鍚悗锛岄€氳繃 Codex++ 鍚姩 Codex 鍓嶈嚜鍔ㄦ暣鐞嗕竴娆℃棫瀵硅瘽鐨勫綊灞炴爣璁般€?/small>
            </span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>淇濆瓨鑷姩淇璁剧疆</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鏈湴浼氳瘽" detail={items.length ? "鎸夋洿鏂版椂闂村€掑簭鏄剧ず" : "鐐瑰嚮鍒锋柊浼氳瘽璇诲彇鏈湴鏁版嵁搴?} />
        <CardContent>
          {items.length ? (
            <>
              <div className="session-list-toolbar">
                <span className="session-selection-summary">宸查€夋嫨 {selectedCount} / {items.length} 涓細璇?/span>
                <div className="session-selection-actions">
                  <Button disabled={allSelected || bulkDeleting} onClick={selectAllSessions} size="sm" variant="outline">
                    鍏ㄩ€夊綋鍓嶅垪琛?
                  </Button>
                  <Button disabled={!selectedCount || bulkDeleting} onClick={clearSelectedSessions} size="sm" variant="outline">
                    娓呯┖閫夋嫨
                  </Button>
                  <Button disabled={(selectionMode && !selectedCount) || bulkDeleting} onClick={() => void deleteSelectedSessions()} size="sm" variant="outline">
                    {selectionMode ? <Trash2 className="h-4 w-4" /> : null}
                    {selectionMode ? (bulkDeleting ? "姝ｅ湪鍒犻櫎鈥? : "鍒犻櫎宸查€?) : "澶氶€?}
                  </Button>
                </div>
              </div>
              <div className="session-list">
                {items.map((session) => {
                  const selected = selectedSessionIds.has(session.id);
                  return (
                    <div className="session-row" data-selection-mode={selectionMode} data-selected={selected} key={session.id}>
                      {selectionMode ? (
                        <label className="session-select" title="閫夋嫨浼氳瘽">
                          <input
                            aria-label={`閫夋嫨浼氳瘽 ${session.title || session.id}`}
                            checked={selected}
                            onChange={(event) => toggleSessionSelection(session.id, event.currentTarget.checked)}
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                      <div className="session-main">
                        <strong>{session.title || "鏈懡鍚嶄細璇?}</strong>
                        <span>{session.id}</span>
                        <small>{session.cwd || "鏈褰曢」鐩矾寰?}</small>
                      </div>
                      <div className="session-meta">
                        <Badge status={session.archived ? "archived" : "ok"} />
                        <span>{session.modelProvider || "provider 鏈褰?}</span>
                        <span>{formatTime(session.updatedAtMs ?? 0)}</span>
                      </div>
                      <Button className="session-delete-button" variant="outline" onClick={() => void actions.deleteLocalSession(session)}>
                        <Trash2 className="h-4 w-4" />
                        鍒犻櫎
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty">鏈鍙栧埌鏈湴浼氳瘽锛屾垨褰撳墠 SQLite 浼氳瘽搴撲笉瀛樺湪銆?/div>
          )}
        </CardContent>
      </Panel>
    </>
  );
}

function RecommendationsScreen({ ads, actions }: { ads: AdsResult | null; actions: Actions }) {
  const items = (ads?.ads ?? []).filter((ad) => !isExpiredAd(ad));
  const sponsors = items.filter((ad) => ad.type === "sponsor");
  const normal = items.filter((ad) => ad.type === "normal");
  return (
    <>
      <Panel>
        <CardHead title="鎺ㄨ崘鍐呭" detail="涓?Codex 鍐呮彃浠惰彍鍗曚娇鐢ㄥ悓涓€涓繙绔箍鍛婃簮" />
        <CardContent>
          <div className="recommend-hero">
            <div>
              <strong>{ads ? `宸插姞杞?${items.length} 鏉℃帹鑽恅 : "灏氭湭鍔犺浇鎺ㄨ崘鍐呭"}</strong>
              <span>鍐呭鏉ヨ嚜 luoda2023/LDCodex锛屽垎涓鸿禐鍔╁晢鎺ㄨ崘鍜屾櫘閫氭帹鑽愩€?/span>
            </div>
            <Button onClick={() => void actions.refreshAds()}>
              <RefreshCw className="h-4 w-4" />
              鍒锋柊鎺ㄨ崘
            </Button>
          </div>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="璧炲姪鍟嗘帹鑽? detail={`${sponsors.length} 鏉} />
        <CardContent>
          <AdGrid actions={actions} ads={sponsors} empty="鏆傛棤璧炲姪鍟嗘帹鑽愩€? />
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鏅€氭帹鑽? detail={`${normal.length} 鏉} />
        <CardContent>
          <AdGrid actions={actions} ads={normal} empty="鏆傛棤鏅€氭帹鑽愩€? />
        </CardContent>
      </Panel>
    </>
  );
}

function MaintenanceScreen({
  overview,
  watcher,
  settings,
  launchForm,
  onLaunchFormChange,
  removeOwnedData,
  onRemoveOwnedDataChange,
  actions,
}: {
  overview: OverviewResult | null;
  watcher: WatcherResult | null;
  settings: SettingsResult | null;
  launchForm: { appPath: string; debugPort: string; helperPort: string };
  onLaunchFormChange: (next: { appPath: string; debugPort: string; helperPort: string }) => void;
  removeOwnedData: boolean;
  onRemoveOwnedDataChange: (value: boolean) => void;
  actions: Actions;
}) {
  const savedCodexAppPath = settings?.settings.codexAppPath ?? "";
  return (
    <>
      <Panel>
        <CardHead title="妫€鏌ヤ笌淇" detail="妫€鏌ュ叆鍙ｃ€丆odex 搴旂敤鍜?Watcher 鐘舵€? />
        <CardContent>
          <div className="status-table">
            <StatusRow title="Codex 搴旂敤" status={overview?.codex_app.status} path={overview?.codex_app.path} />
            <StatusRow title="闈欓粯鍚姩鍏ュ彛" status={overview?.silent_shortcut.status} path={overview?.silent_shortcut.path} />
            <StatusRow title="绠＄悊鎺у埗鍙板叆鍙? status={overview?.management_shortcut.status} path={overview?.management_shortcut.path} />
            <StatusRow title="Watcher 鑷姩鎺ョ" status={watcher?.enabled ? "ok" : "disabled"} path={watcher?.disabled_flag} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.checkHealth()}>妫€鏌?/Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>淇蹇嵎鏂瑰紡</Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>淇鍚庣</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鍏ュ彛绠＄悊" detail="蹇嵎鏂瑰紡鍐欏叆绯荤粺瀹為檯妗岄潰浣嶇疆锛屼笉浣跨敤鍐欐妗岄潰璺緞" />
        <CardContent>
          <label className="check-row">
            <input checked={removeOwnedData} onChange={(event) => onRemoveOwnedDataChange(event.currentTarget.checked)} type="checkbox" />
            <span>鍗歌浇鏃剁Щ闄?Codex++ 鎵樼鏁版嵁</span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.installEntrypoints()}>瀹夎鍏ュ彛</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallEntrypoints()}>鍗歌浇鍏ュ彛</Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>淇鍏ュ彛</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鑷姩鎺ョ" detail="Watcher 鐢ㄤ簬淇濇寔 Codex++ 鎺ョ鐘舵€? />
        <CardContent>
          <Toolbar>
            <Button variant="secondary" onClick={() => void actions.installWatcher()}>瀹夎 watcher</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallWatcher()}>绉婚櫎 watcher</Button>
            <Button variant="secondary" onClick={() => void actions.enableWatcher()}>鍚敤</Button>
            <Button variant="secondary" onClick={() => void actions.disableWatcher()}>绂佺敤</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex 搴旂敤璺緞" detail="鍏嶅畨瑁呯増鎴栬В鍖呯増鍙渶瑕侀€夋嫨涓€娆★紝涔嬪悗闈欓粯鍚姩浼氳嚜鍔ㄥ鐢? />
        <CardContent>
          <div className="status-table">
            <StatusRow title="淇濆瓨璺緞" status={savedCodexAppPath ? "ok" : "not_checked"} path={savedCodexAppPath || null} />
            <StatusRow title="褰撳墠璇嗗埆" status={overview?.codex_app.status} path={overview?.codex_app.path} />
          </div>
          <Field label="淇濆瓨鐨勫簲鐢ㄨ矾寰?>
            <Input
              value={settings?.settings.codexAppPath ?? ""}
              placeholder="閫夋嫨 Codex.exe銆丆odex.app銆乤pp 鐩綍鎴栬В鍖呯洰褰?
              readOnly
            />
          </Field>
          <Toolbar>
            <Button onClick={() => void actions.chooseCodexAppPath("folder")}>閫夋嫨搴旂敤鐩綍</Button>
            <Button variant="secondary" onClick={() => void actions.chooseCodexAppPath("file")}>閫夋嫨 Codex.exe</Button>
            <Button variant="secondary" onClick={() => void actions.clearCodexAppPath()}>娓呴櫎淇濆瓨璺緞</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="鎵嬪姩鍚姩" detail="搴旂敤璺緞鐣欑┖鏃朵娇鐢ㄥ凡淇濆瓨璺緞锛涙病鏈変繚瀛樿矾寰勬椂浣跨敤鑷姩鎺㈡祴" />
        <CardContent>
          <Field label="搴旂敤璺緞瑕嗙洊">
            <Input
              value={launchForm.appPath}
              onChange={(event) => onLaunchFormChange({ ...launchForm, appPath: event.currentTarget.value })}
              placeholder={savedCodexAppPath || "渚嬪 C:\\Program Files\\WindowsApps\\OpenAI.Codex...\\app"}
            />
          </Field>
          <div className="form-row">
            <Field label="Debug 绔彛">
              <Input
                value={launchForm.debugPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, debugPort: event.currentTarget.value })}
              />
            </Field>
            <Field label="Helper 绔彛">
              <Input
                value={launchForm.helperPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, helperPort: event.currentTarget.value })}
              />
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.launch()}>鍚姩 Codex++</Button>
            <Button variant="secondary" onClick={() => void actions.saveManualCodexAppPath()}>
              淇濆瓨涓洪粯璁よ矾寰?
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function AboutScreen({
  overview,
  update,
  logs,
  diagnostics,
  actions,
}: {
  overview: OverviewResult | null;
  update: UpdateResult | null;
  logs: LogsResult | null;
  diagnostics: DiagnosticsResult | null;
  actions: Actions;
}) {
  return (
    <>
      <Panel>
        <CardHead title="鍏充簬 Codex++" detail="鏈湴 Codex 澧炲己銆佺鐞嗗伐鍏峰拰瀹夎鍖呯淮鎶? />
        <CardContent>
          <div className="metric-list">
            <Metric label="Codex++ 鐗堟湰" value={overview?.current_version ?? update?.currentVersion ?? "-"} />
            <Metric label="Codex 鐗堟湰" value={overview?.codex_version ?? "鏈娴嬪埌"} />
            <Metric label="椤圭洰鍦板潃" value="github.com/luoda2023/LDCodex" />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.openExternalUrl("https://github.com/luoda2023/LDCodex")} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              鎵撳紑椤圭洰涓婚〉
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://github.com/luoda2023/LDCodex/issues")} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              鍙嶉闂
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://discord.gg/y96kX7A76v")} variant="secondary">
              <MessageCircle className="h-4 w-4" />
              Discord
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://t.me/CodexPlusPlus")} variant="secondary">
              <MessageCircle className="h-4 w-4" />
              Telegram
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="GitHub Release 鏇存柊" detail={`褰撳墠鐗堟湰 ${overview?.current_version ?? update?.currentVersion ?? "-"}`} />
        <CardContent>
          <div className="metric-list">
            <Metric label="鐘舵€? value={update?.status ?? "not_checked"} />
            <Metric label="鏈€鏂扮増鏈? value={update?.latestVersion ?? "鏈鏌?} />
            <Metric label="璧勬簮" value={update?.assetName ?? "-"} />
            <Metric label="杩涘害" value={`${update?.progress ?? 0}%`} />
          </div>
          <Textarea className="log-view" readOnly value={update?.releaseSummary || update?.message || "灏氭湭妫€鏌?GitHub Release锛涙洿鏂颁細涓嬭浇骞跺惎鍔ㄥ畨瑁呭寘銆?} />
          <Toolbar>
            <Button onClick={() => void actions.checkUpdate()}>妫€鏌ユ洿鏂?/Button>
            <Button variant="secondary" onClick={() => void actions.performUpdate()}>涓嬭浇骞惰繍琛屽畨瑁呭寘</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <LogsPanel logs={logs} actions={actions} />
      <DiagnosticsPanel diagnostics={diagnostics} actions={actions} />
    </>
  );
}

function SettingsScreen({
  settings,
  theme,
  form,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  theme: Theme;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  return (
    <>
      <Panel>
        <CardHead title="鍩虹璁剧疆" detail={settings?.settings_path ?? ""} />
        <CardContent>
          <div className="theme-row">
            <div>
              <strong>鐣岄潰涓婚</strong>
              <span>褰撳墠涓簕theme === "dark" ? "娣辫壊" : "娴呰壊"}妯″紡銆?/span>
            </div>
            <Button variant="secondary" onClick={actions.toggleTheme}>鍒囨崲涓婚</Button>
          </div>
          <Field label="妯″瀷娴嬭瘯妯″瀷">
            <Input
              value={form.relayTestModel}
              onChange={(event) => onFormChange({ ...form, relayTestModel: event.currentTarget.value })}
              placeholder="渚嬪 gpt-5.4-mini"
            />
          </Field>
          <label className="check-row">
            <input
              checked={form.cliWrapperEnabled}
              onChange={(event) => onFormChange({ ...form, cliWrapperEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>鍚敤 Codex 鍛戒护鍖呰鍣?/span>
          </label>
          <div className="form-row">
            <Field label="鍖呰鍣?Base URL">
              <Input
                value={form.cliWrapperBaseUrl}
                onChange={(event) => onFormChange({ ...form, cliWrapperBaseUrl: event.currentTarget.value })}
              />
            </Field>
            <Field label="API Key 鐜鍙橀噺">
              <Input
                value={form.cliWrapperApiKeyEnv}
                onChange={(event) => onFormChange({ ...form, cliWrapperApiKeyEnv: event.currentTarget.value })}
              />
            </Field>
          </div>
          <Field label="API Key">
            <Input
              type="password"
              value={form.cliWrapperApiKey}
              onChange={(event) => onFormChange({ ...form, cliWrapperApiKey: event.currentTarget.value })}
            />
          </Field>
          <div className="settings-block">
            <label className="check-row">
              <input
                checked={form.codexAppImageOverlayEnabled}
                onChange={(event) =>
                  onFormChange({ ...form, codexAppImageOverlayEnabled: event.currentTarget.checked })
                }
                type="checkbox"
              />
              <span>鍚敤 Codex 鍥剧墖瑕嗙洊灞?/span>
            </label>
            <div className="form-row">
              <Field label="瑕嗙洊鍥剧墖">
                <Input
                  value={form.codexAppImageOverlayPath}
                  onChange={(event) => onFormChange({ ...form, codexAppImageOverlayPath: event.currentTarget.value })}
                  placeholder="閫夋嫨 png / jpg / webp / gif / bmp"
                />
              </Field>
              <Toolbar>
                <Button variant="secondary" onClick={() => void actions.chooseImageOverlayPath()}>
                  閫夋嫨鍥剧墖
                </Button>
              </Toolbar>
            </div>
            <Field label={`閫忔槑搴?${form.codexAppImageOverlayOpacity}%`}>
              <Input
                min={1}
                max={100}
                type="range"
                value={form.codexAppImageOverlayOpacity}
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    codexAppImageOverlayOpacity: clampNumber(Number(event.currentTarget.value), 1, 100),
                  })
                }
              />
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>淇濆瓨璁剧疆</Button>
            <Button variant="secondary" onClick={() => void actions.resetImageOverlaySettings()}>
              閲嶇疆鑳屾櫙
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex 鍚姩鍙傛暟" detail="鍚姩 Codex App 鏃惰拷鍔犲埌榛樿 CDP 鍙傛暟鍚庛€傜暀绌哄垯淇濇寔榛樿鍚姩琛屼负銆? />
        <CardContent>
          <Field label="棰濆鍙傛暟">
            <Textarea
              className="launch-args-input"
              placeholder="--force_high_performance_gpu"
              spellCheck={false}
              value={codexExtraArgsToInput(form.codexExtraArgs)}
              onChange={(event) =>
                onFormChange({
                  ...form,
                  codexExtraArgs: inputToCodexExtraArgs(event.currentTarget.value),
                })
              }
            />
          </Field>
          <p className="field-hint">姣忚涓€涓弬鏁帮紝渚嬪 --force_high_performance_gpu銆備笉闇€瑕佸～鍐?open 鎴?--args銆?/p>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>淇濆瓨璁剧疆</Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function LogsPanel({ logs, actions }: { logs: LogsResult | null; actions: Actions }) {
  const lines = splitLogLines(logs?.text ?? "");
  return (
    <Panel>
      <CardHead title="鏈€杩戞棩蹇? detail={logs?.path ?? ""} />
      <CardContent>
        <div className="log-lines">
          {lines.length ? (
            lines.map((line, index) => (
              <div className="log-line" key={`${index}-${line.slice(0, 12)}`}>
                <span>{index + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))
          ) : (
            <div className="empty">鏆傛棤鏃ュ織銆?/div>
          )}
        </div>
        <Toolbar>
          <Button onClick={() => void actions.refreshLogs()}>鍒锋柊</Button>
          <Button variant="secondary" onClick={() => void actions.copyLogs()}>
            澶嶅埗
          </Button>
        </Toolbar>
      </CardContent>
    </Panel>
  );
}

function DiagnosticsPanel({ diagnostics, actions }: { diagnostics: DiagnosticsResult | null; actions: Actions }) {
  return (
    <Panel>
      <CardHead title="璇婃柇鎶ュ憡" detail="鍖呭惈鐗堟湰銆佽矾寰勩€佽缃拰骞冲彴淇℃伅" />
      <CardContent>
        <Textarea className="log-view tall" readOnly value={diagnostics?.report ?? "灏氭湭鐢熸垚璇婃柇鎶ュ憡銆?} />
        <Toolbar>
          <Button onClick={() => void actions.refreshDiagnostics()}>閲嶆柊鐢熸垚</Button>
          <Button variant="secondary" onClick={() => void actions.copyDiagnostics()}>
            澶嶅埗鎶ュ憡
          </Button>
        </Toolbar>
      </CardContent>
    </Panel>
  );
}

function RelayProfileList({
  form,
  onFormChange,
  onEdit,
  disabled = false,
  actions,
}: {
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  onEdit: (id: string) => void;
  disabled?: boolean;
  actions: Actions;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderRelayProfiles(form, String(active.id), String(over.id));
    if (next !== form) onFormChange(next);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={form.relayProfiles.map((profile) => profile.id)} strategy={verticalListSortingStrategy}>
        <div className="relay-profile-list">
          {form.relayProfiles.map((profile, index) => (
            <SortableRelayProfileCard
              actions={actions}
              form={form}
              index={index}
              key={profile.id}
              onEdit={onEdit}
              onFormChange={onFormChange}
              disabled={disabled}
              profile={profile}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRelayProfileCard({
  form,
  profile,
  index,
  onFormChange,
  onEdit,
  disabled = false,
  actions,
}: {
  form: BackendSettings;
  profile: RelayProfile;
  index: number;
  onFormChange: (value: BackendSettings) => void;
  onEdit: (id: string) => void;
  disabled?: boolean;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: profile.id });
  const active = profile.id === form.activeRelayId;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={`relay-profile-card ${active ? "active" : ""} ${isDragging ? "dragging" : ""}`}
      data-relay-profile-id={profile.id}
      key={profile.id}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit(profile.id);
      }}
      ref={setNodeRef}
      style={style}
      tabIndex={0}
    >
      <button
        aria-label="鎷栧姩鎺掑簭"
        className="relay-drag"
        title="鎷栧姩鎺掑簭"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="relay-index" title={profile.name || "鏈懡鍚嶆ā鍨?}>
        {providerInitial(profile.name)}
      </span>
      <span className="relay-summary">
        <strong>{profile.name || "鏈懡鍚嶆ā鍨?}</strong>
        <small>{relayModeLabel(profile.relayMode)} 路 {relayProtocolLabel(profile.protocol)} 路 {relayProfileConfigBrief(profile)}</small>
      </span>
      <span className="relay-card-actions">
        <Button
          className={`relay-use-button ${active ? "active" : ""}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            const previousActiveRelayId = form.activeRelayId;
            const next = syncLegacyRelayFields({ ...form, activeRelayId: profile.id });
            void actions.switchRelayProfile(next, previousActiveRelayId);
          }}
          size="sm"
          title={disabled ? "妯″瀷鍒囨崲涓嶅彲鐢? : active ? "褰撳墠姝ｅ湪浣跨敤" : "璁句负褰撳墠"}
          variant={active ? "secondary" : "outline"}
        >
          <CheckCircle2 className="h-4 w-4" />
          {active ? "浣跨敤涓? : "浣跨敤"}
        </Button>
        <span className="relay-card-extra">
          <Button
            disabled={isAggregateRelayProfile(profile)}
            onClick={(event) => {
              event.stopPropagation();
              if (isAggregateRelayProfile(profile)) return;
              void actions.testRelayProfile(profile);
            }}
            size="icon"
            title={isAggregateRelayProfile(profile) ? "鑱氬悎妯″瀷浼氬湪鐪熷疄瀵硅瘽涓疆杞垚鍛橈紝璇锋祴璇曟垚鍛樻ā鍨? : "鍙戦€?hi 娴嬭瘯"}
            variant="ghost"
          >
            <TestTube className="h-4 w-4" />
          </Button>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onEdit(profile.id);
            }}
            size="icon"
            title="缂栬緫"
            variant="ghost"
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onFormChange(duplicateRelayProfile(form, profile.id));
            }}
            size="icon"
            title="澶嶅埗"
            variant="ghost"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            disabled={form.relayProfiles.length <= 1}
            onClick={(event) => {
              event.stopPropagation();
              onFormChange(removeRelayProfile(form, profile.id));
            }}
            size="icon"
            title="鍒犻櫎妯″瀷"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </span>
      </span>
    </div>
  );
}

function MarketScriptCard({ script, actions }: { script: ScriptMarketItem; actions: Actions }) {
  const status = script.updateAvailable ? "鍙洿鏂? : script.installed ? `宸插畨瑁?${script.installedVersion}` : "鏈畨瑁?;
  return (
    <div className="script-market-card">
      <div className="script-market-title">
        <div>
          <strong>{script.name}</strong>
          <span>{script.author || "鏈煡浣滆€?}</span>
        </div>
        <UiBadge variant={script.updateAvailable ? "default" : script.installed ? "secondary" : "outline"}>{status}</UiBadge>
      </div>
      <p className="script-market-description">{script.description || "鏆傛棤鎻忚堪銆?}</p>
      <div className="script-market-tags">
        <span className="script-market-tag">v{script.version}</span>
        {script.tags.map((tag) => (
          <span className="script-market-tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="script-market-actions">
        <Button onClick={() => void actions.installMarketScript(script.id)} size="sm">
          <Download className="h-4 w-4" />
          {script.updateAvailable ? "鏇存柊" : script.installed ? "閲嶆柊瀹夎" : "瀹夎"}
        </Button>
        {script.homepage ? (
          <Button onClick={() => void actions.openExternalUrl(script.homepage)} size="sm" variant="secondary">
            <ExternalLink className="h-4 w-4" />
            涓婚〉
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RelayProfileDetail({
  profile,
  relayFiles,
  form,
  isNew = false,
  onBack,
  onFormChange,
  onSaved,
  actions,
}: {
  profile: RelayProfile;
  relayFiles: RelayFilesResult | null;
  form: BackendSettings;
  isNew?: boolean;
  onBack: () => void;
  onFormChange: (value: BackendSettings) => void | Promise<void>;
  onSaved?: () => void;
  actions: Actions;
}) {
  const [draft, setDraft] = useState<RelayProfile>(profile);
  const [modelWindowRows, setModelWindowRows] = useState<ModelWindowRow[]>(
    modelWindowRowsFromProfile(profile.modelList, profile.modelWindows || ""),
  );
  const isActive = !isNew && profile.id === form.activeRelayId;
  const profileUsesLiveFiles = relayProfileUsesLiveFiles(profile);
  useEffect(() => {
    const nextDraft = isAggregateRelayProfile(profile)
      ? normalizeAggregateRelayProfile(profile, form)
      : deriveRelayProfileFromFiles(
          isActive && profileUsesLiveFiles && relayFiles
            ? {
              ...profile,
              configContents: relayFiles.configContents,
              authContents: relayFiles.authContents,
            }
            : profile,
        );
    setDraft(nextDraft);
    setModelWindowRows(modelWindowRowsFromProfile(nextDraft.modelList, nextDraft.modelWindows || ""));
  }, [profile.id, profile.modelList, profile.modelWindows, profileUsesLiveFiles, isActive, isNew, relayFiles?.configContents, relayFiles?.authContents]);
  const validationError = isAggregateRelayProfile(draft) ? aggregateRelayProfileValidation(draft) : null;
  const draftWithModelRows = () => {
    const serializedRows = serializeModelWindowRows(modelWindowRows);
    return { ...draft, modelList: serializedRows.modelList, modelWindows: serializedRows.modelWindows };
  };
  const saveDraft = async () => {
    if (validationError) return;
    const draftWithWindows = draftWithModelRows();
    const normalizedDraft = isAggregateRelayProfile(draftWithWindows) ? normalizeAggregateRelayProfile(draftWithWindows, form) : deriveRelayProfileFromFiles(draftWithWindows);
    const next = isNew
      ? addRelayProfile(form, normalizedDraft)
      : updateRelayProfile(form, profile.id, normalizedDraft);
    await onFormChange(next);
    if (isActive && relayProfileUsesLiveFiles(normalizedDraft)) {
      await actions.saveRelayFile(
        "config",
        effectiveRelayConfigPreview(normalizedDraft, form, normalizedDraft),
        true,
      );
      await actions.saveRelayFile("auth", normalizedDraft.authContents, true);
    }
    onSaved?.();
  };
  const switchDraft = () => {
    if (isNew || !form.relayProfilesEnabled) return;
    const draftWithWindows = draftWithModelRows();
    const normalizedDraft = isAggregateRelayProfile(draftWithWindows) ? normalizeAggregateRelayProfile(draftWithWindows, form) : deriveRelayProfileFromFiles(draftWithWindows);
    const previousActiveRelayId = form.activeRelayId;
    const next = syncLegacyRelayFields({
      ...form,
      relayProfiles: form.relayProfiles.map((item) => (item.id === profile.id ? normalizedDraft : item)),
      activeRelayId: profile.id,
    });
    void actions.switchRelayProfile(next, previousActiveRelayId);
  };
  return (
    <div className="relay-detail-page" key={profile.id}>
      <div className="relay-detail-sticky">
        <Toolbar>
          <Button onClick={onBack} variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            杩斿洖鍒楄〃
          </Button>
          <Button disabled={!!validationError} onClick={() => void saveDraft()} title={validationError || "淇濆瓨"}>
            <Save className="h-4 w-4" />
            淇濆瓨
          </Button>
        </Toolbar>
      </div>
        <RelayProfileEditor profile={draft} form={form} isNew={isNew} onProfileChange={setDraft} onSwitch={switchDraft} actions={actions} modelWindowRows={modelWindowRows} setModelWindowRows={setModelWindowRows} />
      {isAggregateRelayProfile(draft) ? null : (
      <RelayFileEditors
        contextProfile={profile}
        profile={draft}
        form={form}
        isActive={isActive}
        profileId={profile.id}
        onFormChange={onFormChange}
        onProfileChange={setDraft}
        actions={actions}
      />
      )}
    </div>
  );
}

function ContextScreen({
  form,
  liveEntries,
  relayFiles,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  liveEntries: CodexContextEntries | null;
  relayFiles: RelayFilesResult | null;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  return (
    <Panel fill>
      <CardHead title="Codex 宸ュ叿涓庢彃浠? detail="鐙珛绠＄悊 Codex 鐨?MCP銆丼kills銆丳lugins锛涘垏鎹换鎰忔ā鍨嬮兘浼氬甫涓娿€? />
      <CardContent>
        <RelayContextManager
          form={normalizeSettings(form)}
          liveEntries={liveEntries}
          relayFiles={relayFiles}
          onFormChange={onFormChange}
          actions={actions}
        />
      </CardContent>
    </Panel>
  );
}

function RelayProfileEditor({
  profile,
  form,
  isNew = false,
  onProfileChange,
  onSwitch,
  actions,
  modelWindowRows,
  setModelWindowRows,
}: {
  profile: RelayProfile;
  form: BackendSettings;
  isNew?: boolean;
  onProfileChange: (value: RelayProfile) => void;
  onSwitch: () => void;
  actions: Actions;
  modelWindowRows: ModelWindowRow[];
  setModelWindowRows: (value: ModelWindowRow[]) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  if (isAggregateRelayProfile(profile)) {
    return (
      <AggregateRelayProfileEditor
        profile={profile}
        form={form}
        isNew={isNew}
        onProfileChange={onProfileChange}
      />
    );
  }

  const showApiFields = profile.relayMode !== "official" || profile.officialMixApiKey;
  const updateDraft = (patch: Partial<RelayProfile>) => {
    onProfileChange(applyRelayProfilePatchToFiles(profile, patch, { allowGenerateFiles: isNew }));
  };
  const updateModelWindowRow = (index: number, patch: Partial<ModelWindowRow>) => {
    setModelWindowRows(
      modelWindowRows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  };
  const removeModelWindowRow = (index: number) => {
    const nextRows = modelWindowRows.filter((_, rowIndex) => rowIndex !== index);
    setModelWindowRows(nextRows.length ? nextRows : [{ model: "", window: "" }]);
  };
  const addModelWindowRows = (rows: ModelWindowRow[]) => {
    const existingRows = modelWindowRows.filter((row) => row.model.trim() || row.window.trim());
    setModelWindowRows([...existingRows, ...rows]);
  };
  return (
    <div className="relay-profile-editor">
      <div className="relay-editor-head">
        <div>
          <strong>{profile.name || "鏈懡鍚嶆ā鍨?}</strong>
          <span>{relayProfileEditorStatus(profile, form, isNew)}</span>
        </div>
        {isNew ? null : (
          <Button
            disabled={!form.relayProfilesEnabled || actions.relaySwitching}
            onClick={onSwitch}
            title={!form.relayProfilesEnabled ? "妯″瀷閰嶇疆鎬诲紑鍏冲凡鍏抽棴" : actions.relaySwitching ? "妯″瀷鍒囨崲涓? : undefined}
            variant={profile.id === form.activeRelayId ? "secondary" : "default"}
          >
            {actions.relaySwitching ? "鍒囨崲涓? : profile.id === form.activeRelayId ? "浣跨敤涓? : "璁句负褰撳墠"}
          </Button>
        )}
      </div>
      {isNew ? (
        <ProviderPresetSelector
          onSelect={(patch: PresetPatch) => {
            updateDraft(patch as unknown as Partial<RelayProfile>);
          }}
        />
      ) : null}
      <div className="relay-fields">
        <Field className="relay-field-name" label="鍚嶇О">
          <Input
            value={profile.name}
            onChange={(event) => updateDraft({ name: event.currentTarget.value })}
          />
        </Field>
        <Field className="relay-field-mode" label="鎺ュ叆妯″紡">
          <select
            className="field-select"
            value={profile.relayMode}
            onChange={(event) => {
              const relayMode = event.currentTarget.value as RelayMode;
              updateDraft(relayMode === "official" ? { relayMode, officialMixApiKey: false } : { relayMode });
            }}
          >
            <option value="official">瀹樻柟鐧诲綍</option>
            <option value="pureApi">绾?API</option>
          </select>
        </Field>
        <Field className="relay-field-config-model" label="閰嶇疆妯″瀷">
          <Input
            value={profile.model}
            onChange={(event) => updateDraft({ model: event.currentTarget.value })}
            placeholder="渚嬪 deepseek-v4-pro"
          />
          <p className="field-hint">
            榛樿鍚姩 Codex 鏃朵娇鐢ㄧ殑妯″瀷鍚嶏紝璇峰嬁甯﹀悗缂€锛涗笂涓嬫枃绐楀彛璇峰湪涓嬫柟銆屾ā鍨嬪垪琛ㄣ€嶄腑鎸夋ā鍨嬪崟鐙厤缃€?
          </p>
        </Field>
        <Field className="relay-field-goals" label="Codex 鐩爣">
          <label className="inline-check">
            <input
              checked={configHasCodexGoalsFeature(profile.configContents)}
              onChange={(event) =>
                updateDraft({
                  configContents: setCodexGoalsFeatureInConfig(profile.configContents, event.currentTarget.checked),
                })
              }
              type="checkbox"
            />
            <span>鍚敤鐩爣鍔熻兘</span>
          </label>
        </Field>
        <div className="relay-advanced-toggle">
          <Button
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Settings className="h-4 w-4" />
            鏇村閫夐」
          </Button>
        </div>
        {showAdvanced ? (
          <div className="relay-advanced-fields">
            <Field className="relay-field-test-model" label="娴嬭瘯妯″瀷">
              <Input
                value={profile.testModel}
                onChange={(event) => updateDraft({ testModel: event.currentTarget.value })}
                placeholder={`鐣欑┖浣跨敤榛樿锛?{form.relayTestModel || defaultSettings.relayTestModel}`}
              />
            </Field>
            <Field className="relay-field-context-window" label="涓婁笅鏂囧ぇ灏?>
              <Input
                inputMode="numeric"
                value={profile.contextWindow}
                onChange={(event) => updateDraft({ contextWindow: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="鐣欑┖涓嶆敼鍐欙紝渚嬪 200000"
              />
            </Field>
            <Field className="relay-field-auto-compact" label="鍘嬬缉涓婁笅鏂囧ぇ灏?>
              <Input
                inputMode="numeric"
                value={profile.autoCompactLimit}
                onChange={(event) => updateDraft({ autoCompactLimit: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="鐣欑┖涓嶆敼鍐欙紝渚嬪 160000"
              />
            </Field>
          </div>
        ) : null}
        {profile.relayMode === "official" ? (
          <Field className="relay-field-official-key" label="API Key">
            <label className="inline-check">
              <input
                checked={profile.officialMixApiKey}
                onChange={(event) => updateDraft({ officialMixApiKey: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>娣峰叆 API KEY</span>
            </label>
          </Field>
        ) : null}
        {showApiFields ? (
          <div className="relay-api-fields">
            <Field className="relay-field-base-url" label="Base URL">
              <Input
                value={profile.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
                placeholder="濉啓涓浆鏈嶅姟 Base URL"
              />
            </Field>
            <Field className="relay-field-key" label="Key">
              <Input
                type="password"
                value={profile.apiKey}
                onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
                placeholder="杈撳叆涓浆鏈嶅姟鐨?API Key"
              />
            </Field>
            <Field className="relay-field-protocol" label="涓婃父鍗忚">
              <div className="protocol-options">
                <button
                  className={`protocol-option ${profile.protocol === "responses" ? "active" : ""}`}
                  onClick={() => updateDraft({ protocol: "responses" })}
                  type="button"
                >
                  Responses API
                </button>
                <button
                  className={`protocol-option ${profile.protocol === "chatCompletions" ? "active" : ""}`}
                  onClick={() => updateDraft({ protocol: "chatCompletions" })}
                  type="button"
                >
                  Chat Completions
                </button>
              </div>
            </Field>
          </div>
        ) : null}
        {showApiFields ? (
          <Field className="relay-field-model-list" label="妯″瀷鍒楄〃">
            <div className="relay-model-row-editor">
              <div className="relay-model-row relay-model-row-head">
                <span>妯″瀷鍚嶇О</span>
                <span>涓婁笅鏂囩獥鍙?/span>
                <span />
              </div>
              {modelWindowRows.map((row, index) => (
                <div className="relay-model-row" key={`${index}-${row.model}`}>
                  <Input
                    value={row.model}
                    onChange={(event) => updateModelWindowRow(index, { model: event.currentTarget.value })}
                    placeholder="deepseek/deepseek-v4-flash"
                  />
                  <Input
                    value={row.window}
                    onChange={(event) => updateModelWindowRow(index, { window: event.currentTarget.value })}
                    placeholder="1M"
                  />
                  <Button
                    aria-label="鍒犻櫎妯″瀷"
                    onClick={() => removeModelWindowRow(index)}
                    size="icon"
                    title="鍒犻櫎妯″瀷"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="relay-model-list-tools">
              <Button
                onClick={() => setModelWindowRows([...modelWindowRows, { model: "", window: "" }])}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Plus className="h-4 w-4" />
                娣诲姞妯″瀷
              </Button>
              <Button
                onClick={async () => {
                  const serializedRows = serializeModelWindowRows(modelWindowRows);
                  const models = await actions.fetchRelayProfileModels({
                    ...profile,
                    modelList: serializedRows.modelList,
                    modelWindows: serializedRows.modelWindows,
                  });
                  if (models?.length) {
                    addModelWindowRows(models.map((model) => ({ model, window: "" })));
                  }
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Download className="h-4 w-4" />
                浠庝笂娓歌幏鍙?
              </Button>
            </div>
            <p className="field-hint">
              姣忚涓€涓ā鍨嬶紱涓婁笅鏂囩獥鍙ｅ彲濉?<code>1M</code>銆?code>200K</code> 鎴?<code>1000000</code>锛岀暀绌鸿〃绀轰娇鐢?Codex 榛樿闀垮害銆?
            </p>
          </Field>
        ) : null}
        {showApiFields ? (
          <Field className="relay-field-user-agent" label="User-Agent">
            <Input
              value={profile.userAgent}
              onChange={(event) => updateDraft({ userAgent: event.currentTarget.value })}
              placeholder="鐣欑┖浣跨敤榛樿鍊?
            />
          </Field>
        ) : null}
      </div>
      {showApiFields && profile.protocol === "chatCompletions" ? (
        <div className="hint-line relay-protocol-hint">
          <MessageCircle className="h-4 w-4" />
          <span>姝や笂娓镐細閫氳繃鏈湴 127.0.0.1:57321 杞垚 Responses API锛岄渶瑕佷粠 Codex++ 鍚姩 Codex銆?/span>
        </div>
      ) : null}
      <div className="hint-line relay-protocol-hint">
        <ShieldCheck className="h-4 w-4" />
        <span>{relayProfileModeHelp(profile)}</span>
      </div>
    </div>
  );
}

function AggregateRelayProfileEditor({
  profile,
  form,
  isNew = false,
  onProfileChange,
}: {
  profile: RelayProfile;
  form: BackendSettings;
  isNew?: boolean;
  onProfileChange: (value: RelayProfile) => void;
}) {
  const candidates = aggregateMemberCandidates(form, profile.id);
  const aggregate = normalizeAggregateConfig(profile.aggregate, candidates);
  const memberIds = new Set(aggregate.members.map((member) => member.profileId));
  const updateAggregate = (nextAggregate: RelayAggregateConfig) => {
    onProfileChange(normalizeAggregateRelayProfile({ ...profile, aggregate: nextAggregate }, form));
  };
  const toggleMember = (profileId: string, checked: boolean) => {
    const members = checked
      ? [...aggregate.members, { profileId, weight: 1 }]
      : aggregate.members.filter((member) => member.profileId !== profileId);
    updateAggregate({ ...aggregate, members });
  };
  const updateWeight = (profileId: string, weight: number) => {
    updateAggregate({
      ...aggregate,
      members: aggregate.members.map((member) =>
        member.profileId === profileId ? { ...member, weight: clampAggregateWeight(weight) } : member,
      ),
    });
  };
  const totalWeight = aggregate.members.reduce((total, member) => total + clampAggregateWeight(member.weight), 0);

  return (
    <div className="relay-profile-editor aggregate-editor">
      <div className="relay-editor-head">
        <div>
          <strong>{profile.name || "鏈懡鍚嶈仛鍚堟ā鍨?}</strong>
          <span>{isNew ? "閫夋嫨宸叉湁妯″瀷浣滀负鎴愬憳锛屼繚瀛樺悗鍐欏叆 settings payload" : "鑱氬悎閰嶇疆鍙紩鐢ㄥ凡鏈夋ā鍨嬶紝涓嶅鍒?Key 鍜岄厤缃枃浠?}</span>
        </div>
        <UiBadge variant="secondary">鑱氬悎</UiBadge>
      </div>
      <div className="relay-fields aggregate-fields">
        <Field className="relay-field-name" label="鍚嶇О">
          <Input
            value={profile.name}
            onChange={(event) => onProfileChange({ ...profile, name: event.currentTarget.value })}
            placeholder="渚嬪 涓诲姏鑱氬悎姹?
          />
        </Field>
        <Field className="relay-field-test-model" label="娴嬭瘯妯″瀷">
          <Input
            value={profile.testModel}
            onChange={(event) => onProfileChange({ ...profile, testModel: event.currentTarget.value })}
            placeholder={`鐣欑┖浣跨敤榛樿锛?{form.relayTestModel || defaultSettings.relayTestModel}`}
          />
        </Field>
        <Field className="aggregate-strategy-field" label="鑱氬悎绛栫暐">
          <select
            className="field-select"
            value={aggregate.strategy}
            onChange={(event) => updateAggregate({ ...aggregate, strategy: event.currentTarget.value as RelayAggregateStrategy })}
          >
            {aggregateStrategyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="aggregate-strategy-grid">
        {aggregateStrategyOptions.map((option) => (
          <button
            className={`mode-option aggregate-strategy-option ${aggregate.strategy === option.value ? "active" : ""}`}
            key={option.value}
            onClick={() => updateAggregate({ ...aggregate, strategy: option.value })}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="aggregate-members">
        <div className="aggregate-members-head">
          <div>
            <strong>鎴愬憳妯″瀷</strong>
            <span>鍙兘鍕鹃€夊凡濉啓 Base URL / Key 鐨?API 妯″瀷锛岃仛鍚堟ā鍨嬩笉浼氫綔涓烘垚鍛樸€?/span>
          </div>
          <UiBadge variant="outline">{aggregate.members.length} / {candidates.length}</UiBadge>
        </div>
        {candidates.length ? (
          <div className="aggregate-member-list">
            {candidates.map((candidate) => {
              const member = aggregate.members.find((item) => item.profileId === candidate.id);
              const checked = memberIds.has(candidate.id);
              return (
                <label className={`aggregate-member-row ${checked ? "selected" : ""}`} key={candidate.id}>
                  <input
                    checked={checked}
                    onChange={(event) => toggleMember(candidate.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span className="aggregate-member-summary">
                    <strong>{candidate.name || "鏈懡鍚嶆ā鍨?}</strong>
                    <small>{relayModeLabel(candidate.relayMode)} 路 {relayProtocolLabel(candidate.protocol)} 路 {relayProfileConfigBrief(candidate)}</small>
                  </span>
                  <span className="aggregate-weight-box">
                    <span>鏉冮噸</span>
                    <Input
                      disabled={!checked}
                      min={1}
                      onChange={(event) => updateWeight(candidate.id, Number.parseInt(event.currentTarget.value, 10))}
                      type="number"
                      value={String(member?.weight ?? 1)}
                    />
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="empty">鍏堟坊鍔犺嚦灏?1 涓凡濉啓 Base URL / Key 鐨?API 妯″瀷锛屽啀鍒涘缓鑱氬悎妯″瀷銆?/div>
        )}
      </div>
      <div className="relay-grid compact aggregate-preview">
        <Metric label="绛栫暐" value={aggregateStrategyLabel(aggregate.strategy)} />
        <Metric label="鎴愬憳鏁伴噺" value={`${aggregate.members.length} 涓猔} />
        <Metric label="鎬绘潈閲? value={`${totalWeight}`} />
        <Metric label="搴忓垪鍖栧瓧娈? value="aggregate.strategy / aggregate.members" />
      </div>
      <div className="hint-line relay-protocol-hint">
        <ShieldCheck className="h-4 w-4" />
        <span>{aggregateStrategyHelp(aggregate.strategy)}</span>
      </div>
    </div>
  );
}

function RelayContextManager({
  form,
  liveEntries,
  relayFiles,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  liveEntries: CodexContextEntries | null;
  relayFiles: RelayFilesResult | null;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const entries = contextEntriesWithLiveEntries(form, liveEntries);
  const [activeKind, setActiveKind] = useState<ContextKind>("mcp");
  const [editor, setEditor] = useState<{ kind: ContextKind; entry?: CodexContextEntry } | null>(null);
  const visibleEntries = contextEntriesByKind(entries, activeKind);
  const label = contextKindLabel(activeKind);

  const saveEntry = async (kind: ContextKind, id: string, tomlBody: string) => {
    const next = await actions.upsertContextEntry(form, kind, id, tomlBody);
    if (!next) return;
    onFormChange(next);
    setEditor(null);
  };

  const toggleContextEntryEnabled = async (entry: CodexContextEntry) => {
    const nextBody = setContextEntryEnabled(entry.tomlBody, !entry.enabled);
    const next = await actions.upsertContextEntry(form, entry.kind, entry.id, nextBody);
    if (!next) return;
    onFormChange(next);
    const syncResult = await actions.syncLiveContextEntries(next, true);
    if (syncResult && isSuccessStatus(syncResult.status)) {
      void actions.refreshRelayFiles();
    }
  };

  const deleteEntry = async (entry: CodexContextEntry) => {
    const next = await actions.deleteContextEntry(form, entry.kind, entry.id);
    if (!next) return;
    onFormChange(next);
  };

  return (
    <div className="relay-context-panel">
      <div className="relay-context-head">
        <div>
          <strong>Codex 宸ュ叿涓庢彃浠?/strong>
          <span>MCP銆丼kills銆丳lugins 浣滀负鍏ㄥ眬閰嶇疆鐙珛绠＄悊锛屽垏鎹换鎰忔ā鍨嬮兘浼氬悎骞躲€?/span>
        </div>
        <div className="relay-context-head-actions">
          <Button onClick={() => setEditor({ kind: activeKind })} size="sm" variant="secondary">
            <Plus className="h-4 w-4" />
            鏂板{label}
          </Button>
        </div>
      </div>
      <div className="segmented">
        {contextKindOptions.map((option) => (
          <button
            className={activeKind === option.kind ? "active" : ""}
            key={option.kind}
            onClick={() => setActiveKind(option.kind)}
            type="button"
          >
            <span>{option.label}</span>
            <small>{contextEntriesByKind(entries, option.kind).length}</small>
          </button>
        ))}
      </div>
      <div className="relay-context-summary">
        褰撳墠鍏辨湁 {visibleEntries.length} 涓獅label}锛涜繖浜涙潯鐩嫭绔嬩簬妯″瀷淇濆瓨锛屼細鍐欏叆鎵€鏈夋ā鍨嬪垏鎹㈠悗鐨?config.toml銆?
      </div>
      <div className="relay-context-list">
        {visibleEntries.length ? (
          visibleEntries.map((entry) => (
            <div className="relay-context-row" key={`${entry.kind}-${entry.id}`}>
              <strong className="context-title">{entry.title || entry.id}</strong>
              <div className="relay-context-actions">
                <button
                  aria-checked={entry.enabled}
                  aria-label={`contextEnabledSwitch-${entry.kind}-${entry.id}`}
                  className={`context-enabled-switch ${entry.enabled ? "active" : ""}`}
                  onClick={() => void toggleContextEntryEnabled(entry)}
                  role="switch"
                  title={entry.enabled ? "绂佺敤姝ゆ墿灞曢」" : "鍚敤姝ゆ墿灞曢」"}
                  type="button"
                >
                  <span className="context-switch-track" aria-hidden="true">
                    <span className="context-switch-thumb" />
                  </span>
                </button>
                <Button onClick={() => setEditor({ kind: entry.kind, entry })} size="icon" title="缂栬緫鎵╁睍椤? variant="ghost">
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  className="relay-context-delete"
                  onClick={() => void deleteEntry(entry)}
                  size="icon"
                  title="鍒犻櫎鎵╁睍椤?
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">鏆傛棤{label}锛屽彲浠ヤ粠閫氱敤閰嶇疆鏂囦欢鎴栬繖閲屾柊澧炪€?/div>
        )}
      </div>
      {editor ? (
        <ContextEntryEditor
          entry={editor.entry}
          kind={editor.kind}
          onCancel={() => setEditor(null)}
          onSave={(kind, id, tomlBody) => void saveEntry(kind, id, tomlBody)}
        />
      ) : null}
    </div>
  );
}

function ContextEntryEditor({
  kind,
  entry,
  onCancel,
  onSave,
}: {
  kind: ContextKind;
  entry?: CodexContextEntry;
  onCancel: () => void;
  onSave: (kind: ContextKind, id: string, tomlBody: string) => void;
}) {
  const [draftKind, setDraftKind] = useState<ContextKind>(entry?.kind ?? kind);
  const [id, setId] = useState(entry?.id ?? "");
  const [tomlBody, setTomlBody] = useState(entry?.tomlBody ?? "");
  const canSave = id.trim().length > 0;

  return (
    <div className="context-editor">
      <div className="context-editor-fields">
        <Field label="绫诲瀷">
          <select
            className="field-select"
            disabled={!!entry}
            value={draftKind}
            onChange={(event) => setDraftKind(event.currentTarget.value as ContextKind)}
          >
            {contextKindOptions.map((option) => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="ID">
          <Input
            disabled={!!entry}
            value={id}
            onChange={(event) => setId(event.currentTarget.value.trim())}
            placeholder="渚嬪 context7"
          />
        </Field>
      </div>
      <Field label="TOML 閰嶇疆浣?>
        <Textarea
          className="context-editor-textarea"
          value={tomlBody}
          onChange={(event) => setTomlBody(event.currentTarget.value)}
          placeholder={'鍙～鍐欒〃澶翠笅闈㈢殑鍐呭锛屼緥濡傦細\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]'}
          spellCheck={false}
        />
      </Field>
      <Toolbar>
        <Button disabled={!canSave} onClick={() => onSave(draftKind, id.trim(), tomlBody)} size="sm">
          <Save className="h-4 w-4" />
          淇濆瓨鎵╁睍椤?
        </Button>
        <Button onClick={onCancel} size="sm" variant="secondary">鍙栨秷</Button>
      </Toolbar>
    </div>
  );
}

function SyncedTextarea({
  value,
  onValueChange,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const isFocusedRef = useRef(false);
  const latestExternalValueRef = useRef(value);

  useEffect(() => {
    latestExternalValueRef.current = value;
    if (!isFocusedRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  return (
    <Textarea
      className={className}
      value={localValue}
      onBlur={() => {
        isFocusedRef.current = false;
        setLocalValue(latestExternalValueRef.current);
      }}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setLocalValue(next);
        onValueChange(next);
      }}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      spellCheck={false}
    />
  );
}

function RelayFileEditors({
  contextProfile,
  profile,
  form,
  isActive,
  profileId,
  onFormChange,
  onProfileChange,
  actions,
}: {
  contextProfile: RelayProfile;
  profile: RelayProfile;
  form: BackendSettings;
  isActive: boolean;
  profileId: string;
  onFormChange: (value: BackendSettings) => void;
  onProfileChange: (value: RelayProfile) => void;
  actions: Actions;
}) {
  const configPreview = effectiveRelayConfigPreview(profile, form, contextProfile);
  const entries = contextEntriesForProfile(form, contextProfile);
  return (
    <div className="relay-file-grid">
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>config.toml 棰勮</strong>
            <span>{isActive ? "褰撳墠妯″瀷鍒囨崲鍚庝細鍐欏叆鐨勯瑙堬紱涓婁笅鏂囧紑鍏冲彉鍖栦細绔嬪嵆鍙嶆槧" : "鍒囨崲鍒版妯″瀷鏃朵細鍐欏叆鐨勯瑙堬紱涓婁笅鏂囧紑鍏冲彉鍖栦細绔嬪嵆鍙嶆槧"}</span>
          </div>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={configPreview}
          onValueChange={(value) => {
            const withoutCommon = stripCommonConfigTextFallback(
              value,
              relayCombinedCommonConfig(form),
            );
            const configContents = stripContextEntriesFromConfig(withoutCommon, entries);
            onProfileChange(deriveRelayProfileFromFiles({
              ...profile,
              configContents,
            }));
          }}
        />
      </div>
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>閫氱敤閰嶇疆鏂囦欢</strong>
            <span>鍙繚鐣欓潪 MCP銆丼kills銆丳lugins 鐨勮法妯″瀷閰嶇疆锛涘伐鍏蜂笌鎻掍欢鍦ㄧ嫭绔嬮〉闈㈢鐞嗐€?/span>
          </div>
          <Button
            onClick={async () => {
              const extracted = await actions.extractRelayCommonConfig(profile.configContents || "");
              if (!extracted) return;
              const split = splitContextConfigText(extracted.commonConfigContents || "");
              if (!split.common.trim() && !split.context.trim()) {
                await actions.showMessage("閫氱敤閰嶇疆鏂囦欢", "褰撳墠妯″瀷 config.toml 閲屾病鏈夊彲鎻愬彇鐨勯€氱敤閰嶇疆銆?, "failed");
                return;
              }
              const promotedProfile = {
                ...profile,
                configContents: extracted.profileConfigContents,
              };
              const next = syncLegacyRelayFields({
                ...form,
                relayCommonConfigContents: split.common,
                relayContextConfigContents: joinTomlSectionsRootFirst([form.relayContextConfigContents || "", split.context]),
                relayProfiles: form.relayProfiles.map((item) => (item.id === profileId ? promotedProfile : item)),
              });
              onFormChange(next);
              onProfileChange(promotedProfile);
              await actions.saveSettingsValue(next, false);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Download className="h-4 w-4" />
            鎻愬彇褰撳墠妯″瀷閰嶇疆
          </Button>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={form.relayCommonConfigContents}
          onValueChange={(value) => onFormChange({ ...form, relayCommonConfigContents: value })}
        />
      </div>
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>auth.json</strong>
            <span>{isActive ? "褰撳墠浣跨敤涓細鎵撳紑鏃朵粠 ~/.codex/auth.json 鍥炲～锛屼繚瀛樺悗浼氫綔涓烘妯″瀷 auth 瀛樻。" : "鍒囨崲鍒版妯″瀷鏃朵細鍐欏叆 ~/.codex/auth.json"}</span>
          </div>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={profile.authContents}
          onValueChange={(value) => onProfileChange(deriveRelayProfileFromFiles({ ...profile, authContents: value }))}
        />
      </div>
    </div>
  );
}

function ModeSelector({ launchMode, actions }: { launchMode: LaunchMode; actions: Actions }) {
  return (
    <div className="mode-grid">
      <button
        className={`mode-option ${launchMode === "relay" ? "active" : ""}`}
        onClick={() => void actions.setLaunchMode("relay")}
        type="button"
      >
        <strong>鍏煎澧炲己</strong>
        <span>閫傚悎瀹樻柟鐧诲綍鎴栧畼鏂规贩鍏?API Key锛涗繚鐣欎細璇濆垹闄ゃ€佸鍑恒€侀」鐩Щ鍔ㄥ拰鐢ㄦ埛鑴氭湰锛屽叧闂彃浠跺競鍦虹浉鍏冲寮恒€?/span>
      </button>
      <button
        className={`mode-option ${launchMode === "patch" ? "active" : ""}`}
        onClick={() => void actions.setLaunchMode("patch")}
        type="button"
      >
        <strong>瀹屾暣澧炲己</strong>
        <span>閫傚悎绾?API锛涘惎鐢ㄦ彃浠跺競鍦恒€佸己鍒跺畨瑁呫€佷細璇濆垹闄ゅ鍑恒€侀」鐩Щ鍔ㄧ瓑鍏ㄩ儴椤甸潰鑳藉姏銆?/span>
      </button>
    </div>
  );
}

function FeatureItem({ title, detail, enabled }: { title: string; detail: string; enabled: boolean }) {
  return (
    <div className="feature-item">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <Badge status={enabled ? "ok" : "disabled"} />
    </div>
  );
}

function FeatureToggle({
  title,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`feature-toggle ${disabled ? "disabled" : ""}`}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <Badge status={!disabled && checked ? "ok" : "disabled"} />
    </label>
  );
}

function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mobileRelayHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(withScheme);
    url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function mobileRelayShareUrl(settings: Pick<BackendSettings, "mobileControlRelayUrl" | "mobileControlRoom" | "mobileControlKey">) {
  const base = mobileRelayHttpUrl(settings.mobileControlRelayUrl);
  const room = settings.mobileControlRoom.trim();
  const key = settings.mobileControlKey.trim();
  if (!base || !room || !key) return "";
  const url = new URL(`${base}/mobile`);
  url.searchParams.set("room", room);
  url.searchParams.set("key", key);
  url.searchParams.set("auto", "1");
  return url.toString();
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function GuideList({ items }: { items: string[] }) {
  return (
    <div className="guide-list">
      {items.map((item, index) => (
        <div className="guide-step" key={item}>
          <span>{index + 1}</span>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}

function NoticeDialog({
  notice,
  onClose,
}: {
  notice: { title: string; message: string; status?: Status };
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast-card ${notice.status === "failed" ? "failed" : ""}`}>
        <div className="toast-progress" />
        <div className="toast-icon">
          {notice.status === "failed" ? <Bell className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>
        <div className="toast-body">
          <h2>{notice.title}</h2>
          <p>{notice.message}</p>
        </div>
        <button className="toast-close" onClick={onClose} type="button">脳</button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  confirm,
  onConfirm,
  onCancel,
}: {
  confirm: { title: string; message: string; confirmText: string; cancelText: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <h2>{confirm.title}</h2>
            <p className="modal-message">{confirm.message}</p>
          </div>
          <button className="toast-close" onClick={onCancel} type="button">脳</button>
        </div>
        <Toolbar>
          <Button onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            {confirm.confirmText}
          </Button>
          <Button onClick={onCancel} variant="secondary">{confirm.cancelText}</Button>
        </Toolbar>
      </div>
    </div>
  );
}

function PluginMarketplacePromptDialog({
  status,
  progress,
  onRepair,
  onClose,
}: {
  status: PluginMarketplaceStatusResult;
  progress: TaskProgress;
  onRepair: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card plugin-marketplace-modal">
        <div className="modal-head">
          <div>
            <h2>鎻掍欢甯傚満闇€瑕佷慨澶?/h2>
            <p>褰撳墠 CODEX_HOME 鏈彂鐜板彲鐢ㄧ殑瀹屾暣鎻掍欢甯傚満锛孉PI Key 妯″紡涓嬪彲鑳藉嚭鐜版彃浠跺畨瑁呭悗涓嶅彲鐢ㄣ€?/p>
          </div>
          <button className="toast-close" onClick={onClose} type="button">脳</button>
        </div>
        <div className="metric-list">
          <Metric label="CODEX_HOME" value={status.codexHome} />
          <Metric label="鏈湴鎻掍欢甯傚満" value={status.marketplaceRoot ?? "鏈彂鐜?} />
          <Metric label="閰嶇疆鐘舵€? value={status.configRegistered ? "宸叉敞鍐? : "鏈敞鍐?} />
        </div>
        <TaskProgressBox progress={progress} title="淇杩涘害" />
        <Toolbar>
          <Button disabled={progress.active} onClick={onRepair}>
            <Download className="h-4 w-4" />
            {progress.active ? "姝ｅ湪淇鈥? : "涓€閿慨澶?}
          </Button>
          <Button disabled={progress.active} onClick={onClose} variant="secondary">绋嶅悗澶勭悊</Button>
        </Toolbar>
      </div>
    </div>
  );
}

function PendingProviderImportDialog({
  request,
  onConfirm,
  onDismiss,
}: {
  request: ProviderImportRequest;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card provider-import-modal">
        <div className="modal-head">
          <div>
            <h2>瀵煎叆 Codex++ 妯″瀷</h2>
            <p>妫€娴嬪埌鏉ヨ嚜缃戦〉鐨勬ā鍨嬮厤缃鍏ヨ姹傦紝纭鍚庝細鍐欏叆鏈満 Codex++ 绠＄悊宸ュ叿銆?/p>
          </div>
          <button className="toast-close" onClick={onDismiss} type="button">脳</button>
        </div>
        <div className="metric-list">
          <Metric label="鍚嶇О" value={request.name || "鏈懡鍚嶆ā鍨?} />
          <Metric label="Base URL" value={request.baseUrl || "鏈～鍐?} />
          <Metric label="鍗忚" value={providerImportWireApiLabel(request.wireApi)} />
          <Metric label="妯″紡" value={providerImportRelayModeLabel(request.relayMode)} />
          <Metric label="API Key" value={maskSecret(request.apiKey)} />
        </div>
        <Toolbar>
          <Button onClick={onConfirm}>
            <Download className="h-4 w-4" />
            纭瀵煎叆
          </Button>
          <Button onClick={onDismiss} variant="secondary">鍙栨秷</Button>
        </Toolbar>
      </div>
    </div>
  );
}

function TaskProgressBox({ progress, title }: { progress: TaskProgress; title: string }) {
  if (!progress.active && progress.percent <= 0) return null;
  return (
    <div className="provider-sync-progress task-progress" data-active={progress.active}>
      <div className="provider-sync-progress-head">
        <strong>{progress.active ? title : "涓婃淇缁撴灉"}</strong>
        <span>{progress.percent}%</span>
      </div>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent}
        className="provider-sync-progress-bar"
        role="progressbar"
      >
        <div className="provider-sync-progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <small>{progress.message}</small>
    </div>
  );
}

function Panel({ children, fill = false, className = "" }: { children: React.ReactNode; fill?: boolean; className?: string }) {
  return (
    <Card className={`panel ${fill ? "fill" : ""} ${className}`}>
      {children}
    </Card>
  );
}

function CardHead({ title, detail }: { title: string; detail: string }) {
  return (
    <CardHeader className="panel-head">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{detail}</CardDescription>
    </CardHeader>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function StatusRow({ title, status = "unknown", path }: { title: string; status?: string; path?: string | null }) {
  return (
    <div className="status-row">
      <span>{title}</span>
      <Badge status={status} />
      <code>{path || "鏈褰曡矾寰?}</code>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  return <UiBadge className={statusClass(status)} variant="secondary">{statusLabel(status)}</UiBadge>;
}

function LatestLaunch({ status }: { status: LaunchStatus | null }) {
  if (!status) return <div className="empty">鏆傛棤鍚姩鐘舵€併€?/div>;
  return (
    <div className="metric-list">
      <Metric label="鐘舵€? value={status.status} />
      <Metric label="娑堟伅" value={status.message} />
      <Metric label="Debug" value={String(status.debug_port ?? "-")} />
      <Metric label="Helper" value={String(status.helper_port ?? "-")} />
      <Metric label="鏃堕棿" value={formatTime(status.started_at_ms)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScriptRow({ script, actions }: { script: NonNullable<UserScriptInventory["scripts"]>[number]; actions: Actions }) {
  const source = script.market_id ? `甯傚満 路 ${script.version || "鏈煡鐗堟湰"}` : script.source === "builtin" ? "鍐呯疆" : "鐢ㄦ埛";
  const canDelete = script.source === "user";
  return (
    <div className="table-row">
      <span>{script.name}</span>
      <span>{source}</span>
      <span>{script.enabled ? "鍚敤" : "鍏抽棴"}</span>
      <span>{script.status}</span>
      <div className="script-row-actions">
        <Button onClick={() => void actions.setUserScriptEnabled(script.key, !script.enabled)} size="sm" variant="secondary">
          {script.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          {script.enabled ? "绂佺敤" : "鍚敤"}
        </Button>
        {canDelete ? (
          <Button onClick={() => void actions.deleteUserScript(script.key)} size="sm" variant="outline">
            <Trash2 className="h-4 w-4" />
            鍒犻櫎
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AdGrid({ ads, empty, actions }: { ads: AdItem[]; empty: string; actions: Actions }) {
  if (!ads.length) return <div className="empty">{empty}</div>;
  return (
    <div className="ad-grid">
      {ads.map((ad) => (
        <button className="ad-card" key={ad.id || `${ad.type}-${ad.title}`} onClick={() => void actions.openExternalUrl(ad.url)} type="button">
          <div>
            <strong>{ad.title}</strong>
            <p>{ad.description}</p>
          </div>
          {ad.highlights?.length ? (
            <div className="ad-tags">
              {ad.highlights.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          <span className="ad-link">
            鎵撳紑
            <ExternalLink className="h-4 w-4" />
          </span>
        </button>
      ))}
    </div>
  );
}

function isExpiredAd(ad: AdItem) {
  if (!ad.expires_at) return false;
  const expiresAt = Date.parse(ad.expires_at);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function routeTitle(route: Route) {
  return routes.find((item) => item.id === route)?.label ?? "姒傝";
}

function routeSubtitle(route: Route) {
  const subtitles: Record<Route, string> = {
    overview: "妫€鏌ラ棶棰樸€佸惎鍔ㄤ笌蹇€熶慨澶?,
    relay: "绠＄悊 API 妯″瀷銆佸崗璁€並ey 涓庨厤缃枃浠?,
    mobileControl: "閰嶇疆鎵嬫満鎺у埗 relay銆佹埧闂村瘑閽ュ拰鏈嶅姟鍣ㄧ姸鎬?,
    sessions: "鏌ョ湅銆佸垹闄ゅ拰淇 Codex 鏈湴浼氳瘽",
    context: "鐙珛绠＄悊 MCP銆丼kills銆丳lugins",
    enhance: "浼氳瘽鍒犻櫎銆佸鍑恒€侀」鐩Щ鍔ㄥ拰鑴氭湰鑳藉姏",
    zedRemote: "绠＄悊 Codex SSH 椤圭洰骞跺姞鍏?Zed workspace",
    userScripts: "鍐呯疆鍜岀敤鎴疯嚜瀹氫箟鑴氭湰娓呭崟",
    recommendations: "璧炲姪鍟嗘帹鑽愪笌鏅€氭帹鑽?,
    maintenance: "鍏ュ彛瀹夎銆佷慨澶嶃€乄atcher 涓庢墜鍔ㄥ惎鍔?,
    about: "鐗堟湰淇℃伅銆侀」鐩摼鎺ャ€丟itHub Release 鏇存柊銆佹棩蹇椾笌璇婃柇",
    settings: "涓婚銆佸懡浠ゅ寘瑁呭櫒鍜屽惎鍔ㄥ弬鏁?,
  };
  return subtitles[route];
}

const contextKindOptions: Array<{ kind: ContextKind; label: string; tableName: string }> = [
  { kind: "mcp", label: "MCP", tableName: "mcp_servers" },
  { kind: "skill", label: "Skills", tableName: "skills" },
  { kind: "plugin", label: "鎻掍欢", tableName: "plugins" },
];

function contextKindLabel(kind: ContextKind) {
  return contextKindOptions.find((option) => option.kind === kind)?.label ?? "鎵╁睍椤?;
}

function contextEntriesFromSettings(settings: BackendSettings): CodexContextEntries {
  const commonConfig = normalizeDuplicateTomlTables(settings.relayContextConfigContents || "");
  return {
    mcpServers: parseContextEntries(commonConfig, "mcp", "mcp_servers"),
    skills: parseContextEntries(commonConfig, "skill", "skills"),
    plugins: parseContextEntries(commonConfig, "plugin", "plugins"),
  };
}

function contextEntriesWithLiveEntries(settings: BackendSettings, liveEntries: CodexContextEntries | null): CodexContextEntries {
  const commonEntries = contextEntriesFromSettings(settings);
  if (!liveEntries) return commonEntries;
  const liveByKind: Record<ContextKind, Map<string, CodexContextEntry>> = {
    mcp: new Map(liveEntries.mcpServers.map((entry) => [entry.id, entry])),
    skill: new Map(liveEntries.skills.map((entry) => [entry.id, entry])),
    plugin: new Map(liveEntries.plugins.map((entry) => [entry.id, entry])),
  };
  return {
    mcpServers: mergeLiveContextEntries(commonEntries.mcpServers, liveByKind.mcp),
    skills: mergeLiveContextEntries(commonEntries.skills, liveByKind.skill),
    plugins: mergeLiveContextEntries(commonEntries.plugins, liveByKind.plugin),
  };
}

function mergeLiveContextEntries(entries: CodexContextEntry[], liveEntries: Map<string, CodexContextEntry>): CodexContextEntry[] {
  const uniqueEntries = dedupeContextEntryList(entries);
  const merged = uniqueEntries.map((entry) => {
    const live = liveEntries.get(entry.id);
    return withLiveEntryState(entry, live);
  });
  const knownIds = new Set(uniqueEntries.map((entry) => entry.id));
  for (const liveEntry of liveEntries.values()) {
    if (!knownIds.has(liveEntry.id)) merged.push(liveEntry);
  }
  return merged;
}

function withLiveEntryState(entry: CodexContextEntry, live?: CodexContextEntry): CodexContextEntry {
  return live ? { ...entry, enabled: live.enabled } : { ...entry, enabled: false };
}

function contextEntriesForProfile(settings: BackendSettings, profile: RelayProfile): CodexContextEntries {
  return filterContextEntriesBySelection(contextEntriesFromSettings(settings), profile.contextSelection);
}

function contextEntriesFromConfig(configContents: string): CodexContextEntries {
  return {
    mcpServers: parseContextEntries(configContents, "mcp", "mcp_servers"),
    skills: parseContextEntries(configContents, "skill", "skills"),
    plugins: parseContextEntries(configContents, "plugin", "plugins"),
  };
}

function mergeContextEntries(primary: CodexContextEntries, secondary: CodexContextEntries): CodexContextEntries {
  return {
    mcpServers: mergeContextEntryList(primary.mcpServers, secondary.mcpServers),
    skills: mergeContextEntryList(primary.skills, secondary.skills),
    plugins: mergeContextEntryList(primary.plugins, secondary.plugins),
  };
}

function mergeContextEntryList(primary: CodexContextEntry[], secondary: CodexContextEntry[]): CodexContextEntry[] {
  return dedupeContextEntryList([...primary, ...secondary]);
}

function dedupeContextEntryList(entries: CodexContextEntry[]): CodexContextEntry[] {
  const byId = new Map<string, CodexContextEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values());
}

function parseContextEntries(commonConfig: string, kind: ContextKind, tableName: string): CodexContextEntry[] {
  const anyHeaderPattern = /^\s*\[[^\]]+\]\s*$/;
  const entries = new Map<string, CodexContextEntry>();
  let currentId: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!currentId) return;
    const tomlBody = ensureTrailingNewline(body.join("\n").trimEnd());
    entries.set(currentId, {
      id: currentId,
      kind,
      title: currentId,
      summary: contextEntrySummary(tomlBody),
      tomlBody,
      enabled: contextEntryEnabled(tomlBody),
    });
  };

  for (const line of commonConfig.split(/\r?\n/)) {
    const path = tomlTablePathFromLine(line);
    if (path?.[0] === tableName && path.length >= 2) {
      const id = path[1];
      if (currentId === id && path.length > 2) {
        body.push(`[${path.slice(2).map(tomlKey).join(".")}]`);
        continue;
      }
      flush();
      currentId = id;
      body = [];
      continue;
    }
    if (currentId && anyHeaderPattern.test(line)) {
      flush();
      currentId = null;
      body = [];
      continue;
    }
    if (currentId) body.push(line);
  }
  flush();

  return Array.from(entries.values());
}

function tomlTablePathFromLine(line: string): string[] | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (!match) return null;
  return parseTomlDottedPath(match[1].trim());
}

function parseTomlDottedPath(path: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of path) {
    if (quote) {
      if (quote === '"' && escaping) {
        current += char;
        escaping = false;
      } else if (quote === '"' && char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ".") {
      if (!current.trim()) return null;
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quote || escaping || !current.trim()) return null;
  parts.push(current.trim());
  return parts;
}

function contextEntrySummary(tomlBody: string) {
  return tomlBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !/^enabled\s*=/.test(line))
    ?.slice(0, 96) ?? "";
}

function contextEntryEnabled(tomlBody: string) {
  return !tomlBody.split(/\r?\n/).some((line) => /^\s*enabled\s*=\s*false\s*(#.*)?$/i.test(line));
}

function setContextEntryEnabled(tomlBody: string, enabled: boolean) {
  const lines = tomlBody.trimEnd().split(/\r?\n/);
  const nextValue = `enabled = ${enabled ? "true" : "false"}`;
  let replaced = false;
  const next = lines.map((line) => {
    if (/^\s*enabled\s*=/.test(line)) {
      replaced = true;
      return nextValue;
    }
    return line;
  });
  if (!replaced) next.unshift(nextValue);
  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function ensureTrailingNewline(value: string) {
  return value.trim() ? `${value}\n` : "";
}

function unquoteTomlKey(key: string) {
  if (key.length >= 2 && ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) {
    return key.slice(1, -1);
  }
  return key;
}

function contextEntriesByKind(entries: CodexContextEntries, kind: ContextKind): CodexContextEntry[] {
  if (kind === "mcp") return dedupeContextEntryList(entries.mcpServers);
  if (kind === "skill") return dedupeContextEntryList(entries.skills);
  return dedupeContextEntryList(entries.plugins);
}

function filterContextEntriesBySelection(entries: CodexContextEntries, selection: RelayContextSelection): CodexContextEntries {
  const selected = {
    mcp: new Set(selection.mcpServers.map((id) => id.trim()).filter(Boolean)),
    skill: new Set(selection.skills.map((id) => id.trim()).filter(Boolean)),
    plugin: new Set(selection.plugins.map((id) => id.trim()).filter(Boolean)),
  };
  return {
    mcpServers: entries.mcpServers.filter((entry) => selected.mcp.has(entry.id)),
    skills: entries.skills.filter((entry) => selected.skill.has(entry.id)),
    plugins: entries.plugins.filter((entry) => selected.plugin.has(entry.id)),
  };
}

function configHasCodexGoalsFeature(configContents: string): boolean {
  let inFeatures = false;
  for (const line of configContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[features\]$/.test(trimmed)) {
      inFeatures = true;
      continue;
    }
    if (inFeatures && /^\[[^\]]+\]$/.test(trimmed)) {
      inFeatures = false;
    }
    if (inFeatures && /^goals\s*=\s*true\b/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function setCodexGoalsFeatureInConfig(configContents: string, enabled: boolean): string {
  const lines = configContents.split(/\r?\n/);
  const next: string[] = [];
  let inFeatures = false;
  let sawFeatures = false;
  let featuresHasGoals = false;

  const maybeInsertGoals = () => {
    if (enabled && sawFeatures && !featuresHasGoals) {
      next.push("goals = true");
      featuresHasGoals = true;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[features\]$/.test(trimmed)) {
      if (inFeatures) maybeInsertGoals();
      inFeatures = true;
      sawFeatures = true;
      featuresHasGoals = false;
      next.push(line);
      continue;
    }
    if (inFeatures && /^\[[^\]]+\]$/.test(trimmed)) {
      maybeInsertGoals();
      inFeatures = false;
    }
    if (inFeatures && /^goals\s*=/.test(trimmed)) {
      if (enabled && !featuresHasGoals) {
        next.push("goals = true");
        featuresHasGoals = true;
      }
      continue;
    }
    next.push(line);
  }

  if (inFeatures) maybeInsertGoals();
  if (enabled && !sawFeatures) {
    const trimmed = ensureTrailingNewline(next.join("\n").trimEnd());
    return joinTomlSections([trimmed, "[features]\ngoals = true"]);
  }

  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function effectiveRelayConfigPreview(profile: RelayProfile, settings: BackendSettings, contextProfile = profile): string {
  const entries = contextEntriesForProfile(settings, contextProfile);
  const isolatedConfig = stripContextEntriesFromConfig(profile.configContents, entries);
  const configWithLimits = applyContextLimitPreview(isolatedConfig, profile);
  return joinTomlSectionsRootFirst([configWithLimits, settings.relayCommonConfigContents || "", selectedContextConfigToml(entries)]);
}

function selectedContextConfigToml(entries: CodexContextEntries): string {
  const sections: string[] = [];
  for (const option of contextKindOptions) {
    for (const entry of dedupeContextEntryList(contextEntriesByKind(entries, option.kind))) {
      if (!entry.enabled) continue;
      sections.push(contextEntryToTomlSection(option.tableName, entry));
    }
  }
  return ensureTrailingNewline(sections.join("\n\n"));
}

function allContextConfigToml(entries: CodexContextEntries): string {
  const sections: string[] = [];
  for (const option of contextKindOptions) {
    for (const entry of dedupeContextEntryList(contextEntriesByKind(entries, option.kind))) {
      sections.push(contextEntryToTomlSection(option.tableName, entry));
    }
  }
  return ensureTrailingNewline(sections.join("\n\n"));
}

function contextEntryToTomlSection(tableName: string, entry: CodexContextEntry): string {
  const parentHeader = `[${tableName}.${tomlKey(entry.id)}]`;
  const body = entry.tomlBody
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => relativeContextSubtableToAbsolute(line, tableName, entry.id))
    .join("\n");
  return `${parentHeader}\n${body}`;
}

function relativeContextSubtableToAbsolute(line: string, tableName: string, id: string): string {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (!match) return line;
  const subtable = match[1].trim();
  if (!subtable || subtable.includes(".")) return line;
  return `[${tableName}.${tomlKey(id)}.${tomlKey(subtable)}]`;
}

function syncLiveConfigContextState(liveConfigContents: string, settings: BackendSettings): string {
  const entries = contextEntriesFromSettings(settings);
  const withoutManaged = stripContextEntriesFromConfig(liveConfigContents, entries);
  return joinTomlSectionsRootFirst([withoutManaged, selectedContextConfigToml(entries)]);
}

function relayCombinedCommonConfig(settings: BackendSettings): string {
  return joinTomlSectionsRootFirst([settings.relayCommonConfigContents || "", settings.relayContextConfigContents || ""]);
}

function splitContextConfigText(configContents: string): { common: string; context: string } {
  const entries = contextEntriesFromConfig(configContents);
  return {
    common: stripContextEntriesFromConfig(configContents, entries),
    context: allContextConfigToml(entries),
  };
}

function stripContextEntriesFromConfig(configContents: string, entries: CodexContextEntries): string {
  const knownIds: Record<ContextKind, Set<string>> = {
    mcp: new Set(entries.mcpServers.map((entry) => entry.id)),
    skill: new Set(entries.skills.map((entry) => entry.id)),
    plugin: new Set(entries.plugins.map((entry) => entry.id)),
  };
  const lines = configContents.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const contextHeader = contextHeaderFromLine(line);
    if (contextHeader) {
      skipping = knownIds[contextHeader.kind].has(contextHeader.id);
    } else if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function stripCommonConfigTextFallback(configContents: string, commonConfig: string): string {
  const anchors = commonConfigAnchors(commonConfig);
  if (!anchors.rootKeys.size && !anchors.tableHeaders.size) return ensureTrailingNewline(configContents.trimEnd());

  const kept: string[] = [];
  let skippingTable = false;

  for (const line of configContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      skippingTable = anchors.tableHeaders.has(trimmed);
      if (skippingTable) continue;
    }
    if (skippingTable) continue;
    const key = tomlRootKeyFromLine(trimmed);
    if (key && anchors.rootKeys.has(key)) continue;
    kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function commonConfigAnchors(commonConfig: string): { rootKeys: Set<string>; tableHeaders: Set<string> } {
  const rootKeys = new Set<string>();
  const tableHeaders = new Set<string>();
  let inRoot = true;

  for (const line of commonConfig.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inRoot = false;
      tableHeaders.add(trimmed);
      continue;
    }
    if (inRoot) {
      const key = tomlRootKeyFromLine(trimmed);
      if (key) rootKeys.add(key);
    }
  }

  return { rootKeys, tableHeaders };
}

function tomlRootKeyFromLine(line: string): string | null {
  if (!line || line.startsWith("#")) return null;
  const index = line.indexOf("=");
  if (index < 0) return null;
  const key = line.slice(0, index).trim();
  return key || null;
}

function contextHeaderFromLine(line: string): { kind: ContextKind; id: string } | null {
  const path = tomlTablePathFromLine(line);
  if (!path || path.length !== 2) return null;
  const option = contextKindOptions.find((item) => item.tableName === path[0]);
  return option ? { kind: option.kind, id: path[1] } : null;
}

function applyContextLimitPreview(configContents: string, profile: RelayProfile): string {
  const replacements: Array<[string, string]> = [
    ["model_context_window", profile.contextWindow],
    ["model_auto_compact_token_limit", profile.autoCompactLimit],
  ];
  let lines = configContents.split(/\r?\n/);

  for (const [key, value] of replacements) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    let replaced = false;
    lines = lines.map((line) => {
      if (!replaced && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
        replaced = true;
        return `${key} = ${trimmed}`;
      }
      return line;
    });
    if (!replaced) {
      const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
      const insertAt = firstTable >= 0 ? firstTable : lines.length;
      lines.splice(insertAt, 0, `${key} = ${trimmed}`);
    }
  }

  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function removeRootTomlKey(contents: string, key: string): string {
  const lines: string[] = [];
  let inRoot = true;
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) inRoot = false;
    if (inRoot && new RegExp(`^\\s*${key}\\s*=`).test(line)) continue;
    lines.push(line);
  }
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function joinTomlSections(sections: string[]): string {
  return ensureTrailingNewline(
    sections
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n"),
  );
}

function joinTomlSectionsRootFirst(sections: string[]): string {
  const rootParts: string[] = [];
  const tableParts: string[] = [];

  for (const section of sections) {
    const { root, tables } = splitTomlRootAndTables(section);
    if (root.trim()) rootParts.push(root.trim());
    if (tables.trim()) tableParts.push(tables.trim());
  }

  return normalizeDuplicateTomlTables(joinTomlSections([...dedupeTomlRootLines(rootParts), ...tableParts]));
}

function normalizeDuplicateTomlTables(contents: string): string {
  const seenHeaders = new Set<string>();
  const kept: string[] = [];
  let skipping = false;

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      skipping = seenHeaders.has(trimmed);
      seenHeaders.add(trimmed);
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function dedupeTomlRootLines(rootParts: string[]): string[] {
  const rootLines = rootParts
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const rootSeen = new Set<string>();
  const kept: string[] = [];

  for (let index = rootLines.length - 1; index >= 0; index -= 1) {
    const line = rootLines[index];
    const key = tomlRootKeyFromLine(line.trim());
    if (key) {
      if (rootSeen.has(key)) continue;
      rootSeen.add(key);
    }
    kept.push(line);
  }

  const normalized = kept.reverse().join("\n").trim();
  return normalized ? [normalized] : [];
}

function splitTomlRootAndTables(section: string): { root: string; tables: string } {
  const lines = section.trim().split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  if (firstTable < 0) return { root: lines.join("\n"), tables: "" };
  return {
    root: lines.slice(0, firstTable).join("\n"),
    tables: lines.slice(firstTable).join("\n"),
  };
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : `"${tomlString(key)}"`;
}

function contextSelectionIds(selection: RelayContextSelection, kind: ContextKind): string[] {
  if (kind === "mcp") return selection.mcpServers;
  if (kind === "skill") return selection.skills;
  return selection.plugins;
}

function setContextSelectionId(selection: RelayContextSelection, kind: ContextKind, id: string, checked: boolean): RelayContextSelection {
  const next = {
    mcpServers: [...selection.mcpServers],
    skills: [...selection.skills],
    plugins: [...selection.plugins],
  };
  const list = contextSelectionIds(next, kind);
  const normalizedId = id.trim();
  const exists = list.includes(normalizedId);
  if (checked && normalizedId && !exists) list.push(normalizedId);
  if (!checked && exists) list.splice(list.indexOf(normalizedId), 1);
  return next;
}

function removeContextSelectionFromSettings(settings: BackendSettings, kind: ContextKind, id: string): BackendSettings {
  return {
    ...settings,
    relayProfiles: settings.relayProfiles.map((profile) => ({
      ...profile,
      contextSelection: setContextSelectionId(profile.contextSelection, kind, id, false),
    })),
  };
}

function contextSelectionForAllEntries(settings: BackendSettings): RelayContextSelection {
  const entries = contextEntriesFromSettings(settings);
  return {
    mcpServers: entries.mcpServers.map((entry) => entry.id),
    skills: entries.skills.map((entry) => entry.id),
    plugins: entries.plugins.map((entry) => entry.id),
  };
}

function relayProfileEditorStatus(profile: RelayProfile, form: BackendSettings, isNew: boolean) {
  if (isNew) return "鏂板缓妯″瀷闇€瑕佸厛淇濆瓨鍒板垪琛?;
  if (!form.relayProfilesEnabled) return "妯″瀷閰嶇疆鎬诲紑鍏冲凡鍏抽棴锛涘綋鍓嶅彧淇濆瓨閰嶇疆锛屼笉鍐欏叆 Codex live 鏂囦欢";
  return profile.id === form.activeRelayId ? "褰撳墠姝ｅ湪浣跨敤" : "缂栬緫鍚庝繚瀛樺垪琛紝鍐嶅垏鎹㈡ā寮忔椂浼氫娇鐢ㄦ柊閰嶇疆";
}

function providerInitial(name: string) {
  const trimmed = (name || "妯″瀷").trim();
  return Array.from(trimmed)[0]?.toUpperCase() || "渚?;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    found: "宸叉壘鍒?,
    missing: "缂哄け",
    installed: "宸插畨瑁?,
    ok: "姝ｅ父",
    running: "杩愯涓?,
    failed: "澶辫触",
    archived: "宸插綊妗?,
    accepted: "宸插彈鐞?,
    not_checked: "鏈鏌?,
    not_implemented: "鏈疄鐜?,
    disabled: "宸茬鐢?,
    unknown: "鏈煡",
  };
  return labels[status] ?? status;
}

function statusClass(status: string) {
  if (["found", "installed", "ok", "running"].includes(status)) return "good";
  if (["failed", "missing"].includes(status)) return "bad";
  return "warn";
}

function isSuccessStatus(status?: Status) {
  return status === "ok" || status === "accepted";
}

function truncateSessionDeletePreview(value: string) {
  const normalized = value.trim();
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
}

function healthItems(overview: OverviewResult | null) {
  return [
    {
      title: "Codex 搴旂敤",
      status: overview?.codex_app.status ?? "not_checked",
      ok: overview?.codex_app.status === "found",
      detail: overview?.codex_app.path || "灏氭湭妫€鏌?Codex 搴旂敤璺緞銆?,
    },
    {
      title: "闈欓粯鍚姩鍏ュ彛",
      status: overview?.silent_shortcut.status ?? "not_checked",
      ok: overview?.silent_shortcut.status === "installed",
      detail: overview?.silent_shortcut.path || "缂哄皯 Codex++ 闈欓粯鍚姩蹇嵎鏂瑰紡鏃跺彲鍦ㄥ畨瑁呯淮鎶ら〉淇銆?,
    },
    {
      title: "绠＄悊宸ュ叿鍏ュ彛",
      status: overview?.management_shortcut.status ?? "not_checked",
      ok: overview?.management_shortcut.status === "installed",
      detail: overview?.management_shortcut.path || "缂哄皯绠＄悊宸ュ叿蹇嵎鏂瑰紡鏃跺彲鍦ㄥ畨瑁呯淮鎶ら〉淇銆?,
    },
  ];
}

function normalizeSettings(settings: BackendSettings): BackendSettings {
  const backendAggregates = new Map(
    (settings.aggregateRelayProfiles ?? []).map((aggregate) => [aggregate.id, aggregate] as const),
  );
  const splitCommon = splitContextConfigText(settings.relayCommonConfigContents || "");
  const relayCommonConfigContents = splitCommon.common;
  const relayContextConfigContents = joinTomlSectionsRootFirst([
    settings.relayContextConfigContents || "",
    splitCommon.context,
  ]);
  const defaultContextSelection = contextSelectionForAllEntries({
    ...settings,
    relayCommonConfigContents,
    relayContextConfigContents,
  });
  const profiles =
    settings.relayProfiles?.length
      ? settings.relayProfiles.map((profile) =>
          normalizeRelayProfile(hydrateAggregateRelayProfile(profile, backendAggregates.get(profile.id)), defaultContextSelection),
        )
      : [
          {
            id: settings.activeRelayId || "default",
            name: "榛樿涓浆",
            model: "",
            baseUrl: settings.relayBaseUrl || defaultSettings.relayBaseUrl,
            upstreamBaseUrl: settings.relayBaseUrl || defaultSettings.relayBaseUrl,
            apiKey: settings.relayApiKey || "",
            protocol: "responses" as RelayProtocol,
            relayMode: "official" as RelayMode,
            officialMixApiKey: false,
            testModel: "",
            configContents: "",
            authContents: "",
            useCommonConfig: true,
            contextSelection: defaultContextSelection,
            contextSelectionInitialized: true,
            contextWindow: "",
            autoCompactLimit: "",
            modelList: "",
            modelWindows: "",
            userAgent: "",
          },
        ];
  const activeRelayId = profiles.some((profile) => profile.id === settings.activeRelayId)
    ? settings.activeRelayId
    : profiles[0]?.id || "default";
  return syncLegacyRelayFields({
    ...defaultSettings,
    ...settings,
    relayProfilesEnabled: settings.relayProfilesEnabled !== false,
    computerUseGuardEnabled: settings.computerUseGuardEnabled === true,
    codexAppImageOverlayOpacity: clampNumber(settings.codexAppImageOverlayOpacity || 35, 1, 100),
    relayCommonConfigContents,
    relayContextConfigContents,
    relayProfiles: profiles,
    activeRelayId,
  });
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function codexExtraArgsToInput(args: string[] | undefined) {
  return (args ?? []).join("\n");
}

function inputToCodexExtraArgs(value: string) {
  return value === "" ? [] : value.split(/\r?\n/);
}

function normalizeRelayProfile(profile: RelayProfile, defaultContextSelection = emptyContextSelection()): RelayProfile {
  const legacyMixedApi = profile.relayMode === "mixedApi";
  if (profile.relayMode === "aggregate" || profile.aggregate) {
    return normalizeAggregateRelayProfile(
      {
        ...profile,
        model: profile.model || "",
        baseUrl: "",
        upstreamBaseUrl: "",
        apiKey: "",
        protocol: "responses",
        relayMode: "aggregate",
        officialMixApiKey: false,
        testModel: profile.testModel || "",
        configContents: "",
        authContents: "",
        useCommonConfig: profile.useCommonConfig !== false,
        contextSelection: profile.contextSelectionInitialized
          ? normalizeContextSelection(profile.contextSelection)
          : normalizeContextSelection(undefined, defaultContextSelection),
        contextSelectionInitialized: true,
        contextWindow: "",
        autoCompactLimit: "",
        modelList: "",
        modelWindows: "",
      },
      null,
    );
  }
  const relayMode = normalizeRelayMode(profile.relayMode);
  const officialMixApiKey = profile.officialMixApiKey === true || legacyMixedApi;
  let normalized: RelayProfile = {
    ...profile,
    model: profile.model || "",
    baseUrl: profile.baseUrl || defaultSettings.relayBaseUrl,
    upstreamBaseUrl: profile.upstreamBaseUrl || profile.baseUrl || "",
    apiKey: profile.apiKey || "",
    protocol: profile.protocol === "chatCompletions" ? "chatCompletions" : "responses",
    relayMode,
    officialMixApiKey,
    testModel: profile.testModel || "",
    configContents: relayMode === "official" && !officialMixApiKey ? "" : profile.configContents || "",
    authContents: relayMode === "official" && !officialMixApiKey ? buildOfficialRelayAuthJson(profile.authContents || "") : profile.authContents || "",
    useCommonConfig: profile.useCommonConfig !== false,
    contextSelection: profile.contextSelectionInitialized
      ? normalizeContextSelection(profile.contextSelection)
      : normalizeContextSelection(undefined, defaultContextSelection),
    contextSelectionInitialized: true,
    contextWindow: profile.contextWindow || "",
    autoCompactLimit: profile.autoCompactLimit || "",
    modelList: profile.modelList || "",
    modelWindows: profile.modelWindows || "",
    userAgent: profile.userAgent || "",
    aggregate: null,
  };
  return relayProfileUsesLiveFiles(normalized) ? deriveRelayProfileFromFiles(normalized) : normalized;
}

function hydrateAggregateRelayProfile(profile: RelayProfile, aggregate: AggregateRelayProfile | undefined): RelayProfile {
  if (!aggregate) return profile;
  return {
    ...profile,
    name: profile.name || aggregate.name,
    relayMode: "aggregate",
    aggregate: {
      strategy: aggregate.strategy,
      members: aggregate.members.map((member) => ({
        profileId: member.relayId,
        weight: clampAggregateWeight(member.weight),
      })),
    },
  };
}

function activeRelayProfile(settings: BackendSettings): RelayProfile {
  return (
    settings.relayProfiles.find((profile) => profile.id === settings.activeRelayId) ||
    settings.relayProfiles[0] ||
    defaultSettings.relayProfiles[0]
  );
}

function relayProtocolLabel(protocol: RelayProtocol): string {
  return protocol === "chatCompletions" ? "Chat Completions 杞?Responses" : "Responses API";
}

function ccsProviderSummary(result: CcsProvidersResult | null): string {
  if (!result) return "璇诲彇 ~/.cc-switch/cc-switch.db";
  if (!isSuccessStatus(result.status)) return result.message || "璇诲彇 cc-switch 妯″瀷澶辫触銆?;
  const count = result.providers.length;
  return count ? `鍙戠幇 ${count} 涓?Codex 妯″瀷` : "鏈彂鐜板彲瀵煎叆妯″瀷";
}

function normalizeRelayMode(mode: RelayMode | undefined): RelayMode {
  if (mode === "aggregate") return mode;
  if (mode === "pureApi") return mode;
  return "official";
}

function normalizeContextSelection(
  selection?: Partial<RelayContextSelection>,
  fallback: RelayContextSelection = emptyContextSelection(),
): RelayContextSelection {
  if (!selection) {
    return {
      mcpServers: [...fallback.mcpServers],
      skills: [...fallback.skills],
      plugins: [...fallback.plugins],
    };
  }
  return {
    mcpServers: Array.isArray(selection?.mcpServers) ? selection.mcpServers.map(String) : [],
    skills: Array.isArray(selection?.skills) ? selection.skills.map(String) : [],
    plugins: Array.isArray(selection?.plugins) ? selection.plugins.map(String) : [],
  };
}

function relayModeLabel(mode: RelayMode): string {
  if (mode === "aggregate") return "鑱氬悎妯″瀷";
  if (mode === "pureApi") return "绾?API";
  return "瀹樻柟鐧诲綍";
}

function providerImportWireApiLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "chat" || normalized === "chat_completions" || normalized === "chat-completions") {
    return "Chat Completions";
  }
  return "Responses";
}

function providerImportRelayModeLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "official") return "瀹樻柟鐧诲綍";
  if (normalized === "mixedapi" || normalized === "mixed-api" || normalized === "mixed_api") return "娣峰叆 API";
  if (normalized === "aggregate") return "鑱氬悎妯″瀷";
  return "绾?API";
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "鏈～鍐?;
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}鈥?{trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}鈥?{trimmed.slice(-4)}`;
}

function relayProfileConfigBrief(profile: RelayProfile): string {
  if (isAggregateRelayProfile(profile)) {
    const aggregate = normalizeAggregateConfig(profile.aggregate, []);
    return `${aggregateStrategyLabel(aggregate.strategy)} 路 ${aggregate.members.length} 涓垚鍛榒;
  }
  if (profile.relayMode === "official") return profile.officialMixApiKey ? "娣峰叆 API Key" : "涓嶅啓 API 鏂囦欢";
  return profile.baseUrl || "鏈～鍐?URL";
}

function relayProfileModeHelp(profile: RelayProfile): string {
  if (isAggregateRelayProfile(profile)) {
    return "鑱氬悎妯″瀷鍙繚瀛樻垚鍛樺拰绛栫暐閰嶇疆锛屾垚鍛樻潵鑷凡鏈?API 妯″瀷锛涘垏涓哄綋鍓嶅悗浼氶€氳繃鏈湴鍗忚浠ｇ悊杞浆璇锋眰銆?;
  }
  if (profile.relayMode === "official") {
    if (profile.officialMixApiKey) {
      return "姝ゆā鍨嬩細淇濈暀瀹樻柟鐧诲綍妯″紡锛屽苟鎶婅姹傛贩鍏ュ綋鍓?API Key锛汣odex澧炲己浠嶄娇鐢ㄥ吋瀹规ā寮忋€?;
    }
    return "姝ゆā鍨嬩細鍒囧洖瀹樻柟鐧诲綍妯″紡锛屼娇鐢?ChatGPT 瀹樻柟璐﹀彿锛屼笉鍐欏叆 API Key銆?;
  }
  if (profile.relayMode === "pureApi") {
    return "姝ゆā鍨嬩細鍚屾椂鍐欏叆 config.toml 鍜?auth.json锛汚PI Key 涔熶細娉ㄥ叆鍒?provider bearer token銆?;
  }
  return "姝ゆā鍨嬩細淇濈暀瀹樻柟鐧诲綍妯″紡锛屽苟鎶婅姹傛贩鍏ュ綋鍓?API Key锛汣odex澧炲己浠嶄娇鐢ㄥ吋瀹规ā寮忋€?;
}

function relayProfileReadinessText(profile: RelayProfile, relay: RelayResult | null): string {
  if (isAggregateRelayProfile(profile)) {
    const aggregate = normalizeAggregateConfig(profile.aggregate, []);
    return `鑱氬悎妯″瀷宸查厤缃负${aggregateStrategyLabel(aggregate.strategy)}锛屽寘鍚?${aggregate.members.length} 涓垚鍛橈紱鐪熷疄瀵硅瘽浼氳蛋鏈湴浠ｇ悊杞浆銆俙;
  }
  if (profile.relayMode === "official") {
    if (profile.officialMixApiKey) {
      const hasApiFields = profile.baseUrl.trim() && profile.apiKey.trim();
      if (!relay?.authenticated && !hasApiFields) return "褰撳墠鏈櫥褰曞畼鏂硅处鍙凤紝涔熸湭閰嶇疆娣峰叆 API 鐨?Base URL / Key銆?;
      if (!relay?.authenticated) return "褰撳墠鏈櫥褰曞畼鏂硅处鍙凤紱瀹樻柟鐧诲綍娣峰叆 API Key 闇€瑕佸厛鐧诲綍瀹樻柟璐﹀彿銆?;
      if (!hasApiFields) return "褰撳墠杩樻病鏈夊～鍐欐贩鍏?API 鐨?Base URL / Key銆?;
      return `瀹樻柟鐧诲綍宸插氨缁細${relay.accountLabel || "宸茬櫥褰?}锛屼細娣峰叆褰撳墠 API Key銆俙;
    }
    return relay?.authenticated
      ? `瀹樻柟璐﹀彿宸茬櫥褰曪細${relay.accountLabel || relay.authSource || "宸叉娴?}銆俙
      : "褰撳墠鏈櫥褰曞畼鏂硅处鍙凤紱鍒囧埌瀹樻柟鐧诲綍妯″紡鍚庝粛闇€瑕佸厛鍦?Codex/ChatGPT 鐧诲綍銆?;
  }
  const hasFiles = profile.configContents.trim() && profile.authContents.trim();
  if (!hasFiles) return "褰撳墠妯″瀷杩樻病鏈夊畬鏁?config.toml / API Key 瀛樻。銆?;
  if (relay && !relay.configured) return "绾?API 閰嶇疆鏈畬鏁村啓鍏ワ細璇锋鏌ユ妯″瀷鏄惁鏈?OPENAI_API_KEY锛屼笖 config.toml 鏄惁鍖呭惈 model_provider / provider / base_url銆?;
  return "绾?API 灏辩华锛氫細鍚屾椂鍐欏叆 config.toml 鍜?auth.json銆?;
}

function relayProfileSwitchCommand(profile: RelayProfile): "clear_relay_injection" | "apply_relay_injection" | "apply_pure_api_injection" {
  if (isAggregateRelayProfile(profile)) return "apply_relay_injection";
  if (profile.relayMode === "pureApi") return "apply_pure_api_injection";
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return "clear_relay_injection";
  if (profile.configContents.trim()) return "apply_relay_injection";
  return profile.officialMixApiKey ? "apply_relay_injection" : "clear_relay_injection";
}
function relayProfileModeSwitchedText(profile: RelayProfile): string {
  if (isAggregateRelayProfile(profile)) return "宸插垏鎹㈠埌鑱氬悎妯″瀷锛涚湡瀹炲璇濅細鎸夋墍閫夌瓥鐣ヨ疆杞垚鍛樸€?;
  if (profile.relayMode === "pureApi") return "宸叉寜姝ゆā鍨嬪垏鎹㈠埌绾?API锛汣odex澧炲己宸茶涓哄畬鏁村寮恒€?;
  if (profile.officialMixApiKey) return "宸叉寜姝ゆā鍨嬩娇鐢ㄥ畼鏂圭櫥褰曪紝骞舵贩鍏?API Key锛汣odex澧炲己宸茶涓哄吋瀹瑰寮恒€?;
  return "宸叉寜姝ゆā鍨嬪垏鍥炲畼鏂圭櫥褰曪紱Codex澧炲己宸茶涓哄吋瀹瑰寮恒€?;
}

function withGeneratedRelayFiles(profile: RelayProfile): RelayProfile {
  if (isAggregateRelayProfile(profile)) {
    return { ...profile, configContents: "", authContents: "", aggregate: normalizeAggregateConfig(profile.aggregate, []) };
  }
  if (profile.relayMode === "official") {
    return {
      ...profile,
      configContents: profile.officialMixApiKey ? buildRelayConfigToml(profile, { includeBearerToken: true }) : "",
      authContents: profile.authContents || "",
    };
  }
  return {
    ...profile,
    configContents: buildRelayConfigToml(profile, { includeBearerToken: false }),
    authContents: buildRelayAuthJson(profile),
  };
}

function buildRelayConfigToml(
  profile: Pick<RelayProfile, "model" | "baseUrl" | "upstreamBaseUrl" | "apiKey" | "protocol">,
  options: { includeBearerToken: boolean },
): string {
  const baseUrl = profile.protocol === "chatCompletions" ? PROTOCOL_PROXY_BASE_URL : profile.baseUrl.trim();
  const apiKey = profile.apiKey.trim();
  const rootLines = [
    profile.model.trim() ? `model = "${tomlString(profile.model.trim())}"` : null,
    'model_provider = "custom"',
    "",
  ].filter((line): line is string => line !== null);
  return [
    ...rootLines,
    "[model_providers.custom]",
    'name = "custom"',
    'wire_api = "responses"',
    "requires_openai_auth = true",
    `base_url = "${tomlString(baseUrl)}"`,
    options.includeBearerToken && apiKey ? `experimental_bearer_token = "${tomlString(apiKey)}"` : null,
    "",
  ].filter((line): line is string => line !== null).join("\n");
}

function buildRelayAuthJson(profile: Pick<RelayProfile, "apiKey">): string {
  return `${JSON.stringify({ OPENAI_API_KEY: profile.apiKey.trim() }, null, 2)}\n`;
}

function buildOfficialRelayAuthJson(contents: string): string {
  const trimmed = contents.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    delete parsed.OPENAI_API_KEY;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return "";
  }
}

function deriveRelayProfileFromFiles(profile: RelayProfile): RelayProfile {
  if (isAggregateRelayProfile(profile)) {
    return normalizeAggregateRelayProfile(profile, null);
  }
  const configContents = profile.configContents || "";
  const authContents = profile.relayMode === "official" ? buildOfficialRelayAuthJson(profile.authContents || "") : profile.authContents || "";
  const configBaseUrl = codexBaseUrlFromConfig(configContents);
  const chatUpstreamBaseUrl = rootTomlStringValue(configContents, CHAT_UPSTREAM_BASE_URL_KEY);
  const isProxyConfig = configBaseUrl === PROTOCOL_PROXY_BASE_URL;
  const upstreamBaseUrl = profile.upstreamBaseUrl || chatUpstreamBaseUrl || (configBaseUrl && !isProxyConfig ? configBaseUrl : profile.baseUrl || "");
  const configApiKey = codexExperimentalBearerTokenFromConfig(configContents);
  const configModel = codexModelFromConfig(configContents);
  // 濡傛灉鐢ㄦ埛杈撳叆浜嗗甫鍚庣紑鐨勬ā鍨嬪悕锛屼紭鍏堜繚鐣欏湪鐣岄潰鐨勩€岄厤缃ā鍨嬨€嶅瓧娈典腑锛?
  // config.toml 閲屽疄闄呭啓鐨勬槸鍓ョ鍚庣紑鐨?slug锛堢敱 applyRelayProfilePatchToFiles 澶勭悊锛夈€?
  const model = /\[.+\]$/.test(profile.model.trim()) ? profile.model.trim() : configModel;
  return {
    ...profile,
    model,
    baseUrl: upstreamBaseUrl,
    upstreamBaseUrl,
    apiKey: profile.relayMode === "official"
      ? configApiKey || profile.apiKey || ""
      : codexApiKeyFromAuth(authContents) || configApiKey || "",
    contextWindow: codexTopLevelIntFromConfig(configContents, "model_context_window"),
    autoCompactLimit: codexTopLevelIntFromConfig(configContents, "model_auto_compact_token_limit"),
    configContents,
    authContents,
  };
}

function applyRelayProfilePatchToFiles(
  profile: RelayProfile,
  patch: Partial<RelayProfile>,
  options: { allowGenerateFiles?: boolean } = {},
): RelayProfile {
  let next: RelayProfile = { ...profile, ...patch };
  if (isAggregateRelayProfile(next)) {
    return normalizeAggregateRelayProfile(next, null);
  }
  const shouldHaveFiles =
    next.relayMode !== "official" || next.officialMixApiKey || next.configContents.trim() || next.authContents.trim();
  const needsAuthFile = next.relayMode === "pureApi";
  if (options.allowGenerateFiles && shouldHaveFiles && (!next.configContents.trim() || (needsAuthFile && !next.authContents.trim()))) {
    next = withGeneratedRelayFiles(next);
  }

  if ("model" in patch) {
    // 妯″瀷鍚庣紑锛堝 [1M]锛変粎渚?CodexPlusPlus 鍐呴儴浣跨敤锛屽啓鍏?config.toml 鍓嶉渶鍓ョ锛?
    // 鍚﹀垯 codex 浼氭寜甯﹀悗缂€鐨勫瓧绗︿覆鍘诲尮閰?catalog slug锛屽鑷寸獥鍙ｅ洖閫€鍒伴粯璁ゅ€笺€?
    const { slug } = parseModelSuffix(patch.model || "");
    next.configContents = setRootTomlStringKey(next.configContents, "model", slug);
  }
  if ("apiKey" in patch) {
    if (next.relayMode === "pureApi") {
      next.authContents = setAuthOpenAiApiKey(next.authContents, patch.apiKey || "");
      next.configContents = removeCodexExperimentalBearerToken(next.configContents);
    } else {
      next.configContents = setCodexExperimentalBearerToken(next.configContents, patch.apiKey || "");
    }
  }
  if ("baseUrl" in patch) {
    next.upstreamBaseUrl = patch.baseUrl || "";
  }
  if ("upstreamBaseUrl" in patch) {
    next.baseUrl = patch.upstreamBaseUrl || "";
  }
  if ("baseUrl" in patch || "upstreamBaseUrl" in patch || "protocol" in patch) {
    const baseUrlForConfig = next.protocol === "chatCompletions" ? PROTOCOL_PROXY_BASE_URL : next.upstreamBaseUrl || next.baseUrl;
    next.configContents = setCodexProviderStringKey(next.configContents, "base_url", baseUrlForConfig);
    next.configContents = removeRootTomlKey(next.configContents, CHAT_UPSTREAM_BASE_URL_KEY);
  }
  if ("contextWindow" in patch) {
    next.configContents = setRootTomlIntKey(next.configContents, "model_context_window", patch.contextWindow || "");
  }
  if ("autoCompactLimit" in patch) {
    next.configContents = setRootTomlIntKey(
      next.configContents,
      "model_auto_compact_token_limit",
      patch.autoCompactLimit || "",
    );
  }
  if ("relayMode" in patch || "officialMixApiKey" in patch) {
    if (next.relayMode === "official" && !next.officialMixApiKey) {
      next.configContents = "";
      next.authContents = buildOfficialRelayAuthJson(next.authContents);
    } else if (options.allowGenerateFiles && (!next.configContents.trim() || (next.relayMode === "pureApi" && !next.authContents.trim()))) {
      next = withGeneratedRelayFiles(next);
    }
  }

  return deriveRelayProfileFromFiles(next);
}

function codexModelFromConfig(contents: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break;
    const match = /^model\s*=\s*(["'])(.*)\1\s*$/.exec(trimmed);
    if (match) return match[2].replace(/\\(["'\\])/g, "$1");
  }
  return "";
}

/// 瑙ｆ瀽妯″瀷鍚庣紑璇硶锛屽 deepseek-v4-flash[1M] -> { slug: "deepseek-v4-flash", window: 1000000 }
/// 闈炴硶鎴栨病鏈夊悗缂€鏃惰繑鍥炲師涓蹭綔涓?slug銆?
function parseModelSuffix(raw: string): { slug: string; window?: number } {
  const trimmed = raw.trim();
  const match = /^(.*?)\[(\d+(?:[KkMm])?)\]$/.exec(trimmed);
  if (!match) return { slug: trimmed };
  const inner = match[2];
  const numPart = inner.replace(/[KkMm]$/, "");
  const multiplier = inner.endsWith("K") || inner.endsWith("k") ? 1_000
    : inner.endsWith("M") || inner.endsWith("m") ? 1_000_000
    : 1;
  const window = Number.parseInt(numPart, 10) * multiplier;
  if (!Number.isFinite(window) || window <= 0) return { slug: trimmed };
  return { slug: match[1].trim(), window };
}

function codexBaseUrlFromConfig(contents: string): string {
  return codexProviderStringFromConfig(contents, "base_url");
}

function codexExperimentalBearerTokenFromConfig(contents: string): string {
  return codexProviderStringFromConfig(contents, "experimental_bearer_token");
}

function codexProviderStringFromConfig(contents: string, key: string): string {
  const provider = rootTomlStringValue(contents, "model_provider");
  const targetSection = provider ? `model_providers.${provider}` : "";
  const lines = contents.split(/\r?\n/);
  let currentSection = "";
  const matches: string[] = [];

  for (const line of lines) {
    const section = tomlSectionName(line);
    if (section !== null) {
      currentSection = section;
      continue;
    }
    const value = tomlStringAssignmentValue(line, key);
    if (value === null) continue;
    if (targetSection && currentSection === targetSection) return value;
    if (!currentSection || !currentSection.startsWith("model_providers.")) matches.push(value);
  }

  return matches.length === 1 ? matches[0] : "";
}

function codexApiKeyFromAuth(contents: string): string {
  try {
    const parsed = JSON.parse(contents || "{}") as { OPENAI_API_KEY?: unknown };
    return typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : "";
  } catch {
    return "";
  }
}

function codexTopLevelIntFromConfig(contents: string, key: string): string {
  const topLevel = splitTomlRootAndTables(contents).root;
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`);
  for (const line of topLevel.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match) return match[1];
  }
  return "";
}

function rootTomlStringValue(contents: string, key: string): string {
  const topLevel = splitTomlRootAndTables(contents).root;
  for (const line of topLevel.split(/\r?\n/)) {
    const value = tomlStringAssignmentValue(line, key);
    if (value !== null) return value;
  }
  return "";
}

function tomlSectionName(line: string): string | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  return match ? match[1].trim() : null;
}

function tomlStringAssignmentValue(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*([\"'])(.*)\\1\\s*(?:#.*)?$`).exec(line.trim());
  if (!match) return null;
  return match[2].replace(/\\(["'\\])/g, "$1");
}

function setAuthOpenAiApiKey(contents: string, apiKey: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(contents || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  parsed.OPENAI_API_KEY = apiKey.trim();
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function setRootTomlStringKey(contents: string, key: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return removeRootTomlKey(contents, key);
  return setRootTomlLine(contents, key, `${key} = "${tomlString(trimmed)}"`);
}

function setRootTomlIntKey(contents: string, key: string, value: string): string {
  const trimmed = value.replace(/[^\d]/g, "");
  if (!trimmed) return removeRootTomlKey(contents, key);
  return setRootTomlLine(contents, key, `${key} = ${trimmed}`);
}

function setRootTomlLine(contents: string, key: string, lineText: string): string {
  const lines = contents.split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  const rootEnd = firstTable >= 0 ? firstTable : lines.length;
  for (let index = 0; index < rootEnd; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = lineText;
      return ensureTrailingNewline(lines.join("\n").trimEnd());
    }
  }
  const insertAt = key === "model" ? 0 : rootEnd;
  lines.splice(insertAt, 0, lineText);
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function setCodexProviderStringKey(contents: string, key: string, value: string): string {
  const provider = rootTomlStringValue(contents, "model_provider") || "custom";
  let next = contents;
  if (!rootTomlStringValue(next, "model_provider")) {
    next = setRootTomlStringKey(next, "model_provider", provider);
  }
  next = ensureCodexProviderDefaults(next, provider);
  return setTomlSectionStringKey(next, `model_providers.${provider}`, key, value);
}

function setCodexExperimentalBearerToken(contents: string, apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed
    ? setCodexProviderStringKey(contents, "experimental_bearer_token", trimmed)
    : removeCodexExperimentalBearerToken(contents);
}

function removeCodexExperimentalBearerToken(contents: string): string {
  const provider = rootTomlStringValue(contents, "model_provider") || "custom";
  return removeTomlSectionKey(contents, `model_providers.${provider}`, "experimental_bearer_token");
}

function ensureCodexProviderDefaults(contents: string, provider: string): string {
  let next = contents;
  const section = `model_providers.${provider}`;
  next = setTomlSectionStringKey(next, section, "name", provider);
  next = setTomlSectionStringKey(next, section, "wire_api", "responses");
  return setTomlSectionBoolKey(next, section, "requires_openai_auth", true);
}

function setTomlSectionBoolKey(contents: string, sectionName: string, key: string, value: boolean): string {
  return setTomlSectionRawKey(contents, sectionName, key, value ? "true" : "false");
}

function setTomlSectionStringKey(contents: string, sectionName: string, key: string, value: string): string {
  return setTomlSectionRawKey(contents, sectionName, key, `"${tomlString(value.trim())}"`);
}

function setTomlSectionRawKey(contents: string, sectionName: string, key: string, value: string): string {
  const lines = contents.split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const section = tomlSectionName(lines[index]);
    if (section === null) continue;
    if (sectionStart >= 0) {
      sectionEnd = index;
      break;
    }
    if (section === sectionName) sectionStart = index;
  }
  if (sectionStart < 0) {
    const prefix = ensureTrailingNewline(lines.join("\n").trimEnd()).trimEnd();
    return joinTomlSections([prefix, `[${sectionName}]\n${key} = ${value}`]);
  }
  const replacement = `${key} = ${value}`;
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = replacement;
      return ensureTrailingNewline(lines.join("\n").trimEnd());
    }
  }
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  lines.splice(insertAt, 0, replacement);
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function removeTomlSectionKey(contents: string, sectionName: string, key: string): string {
  const lines = contents.split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const section = tomlSectionName(lines[index]);
    if (section === null) continue;
    if (sectionStart >= 0) {
      sectionEnd = index;
      break;
    }
    if (section === sectionName) sectionStart = index;
  }
  if (sectionStart < 0) return contents;
  const next = lines.filter((line, index) => {
    if (index <= sectionStart || index >= sectionEnd) return true;
    return !new RegExp(`^\\s*${key}\\s*=`).test(line);
  });
  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function relayProfileSwitchValidation(profile: RelayProfile): string | null {
  if (isAggregateRelayProfile(profile)) {
    return aggregateRelayProfileValidation(profile);
  }
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return null;
  if (!profile.configContents.trim()) {
    return `妯″瀷銆?{profile.name || profile.id}銆嶇己灏戠嫭绔?config.toml锛屽凡鍋滄鍒囨崲锛岄伩鍏嶇户缁樉绀轰笂涓€濂楅厤缃枃浠躲€傝鍏堝湪璇ユā鍨嬭鎯呴噷淇濆瓨 config.toml銆俙;
  }
  if (profile.relayMode !== "official" || !authJsonHasOpenAiApiKey(profile.authContents)) return null;
  return "瀹樻柟娣峰悎 API 涓嶅簲鍦?auth.json 涓繚瀛?OPENAI_API_KEY銆傝娓呯悊姝ゆā鍨嬬殑 auth.json 鍚庡啀鍒囨崲銆?;
}

function relayProfileUsesLiveFiles(profile: RelayProfile): boolean {
  return profile.relayMode !== "official" || profile.officialMixApiKey;
}

function authJsonHasOpenAiApiKey(contents: string): boolean {
  const trimmed = contents.trim();
  if (!trimmed) return false;
  try {
    const value = JSON.parse(trimmed);
    return !!value && typeof value === "object" && typeof value.OPENAI_API_KEY === "string" && value.OPENAI_API_KEY.trim().length > 0;
  } catch {
    return /"OPENAI_API_KEY"\s*:/.test(trimmed);
  }
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function syncLegacyRelayFields(settings: BackendSettings): BackendSettings {
  const relayProfiles = settings.relayProfiles.map((profile) =>
    isAggregateRelayProfile(profile) ? normalizeAggregateRelayProfile(profile, { ...settings, relayProfiles: settings.relayProfiles }) : deriveRelayProfileFromFiles(profile),
  );
  const active = activeRelayProfile({ ...settings, relayProfiles });
  const aggregateRelayProfiles = normalizeAggregateProfilesFromRelayProfiles(relayProfiles);
  const activeAggregateRelayId = isAggregateRelayProfile(active) ? active.id : "";
  return {
    ...settings,
    relayProfiles,
    activeRelayId: active.id,
    relayBaseUrl: isAggregateRelayProfile(active) ? PROTOCOL_PROXY_BASE_URL : active.baseUrl,
    relayApiKey: active.apiKey,
    aggregateRelayProfiles,
    activeAggregateRelayId,
  };
}

function normalizeAggregateProfilesFromRelayProfiles(profiles: RelayProfile[]): AggregateRelayProfile[] {
  const candidates = profiles.filter((profile) => !isAggregateRelayProfile(profile));
  return profiles.filter(isAggregateRelayProfile).map((profile) => {
    const aggregate = normalizeAggregateConfig(profile.aggregate, candidates);
    return {
      id: profile.id,
      name: profile.name || "鑱氬悎妯″瀷",
      strategy: aggregate.strategy,
      members: aggregate.members.map((member) => ({
        relayId: member.profileId,
        weight: clampAggregateWeight(member.weight),
      })),
    };
  });
}
function updateRelayProfile(settings: BackendSettings, id: string, patch: Partial<RelayProfile>): BackendSettings {
  if (patch.relayMode === "aggregate" || patch.aggregate) {
    return syncLegacyRelayFields({
      ...settings,
      relayProfiles: settings.relayProfiles.map((profile) =>
        profile.id === id ? normalizeAggregateRelayProfile({ ...profile, ...patch }, settings) : profile,
      ),
    });
  }
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: settings.relayProfiles.map((profile) => {
      if (profile.id !== id) return profile;
      return deriveRelayProfileFromFiles({ ...profile, ...patch });
    }),
  });
}

function createRelayProfile(settings: BackendSettings): RelayProfile {
  const id = `relay-${Date.now().toString(36)}`;
  const contextSelection = contextSelectionForAllEntries(settings);
  const next = {
    id,
    name: `妯″瀷 ${settings.relayProfiles.length + 1}`,
    model: "",
    baseUrl: defaultSettings.relayBaseUrl,
    upstreamBaseUrl: defaultSettings.relayBaseUrl,
    apiKey: "",
    protocol: "responses" as RelayProtocol,
    relayMode: "official" as RelayMode,
    officialMixApiKey: false,
    testModel: "",
    configContents: "",
    authContents: "",
    useCommonConfig: true,
    contextSelection,
    contextSelectionInitialized: true,
    contextWindow: "",
    autoCompactLimit: "",
    modelList: "",
    modelWindows: "",
    userAgent: "",
  };
  return withGeneratedRelayFiles(next);
}

function createAggregateRelayProfile(settings: BackendSettings): RelayProfile {
  const id = `aggregate-${Date.now().toString(36)}`;
  const contextSelection = contextSelectionForAllEntries(settings);
  const candidates = aggregateMemberCandidates(settings, id);
  return normalizeAggregateRelayProfile(
    {
      id,
      name: `鑱氬悎妯″瀷 ${settings.relayProfiles.filter(isAggregateRelayProfile).length + 1}`,
      model: "",
      baseUrl: "",
      upstreamBaseUrl: "",
      apiKey: "",
      protocol: "responses",
      relayMode: "aggregate",
      officialMixApiKey: false,
      testModel: "",
      configContents: "",
      authContents: "",
      useCommonConfig: true,
      contextSelection,
      contextSelectionInitialized: true,
      contextWindow: "",
      autoCompactLimit: "",
      modelList: "",
      modelWindows: "",
      userAgent: "",
      aggregate: {
        strategy: "failover",
        members: candidates.slice(0, 1).map((profile) => ({ profileId: profile.id, weight: 1 })),
      },
    },
    settings,
  );
}

function addRelayProfile(settings: BackendSettings, profile: RelayProfile): BackendSettings {
  const nextWithFiles = isAggregateRelayProfile(profile)
    ? normalizeAggregateRelayProfile(profile, settings)
    : deriveRelayProfileFromFiles(
        profile.configContents.trim() || profile.authContents.trim() ? profile : withGeneratedRelayFiles(profile),
      );
  const activeId = settings.relayProfiles.some((item) => item.id === settings.activeRelayId)
    ? settings.activeRelayId
    : activeRelayProfile(settings).id;
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: [...settings.relayProfiles, nextWithFiles],
    activeRelayId: activeId,
  });
}

function duplicateRelayProfile(settings: BackendSettings, id: string): BackendSettings {
  const sourceIndex = settings.relayProfiles.findIndex((profile) => profile.id === id);
  const source = settings.relayProfiles[sourceIndex] || activeRelayProfile(settings);
  const nextId = `relay-${Date.now().toString(36)}`;
  const next = {
    ...source,
    id: nextId,
    name: `${source.name || "鏈懡鍚嶆ā鍨?} 鍓湰`,
  };
  const normalizedNext = isAggregateRelayProfile(next) ? normalizeAggregateRelayProfile(next, settings) : next;
  const relayProfiles = [...settings.relayProfiles];
  relayProfiles.splice(sourceIndex >= 0 ? sourceIndex + 1 : relayProfiles.length, 0, normalizedNext);
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles,
  });
}

function reorderRelayProfiles(settings: BackendSettings, sourceId: string, targetId: string): BackendSettings {
  if (sourceId === targetId) return settings;
  const sourceIndex = settings.relayProfiles.findIndex((profile) => profile.id === sourceId);
  const targetIndex = settings.relayProfiles.findIndex((profile) => profile.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return settings;
  const relayProfiles = [...settings.relayProfiles];
  const [moved] = relayProfiles.splice(sourceIndex, 1);
  relayProfiles.splice(targetIndex, 0, moved);
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles,
  });
}

function removeRelayProfile(settings: BackendSettings, id: string): BackendSettings {
  const profiles = settings.relayProfiles.filter((profile) => profile.id !== id);
  const scrubbedProfiles = profiles.map((profile) =>
    isAggregateRelayProfile(profile)
      ? normalizeAggregateRelayProfile(
          {
            ...profile,
            aggregate: {
              ...normalizeAggregateConfig(profile.aggregate, []),
              members: normalizeAggregateConfig(profile.aggregate, []).members.filter((member) => member.profileId !== id),
            },
          },
          { ...settings, relayProfiles: profiles },
        )
      : profile,
  );
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: scrubbedProfiles.length ? scrubbedProfiles : defaultSettings.relayProfiles,
    activeRelayId: settings.activeRelayId === id ? scrubbedProfiles[0]?.id || "default" : settings.activeRelayId,
  });
}

const aggregateStrategyOptions: Array<{ value: RelayAggregateStrategy; label: string; description: string }> = [
  {
    value: "failover",
    label: "澶辫触鍒囨崲",
    description: "鎸夋垚鍛橀『搴忚姹傦紝澶辫触鍚庡垏鍒颁笅涓€涓ā鍨嬨€?,
  },
  {
    value: "conversationRoundRobin",
    label: "鎸夊璇濊疆杞?,
    description: "鍚屼竴瀵硅瘽淇濇寔涓€涓垚鍛橈紝涓嶅悓瀵硅瘽渚濇鍒嗛厤銆?,
  },
  {
    value: "requestRoundRobin",
    label: "鎸夎姹傝疆杞?,
    description: "姣忔璇锋眰鎸夋垚鍛橀『搴忓垏鎹紝閫傚悎鍧囧寑鎽婅姹傞噺銆?,
  },
  {
    value: "weightedRoundRobin",
    label: "鏉冮噸杞浆",
    description: "鎸夋垚鍛樻潈閲嶅垎閰嶈姹傦紝鏉冮噸瓒婇珮鎵挎媴瓒婂銆?,
  },
];

function isAggregateRelayProfile(profile: Pick<RelayProfile, "relayMode" | "aggregate">): boolean {
  return profile.relayMode === "aggregate" || !!profile.aggregate;
}

function normalizeAggregateRelayProfile(profile: RelayProfile, settings: BackendSettings | null): RelayProfile {
  const candidates = settings ? aggregateMemberCandidates(settings, profile.id) : [];
  const aggregate = normalizeAggregateConfig(profile.aggregate, candidates);
  return {
    ...profile,
    baseUrl: "",
    upstreamBaseUrl: "",
    apiKey: "",
    protocol: "responses",
    relayMode: "aggregate",
    officialMixApiKey: false,
    configContents: "",
    authContents: "",
    aggregate,
  };
}

function normalizeAggregateConfig(
  aggregate: RelayAggregateConfig | null | undefined,
  candidates: RelayProfile[],
): RelayAggregateConfig {
  const candidateIds = new Set(candidates.map((profile) => profile.id));
  const seen = new Set<string>();
  const strategy: RelayAggregateStrategy =
    aggregate?.strategy && aggregateStrategyOptions.some((option) => option.value === aggregate.strategy)
      ? aggregate.strategy
      : "failover";
  const members = (aggregate?.members ?? [])
    .filter((member) => member.profileId && !seen.has(member.profileId))
    .filter((member) => !candidateIds.size || candidateIds.has(member.profileId))
    .map((member) => {
      seen.add(member.profileId);
      return { profileId: member.profileId, weight: clampAggregateWeight(member.weight) };
    });
  return { strategy, members };
}

function aggregateMemberCandidates(settings: BackendSettings, aggregateId: string): RelayProfile[] {
  return settings.relayProfiles.filter(
    (profile) => profile.id !== aggregateId && !isAggregateRelayProfile(profile) && isApiRelayProfile(profile),
  );
}

function isApiRelayProfile(profile: RelayProfile): boolean {
  return Boolean(profile.baseUrl.trim() && profile.apiKey.trim());
}

function clampAggregateWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(999, Math.round(value)));
}

function aggregateStrategyLabel(strategy: RelayAggregateStrategy): string {
  return aggregateStrategyOptions.find((option) => option.value === strategy)?.label ?? "澶辫触鍒囨崲";
}

function aggregateStrategyHelp(strategy: RelayAggregateStrategy): string {
  if (strategy === "failover") return "澶辫触鍒囨崲浼氫繚鐣欐垚鍛橀『搴忥紝浼樺厛浣跨敤绗竴涓彲鐢ㄦā鍨嬨€?;
  if (strategy === "conversationRoundRobin") return "鎸夊璇濊疆杞細璁╁悓涓€瀵硅瘽灏介噺淇濇寔鍥哄畾鎴愬憳锛岄檷浣庝笂涓嬫枃婕傜Щ銆?;
  if (strategy === "requestRoundRobin") return "鎸夎姹傝疆杞細閫愯姹傚垏鎹㈡垚鍛橈紝閫傚悎妯″瀷鑳藉姏鎺ヨ繎鐨勫満鏅€?;
  return "鏉冮噸杞浆浼氳鍙栨瘡涓垚鍛樼殑鏉冮噸鍊硷紝鏉冮噸瓒婇珮鐨勬垚鍛樿幏寰楁洿澶氳姹傘€?;
}

function aggregateRelayProfileValidation(profile: RelayProfile): string | null {
  const aggregate = normalizeAggregateConfig(profile.aggregate, []);
  return aggregate.members.length >= 1 ? null : "鑱氬悎妯″瀷鑷冲皯闇€瑕佸嬀閫?1 涓凡濉啓 Base URL / Key 鐨?API 妯″瀷銆?;
}

function numberOrDefault(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitLogLines(text: string) {
  return text.trimEnd().split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

function zedStrategyLabel(strategy: ZedOpenStrategy) {
  if (strategy === "reuseWindow") return "澶嶇敤绐楀彛";
  if (strategy === "newWindow") return "鏂扮獥鍙?;
  if (strategy === "default") return "Zed 榛樿琛屼负";
  return "鍔犲叆褰撳墠宸ヤ綔鍖?;
}

function zedRemoteHostLabel(project: ZedRemoteProject) {
  const user = project.ssh.user ? `${project.ssh.user}@` : "";
  const port = project.ssh.port ? `:${project.ssh.port}` : "";
  return `${user}${project.ssh.host}${port}`;
}

function zedRemoteSourceLabel(source: string) {
  if (source === "currentThread") return "褰撳墠浼氳瘽";
  if (source === "codexRemoteProject") return "Codex remote project";
  if (source === "threadWorkspaceHint") return "Thread workspace hint";
  if (source === "sqliteThreadCwd") return "SQLite cwd";
  if (source === "recent") return "鏈€杩戞墦寮€";
  return source || "鏈煡鏉ユ簮";
}

function formatTime(value: number) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function formatDuration(startedAtMs: number): string {
  if (!startedAtMs) return "-";
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < 0) return formatTime(startedAtMs);
  const mins = Math.floor(elapsed / 60000);
  if (mins < 1) return "鍒氬垰鍚姩";
  if (mins < 60) return `宸茶繍琛?${mins} 鍒嗛挓`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `宸茶繍琛?${hours} 灏忔椂 ${remainMins} 鍒嗛挓`;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function loadInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem("codex-plus-theme") === "light" ? "light" : "dark";
}

function loadInitialRoute(): Route {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  if (params.get("showUpdate") === "1" || window.location.hash === "#about") {
    return "about";
  }
  return "overview";
}

