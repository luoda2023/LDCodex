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
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  codexAppPluginEntryUnlock: boolean;
  codexAppPluginMarketplaceUnlock: boolean;
  codexAppForcePluginInstall: boolean;
  codexAppModelWhitelistUnlock: boolean;
  codexAppSessionDelete: boolean;
  codexAppMarkdownExport: boolean;
  codexAppProjectMove: boolean;
  codexAppConversationTimeline: boolean;
  codexAppConversationView: boolean;
  codexAppThreadScrollRestore: boolean;

  zedRemoteOpenStrategy: ZedOpenStrategy;
  zedRemoteProjectRegistryEnabled: boolean;
  zedRemoteSyncToZedSettings: boolean;
  codexAppUpstreamWorktreeCreate: boolean;
  codexAppNativeMenuPlacement: boolean;
  codexAppServiceTierControls: boolean;
  codexAppImageOverlayEnabled: boolean;
  codexAppImageOverlayPath: string;
  codexAppImageOverlayOpacity: number;
  codexGoalsEnabled: boolean;
  launchMode: LaunchMode;
  relayBaseUrl: string;
  relayApiKey: string;
  relayProfiles: RelayProfile[];
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

type RelayProfile = {
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
  userAgent: string;
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
type RelayMode = "official" | "mixedApi" | "pureApi";
const PROTOCOL_PROXY_BASE_URL = "http://127.0.0.1:57321/v1";
const CHAT_UPSTREAM_BASE_URL_KEY = "codex_plus_chat_base_url";
const SCRIPT_MARKET_REPOSITORY_URL = "https://github.com/luoda2023/LDCodexScriptMarket";

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

type RelayProfileTestResult = CommandResult<{
  httpStatus: number;
  endpoint: string;
  responsePreview: string;
}>;

type RelayProfileModelsResult = CommandResult<{
  models: string[];
  endpoint: string;
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
  const target = result.targetProvider || "å½å provider";
  const skipped = result.skippedLockedRolloutFiles?.length ?? 0;
  const skippedText = skipped ? `ï¼è·³è¿?${skipped} ä¸ªå ç¨æä»¶` : "";
  return `å·²åæ­¥å° ${target}ï¼ä¿®å¤?${changed} ä¸ªä¼è¯æä»¶ï¼æ´æ° ${rows} è¡ç´¢å¼?{skippedText}ã`;
}

const providerSyncSourceLabels: Record<ProviderSyncTargetSource, string> = {
  config: "éç½®",
  rollout: "ä¼è¯",
  sqlite: "ç´¢å¼",
  manual: "æå¨",
};

function providerSyncTargetLabel(target: ProviderSyncTargetOption): string {
  const labels = target.sources.map((source) => providerSyncSourceLabels[source]).filter(Boolean);
  const current = target.isCurrentProvider ? ["å½å"] : [];
  return [...labels, ...current].join(" / ") || "åç°";
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

type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "maintenance" | "about" | "settings" | "proxy";
type Theme = "dark" | "light";

const routes: Array<{ id: Route; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "relay", label: "供应商配置", icon: KeyRound },
  { id: "sessions", label: "会话管理", icon: MessageCircle },
  { id: "context", label: "工具与插件", icon: Network },
  { id: "enhance", label: "页面增强", icon: Hammer },
  { id: "maintenance", label: "维护中心", icon: Wrench },
  { id: "settings", label: "设置", icon: Settings },
  { id: "proxy", label: "代理转发配置", icon: ShieldCheck },
  { id: "about", label: "关于", icon: Info },
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
  codexAppPluginEntryUnlock: true,
  codexAppPluginMarketplaceUnlock: true,
  codexAppForcePluginInstall: true,
  codexAppModelWhitelistUnlock: true,
  codexAppSessionDelete: true,
  codexAppMarkdownExport: true,
  codexAppProjectMove: true,
  codexAppConversationTimeline: true,
  codexAppConversationView: false,
  codexAppThreadScrollRestore: true,

  codexAppUpstreamWorktreeCreate: true,
  codexAppNativeMenuPlacement: true,
  codexAppServiceTierControls: false,
  codexAppImageOverlayEnabled: false,
  codexAppImageOverlayPath: "",
  codexAppImageOverlayOpacity: 35,
  codexGoalsEnabled: false,
  launchMode: "patch",
  relayBaseUrl: "",
  relayApiKey: "",
  relayProfiles: [
    {
      id: "default",
      name: "é»è®¤ä¸­è½¬",
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
      userAgent: "",
    },
  ],
  relayCommonConfigContents: "",
  relayContextConfigContents: "",
  activeRelayId: "default",
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
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [relay, setRelay] = useState<RelayResult | null>(null);
  const [relayFiles, setRelayFiles] = useState<RelayFilesResult | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSessionsResult | null>(null);
  const [liveContextEntries, setLiveContextEntries] = useState<CodexContextEntries | null>(null);
  const [logs, setLogs] = useState<LogsResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [watcher, setWatcher] = useState<WatcherResult | null>(null);
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  
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
    message: "å°æªè¿è¡åå²ä¼è¯ä¿®å¤ã?,
    result: null,
  });
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
      showNotice("è°ç¨å¤±è´¥", stringifyError(error), "failed");
      return null;
    }
  };

  const refreshOverview = async (silent = false) => {
    const result = await run(() => call<OverviewResult>("load_overview"));
    if (result) {
      // å´©æºæ£æµï¼è¿ç¨ä»è¿è¡ç¶æåä¸ºåæ­?å¤±è´¥ â?å¼¹åºéç¥
      const prev = prevLaunchStatusRef.current;
      const current = result.latest_launch?.status;
      if (prev && prev === "running" && current && (current === "stopped" || current === "failed" || current === "crashed")) {
        showNotice("Codex æå¤åæ­¢", `è¿ç¨ç¶æï¼${current}ãæ¯å¦è¦éæ°å¯å¨ï¼`, "failed");
      }
      prevLaunchStatusRef.current = current ?? null;
      setOverview(result);
      if (!silent) showResultNotice("æ¦è§å·²æ£æ?, result, { silentSuccess: true });
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
      if (!silent) showResultNotice("è®¾ç½®å·²å è½?, result, { silentSuccess: true });
      return normalized;
    }
    return null;
  };

  const refreshScriptMarket = async (silent = false) => {
    const result = await run(() => call<ScriptMarketResult>("refresh_script_market"));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("èæ¬å¸åº", result, { silentSuccess: true });
    }
  };

  const installMarketScript = async (id: string) => {
    const result = await run(() => call<ScriptMarketResult>("install_market_script", { id }));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      showResultNotice("èæ¬å¸åº", result);
    }
  };

  const setUserScriptEnabled = async (key: string, enabled: boolean) => {
    const result = await run(() => call<SettingsResult>("set_user_script_enabled", { key, enabled }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("æ¬å°èæ¬", result);
    }
  };

  const deleteUserScript = async (key: string) => {
    const script = settings?.user_scripts?.scripts?.find((item) => item.key === key);
    const name = script?.name || key;
    if (!window.confirm(`å é¤èæ¬â?{name}âï¼æ­¤æä½ä¼ç§»é¤æ¬å°èæ¬æä»¶ã`)) return;
    const result = await run(() => call<SettingsResult>("delete_user_script", { key }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("æ¬å°èæ¬", result);
    }
  };

  const refreshRelay = async (silent = false) => {
    const result = await run(() => call<RelayResult>("relay_status"));
    if (result) {
      setRelay(result);
      if (!silent) showResultNotice("ç»å½ç¶æ?, result, { silentSuccess: true });
    }
  };

  const refreshRelayFiles = async (silent = false) => {
    const result = await run(() => call<RelayFilesResult>("read_relay_files"));
    if (result) {
      setRelayFiles(result);
      if (!silent) showResultNotice("éç½®æä»¶", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshLocalSessions = async (silent = false) => {
    const result = await run(() => call<LocalSessionsResult>("list_local_sessions"));
    if (result) {
      setLocalSessions(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("ä¼è¯ç®¡ç", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshZedRemoteProjects = async (silent = false) => {
    const result = await run(() => call<ZedRemoteProjectsResult>("list_zed_remote_projects"));
    if (result) {
      setZedRemoteProjects(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("Zed è¿ç¨é¡¹ç®", result, { silentSuccess: true });
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
      showResultNotice("Zed è¿ç¨æå¼", result);
      await refreshZedRemoteProjects(true);
    }
  };

  const forgetZedRemoteProject = async (project: ZedRemoteProject) => {
    const result = await run(() => call<ZedRemoteProjectsResult>("forget_zed_remote_project", { id: project.id }));
    if (result) {
      setZedRemoteProjects(result);
      showResultNotice("Zed è¿ç¨é¡¹ç®", result);
    }
  };

  const deleteLocalSession = async (session: LocalSession) => {
    const title = session.title || session.id;
    if (!window.confirm(`å é¤ä¼è¯â?{title}âï¼æ­¤æä½ä¼å é¤æ¬å°æ°æ®åºè®°å½å rollout æä»¶ï¼å¹¶åå»ºå¤ä»½ã`)) return;
    const result = await run(() =>
      call<DeleteLocalSessionResult>("delete_local_session", {
        request: { sessionId: session.id, title: session.title, dbPath: session.dbPath },
      }),
    );
    if (result) {
      showResultNotice("ä¼è¯å é¤", result);
      await refreshLocalSessions(true);
    }
  };

  const refreshLiveContextEntries = async (silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("read_live_context_entries"));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("å·¥å·ä¸æä»?, result, { silentSuccess: true });
    }
    return result;
  };

  const syncLiveContextEntries = async (next: BackendSettings, silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("sync_live_context_entries", { request: { settings: next } }));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("å·¥å·ä¸æä»?, result, { silentSuccess: true });
    }
    return result;
  };

  const refreshLogs = async (silent = false) => {
    const result = await run(() => call<LogsResult>("read_latest_logs", { request: { lines: 240 } }));
    if (result) {
      setLogs(result);
      if (!silent) showResultNotice("æ¥å¿å·²å·æ?, result, { silentSuccess: true });
    }
  };

  const refreshDiagnostics = async (silent = false) => {
    const result = await run(() => call<DiagnosticsResult>("copy_diagnostics"));
    if (result) {
      setDiagnostics(result);
      if (!silent) showResultNotice("è¯æ­å·²çæ?, result, { silentSuccess: true });
    }
  };

  const refreshWatcher = async (silent = false) => {
    const result = await run(() => call<WatcherResult>("load_watcher_state"));
    if (result) {
      setWatcher(result);
      if (!silent) showResultNotice("Watcher ç¶æ?, result, { silentSuccess: true });
    }
  };

  const navigate = async (next: Route) => {
    setRoute(next);
    if (next === "overview") await refreshOverview(true);
    if (next === "relay") {
      await refreshSettings(true);
      await refreshRelay(true);
      await refreshRelayFiles(true);
    }
    if (next === "sessions") {
      await refreshSettings(true);
      await refreshLocalSessions(true);
      await refreshProviderSyncTargets(true);
    }
    
    if (next === "context") {
      await refreshSettings(true);
      await refreshRelayFiles(true);
      await refreshLiveContextEntries(true);
    }
    if (next === "proxy") {
      await refreshOverview(true);
      await refreshWatcher(true);
    }
    if (next === "settings") await refreshSettings(true);

    
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
      showNotice("å¯å¨ä»»å¡", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const restart = async () => {
    const result = await launchCommand("restart_codex_plus");
    if (result) {
      showNotice("éå¯ LDCodex", result.message, result.status);
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
      showNotice("åç«¯ä¿®å¤", result.message, result.status);
    }
  };

  const installEntrypoints = async () => {
    const result = await run(() => call<InstallResult>("install_entrypoints"));
    if (result) {
      showNotice("å¥å£å®è£", result.message, result.status);
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
      showNotice("å¥å£å¸è½½", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const repairShortcuts = async () => {
    const result = await run(() => call<InstallResult>("repair_shortcuts"));
    if (result) {
      showNotice("å¿«æ·æ¹å¼ä¿®å¤", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const watcherAction = async (command: string) => {
    const result = await run(() => call<WatcherResult>(command));
    if (result) {
      setWatcher(result);
      showNotice("Watcher æä½", result.message, result.status);
    }
  };

  const checkUpdate = async (_silent = false) => {
    // åçº§æ£æ¥å·²ç¦ç¨
  };


  const performUpdate = async () => {
    // æ´æ°åè½å·²ç¦ç?
  };


  const saveSettings = async () => {
    const next = normalizeSettings(settingsForm);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      // ²»¸²¸Ç±íµ¥×´Ì¬ - ±£³ÖÓÃ»§¸Õ¸Õ¹´Ñ¡µÄÑ¡Ïî
      // setSettingsForm(normalizeSettings(result.settings));
    }
  };

  const saveSettingsValue = async (next: BackendSettings, silent = true) => {
    const normalized = normalizeSettings(next);
    setSettingsForm(normalized);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      if (!silent || !isSuccessStatus(result.status)) showNotice("è®¾ç½®ä¿å­", result.message, result.status);
    }
  };

  const resetSettings = async () => {
    const result = await run(() => call<SettingsResult>("reset_settings"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("è®¾ç½®éç½®", result.message, result.status);
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
      if (!silent && !isSuccessStatus(result.status)) showNotice("Provider åæ­¥ç®æ ", result.message, result.status);
    }
    return result;
  };

  const syncProvidersNow = async () => {
    if (providerSyncProgress.active) return;
    setProviderSyncProgress({
      active: true,
      percent: 12,
      message: selectedProviderSyncTarget ? `æ­£å¨åæ­¥å?${selectedProviderSyncTarget}â¦` : "æ­£å¨æ«æåå²ä¼è¯ä¸ç´¢å¼â?,
      result: null,
    });
    const progressTimer = window.setInterval(() => {
      setProviderSyncProgress((current) => {
        if (!current.active) return current;
        return {
          ...current,
          percent: Math.min(88, current.percent + 8),
          message: current.percent < 40 ? "æ­£å¨æ£æ¥ä¼è¯?provider æ è®°â? : "æ­£å¨åå¥ä¿®å¤ä¸å¤ä»½â?,
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
        showNotice("åå²ä¼è¯ä¿®å¤", result.message, result.status);
      } else {
        setProviderSyncProgress({
          active: false,
          percent: 100,
          message: "åå²ä¼è¯ä¿®å¤å¤±è´¥ï¼è¯·æ¥çéè¯¯æç¤ºåéè¯ã?,
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
        showNotice("è®¾ç½®ä¿å­", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("å®æ¹æ··å¥ API Key", result.message, result.status);
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
      if (!silent) showNotice("é¡µé¢å¢å¼ºæ¨¡å¼", result.message, result.status);
    }
    return result;
  };

  const applyPureApiInjection = async (silent = false) => {
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: settingsForm }));
    if (settingsResult) {
      setSettings(settingsResult);
      setSettingsForm(normalizeSettings(settingsResult.settings));
      if (!isSuccessStatus(settingsResult.status)) {
        showNotice("è®¾ç½®ä¿å­", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_pure_api_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("çº?API æ¨¡å¼", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && result.configured;
  };

  const clearRelayInjection = async (silent = false) => {
    const result = await run(() => call<RelayResult>("clear_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("å®æ¹ç»å½æ¨¡å¼", result.message, result.status);
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
    if (!isSuccessStatus(result.status)) showResultNotice("å·¥å·ä¸æä»?, result);
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
    if (!isSuccessStatus(result.status)) showResultNotice("å·¥å·ä¸æä»?, result);
    return normalized;
  };

  const extractRelayCommonConfig = async (configContents: string) => {
    const result = await run(() =>
      call<ExtractRelayCommonConfigResult>("extract_relay_common_config", {
        request: { configContents },
      }),
    );
    if (result) showResultNotice("éç¨éç½®æä»¶", result);
    return result && isSuccessStatus(result.status) ? result : null;
  };

  const testRelayProfile = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileTestResult>("test_relay_profile", { profile }));
    if (result) showNotice("ä¾åºåæµè¯?, result.message, result.status);
  };

  const fetchRelayProfileModels = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileModelsResult>("fetch_relay_profile_models", { profile }));
    if (result) showNotice("æ¨¡ååè¡¨", result.message, result.status);
    return result && isSuccessStatus(result.status) ? result.models : null;
  };

  const switchOfficialMode = async () => {
    const switched = await clearRelayInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("relay", true);
    if (result) showNotice("å®æ¹ç»å½æ¨¡å¼", "å·²ååå®æ¹ç»å½ï¼é¡µé¢å¢å¼ºå·²è®¾ä¸ºå¼å®¹å¢å¼ºã?, result.status);
  };

  const switchPureApiMode = async () => {
    const switched = await applyPureApiInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("patch", true);
    if (result) showNotice("çº?API æ¨¡å¼", "å·²åæ¢å°çº?APIï¼é¡µé¢å¢å¼ºå·²è®¾ä¸ºå®æ´å¢å¼ºã?, result.status);
  };

  const switchRelayProfile = async (next: BackendSettings, previousActiveRelayId = settingsForm.activeRelayId) => {
    if (relaySwitching) {
      showNotice("ä¾åºååæ¢ä¸­", "ä¸ä¸æ¬¡åæ¢è¿æ²¡æå®æï¼è¯·ç¨ååè¯ã?, "failed");
      return;
    }
    let switchSettings = normalizeSettings(next);
    if (!switchSettings.relayProfilesEnabled) {
      showNotice("ä¾åºåéç½®å·²å³é­", "å½åä¸ä¼åå¥ Codex config.toml / auth.jsonãæå¼ä¾åºåéç½®æ»å¼å³åååæ¢ã?, "failed");
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
      showNotice("ä¾åºåéç½®å¯è½ä¸æ­£ç¡®", validationError, "failed");
      return;
    }

    logDiagnostic("switchRelayProfile.apply_start", {
      targetRelayId: selectedBeforeSave.id,
      targetRelayName: selectedBeforeSave.name,
      previousActiveRelayId,
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
          targetRelayId: selectedBeforeSave.id,
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
          targetRelayId: selectedBeforeSave.id,
          status: result.status,
          message: result.message,
          activeRelayId: selectedSettings.activeRelayId,
        });
        showNotice("ä¾åºååæ?, result.message, result.status);
        return;
      }
      const currentSelected = activeRelayProfile(selectedSettings);
      logDiagnostic("switchRelayProfile.ok", {
        targetRelayId: currentSelected.id,
        launchMode: selectedSettings.launchMode,
        status: result.status,
      });
      showNotice("ä¾åºååæ?, relayProfileModeSwitchedText(currentSelected), result.status);
    } finally {
      setRelaySwitching(false);
    }
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      showNotice("å¤å¶å¤±è´¥", stringifyError(error), "failed");
    }
  };
  const openExternalUrl = async (url: string) => {
    try {
      const result = await run(() => call<CommandResult<Record<string, unknown>>>("open_external_url", { url }));
      if (result && result.status === "ok") {
        return;
      }
    } catch (_) {}
    window.open(url, "_blank");
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
      await refreshProviderSyncTargets(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    (async () => {
      try { await getCurrentWindow().setTheme(theme == "dark" ? "dark" : "light"); } catch (_) {}
    })();
  }, [theme]);

const minimize = async () => {
  try { await getCurrentWindow().minimize(); } catch (_) {}
};
const maximize = async () => {
  try { await getCurrentWindow().toggleMaximize(); } catch (_) {}
};
const closeWindow = async () => {
  try { await getCurrentWindow().close(); } catch (_) {}
};

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
      installEntrypoints,
      uninstallEntrypoints,
      repairShortcuts,
      checkUpdate,
      performUpdate,
      saveSettings,
      saveSettingsValue,
      refreshSettings,
      resetSettings,
      chooseCodexAppPath: async (mode: "folder" | "file") => {
        let selected: unknown;
        try {
          selected = await open(
            mode === "folder"
              ? { directory: true, multiple: false, title: "éæ© Codex åºç¨ç®å½" }
              : {
                  directory: false,
                  multiple: false,
                  title: "éæ© Codex.exe æ?Codex.app",
                  filters: [{ name: "Codex åºç¨", extensions: ["exe", "app"] }],
                },
          );
        } catch (error) {
          // Surface plugin failures (e.g. missing capability permission) so the
          // buttons no longer appear unresponsive â?see #345.
          const message = error instanceof Error ? error.message : String(error);
          showNotice("Codex åºç¨è·¯å¾", `æå¼éæ©å¨å¤±è´¥ï¼${message}`, "failed");
          return;
        }
        if (typeof selected === "string" && selected.trim()) {
          const result = await saveCodexAppPath(selected.trim());
          if (result) {
            showNotice("Codex åºç¨è·¯å¾", "åºç¨è·¯å¾å·²ä¿å­ï¼ä¹åå¯å¨ä¼èªå¨å¤ç¨ã?, result.status);
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
          showNotice("Codex åºç¨è·¯å¾", "å·²æ¸é¤ä¿å­è·¯å¾ï¼åç»­å¯å¨ä¼åå°èªå¨æ¢æµã?, result.status);
          await refreshOverview(true);
        }
      },
      chooseImageOverlayPath: async () => {
        let selected: unknown;
        try {
          selected = await open({
            directory: false,
            multiple: false,
            title: "éæ©è¦çå¾ç",
            filters: [{ name: "å¾ç", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          showNotice("å¾çè¦çå±?, `æå¼éæ©å¨å¤±è´¥ï¼${message}`, "failed");
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
          showNotice("Codex åºç¨è·¯å¾", "è¯·åå¡«åæéæ©åºç¨è·¯å¾ã?, "failed");
          return;
        }
        const result = await saveCodexAppPath(appPath);
        if (result) {
          showNotice("Codex åºç¨è·¯å¾", "åºç¨è·¯å¾å·²ä¿å­ï¼ä¹åå¯å¨ä¼èªå¨å¤ç¨ã?, result.status);
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
      refreshLiveContextEntries,
      syncLiveContextEntries,
      refreshScriptMarket,
      installMarketScript,
      setUserScriptEnabled,
      deleteUserScript,
      refreshLocalSessions,
      deleteLocalSession,
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
      copyLogs: () => copyText(logs?.text ?? "", "æ¥å¿å·²å¤å¶ã?),
      copyDiagnostics: () => copyText(diagnostics?.report ?? "", "è¯æ­æ¥åå·²å¤å¶ã?),
      goLogs: () => {},
      checkHealth: async () => {
        await refreshOverview(true);
        await refreshRelay(true);
        await refreshWatcher(true);
        showNotice("æ£æ¥å®æ?, "å·²å·æ?Codex åºç¨ãå¥å£å Watcher ç¶æã?, "ok");
      },
      installWatcher: () => watcherAction("install_watcher"),
      uninstallWatcher: () => watcherAction("uninstall_watcher"),
      enableWatcher: () => watcherAction("enable_watcher"),
      disableWatcher: () => watcherAction("disable_watcher"),
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
  );
  const hasUpdate = update?.updateAvailable === true;

  return (
    <div className={`shell ${theme}`}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">LDCodex</span>
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={(e) => { e.stopPropagation(); minimize(); }} title="æå°å">_</button>
          <button className="titlebar-btn" onClick={(e) => { e.stopPropagation(); maximize(); }} title="æå¤§å">&#x25A1;</button>
          <button className="titlebar-btn titlebar-close" onClick={(e) => { e.stopPropagation(); closeWindow(); }} title="å³é­">&#x2A2F;</button>
        </div>
      </header>
      <aside className="sidebar">

        <div className="brand">
          <div className="brand-mark"><img src="/logo.png" alt="LDCodex" className="brand-logo" style={{ background: "transparent" }} /></div>
          <div className="brand-copy">
            <div className="brand-title-row">
              <div className="brand-title">LDCodex</div>
            </div>
            <div className="brand-subtitle">ç®¡çæ§å¶å?/div>
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
            </button>
          );
          })}
        </nav>
        <div className="sidebar-footer">
          <span onClick={() => actions.openExternalUrl("https://Dicad.cn")} className="sidebar-footer-link">Dicad.cn</span>
          <div className="sidebar-footer-text">AIèµè½å·¥ç¨è®¾è®¡</div>
          <div className="sidebar-footer-en">LET IMAGINATION BECOME REALITY</div>
        </div>
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
              title={theme === "dark" ? "åæ¢å°æµè? : "åæ¢å°æ·±è?}
              variant="outline"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button onClick={() => void actions.restart()} title="éå¯ LDCodex" variant="outline">
              <Rocket className="h-4 w-4" />
              éå¯ LDCodex
            </Button>
            <Button onClick={() => void actions.refreshCurrent()} size="icon" title="å·æ°å½åé¡µé¢" variant="outline">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <section className="screen" key={route}>
          {route === "overview" ? (
            <OverviewScreen
              overview={overview}
              actions={actions}
            />
          ) : null}
          {route === "relay" ? (
            <RelayScreen
              settings={settings}
              relayFiles={relayFiles}
              form={settingsForm}
              onFormChange={setSettingsForm}
              actions={actions}
            />
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
            <EnhanceScreen form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}


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
          {route === "proxy" ? (
            <ProxyScreen
              overview={overview}
              launchForm={launchForm}
              onLaunchFormChange={onLaunchFormChange}
              actions={actions}
              settings={settings}
            />
          ) : null}
          {route === "about" ? <AboutScreen overview={overview} actions={actions} /> : null}
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
    </div>
  );
}

type Actions = {
  refreshCurrent: () => Promise<void>;
  launch: () => Promise<void>;
  restart: () => Promise<void>;
  repairBackend: () => Promise<void>;
  installEntrypoints: () => Promise<void>;
  uninstallEntrypoints: () => Promise<void>;
  repairShortcuts: () => Promise<void>;
  checkUpdate: () => Promise<void>;
  performUpdate: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveSettingsValue: (settings: BackendSettings, silent?: boolean) => Promise<void>;
  refreshSettings: (silent?: boolean) => Promise<BackendSettings | null>;
  resetSettings: () => Promise<void>;
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
  refreshLiveContextEntries: () => Promise<LiveContextEntriesResult | null>;
  syncLiveContextEntries: (settings: BackendSettings, silent?: boolean) => Promise<LiveContextEntriesResult | null>;
  refreshScriptMarket: () => Promise<void>;
  installMarketScript: (id: string) => Promise<void>;
  setUserScriptEnabled: (key: string, enabled: boolean) => Promise<void>;
  deleteUserScript: (key: string) => Promise<void>;
  refreshLocalSessions: () => Promise<LocalSessionsResult | null>;
  deleteLocalSession: (session: LocalSession) => Promise<void>;
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

function OverviewScreen({
  overview,
  actions,
}: {
  overview: OverviewResult | null;
  actions: Actions;
}) {
  const health = healthItems(overview);
  return (
    <>

      <Panel>
        <CardHead title="å¥åº·æ£æ? detail="æ¦è§åªå±ç¤ºå³é®é®é¢ï¼å·ä½éç½®å¨å¯¹åºé¡µé¢å¤ç? />
        <CardContent>
          <div className="health-grid">
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
              æ£æ?
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>
              <Wrench className="h-4 w-4" />
              ä¿®å¤å¥å£
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>
              ä¿®å¤åç«¯
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="ä»£çæå¡å¨å¯å¨ç¶æ? detail={overview?.logs_path ?? "ææ ç¶ææä»?} />
        <CardContent>
          <LatestLaunch status={overview?.latest_launch ?? null} />
          <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              å¯å¨ LDCodex
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              æå¼å³äº
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
  form,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  relayFiles: RelayFilesResult | null;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const normalized = normalizeSettings(form);
  const [detailProfileId, setDetailProfileId] = useState<string | null>(null);
  const [newProfileDraft, setNewProfileDraft] = useState<RelayProfile | null>(null);
  const detailProfile = newProfileDraft || (detailProfileId
    ? normalized.relayProfiles.find((profile) => profile.id === detailProfileId) || null
    : null);
  const isNewProfile = !!newProfileDraft;
  const saveRelaySettings = async (next: BackendSettings) => {
    onFormChange(next);
    await actions.saveSettingsValue(next, true);
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
        <CardHead title="ä¾åºååè¡? detail={`${normalized.relayProfiles.length} ä¸ªä¾åºåéç½®ï¼å¯æå¨æåºï¼ç¹ç¼è¾è¿å¥è¯¦æ`} />
        <CardContent>
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
              <strong>å¯ç¨ä¾åºåéç½®åæ?/strong>
              <small>å³é­åæ¬å·¥å·ä¸ä¼å¨æå¨åæ¢æ¶åå¥ Codex ç?config.toml / auth.jsonï¼å¯å?Codex æ¶å§ç»ä¸ä¼èªå¨æ¹è¿äºæä»¶ã?/small>
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
              æ·»å ä¾åºå?
            </Button>
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

function EnhanceScreen({
  form,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const setEnhanceFlag = (key: keyof BackendSettings, value: boolean) => onFormChange({ ...form, [key]: value });
  const masterEnabled = form.enhancementsEnabled;
  const patchMode = form.launchMode === "patch";
  return (
    <>
      <Panel>
        <CardHead title="é¡µé¢åè½å¢å¼º" detail="ä¼è¯å é¤ãå¯¼åºãé¡¹ç®ç§»å¨ãTimeline åç¨æ·èæ¬ç­çé¢è½å" />
        <CardContent>
          <label className="switch-row">
            <input
              checked={form.enhancementsEnabled}
              onChange={(event) => onFormChange({ ...form, enhancementsEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>å¯ç¨ LDCodex é¡µé¢å¢å¼º</strong>
              <small>å³é­åä¼åç¨å é¤ãå¯¼åºãé¡¹ç®ç§»å¨ãTimelineãæä»¶ç¸å³åèåä½ç½®å¢å¼ºã?/small>
            </span>
          </label>
          <label className="switch-row">
            <input
              checked={form.computerUseGuardEnabled}
              onChange={(event) => onFormChange({ ...form, computerUseGuardEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>å¯ç¨ Windows Computer Use Guard</strong>
              <small>é»è®¤å³é­ï¼å¼å¯åå¯å¨ Codex æ¶ä¼èªå¨ä¿çå®æ¹ Computer Use æä»¶æéç?config.tomlãbundled æä»¶å?notify éç½®ã?/small>
            </span>
          </label>
          <ModeSelector launchMode={form.launchMode} actions={actions} />
          {form.launchMode === "relay" ? (
            <div className="hint-line">
              <ShieldCheck className="h-4 w-4" />
              <span>å½åä¸ºå¼å®¹å¢å¼ºæ¨¡å¼ï¼æä»¶å¸åºè§£éãå¼ºå¶è§£éå¥å£åç¹æ®æä»¶å¼ºå¶å®è£ä¸ä¼å¯ç¨ï¼å¶ä»é¡µé¢åè½ä»å¯ç¨ã?/span>
            </div>
          ) : null}
          <div className="feature-switch-grid">
            <FeatureToggle title="æä»¶å¸åºè§£é" detail="API Key æ¨¡å¼ä¸æ©å±æä»¶å¸åºè¯·æ±ï¼å°½éæ¾ç¤ºå®æ´æä»¶åè¡¨ï¼å®æ?æ··åæ¨¡å¼éå¸¸ä¸éè¦ã? checked={form.codexAppPluginMarketplaceUnlock} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppPluginMarketplaceUnlock", value)} />
            <FeatureToggle title="å¼ºå¶è§£éå¥å£" detail="æ¢å¤ 1.1.9 çå¥å£è§£éæ¹å¼ï¼å¼ºå¶æ¾ç¤ºå¹¶å¯ç¨æä»¶å¥å£ã? checked={form.codexAppPluginEntryUnlock} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppPluginEntryUnlock", value)} />
            <FeatureToggle title="ç¹æ®æä»¶å¼ºå¶å®è£" detail="è§£é¤ App unavailable / åºç¨ä¸å¯ç¨å¯¼è´çåç«¯å®è£ç¦ç¨ã? checked={form.codexAppForcePluginInstall} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppForcePluginInstall", value)} />
            <FeatureToggle title="æ¨¡åç½ååè§£é? detail="ä»ç¯å¢åéå config.toml ç?/v1/models æåæ¨¡åå¹¶è¡¥è¿æ¨¡ååè¡¨ã? checked={form.codexAppModelWhitelistUnlock} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppModelWhitelistUnlock", value)} />
            <FeatureToggle title="Fast æé®" detail="æ¾ç¤ºæå¡æ¨¡å¼åæ¢æé®ï¼Fast ä»æ¯æ?gpt-5.4 / gpt-5.5ï¼å¶ä»æ¨¡åæ Standard åéã? checked={form.codexAppServiceTierControls} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppServiceTierControls", value)} />
            <FeatureToggle title="ä¼è¯å é¤" detail="å¨ä¼è¯åè¡¨æ¬åæ¾ç¤ºå é¤æé®ï¼å¹¶æ¯ææ¤éã? checked={form.codexAppSessionDelete} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppSessionDelete", value)} />
            <FeatureToggle title="Markdown å¯¼åº" detail="å¨ä¼è¯åè¡¨æ¾ç¤ºå¯¼åºæé®ï¼å¯¼åºå¸¦æ¶é´æ³ç?Markdownã? checked={form.codexAppMarkdownExport} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppMarkdownExport", value)} />
            <FeatureToggle title="ä¼è¯é¡¹ç®ç§»å¨" detail="æä¼è¯ç§»å¨å°æ®éå¯¹è¯æå¶ä»æ¬å°é¡¹ç®ã? checked={form.codexAppProjectMove} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppProjectMove", value)} />
            <FeatureToggle title="å¯¹è¯ Timeline" detail="å¨å¯¹è¯å³ä¾§æ¾ç¤ºç¨æ·æé®æ¶é´çº¿ï¼æ¯ææè¦åè·³è½¬ã? checked={form.codexAppConversationTimeline} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppConversationTimeline", value)} />
            <FeatureToggle title="å¯¹è¯å±ä¸­å®½åº¦" detail="æä¸»å¯¹è¯åè¾å¥æ¡éå¶å°åºå®æå¤§å®½åº¦ï¼éåå¤§å±éè¯»ã? checked={form.codexAppConversationView} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppConversationView", value)} />
            <FeatureToggle title="åæ¢å¯¹è¯ä¿çä½ç½®" detail="åæ¢ thread æ¶æ¢å¤ä¸ä¸æ¬¡æµè§ä½ç½®ã? checked={form.codexAppThreadScrollRestore} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppThreadScrollRestore", value)} />
            <FeatureToggle title="Upstream worktree" detail="ä»ææ?upstream åæ¯åå»º Git worktreeã? checked={form.codexAppUpstreamWorktreeCreate} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppUpstreamWorktreeCreate", value)} />
            <FeatureToggle title="åçèåæ ä½ç½? detail="æ?LDCodex èåæå¥ Codex é¡¶é¨åçèåæ ã? checked={form.codexAppNativeMenuPlacement} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppNativeMenuPlacement", value)} />
          </div>
          <div className="hint-line">
            <Info className="h-4 w-4" />
            <span>å¦æä½¿ç¨å®æ¹æ¨¡å¼æå®æ¹æ··å?API æ¨¡å¼ï¼éå¸¸ä¸éè¦å¼å¯æä»¶å¸åºè§£éãå¼ºå¶è§£éå¥å£åç¹æ®æä»¶å¼ºå¶å®è£ã?/span>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>ä¿å­å¢å¼ºè®¾ç½®</Button>
          </Toolbar>
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
  return (
    <>
      <Panel>
        <CardHead title="ä¼è¯ç®¡ç" detail="è¯»å Codex æ¬å° SQLite ä¼è¯åºï¼ä¼å é¤æ°æ®åºè®°å½åå¯¹åº?rollout æä»¶" />
        <CardContent>
          <div className="metric-list">
            <Metric label="ä¼è¯æ»æ°" value={`${items.length} ä¸ª`} />
            <Metric label="æªå½æ¡? value={`${activeCount} ä¸ª`} />
            <Metric label="å·²å½æ¡? value={`${archivedCount} ä¸ª`} />
            <Metric label="æ°æ®åº? value={sessions?.dbPath ?? "~/.codex/sqlite/*.db"} />
          </div>
          <div className="form-row">
            <Field label="åæ­¥ç®æ ">
              <select
                className="select-input"
                disabled={providerSyncProgress.active || !(providerSyncTargets?.targets ?? []).length}
                value={selectedProviderSyncTarget}
                onChange={(event) => actions.setProviderSyncTarget(event.currentTarget.value)}
              >
                {(providerSyncTargets?.targets ?? []).map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.id}ï¼{providerSyncTargetLabel(target)}ï¼?
                  </option>
                ))}
                {!(providerSyncTargets?.targets ?? []).length ? <option value="">å½åéç½® provider</option> : null}
              </select>
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshLocalSessions()}>
              <RefreshCw className="h-4 w-4" />
              å·æ°ä¼è¯
            </Button>
            <Button disabled={providerSyncProgress.active} onClick={() => void actions.syncProvidersNow()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              {providerSyncProgress.active ? "æ­£å¨ä¿®å¤â? : "ç«å»ä¿®å¤åå²ä¼è¯"}
            </Button>
          </Toolbar>
          <div className="provider-sync-progress" data-active={providerSyncProgress.active}>
            <div className="provider-sync-progress-head">
              <strong>{providerSyncProgress.active ? "æ­£å¨ä¿®å¤åå²ä¼è¯" : "åå²ä¼è¯ä¿®å¤è¿åº¦"}</strong>
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
            <span>å é¤ä¼åå»ºæ¬å°å¤ä»½ï¼å¦æ Codex App æ­£å¨ä½¿ç¨è¯¥ä¼è¯ï¼å»ºè®®åå³é­å¯¹åºä¼è¯çªå£åæä½ã?/span>
          </div>
          <label className="switch-row">
            <input
              checked={form.providerSyncEnabled}
              onChange={(event) => onFormChange({ ...form, providerSyncEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>å¯å¨åèªå¨ä¿®å¤åå²ä¼è¯?/strong>
              <small>å¼å¯åï¼éè¿ LDCodex å¯å¨ Codex åèªå¨æ´çä¸æ¬¡æ§å¯¹è¯çå½å±æ è®°ã?/small>
            </span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>ä¿å­èªå¨ä¿®å¤è®¾ç½®</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="æ¬å°ä¼è¯" detail={items.length ? "ææ´æ°æ¶é´ååºæ¾ç¤º" : "ç¹å»å·æ°ä¼è¯è¯»åæ¬å°æ°æ®åº?} />
        <CardContent>
          {items.length ? (
            <div className="session-list">
              {items.map((session) => (
                <div className="session-row" key={session.id}>
                  <div className="session-main">
                    <strong>{session.title || "æªå½åä¼è¯?}</strong>
                    <span>{session.id}</span>
                    <small>{session.cwd || "æªè®°å½é¡¹ç®è·¯å¾?}</small>
                  </div>
                  <div className="session-meta">
                    <Badge status={session.archived ? "archived" : "ok"} />
                    <span>{session.modelProvider || "provider æªè®°å½?}</span>
                    <span>{formatTime(session.updatedAtMs ?? 0)}</span>
                  </div>
                  <Button variant="outline" onClick={() => void actions.deleteLocalSession(session)}>
                    <Trash2 className="h-4 w-4" />
                    å é¤
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">æªè¯»åå°æ¬å°ä¼è¯ï¼æå½å SQLite ä¼è¯åºä¸å­å¨ã?/div>
          )}
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
        <CardHead title="æ£æ¥ä¸ä¿®å¤" detail="æ£æ¥å¥å£ãCodex åºç¨å?Watcher ç¶æ? />
        <CardContent>
          <div className="status-table">
            <StatusRow title="Codex åºç¨" status={overview?.codex_app.status} path={overview?.codex_app.path} />
            <StatusRow title="éé»å¯å¨å¥å£" status={overview?.silent_shortcut.status} path={overview?.silent_shortcut.path} />
            <StatusRow title="ç®¡çæ§å¶å°å¥å? status={overview?.management_shortcut.status} path={overview?.management_shortcut.path} />
            <StatusRow title="Watcher èªå¨æ¥ç®¡" status={watcher?.enabled ? "ok" : "disabled"} path={watcher?.disabled_flag} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.checkHealth()}>æ£æ?/Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>ä¿®å¤å¿«æ·æ¹å¼</Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>ä¿®å¤åç«¯</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="å¥å£ç®¡ç" detail="å¿«æ·æ¹å¼åå¥ç³»ç»å®éæ¡é¢ä½ç½®ï¼ä¸ä½¿ç¨åæ­»æ¡é¢è·¯å¾" />
        <CardContent>
          <label className="check-row">
            <input checked={removeOwnedData} onChange={(event) => onRemoveOwnedDataChange(event.currentTarget.checked)} type="checkbox" />
            <span>å¸è½½æ¶ç§»é?LDCodex æç®¡æ°æ®</span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.installEntrypoints()}>å®è£å¥å£</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallEntrypoints()}>å¸è½½å¥å£</Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>ä¿®å¤å¥å£</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="èªå¨æ¥ç®¡" detail="Watcher ç¨äºä¿æ LDCodex æ¥ç®¡ç¶æ? />
        <CardContent>
          <Toolbar>
            <Button variant="secondary" onClick={() => void actions.installWatcher()}>å®è£ watcher</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallWatcher()}>ç§»é¤ watcher</Button>
            <Button variant="secondary" onClick={() => void actions.enableWatcher()}>å¯ç¨</Button>
            <Button variant="secondary" onClick={() => void actions.disableWatcher()}>ç¦ç¨</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex åºç¨è·¯å¾" detail="åå®è£çæè§£åçåªéè¦éæ©ä¸æ¬¡ï¼ä¹åéé»å¯å¨ä¼èªå¨å¤ç? />
        <CardContent>
          <div className="status-table">
            <StatusRow title="ä¿å­è·¯å¾" status={savedCodexAppPath ? "ok" : "not_checked"} path={savedCodexAppPath || null} />
            <StatusRow title="å½åè¯å«" status={overview?.codex_app.status} path={overview?.codex_app.path} />
          </div>
          <Field label="ä¿å­çåºç¨è·¯å¾?>
            <Input
              value={settings?.settings.codexAppPath ?? ""}
              placeholder="éæ© Codex.exeãCodex.appãapp ç®å½æè§£åç®å½?
              readOnly
            />
          </Field>
          <Toolbar>
            <Button onClick={() => void actions.chooseCodexAppPath("folder")}>éæ©åºç¨ç®å½</Button>
            <Button variant="secondary" onClick={() => void actions.chooseCodexAppPath("file")}>éæ© Codex.exe</Button>
            <Button variant="secondary" onClick={() => void actions.clearCodexAppPath()}>æ¸é¤ä¿å­è·¯å¾</Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}
function ProxyScreen({
  overview,
  launchForm,
  onLaunchFormChange,
  actions,
  settings,
}: {
  overview: OverviewResult | null;
  launchForm: { appPath: string; debugPort: string; helperPort: string };
  onLaunchFormChange: (next: { appPath: string; debugPort: string; helperPort: string }) => void;
  actions: Actions;
  settings: SettingsResult | null;
}) {
  const savedCodexAppPath = settings?.settings.codexAppPath ?? "";
  return (
    <>
      <Panel>
        <CardHead title="ä»£çæå¡å? detail="ä»£çæå¡å¨å¯å¨ç¶æä¸éç½®" />
        <CardContent>
          <LatestLaunch status={overview?.latest_launch ?? null} />
          <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              å¯å¨ LDCodex
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              æå¼å³äº
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="æå¨å¯å¨" detail="åºç¨è·¯å¾çç©ºæ¶ä½¿ç¨å·²ä¿å­è·¯å¾ï¼æ²¡æä¿å­è·¯å¾æ¶ä½¿ç¨èªå¨æ¢æµ" />
        <CardContent>
          <Field label="åºç¨è·¯å¾è¦ç">
            <Input
              value={launchForm.appPath}
              onChange={(event) => onLaunchFormChange({ ...launchForm, appPath: event.currentTarget.value })}
              placeholder={savedCodexAppPath || "ä¾å¦ C:\\Program Files\\WindowsApps\\OpenAI.Codex...\\app"}
            />
          </Field>
          <div className="form-row">
            <Field label="Debug ç«¯å£">
              <Input
                value={launchForm.debugPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, debugPort: event.currentTarget.value })}
              />
            </Field>
            <Field label="Helper ç«¯å£">
              <Input
                value={launchForm.helperPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, helperPort: event.currentTarget.value })}
              />
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.launch()}>å¯å¨ LDCodex</Button>
            <Button variant="secondary" onClick={() => void actions.saveManualCodexAppPath()}>
              ä¿å­ä¸ºé»è®¤è·¯å¾?
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}


function AboutScreen({
  overview,
  actions,
}: {
  overview: OverviewResult | null;
  actions: Actions;
}) {
  return (
    <>
      <Panel>
        <CardHead title="å³äº LDCodex" detail="æ¬å° Codex å¢å¼ºåç®¡çå·¥å? />
        <CardContent>
          <div className="metric-list">
            <Metric label="LDCodex çæ¬" value={overview?.current_version ?? "-"} />
          </div>
        </CardContent>
      </Panel>
      <Panel>
        <CardContent>
          <div className="about-footer">
            <span onClick={() => actions.openExternalUrl("https://Dicad.cn")} className="about-footer-link">Dicad.cn</span>
            <div className="about-footer-text">AIèµè½å·¥ç¨è®¾è®¡</div>
            <div className="about-footer-en">LET IMAGINATION BECOME REALITY</div>
          </div>
        </CardContent>
      </Panel>
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
        <CardHead title="åºç¡è®¾ç½®" detail={settings?.settings_path ?? ""} />
        <CardContent>
          <div className="theme-row">
            <div>
              <strong>çé¢ä¸»é¢</strong>
              <span>å½åä¸º{theme === "dark" ? "æ·±è²" : "æµè²"}æ¨¡å¼ã?/span>
            </div>
            <Button variant="secondary" onClick={actions.toggleTheme}>åæ¢ä¸»é¢</Button>
          </div>
          <Field label="ä¾åºåæµè¯æ¨¡å?>
            <Input
              value={form.relayTestModel}
              onChange={(event) => onFormChange({ ...form, relayTestModel: event.currentTarget.value })}
              placeholder="ä¾å¦ gpt-5.4-mini"
            />
          </Field>
          <label className="check-row">
            <input
              checked={form.cliWrapperEnabled}
              onChange={(event) => onFormChange({ ...form, cliWrapperEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>å¯ç¨ Codex å½ä»¤åè£å?/span>
          </label>
          <div className="form-row">
            <Field label="åè£å?Base URL">
              <Input
                value={form.cliWrapperBaseUrl}
                onChange={(event) => onFormChange({ ...form, cliWrapperBaseUrl: event.currentTarget.value })}
              />
            </Field>
            <Field label="API Key ç¯å¢åé">
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
              <span>å¯ç¨ Codex å¾çè¦çå±?/span>
            </label>
            <div className="form-row">
              <Field label="è¦çå¾ç">
                <Input
                  value={form.codexAppImageOverlayPath}
                  onChange={(event) => onFormChange({ ...form, codexAppImageOverlayPath: event.currentTarget.value })}
                  placeholder="éæ© png / jpg / webp / gif / bmp"
                />
              </Field>
              <Toolbar>
                <Button variant="secondary" onClick={() => void actions.chooseImageOverlayPath()}>
                  éæ©å¾ç
                </Button>
              </Toolbar>
            </div>
            <Field label={`éæåº?${form.codexAppImageOverlayOpacity}%`}>
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
            <Button onClick={() => void actions.saveSettings()}>ä¿å­è®¾ç½®</Button>
            <Button variant="secondary" onClick={() => void actions.resetSettings()}>
              éç½®è®¾ç½®
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex å¯å¨åæ°" detail="å¯å¨ Codex App æ¶è¿½å å°é»è®¤ CDP åæ°åãçç©ºåä¿æé»è®¤å¯å¨è¡ä¸ºã? />
        <CardContent>
          <Field label="é¢å¤åæ°">
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
          <p className="field-hint">æ¯è¡ä¸ä¸ªåæ°ï¼ä¾å¦ --force_high_performance_gpuãä¸éè¦å¡«å?open æ?--argsã?/p>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>ä¿å­è®¾ç½®</Button>
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
      <CardHead title="æè¿æ¥å¿? detail={logs?.path ?? ""} />
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
            <div className="empty">ææ æ¥å¿ã?/div>
          )}
        </div>
        <Toolbar>
          <Button onClick={() => void actions.refreshLogs()}>å·æ°</Button>
          <Button variant="secondary" onClick={() => void actions.copyLogs()}>
            å¤å¶
          </Button>
        </Toolbar>
      </CardContent>
    </Panel>
  );
}

function DiagnosticsPanel({ diagnostics, actions }: { diagnostics: DiagnosticsResult | null; actions: Actions }) {
  return (
    <Panel>
      <CardHead title="è¯æ­æ¥å" detail="åå«çæ¬ãè·¯å¾ãè®¾ç½®åå¹³å°ä¿¡æ¯" />
      <CardContent>
        <Textarea className="log-view tall" readOnly value={diagnostics?.report ?? "å°æªçæè¯æ­æ¥åã?} />
        <Toolbar>
          <Button onClick={() => void actions.refreshDiagnostics()}>éæ°çæ</Button>
          <Button variant="secondary" onClick={() => void actions.copyDiagnostics()}>
            å¤å¶æ¥å
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
        aria-label="æå¨æåº"
        className="relay-drag"
        title="æå¨æåº"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="relay-index" title={profile.name || "æªå½åä¾åºå"}>
        {providerInitial(profile.name)}
      </span>
      <span className="relay-summary">
        <strong>{profile.name || "æªå½åä¾åºå"}</strong>
        <small>{relayModeLabel(profile.relayMode)} Â· {relayProtocolLabel(profile.protocol)} Â· {relayProfileConfigBrief(profile)}</small>
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
          title={disabled ? "ä¾åºååæ¢ä¸å¯ç¨" : active ? "å½åæ­£å¨ä½¿ç¨" : "è®¾ä¸ºå½å"}
          variant={active ? "secondary" : "outline"}
        >
          <CheckCircle2 className="h-4 w-4" />
          {active ? "ä½¿ç¨ä¸? : "ä½¿ç¨"}
        </Button>
        <span className="relay-card-extra">
          <Button
            onClick={(event) => {
              event.stopPropagation();
              void actions.testRelayProfile(profile);
            }}
            size="icon"
            title="åé?hi æµè¯"
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
            title="ç¼è¾"
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
            title="å¤å¶"
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
            title="å é¤ä¾åºå?
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
  const status = script.updateAvailable ? "å¯æ´æ? : script.installed ? `å·²å®è£?${script.installedVersion}` : "æªå®è£?;
  return (
    <div className="script-market-card">
      <div className="script-market-title">
        <div>
          <strong>{script.name}</strong>
          <span>{script.author || "æªç¥ä½è?}</span>
        </div>
        <UiBadge variant={script.updateAvailable ? "default" : script.installed ? "secondary" : "outline"}>{status}</UiBadge>
      </div>
      <p className="script-market-description">{script.description || "ææ æè¿°ã?}</p>
      <div className="script-market-tags">
        <span className="script-market-tag">v{script.version}</span>
        {script.tags.map((tag) => (
          <span className="script-market-tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="script-market-actions">
        <Button onClick={() => void actions.installMarketScript(script.id)} size="sm">
          <Download className="h-4 w-4" />
          {script.updateAvailable ? "æ´æ°" : script.installed ? "éæ°å®è£" : "å®è£"}
        </Button>
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
  const isActive = !isNew && profile.id === form.activeRelayId;
  useEffect(() => {
    setDraft(
      deriveRelayProfileFromFiles(
        isActive && relayFiles
          ? {
            ...profile,
            configContents: relayFiles.configContents,
            authContents: relayFiles.authContents,
          }
          : profile,
      ),
    );
  }, [profile.id, isActive, isNew, relayFiles?.configContents, relayFiles?.authContents]);
  const saveDraft = async () => {
    const normalizedDraft = deriveRelayProfileFromFiles(draft);
    const next = isNew
      ? addRelayProfile(form, normalizedDraft)
      : updateRelayProfile(form, profile.id, normalizedDraft);
    await onFormChange(next);
    if (isActive) {
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
    if (isNew || !form.relayProfilesEnabled || actions.relaySwitching) return;
    const normalizedDraft = deriveRelayProfileFromFiles(draft);
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
            è¿ååè¡¨
          </Button>
          <Button onClick={() => void saveDraft()}>
            <Save className="h-4 w-4" />
            ä¿å­
          </Button>
        </Toolbar>
      </div>
        <RelayProfileEditor profile={draft} form={form} isNew={isNew} onProfileChange={setDraft} onSwitch={switchDraft} actions={actions} />
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
      <CardHead title="Codex å·¥å·ä¸æä»? detail="ç¬ç«ç®¡ç Codex ç?MCPãSkillsãPluginsï¼åæ¢ä»»æä¾åºåé½ä¼å¸¦ä¸ã? />
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
}: {
  profile: RelayProfile;
  form: BackendSettings;
  isNew?: boolean;
  onProfileChange: (value: RelayProfile) => void;
  onSwitch: () => void;
  actions: Actions;
}) {
  const showApiFields = profile.relayMode !== "official" || profile.officialMixApiKey;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const updateDraft = (patch: Partial<RelayProfile>) => {
    onProfileChange(applyRelayProfilePatchToFiles(profile, patch, { allowGenerateFiles: isNew }));
  };
  return (
    <div className="relay-profile-editor">
      <div className="relay-editor-head">
        <div>
          <strong>{profile.name || "æªå½åä¾åºå"}</strong>
          <span>{relayProfileEditorStatus(profile, form, isNew)}</span>
        </div>
        {isNew ? null : (
          <Button
            disabled={!form.relayProfilesEnabled || actions.relaySwitching}
            onClick={onSwitch}
            title={!form.relayProfilesEnabled ? "ä¾åºåéç½®æ»å¼å³å·²å³é­" : actions.relaySwitching ? "ä¾åºååæ¢ä¸­" : undefined}
            variant={profile.id === form.activeRelayId ? "secondary" : "default"}
          >
            {actions.relaySwitching ? "åæ¢ä¸? : profile.id === form.activeRelayId ? "ä½¿ç¨ä¸? : "è®¾ä¸ºå½å"}
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
        <Field className="relay-field-name" label="åç§°">
          <Input
            value={profile.name}
            onChange={(event) => updateDraft({ name: event.currentTarget.value })}
          />
        </Field>
        <Field className="relay-field-mode" label="æ¥å¥æ¨¡å¼">
          <select
            className="field-select"
            value={profile.relayMode}
            onChange={(event) => {
              const relayMode = event.currentTarget.value as RelayMode;
              updateDraft(relayMode === "official" ? { relayMode, officialMixApiKey: false } : { relayMode });
            }}
          >
            <option value="official">å®æ¹ç»å½</option>
            <option value="pureApi">çº?API</option>
          </select>
        </Field>
        <Field className="relay-field-config-model" label="éç½®æ¨¡å">
          <Input
            value={profile.model}
            onChange={(event) => updateDraft({ model: event.currentTarget.value })}
            placeholder="åå¥ config.toml ç?model å­æ®µï¼ä¾å¦?gpt-5"
          />
        </Field>
        <Field className="relay-field-goals" label="Codex ç®æ ">
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
            <span>å¯ç¨ç®æ åè½</span>
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
            æ´å¤éé¡¹
          </Button>
        </div>
        {showAdvanced ? (
          <div className="relay-advanced-fields">
            <Field className="relay-field-test-model" label="æµè¯æ¨¡å">
              <Input
                value={profile.testModel}
                onChange={(event) => updateDraft({ testModel: event.currentTarget.value })}
                placeholder={`çç©ºä½¿ç¨é»è®¤ï¼?{form.relayTestModel || defaultSettings.relayTestModel}`}
              />
            </Field>
            <Field className="relay-field-context-window" label="ä¸ä¸æå¤§å°?>
              <Input
                inputMode="numeric"
                value={profile.contextWindow}
                onChange={(event) => updateDraft({ contextWindow: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="çç©ºä¸æ¹åï¼ä¾å¦ 200000"
              />
            </Field>
            <Field className="relay-field-auto-compact" label="åç¼©ä¸ä¸æå¤§å°?>
              <Input
                inputMode="numeric"
                value={profile.autoCompactLimit}
                onChange={(event) => updateDraft({ autoCompactLimit: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="çç©ºä¸æ¹åï¼ä¾å¦ 160000"
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
              <span>æ··å¥ API KEY</span>
            </label>
          </Field>
        ) : null}
        {showApiFields ? (
          <div className="relay-api-fields">
            <Field className="relay-field-base-url" label="Base URL">
              <Input
                value={profile.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
                placeholder="å¡«åä¸­è½¬æå¡ Base URL"
              />
            </Field>
            <Field className="relay-field-key" label="Key">
              <Input
                type="password"
                value={profile.apiKey}
                onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
                placeholder="è¾å¥ä¸­è½¬æå¡ç?API Key"
              />
            </Field>
            <Field className="relay-field-protocol" label="ä¸æ¸¸åè®®">
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
          <Field className="relay-field-model-list" label="æ¨¡ååè¡¨">
            <div className="relay-model-list-tools">
              <Textarea
                value={profile.modelList}
                onChange={(event) => updateDraft({ modelList: event.currentTarget.value })}
                placeholder="æ¯è¡ä¸ä¸ªæ¨¡åï¼ä¾å¦ qwen3-coder"
              />
              <Button
                onClick={async () => {
                  const models = await actions.fetchRelayProfileModels(profile);
                  if (models?.length) updateDraft({ modelList: models.join("\n") });
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Download className="h-4 w-4" />
                ä»ä¸æ¸¸è·å?
              </Button>
            </div>
          </Field>
        ) : null}
        {showApiFields ? (
          <Field className="relay-field-user-agent" label="User-Agent">
            <Input
              value={profile.userAgent}
              onChange={(event) => updateDraft({ userAgent: event.currentTarget.value })}
              placeholder="çç©ºä½¿ç¨é»è®¤å?
            />
          </Field>
        ) : null}
      </div>
      {showApiFields && profile.protocol === "chatCompletions" ? (
        <div className="hint-line relay-protocol-hint">
          <MessageCircle className="h-4 w-4" />
          <span>æ­¤ä¸æ¸¸ä¼éè¿æ¬å° 127.0.0.1:57321 è½¬æ Responses APIï¼éè¦ä» LDCodex å¯å¨ Codexã?/span>
        </div>
      ) : null}
      <div className="hint-line relay-protocol-hint">
        <ShieldCheck className="h-4 w-4" />
        <span>{relayProfileModeHelp(profile)}</span>
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
          <strong>Codex å·¥å·ä¸æä»?/strong>
          <span>MCPãSkillsãPlugins ä½ä¸ºå¨å±éç½®ç¬ç«ç®¡çï¼åæ¢ä»»æä¾åºåé½ä¼åå¹¶ã?/span>
        </div>
        <div className="relay-context-head-actions">
          <Button onClick={() => setEditor({ kind: activeKind })} size="sm" variant="secondary">
            <Plus className="h-4 w-4" />
            æ°å¢{label}
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
        å½åå±æ {visibleEntries.length} ä¸ª{label}ï¼è¿äºæ¡ç®ç¬ç«äºä¾åºåä¿å­ï¼ä¼åå¥ææä¾åºååæ¢åç config.tomlã?
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
                  title={entry.enabled ? "ç¦ç¨æ­¤æ©å±é¡¹" : "å¯ç¨æ­¤æ©å±é¡¹"}
                  type="button"
                >
                  <span className="context-switch-track" aria-hidden="true">
                    <span className="context-switch-thumb" />
                  </span>
                </button>
                <Button onClick={() => setEditor({ kind: entry.kind, entry })} size="icon" title="ç¼è¾æ©å±é¡? variant="ghost">
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  className="relay-context-delete"
                  onClick={() => void deleteEntry(entry)}
                  size="icon"
                  title="å é¤æ©å±é¡?
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">ææ {label}ï¼å¯ä»¥ä»éç¨éç½®æä»¶æè¿éæ°å¢ã?/div>
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
        <Field label="ç±»å">
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
            placeholder="ä¾å¦ context7"
          />
        </Field>
      </div>
      <Field label="TOML éç½®ä½?>
        <Textarea
          className="context-editor-textarea"
          value={tomlBody}
          onChange={(event) => setTomlBody(event.currentTarget.value)}
          placeholder={'åªå¡«åè¡¨å¤´ä¸é¢çåå®¹ï¼ä¾å¦ï¼\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]'}
          spellCheck={false}
        />
      </Field>
      <Toolbar>
        <Button disabled={!canSave} onClick={() => onSave(draftKind, id.trim(), tomlBody)} size="sm">
          <Save className="h-4 w-4" />
          ä¿å­æ©å±é¡?
        </Button>
        <Button onClick={onCancel} size="sm" variant="secondary">åæ¶</Button>
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
            <strong>config.toml é¢è§</strong>
            <span>{isActive ? "å½åä¾åºååæ¢åä¼åå¥çé¢è§ï¼ä¸ä¸æå¼å³ååä¼ç«å³åæ " : "åæ¢å°æ­¤ä¾åºåæ¶ä¼åå¥çé¢è§ï¼ä¸ä¸æå¼å³ååä¼ç«å³åæ "}</span>
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
            <strong>éç¨éç½®æä»¶</strong>
            <span>åªä¿çé MCPãSkillsãPlugins çè·¨ä¾åºåéç½®ï¼å·¥å·ä¸æä»¶å¨ç¬ç«é¡µé¢ç®¡çã?/span>
          </div>
          <Button
            onClick={async () => {
              const extracted = await actions.extractRelayCommonConfig(profile.configContents || "");
              if (!extracted) return;
              const split = splitContextConfigText(extracted.commonConfigContents || "");
              if (!split.common.trim() && !split.context.trim()) {
                await actions.showMessage("éç¨éç½®æä»¶", "å½åä¾åºå?config.toml éæ²¡æå¯æåçéç¨éç½®ã?, "failed");
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
            æåå½åä¾åºåéç½?
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
            <span>{isActive ? "å½åä½¿ç¨ä¸­ï¼æå¼æ¶ä» ~/.codex/auth.json åå¡«ï¼ä¿å­åä¼ä½ä¸ºæ­¤ä¾åºå?auth å­æ¡£" : "åæ¢å°æ­¤ä¾åºåæ¶ä¼åå?~/.codex/auth.json"}</span>
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
        <strong>å¼å®¹å¢å¼º</strong>
        <span>éåå®æ¹ç»å½æå®æ¹æ··å?API Keyï¼ä¿çä¼è¯å é¤ãå¯¼åºãé¡¹ç®ç§»å¨ãTimeline åç¨æ·èæ¬ï¼å³é­æä»¶å¥å£ç¸å³å¢å¼ºã?/span>
      </button>
      <button
        className={`mode-option ${launchMode === "patch" ? "active" : ""}`}
        onClick={() => void actions.setLaunchMode("patch")}
        type="button"
      >
        <strong>å®æ´å¢å¼º</strong>
        <span>éåçº?APIï¼å¯ç¨æä»¶å¥å£ãå¼ºå¶å®è£ãä¼è¯å é¤å¯¼åºãé¡¹ç®ç§»å¨ç­å¨é¨é¡µé¢è½åã?/span>
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
        <button className="toast-close" onClick={onClose} type="button">Ã</button>
      </div>
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
      <code>{path || "æªè®°å½è·¯å¾?}</code>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  return <UiBadge className={statusClass(status)} variant="secondary">{statusLabel(status)}</UiBadge>;
}

function LatestLaunch({ status }: { status: LaunchStatus | null }) {
  if (!status) return <div className="empty">ææ å¯å¨ç¶æã?/div>;
  return (
    <div className="metric-list">
      <Metric label="ç¶æ? value={status.status} />
      <Metric label="æ¶æ¯" value={status.message} />
      <Metric label="Debug" value={String(status.debug_port ?? "-")} />
      <Metric label="Helper" value={String(status.helper_port ?? "-")} />
      <Metric label="æ¶é´" value={formatTime(status.started_at_ms)} />
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
  const source = script.market_id ? `å¸åº Â· ${script.version || "æªç¥çæ¬"}` : script.source === "builtin" ? "åç½®" : "ç¨æ·";
  const canDelete = script.source === "user";
  return (
    <div className="table-row">
      <span>{script.name}</span>
      <span>{source}</span>
      <span>{script.enabled ? "å¯ç¨" : "å³é­"}</span>
      <span>{script.status}</span>
      <div className="script-row-actions">
        <Button onClick={() => void actions.setUserScriptEnabled(script.key, !script.enabled)} size="sm" variant="secondary">
          {script.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          {script.enabled ? "ç¦ç¨" : "å¯ç¨"}
        </Button>
        {canDelete ? (
          <Button onClick={() => void actions.deleteUserScript(script.key)} size="sm" variant="outline">
            <Trash2 className="h-4 w-4" />
            å é¤
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function routeTitle(route: Route) {
  return routes.find((item) => item.id === route)?.label ?? "æ¦è§";
}

function routeSubtitle(route: Route) {
  const subtitles: Record<Route, string> = {
    overview: "æ£æ¥é®é¢ãå¯å¨ä¸å¿«éä¿®å¤?,
    relay: "ç®¡ç API ä¾åºåãåè®®ãKey ä¸éç½®æä»?,
    sessions: "æ¥çãå é¤åä¿®å¤ Codex æ¬å°ä¼è¯",
    context: "ç¬ç«ç®¡ç MCPãSkillsãPlugins",
    enhance: "ä¼è¯å é¤ãå¯¼åºãé¡¹ç®ç§»å¨åèæ¬è½å",
    maintenance: "å¥å£å®è£ãä¿®å¤ãWatcher",
    proxy: "ä»£çæå¡å¨éç½®ä¸æå¨å¯å¨",
    about: "çæ¬ä¿¡æ¯",
    settings: "ä¸»é¢ãå½ä»¤åè£å¨åå¯å¨åæ?,
  };
  return subtitles[route];
}

const contextKindOptions: Array<{ kind: ContextKind; label: string; tableName: string }> = [
  { kind: "mcp", label: "MCP", tableName: "mcp_servers" },
  { kind: "skill", label: "Skills", tableName: "skills" },
  { kind: "plugin", label: "æä»¶", tableName: "plugins" },
];

function contextKindLabel(kind: ContextKind) {
  return contextKindOptions.find((option) => option.kind === kind)?.label ?? "æ©å±é¡?;
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
  return live ? { ...entry, enabled: live.enabled } : entry;
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
  if (isNew) return "æ°å»ºä¾åºåéè¦åä¿å­å°åè¡?;
  if (!form.relayProfilesEnabled) return "ä¾åºåéç½®æ»å¼å³å·²å³é­ï¼å½ååªä¿å­éç½®ï¼ä¸åå¥ Codex live æä»¶";
  return profile.id === form.activeRelayId ? "å½åæ­£å¨ä½¿ç¨" : "ç¼è¾åä¿å­åè¡¨ï¼ååæ¢æ¨¡å¼æ¶ä¼ä½¿ç¨æ°éç½®";
}

function providerInitial(name: string) {
  const trimmed = (name || "ä¾åºå?).trim();
  return Array.from(trimmed)[0]?.toUpperCase() || "ä¾?;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    found: "å·²æ¾å?,
    missing: "ç¼ºå¤±",
    installed: "å·²å®è£?,
    ok: "æ­£å¸¸",
    running: "è¿è¡ä¸?,
    failed: "å¤±è´¥",
    archived: "å·²å½æ¡?,
    accepted: "å·²åç?,
    not_checked: "æªæ£æ?,
    not_implemented: "æªå®ç?,
    disabled: "å·²ç¦ç?,
    unknown: "æªç¥",
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

function healthItems(overview: OverviewResult | null) {
  return [
    {
      title: "Codex åºç¨",
      status: overview?.codex_app.status ?? "not_checked",
      ok: overview?.codex_app.status === "found",
      detail: overview?.codex_app.path || "å°æªæ£æ?Codex åºç¨è·¯å¾ã?,
    },
    {
      title: "éé»å¯å¨å¥å£",
      status: overview?.silent_shortcut.status ?? "not_checked",
      ok: overview?.silent_shortcut.status === "installed",
      detail: overview?.silent_shortcut.path || "ç¼ºå° LDCodex éé»å¯å¨å¿«æ·æ¹å¼æ¶å¯å¨å®è£ç»´æ¤é¡µä¿®å¤ã?,
    },
    {
      title: "ç®¡çå·¥å·å¥å£",
      status: overview?.management_shortcut.status ?? "not_checked",
      ok: overview?.management_shortcut.status === "installed",
      detail: overview?.management_shortcut.path || "ç¼ºå°ç®¡çå·¥å·å¿«æ·æ¹å¼æ¶å¯å¨å®è£ç»´æ¤é¡µä¿®å¤ã?,
    },
  ];
}

function normalizeSettings(settings: BackendSettings): BackendSettings {
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
      ? settings.relayProfiles.map((profile) => normalizeRelayProfile(profile, defaultContextSelection))
      : [
          {
            id: settings.activeRelayId || "default",
            name: "é»è®¤ä¸­è½¬",
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
  let normalized: RelayProfile = {
    ...profile,
    model: profile.model || "",
    baseUrl: profile.baseUrl || defaultSettings.relayBaseUrl,
    upstreamBaseUrl: profile.upstreamBaseUrl || profile.baseUrl || "",
    apiKey: profile.apiKey || "",
    protocol: profile.protocol === "chatCompletions" ? "chatCompletions" : "responses",
    relayMode: normalizeRelayMode(profile.relayMode),
    officialMixApiKey: profile.officialMixApiKey === true || legacyMixedApi,
    testModel: profile.testModel || "",
    configContents: profile.configContents || "",
    authContents: profile.authContents || "",
    useCommonConfig: profile.useCommonConfig !== false,
    contextSelection: profile.contextSelectionInitialized
      ? normalizeContextSelection(profile.contextSelection)
      : normalizeContextSelection(undefined, defaultContextSelection),
    contextSelectionInitialized: true,
    contextWindow: profile.contextWindow || "",
    autoCompactLimit: profile.autoCompactLimit || "",
    modelList: profile.modelList || "",
    userAgent: profile.userAgent || "",
  };
  return deriveRelayProfileFromFiles(normalized);
}

function activeRelayProfile(settings: BackendSettings): RelayProfile {
  return (
    settings.relayProfiles.find((profile) => profile.id === settings.activeRelayId) ||
    settings.relayProfiles[0] ||
    defaultSettings.relayProfiles[0]
  );
}

function relayProtocolLabel(protocol: RelayProtocol): string {
  return protocol === "chatCompletions" ? "Chat Completions è½?Responses" : "Responses API";
}

function normalizeRelayMode(mode: RelayMode | undefined): RelayMode {
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
  if (mode === "pureApi") return "çº?API";
  return "å®æ¹ç»å½";
}

function relayProfileConfigBrief(profile: RelayProfile): string {
  if (profile.relayMode === "official") return profile.officialMixApiKey ? "æ··å¥ API Key" : "ä¸å API æä»¶";
  return profile.baseUrl || "æªå¡«å?URL";
}

function relayProfileModeHelp(profile: RelayProfile): string {
  if (profile.relayMode === "official") {
    if (profile.officialMixApiKey) {
      return "æ­¤ä¾åºåä¼ä¿çå®æ¹ç»å½æ¨¡å¼ï¼å¹¶æè¯·æ±æ··å¥å½å API Keyï¼é¡µé¢å¢å¼ºä»ä½¿ç¨å¼å®¹æ¨¡å¼ã?;
    }
    return "æ­¤ä¾åºåä¼ååå®æ¹ç»å½æ¨¡å¼ï¼ä½¿ç¨ ChatGPT å®æ¹è´¦å·ï¼ä¸åå¥ API Keyã?;
  }
  if (profile.relayMode === "pureApi") {
    return "æ­¤ä¾åºåä¼åæ¶åå?config.toml å?auth.jsonï¼API Key ä¹ä¼æ³¨å¥å?provider bearer tokenã?;
  }
  return "æ­¤ä¾åºåä¼ä¿çå®æ¹ç»å½æ¨¡å¼ï¼å¹¶æè¯·æ±æ··å¥å½å API Keyï¼é¡µé¢å¢å¼ºä»ä½¿ç¨å¼å®¹æ¨¡å¼ã?;
}

function relayProfileModeSwitchedText(profile: RelayProfile): string {
  if (profile.relayMode === "pureApi") return "å·²ææ­¤ä¾åºååæ¢å°çº¯ APIï¼é¡µé¢å¢å¼ºå·²è®¾ä¸ºå®æ´å¢å¼ºã?;
  if (profile.officialMixApiKey) return "å·²ææ­¤ä¾åºåä½¿ç¨å®æ¹ç»å½ï¼å¹¶æ··å¥ API Keyï¼é¡µé¢å¢å¼ºå·²è®¾ä¸ºå¼å®¹å¢å¼ºã?;
  return "å·²ææ­¤ä¾åºåååå®æ¹ç»å½ï¼é¡µé¢å¢å¼ºå·²è®¾ä¸ºå¼å®¹å¢å¼ºã?;
}

function withGeneratedRelayFiles(profile: RelayProfile): RelayProfile {
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
  const configContents = profile.configContents || "";
  const authContents = profile.relayMode === "official" ? buildOfficialRelayAuthJson(profile.authContents || "") : profile.authContents || "";
  const configBaseUrl = codexBaseUrlFromConfig(configContents);
  const chatUpstreamBaseUrl = rootTomlStringValue(configContents, CHAT_UPSTREAM_BASE_URL_KEY);
  const isProxyConfig = configBaseUrl === PROTOCOL_PROXY_BASE_URL;
  const upstreamBaseUrl = profile.upstreamBaseUrl || chatUpstreamBaseUrl || (configBaseUrl && !isProxyConfig ? configBaseUrl : profile.baseUrl || "");
  const configApiKey = codexExperimentalBearerTokenFromConfig(configContents);
  return {
    ...profile,
    model: codexModelFromConfig(configContents),
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
  const shouldHaveFiles =
    next.relayMode !== "official" || next.officialMixApiKey || next.configContents.trim() || next.authContents.trim();
  const needsAuthFile = next.relayMode === "pureApi";
  if (options.allowGenerateFiles && shouldHaveFiles && (!next.configContents.trim() || (needsAuthFile && !next.authContents.trim()))) {
    next = withGeneratedRelayFiles(next);
  }

  if ("model" in patch) {
    next.configContents = setRootTomlStringKey(next.configContents, "model", patch.model || "");
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
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return null;
  if (!profile.configContents.trim()) {
    return `ä¾åºåã?{profile.name || profile.id}ãç¼ºå°ç¬ç«?config.tomlï¼å·²åæ­¢åæ¢ï¼é¿åç»§ç»­æ¾ç¤ºä¸ä¸å¥éç½®æä»¶ãè¯·åå¨è¯¥ä¾åºåè¯¦æéä¿å­?config.tomlã`;
  }
  if (profile.relayMode !== "official" || !authJsonHasOpenAiApiKey(profile.authContents)) return null;
  return "å®æ¹æ··å API ä¸åºå?auth.json ä¸­ä¿å­?OPENAI_API_KEYãè¯·æ¸çæ­¤ä¾åºåç?auth.json åååæ¢ã?;
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
  const relayProfiles = settings.relayProfiles.map(deriveRelayProfileFromFiles);
  const active = activeRelayProfile({ ...settings, relayProfiles });
  return {
    ...settings,
    relayProfiles,
    activeRelayId: active.id,
    relayBaseUrl: active.baseUrl,
    relayApiKey: active.apiKey,
  };
}

function updateRelayProfile(settings: BackendSettings, id: string, patch: Partial<RelayProfile>): BackendSettings {
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
    name: `ä¾åºå?${settings.relayProfiles.length + 1}`,
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
    userAgent: "",
  };
  return withGeneratedRelayFiles(next);
}

function addRelayProfile(settings: BackendSettings, profile: RelayProfile): BackendSettings {
  const nextWithFiles = deriveRelayProfileFromFiles(
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
    name: `${source.name || "æªå½åä¾åºå"} å¯æ¬`,
  };
  const relayProfiles = [...settings.relayProfiles];
  relayProfiles.splice(sourceIndex >= 0 ? sourceIndex + 1 : relayProfiles.length, 0, next);
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
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: profiles.length ? profiles : defaultSettings.relayProfiles,
    activeRelayId: settings.activeRelayId === id ? profiles[0]?.id || "default" : settings.activeRelayId,
  });
}

function numberOrDefault(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitLogLines(text: string) {
  return text.trimEnd().split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

function zedStrategyLabel(strategy: ZedOpenStrategy) {
  if (strategy === "reuseWindow") return "å¤ç¨çªå£";
  if (strategy === "newWindow") return "æ°çªå?;
  if (strategy === "default") return "Zed é»è®¤è¡ä¸º";
  return "å å¥å½åå·¥ä½å?;
}

function zedRemoteHostLabel(project: ZedRemoteProject) {
  const user = project.ssh.user ? `${project.ssh.user}@` : "";
  const port = project.ssh.port ? `:${project.ssh.port}` : "";
  return `${user}${project.ssh.host}${port}`;
}

function zedRemoteSourceLabel(source: string) {
  if (source === "currentThread") return "å½åä¼è¯";
  if (source === "codexRemoteProject") return "Codex remote project";
  if (source === "threadWorkspaceHint") return "Thread workspace hint";
  if (source === "sqliteThreadCwd") return "SQLite cwd";
  if (source === "recent") return "æè¿æå¼";
  return source || "æªç¥æ¥æº";
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
  if (mins < 1) return "ååå¯å¨";
  if (mins < 60) return `å·²è¿è¡?${mins} åé`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `å·²è¿è¡?${hours} å°æ¶ ${remainMins} åé`;
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


