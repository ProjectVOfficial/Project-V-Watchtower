import type { AppContext, AppModule } from '@/app/app-context';
import type { RelatedAsset } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import {
  MapContainer,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  EconomicPanel,
  GdeltIntelPanel,
  LiveNewsPanel,
  LiveWebcamsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  TechEventsPanel,
  ServiceStatusPanel,
  RuntimeConfigPanel,
  InsightsPanel,
  TechReadinessPanel,
  MacroSignalsPanel,
  ETFFlowsPanel,
  StablecoinPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  InvestmentsPanel,
  TradePolicyPanel,
  SupplyChainPanel,
  SecurityAdvisoriesPanel,
  OrefSirensPanel,
  TelegramIntelPanel,
  GulfEconomiesPanel,
  WorldClockPanel,
  PluginPanel,
  CommandAssistantPanel,
  ResearchLibraryPanel,
  AlertCenterPanel,
  AlertRulesPanel,
  WatchlistsPanel,
  EventTimelinePanel,
  SourceHealthPanel,
  CommunicationsWallPanel,
  SourceBrowserPanel,
  CaseStatusPanel,
  DataLibraryPanel,
  MapOperationsPanel,
  LaunchDeckPanel,
  CameraWallPanel,
  LiveLanguagePanel,
  AirOperationsPanel,
  MultiAgentResearchPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import { CountersPanel } from '@/components/CountersPanel';
import { ProgressChartsPanel } from '@/components/ProgressChartsPanel';
import { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import { SpeciesComebackPanel } from '@/components/SpeciesComebackPanel';
import { RenewableEnergyPanel } from '@/components/RenewableEnergyPanel';
import { GivingPanel } from '@/components';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { debounce, saveToStorage } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { getCurrentWatchtowerUiTheme, setWatchtowerUiTheme, type WatchtowerUiTheme } from '@/utils/theme-manager';
import {
  FEEDS,
  INTEL_SOURCES,
  DEFAULT_PANELS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { t } from '@/services/i18n';
import { trackCriticalBannerAction } from '@/services/analytics';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import {
  RUNTIME_FEATURES,
  isFeatureAvailable,
  isFeatureEnabled,
  isLocalRuntimeConfigEnabled,
  subscribeRuntimeConfig,
} from '@/services/runtime-config';
import { DeckEditorController } from '@/app/deck-editor';
import {
  DECK_WORKSPACES,
  DeckWorkspaceManager,
  type DeckWorkspaceDefinition,
  type DeckWorkspaceId,
  type DeckPresetId,
  DECK_PRESETS,
} from '@/app/deck-workspaces';
import {
  MISSION_PROFILES,
  getMissionProfile,
  isMissionProfileId,
  type MissionProfileId,
} from '@/app/mission-profiles';
import { PluginManagerController } from '@/app/plugin-manager';
import { ProjectVModuleRegistry, pluginPanelId } from '@/modules/plugin-registry';
import { ProjectVOperationsCenter } from '@/services/operations-center';
import { SecurityCenterController } from '@/app/security-center';
import { getSecuritySettings, initializeSecuritySession, isProjectVSafeModeActive, shouldRequireStartupAccessGate } from '@/services/security-center';
import { MapGeofenceMonitor } from '@/services/map-geofence-monitor';
import { VoiceCommandCenterController } from '@/app/voice-command-center';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import {
  PROJECT_V_BRIDGE_APPS,
  configureProjectVBridgeApp,
  disconnectProjectVBridgeApp,
  launchProjectVBridgeApp,
  listProjectVBridgeStatuses,
  subscribeProjectVBridge,
  type ProjectVBridgeAppId,
} from '@/services/project-v-app-bridge';
import {
  disconnectPhoenixBridge,
  getPhoenixBridgeSnapshot,
  pairPhoenixBridge,
  refreshPhoenixBridgeHealth,
  sendPhoenixBridgeTestAlert,
  setPhoenixBridgeAutoForward,
  setPhoenixBridgeMinimumSeverity,
  subscribePhoenixBridge,
  type PhoenixBridgeMinimumSeverity,
} from '@/services/phoenix-ai-bridge';
import type { MapPopupIntelligenceItem } from '@/services/map-popup-intelligence';
import { installLiveLanguageOpenBridge, mountLiveLanguageOverlay } from '@/services/live-language';
import { WeatherOperationsPanel } from '@/components/WeatherOperationsPanel';

export interface PanelLayoutCallbacks {
  openCountryStory: (code: string, name: string) => void;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
  loadSecurityAdvisories?: () => Promise<void>;
}

const COMMAND_BAR_STORAGE_KEY = 'project-v-watchtower-command-bar-v1';
const MISSION_PROFILE_STORAGE_KEY = 'project-v-watchtower-mission-profile-v1';

const COMMAND_BAR_COMMANDS = [
  { id: 'history', label: 'HISTORY', description: 'Undo / redo layout changes' },
  { id: 'save', label: 'SAVE', description: 'Save the current desk layout' },
  { id: 'auto-arrange', label: 'AUTO ARRANGE', description: 'Pack visible modules without gaps' },
  { id: 'modules', label: 'MODULES', description: 'Open the module library' },
  { id: 'plugins', label: 'PLUGINS', description: 'Manage local extensions' },
  { id: 'apps', label: 'APPS', description: 'Open the Launch Deck' },
  { id: 'cameras', label: 'CAMERAS', description: 'Open Camera Wall' },
  { id: 'analysis', label: 'ANALYSIS', description: 'Open Analysis Room' },
  { id: 'osint', label: 'OSINT', description: 'Open public-source tools' },
  { id: 'alerts', label: 'ALERTS', description: 'Open Alert Center' },
  { id: 'voice', label: 'VOICE', description: 'Open voice command center' },
  { id: 'security', label: 'SECURITY', description: 'Open security controls' },
  { id: 'map-width', label: 'MAP WIDTH', description: 'Quick map-width selector' },
  { id: 'reset', label: 'RESET', description: 'Reset current desk layout' },
  { id: 'export', label: 'EXPORT', description: 'Export workspace layouts' },
  { id: 'import', label: 'IMPORT', description: 'Import workspace layouts' },
] as const;

type CommandBarCommandId = typeof COMMAND_BAR_COMMANDS[number]['id'];

const ESSENTIAL_COMMAND_BAR: readonly CommandBarCommandId[] = [
  'modules',
  'apps',
  'cameras',
  'analysis',
  'osint',
  'alerts',
  'voice',
  'security',
];

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutCallbacks;
  private deckEditor: DeckEditorController | null = null;
  private criticalBannerEl: HTMLElement | null = null;
  private deckWorkspaces: DeckWorkspaceManager | null = null;
  private runtimeConfigCleanup: (() => void) | null = null;
  private readonly moduleRegistry = new ProjectVModuleRegistry();
  private pluginManager: PluginManagerController | null = null;
  private pluginRegistryCleanup: (() => void) | null = null;
  private operationsCenter: ProjectVOperationsCenter | null = null;
  private securityCenter: SecurityCenterController | null = null;
  private operationsUiCleanup: (() => void) | null = null;
  private mapIntelligenceCleanup: (() => void) | null = null;
  private mapGeofenceMonitor: MapGeofenceMonitor | null = null;
  private mapOperationsHandoffChannel: BroadcastChannel | null = null;
  private voiceCommandCenter: VoiceCommandCenterController | null = null;
  private commandDrawerCleanup: (() => void) | null = null;
  private commandPaletteCleanup: (() => void) | null = null;
  private liveLanguageOpenCleanup: (() => void) | null = null;
  private liveLanguageOverlayCleanup: (() => void) | null = null;
  private airOperationsOpenCleanup: (() => void) | null = null;
  private weatherOperationsPanel: WeatherOperationsPanel | null = null;
  private applyingMissionProfile = false;
  private readonly applyTimeRangeFilterDebounced: () => void;

  constructor(ctx: AppContext, callbacks: PanelLayoutCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.applyTimeRangeFilterDebounced = debounce(() => {
      this.applyTimeRangeFilterToNewsPanels();
    }, 120);
  }

  init(): void {
    initializeSecuritySession();
    if (shouldRequireStartupAccessGate()) document.body.classList.add('project-v-startup-gated');
    this.renderLayout();
  }

  destroy(): void {
    this.deckEditor?.destroy();
    this.deckEditor = null;
    if (this.criticalBannerEl) {
      this.criticalBannerEl.remove();
      this.criticalBannerEl = null;
    }
    this.deckWorkspaces?.destroy();
    this.deckWorkspaces = null;
    this.runtimeConfigCleanup?.();
    this.runtimeConfigCleanup = null;
    this.pluginManager?.destroy();
    this.pluginManager = null;
    this.pluginRegistryCleanup?.();
    this.pluginRegistryCleanup = null;
    this.operationsUiCleanup?.();
    this.operationsUiCleanup = null;
    this.mapIntelligenceCleanup?.();
    this.mapIntelligenceCleanup = null;
    this.mapGeofenceMonitor?.destroy();
    this.mapGeofenceMonitor = null;
    this.mapOperationsHandoffChannel?.close();
    this.mapOperationsHandoffChannel = null;
    this.voiceCommandCenter?.destroy();
    this.voiceCommandCenter = null;
    this.commandDrawerCleanup?.();
    this.commandDrawerCleanup = null;
    this.commandPaletteCleanup?.();
    this.commandPaletteCleanup = null;
    this.liveLanguageOpenCleanup?.();
    this.liveLanguageOpenCleanup = null;
    this.liveLanguageOverlayCleanup?.();
    this.liveLanguageOverlayCleanup = null;
    this.airOperationsOpenCleanup?.();
    this.airOperationsOpenCleanup = null;
    this.weatherOperationsPanel?.destroy();
    this.weatherOperationsPanel = null;
    this.operationsCenter?.destroy();
    this.operationsCenter = null;
    this.securityCenter?.destroy();
    this.securityCenter = null;
    // Clean up happy variant panels
    this.ctx.tvMode?.destroy();
    this.ctx.tvMode = null;
    this.ctx.countersPanel?.destroy();
    this.ctx.progressPanel?.destroy();
    this.ctx.breakthroughsPanel?.destroy();
    this.ctx.heroPanel?.destroy();
    this.ctx.digestPanel?.destroy();
    this.ctx.speciesPanel?.destroy();
    this.ctx.renewablePanel?.destroy();
  }

  renderLayout(): void {
    const mapTitle = SITE_VARIANT === 'tech'
      ? t('panels.techMap')
      : SITE_VARIANT === 'happy'
        ? 'Good News Map'
        : t('panels.map');

    this.ctx.container.innerHTML = `
      <header class="header v-command-header">
        <div class="header-left v-brand-zone">
          <button class="v-mark v-command-menu-trigger" id="vCommandMenuBtn" type="button" aria-label="Open Project V command menu" aria-expanded="false" aria-controls="vCommandDrawer" title="Open Project V command menu"><span>V</span></button>
          <div class="v-brand-copy">
            <div class="v-brand-line">
              <span class="logo">PROJECT V</span>
              <span class="v-product-name">WATCHTOWER</span>
              <span class="version">CORE v${__APP_VERSION__}</span>
              <span class="beta-badge">PRE-ALPHA</span>
            </div>
            <span class="v-brand-subtitle">PRIVATE SITUATIONAL INTELLIGENCE SYSTEM</span>
          </div>
          <nav class="v-primary-nav" aria-label="Primary workspaces">
            ${DECK_WORKSPACES.map((workspace) => `<button class="v-nav-item" type="button" data-deck-id="${workspace.id}" title="Open ${workspace.label} workspace">${workspace.label}</button>`).join('')}
            <button class="v-nav-item v-workspace-manager-nav" id="workspaceManagerBtn" type="button" title="Open workspace manager">DESKS ▾</button>
          </nav>
        </div>
        <div class="header-right v-header-right">
          <span class="header-clock" id="headerClock"></span>
          <button class="v-api-settings-btn" id="apiSettingsBtn" type="button" title="Open API keys and data-source configuration">
            <span class="v-api-settings-dot" aria-hidden="true"></span>
            <span class="v-api-settings-label">API KEYS</span>
            <span class="v-api-settings-count" id="apiSettingsCount">CHECK</span>
          </button>
          <div class="status-indicator v-local-status" title="Local-first operating mode">
            <span class="status-dot"></span>
            <span>LOCAL</span>
          </div>
          <button class="search-btn" id="searchBtn" type="button" title="Open Watchtower command palette"><kbd>CTRL K</kbd> COMMAND</button>
          ${this.ctx.isDesktopApp ? '' : `<button class="fullscreen-btn" id="fullscreenBtn" title="${t('header.fullscreen')}">⛶</button>`}
          <span id="unifiedSettingsMount"></span>
        </div>
      </header>

      <div class="v-opsbar">
        <div class="v-opsbar-left" aria-label="Operations toolbar">
          <span class="v-ops-label active">ANALYST</span>
          <span class="v-workspace-state"><strong id="workspaceTitle">WATCHTOWER</strong><span id="workspaceSubtitle">COMMAND OVERVIEW</span></span>
          <span class="v-ops-separator"></span>
          <span class="v-source-state"><span class="status-dot"></span> SOURCES ACTIVE</span>
        </div>
        <div class="v-opsbar-right">
          <label class="v-region-label" for="regionSelect">THEATER</label>
          <div class="region-selector">
            <select id="regionSelect" class="region-select">
              <option value="global">${t('components.deckgl.views.global')}</option>
              <option value="america">${t('components.deckgl.views.americas')}</option>
              <option value="mena">${t('components.deckgl.views.mena')}</option>
              <option value="eu">${t('components.deckgl.views.europe')}</option>
              <option value="asia">${t('components.deckgl.views.asia')}</option>
              <option value="latam">${t('components.deckgl.views.latam')}</option>
              <option value="africa">${t('components.deckgl.views.africa')}</option>
              <option value="oceania">${t('components.deckgl.views.oceania')}</option>
            </select>
          </div>
          <button class="v-deck-action-btn v-icon-action" id="deckUndoBtn" data-v-command-key="history" type="button" title="Undo last layout change" aria-label="Undo layout change">↶</button>
          <button class="v-deck-action-btn v-icon-action" id="deckRedoBtn" data-v-command-key="history" type="button" title="Redo layout change" aria-label="Redo layout change">↷</button>
          <div class="v-preset-control">
            <button class="v-deck-action-btn" id="layoutPresetBtn" type="button" aria-expanded="false" title="Open advanced workspace layout manager"><span id="layoutPresetLabel">LAYOUT: COMMAND</span> ▾</button>
            <div class="v-layout-preset-menu v-layout-manager-menu" id="layoutPresetMenu" role="menu" aria-label="Advanced workspace layout manager">
              <div class="v-layout-manager-head">
                <div>
                  <span>WORKSPACE LAYOUT</span>
                  <strong id="layoutManagerDeskName">WATCHTOWER</strong>
                  <small id="layoutManagerSummary">COMMAND · MAP COMMAND</small>
                </div>
                <div class="v-layout-manager-head-actions">
                  <div class="v-layout-manager-badges" aria-label="Workspace status">
                    <em id="layoutManagerKindBadge" title="Built-in Watchtower workspace status">CORE DESK</em>
                    <em id="layoutManagerDefaultBadge" title="This desk opens by default at startup" hidden>STARTUP DEFAULT</em>
                  </div>
                  <button class="v-layout-manager-close" id="layoutManagerCloseBtn" type="button" aria-label="Close layout manager" title="Close layout manager">×</button>
                </div>
              </div>

              <section class="v-layout-manager-section">
                <div class="v-layout-manager-section-title"><span>01</span> PRESETS</div>
                <div class="v-layout-manager-preset-grid">
                  ${DECK_PRESETS.map((preset) => `<button type="button" data-preset-id="${preset.id}"><strong>${preset.label}</strong><span>${preset.description}</span></button>`).join('')}
                </div>
              </section>

              <section class="v-layout-manager-section">
                <div class="v-layout-manager-section-title"><span>02</span> MAP WIDTH</div>
                <div class="v-layout-manager-map-grid">
                  <button type="button" data-layout-map-span="3"><strong>FULL</strong><span>12 columns</span></button>
                  <button type="button" data-layout-map-span="2"><strong>COMMAND</strong><span>8 columns</span></button>
                  <button type="button" data-layout-map-span="1"><strong>COMPACT</strong><span>6 columns</span></button>
                </div>
              </section>

              <section class="v-layout-manager-section">
                <div class="v-layout-manager-section-title"><span>03</span> CURRENT DESK</div>
                <div class="v-layout-manager-action-grid">
                  <button type="button" data-layout-action="save">SAVE NOW</button>
                  <button type="button" data-layout-action="auto-arrange">AUTO ARRANGE</button>
                  <button type="button" data-layout-action="edit">EDIT DECK</button>
                  <button type="button" data-layout-action="duplicate">DUPLICATE</button>
                  <button type="button" data-layout-action="new">NEW DESK</button>
                  <button type="button" data-layout-action="rename" id="layoutManagerRenameBtn">RENAME</button>
                  <button type="button" data-layout-action="default" id="layoutManagerDefaultBtn">SET DEFAULT</button>
                  <button type="button" data-layout-action="desks">MANAGE DESKS</button>
                </div>
              </section>

              <section class="v-layout-manager-section v-layout-manager-section-secondary">
                <div class="v-layout-manager-section-title"><span>04</span> PORTABILITY & RECOVERY</div>
                <div class="v-layout-manager-action-grid compact">
                  <button type="button" data-layout-action="export">EXPORT</button>
                  <button type="button" data-layout-action="import">IMPORT</button>
                  <button type="button" data-layout-action="reset" class="danger">RESET LAYOUT</button>
                </div>
              </section>
            </div>
          </div>
          <button class="v-deck-mode-btn" id="deckModeBtn" type="button" aria-pressed="false" title="Enable panel movement and resizing"></button>
          <button class="v-deck-action-btn" id="deckSaveBtn" data-v-command-key="save" type="button" title="Save the current workspace layout">SAVE</button>
          <button class="v-deck-action-btn" id="deckPackBtn" data-v-command-key="auto-arrange" type="button" title="Remove gaps and arrange all visible modules without overlap">AUTO ARRANGE</button>
          <button class="v-deck-action-btn v-module-library-btn" id="moduleLibraryBtn" data-v-command-key="modules" type="button" title="Open the module library">MODULES <span id="moduleLibraryCount">0</span></button>
          <button class="v-deck-action-btn v-plugin-manager-btn" id="pluginManagerBtn" data-v-command-key="plugins" type="button" title="Manage local Project V plugins">PLUGINS <span id="pluginManagerCount">0</span></button>
          <button class="v-deck-action-btn v-launch-deck-btn" id="launchDeckBtn" data-v-command-key="apps" type="button" title="Open approved desktop applications">APPS <span>OPEN</span></button>
          <button class="v-deck-action-btn v-camera-wall-btn" id="cameraWallBtn" data-v-command-key="cameras" type="button" title="Open the Project V camera monitoring wall">CAMERAS <span>WALL</span></button>
          <button class="v-deck-action-btn v-analysis-room-btn" id="analysisRoomBtn" data-v-command-key="analysis" type="button" title="Open the Project V local multi-agent Analysis Room">ANALYSIS <span>ROOM</span></button>
          <button class="v-deck-action-btn v-osint-desk-btn" id="osintDeskBtn" data-v-command-key="osint" type="button" title="Open the Project V public-source OSINT query desk">OSINT <span>TOOLS</span></button>
          <button class="v-deck-action-btn v-operations-alert-btn" id="operationsAlertBtn" data-v-command-key="alerts" type="button" title="Open the operational Alert Center">ALERTS <span id="operationsAlertCount">0</span></button>
          <button class="v-deck-action-btn v-voice-control-btn" id="voiceControlBtn" data-v-command-key="voice" type="button" title="Open push-to-talk voice control (Ctrl+Shift+V)">VOICE <span data-voice-header-state>READY</span></button>
          <button class="v-deck-action-btn v-security-center-btn" id="securityCenterBtn" data-v-command-key="security" type="button" title="Open Project V security, backup, network, and recovery controls">SECURITY <span>OPEN</span></button>
          <div class="v-map-layout-control" data-v-command-key="map-width">
            <button class="v-deck-action-btn" id="mapLayoutBtn" type="button" aria-expanded="false" title="Choose map width"><span id="mapLayoutLabel">MAP: FULL</span> ▾</button>
            <div class="v-map-layout-menu" id="mapLayoutMenu" role="menu">
              <button type="button" data-map-span="3">FULL WIDTH <span>12 columns</span></button>
              <button type="button" data-map-span="2">COMMAND <span>8 columns</span></button>
              <button type="button" data-map-span="1">COMPACT <span>6 columns</span></button>
            </div>
          </div>
          <button class="v-deck-action-btn" id="deckResetBtn" data-v-command-key="reset" type="button" title="Reset this workspace to its default layout">RESET</button>
          <button class="v-deck-action-btn" id="deckExportBtn" data-v-command-key="export" type="button" title="Export all workspace layouts">EXPORT</button>
          <button class="v-deck-action-btn" id="deckImportBtn" data-v-command-key="import" type="button" title="Import workspace layouts">IMPORT</button>
          <input id="deckImportInput" type="file" accept="application/json,.json" hidden>
          <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener" class="v-attribution" title="Upstream source and AGPL license">BASED ON WORLD MONITOR · AGPL</a>
        </div>
      </div>

      <div class="v-command-drawer-backdrop" id="vCommandDrawerBackdrop"></div>
      <aside class="v-command-drawer" id="vCommandDrawer" aria-label="Project V command menu" aria-hidden="true">
        <div class="v-command-drawer-head">
          <div class="v-command-drawer-brand">
            <span class="v-command-drawer-mark">V</span>
            <div><strong>PROJECT V // WATCHTOWER</strong><small>MASTER COMMAND MENU</small></div>
          </div>
          <button class="v-command-drawer-close" id="vCommandDrawerClose" type="button" aria-label="Close command menu">×</button>
        </div>
        <div class="v-command-drawer-scroll">
          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>01</span> WORKSPACES</div>
            <div class="v-command-drawer-grid workspace-grid">
              ${DECK_WORKSPACES.map((workspace) => `<button type="button" class="v-command-item" data-v-deck-id="${workspace.id}"><span class="v-command-item-icon">${workspace.id === 'watchtower' ? '⌂' : workspace.id === 'global-pulse' ? '◎' : workspace.id === 'live-ops' ? '◈' : workspace.id === 'intelligence' ? '◇' : '✦'}</span><span><strong>${workspace.label}</strong><small>${workspace.subtitle}</small></span></button>`).join('')}
              <button type="button" class="v-command-item" data-v-target="workspaceManagerBtn"><span class="v-command-item-icon">＋</span><span><strong>DESKS</strong><small>Manage custom workspaces</small></span></button>
            </div>
          </section>

          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>02</span> OPERATIONS</div>
            <div class="v-command-drawer-grid">
              <button type="button" class="v-command-item" data-v-target="moduleLibraryBtn"><span class="v-command-item-icon">▦</span><span><strong>MODULES <em id="vCommandModuleCount">0</em></strong><small>Module library</small></span></button>
              <button type="button" class="v-command-item" data-v-target="pluginManagerBtn"><span class="v-command-item-icon">⬡</span><span><strong>PLUGINS <em id="vCommandPluginCount">0</em></strong><small>Local plugin manager</small></span></button>
              <button type="button" class="v-command-item" data-v-target="launchDeckBtn"><span class="v-command-item-icon">↗</span><span><strong>OPEN APPS</strong><small>Launch Deck</small></span></button>
              <button type="button" class="v-command-item" data-v-target="cameraWallBtn"><span class="v-command-item-icon">▣</span><span><strong>CAMERA WALL</strong><small>Monitoring desk</small></span></button>
              <button type="button" class="v-command-item" data-v-target="analysisRoomBtn"><span class="v-command-item-icon">⌁</span><span><strong>ANALYSIS ROOM</strong><small>Multi-agent research</small></span></button>
              <button type="button" class="v-command-item" data-v-target="osintDeskBtn"><span class="v-command-item-icon">⌖</span><span><strong>OSINT TOOLS</strong><small>Public-source query desk</small></span></button>
              <button type="button" class="v-command-item" data-v-target="operationsAlertBtn"><span class="v-command-item-icon">!</span><span><strong>ALERTS <em id="vCommandAlertCount">0</em></strong><small>Operational Alert Center</small></span></button>
              <button type="button" class="v-command-item" data-v-target="voiceControlBtn"><span class="v-command-item-icon">◉</span><span><strong>VOICE CONTROL</strong><small>Hands-free commands</small></span></button>
              <button type="button" class="v-command-item" data-v-target="securityCenterBtn"><span class="v-command-item-icon">⛨</span><span><strong>SECURITY</strong><small>Lock, backup, network</small></span></button>
              <button type="button" class="v-command-item" data-v-panel-id="communications-wall" data-v-workspace="live-ops"><span class="v-command-item-icon">⇄</span><span><strong>COMMS WALL</strong><small>Communications workspace</small></span></button>
              <button type="button" class="v-command-item" data-v-panel-id="map-operations" data-v-workspace="live-ops"><span class="v-command-item-icon">⌗</span><span><strong>MAP COMMAND</strong><small>Map operations controls</small></span></button>
              <button type="button" class="v-command-item" data-v-panel-id="command-assistant" data-v-workspace="assistant"><span class="v-command-item-icon">V</span><span><strong>AI ASSISTANT</strong><small>Local command assistant</small></span></button>
            </div>
          </section>

          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>03</span> LAYOUT</div>
            <div class="v-command-preset-grid">
              ${DECK_PRESETS.map((preset) => `<button type="button" data-v-preset-id="${preset.id}"><strong>${preset.label}</strong><small>${preset.description}</small></button>`).join('')}
            </div>
            <div class="v-command-action-row">
              <button type="button" data-v-target="deckSaveBtn">SAVE</button>
              <button type="button" data-v-target="deckPackBtn">AUTO ARRANGE</button>
              <button type="button" data-v-target="deckResetBtn" class="danger">RESET</button>
            </div>
            <div class="v-command-map-row">
              <span>MAP WIDTH</span>
              <button type="button" data-v-map-span="3">FULL</button>
              <button type="button" data-v-map-span="2">COMMAND</button>
              <button type="button" data-v-map-span="1">COMPACT</button>
            </div>
            <div class="v-command-action-row minor">
              <button type="button" data-v-target="deckExportBtn">EXPORT LAYOUTS</button>
              <button type="button" data-v-target="deckImportBtn">IMPORT LAYOUTS</button>
            </div>
          </section>

          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>04</span> QUICK BAR</div>
            <div class="v-command-bar-summary">
              <span>PIN COMMANDS TO THE TOP OPERATIONS BAR</span>
              <strong id="vCommandBarPinnedCount">0 / 0 PINNED</strong>
            </div>
            <div class="v-command-bar-customizer" role="group" aria-label="Customize quick command bar">
              ${COMMAND_BAR_COMMANDS.map((command) => `<button type="button" data-v-command-bar="${command.id}" aria-pressed="true"><span class="v-command-pin-dot" aria-hidden="true"></span><span><strong>${command.label}</strong><small>${command.description}</small></span><em data-v-command-bar-state>PINNED</em></button>`).join('')}
            </div>
            <div class="v-command-action-row minor v-command-bar-presets">
              <button type="button" data-v-command-bar-action="original">RESTORE ORIGINAL BAR</button>
              <button type="button" data-v-command-bar-action="essential">ESSENTIALS ONLY</button>
            </div>
            <p class="v-command-bar-note">THEATER, LAYOUT, and EDIT DECK stay fixed. Hidden commands remain available in this V menu.</p>
          </section>

          <section class="v-command-drawer-section" id="vApplicationBridgeSection">
            <div class="v-command-drawer-section-title"><span>05</span> PROJECT V BRIDGE</div>
            <div class="v-app-bridge-summary">
              <span>LOCAL APPLICATION HANDOFF</span>
              <strong id="vAppBridgeConnectedCount">0 / 3 READY</strong>
            </div>
            <div class="v-app-bridge-grid">
              ${PROJECT_V_BRIDGE_APPS.map((app) => `<article class="v-app-bridge-card" data-v-bridge-card="${app.id}">
                <div class="v-app-bridge-card-head"><span class="v-app-bridge-icon">${app.id === 'project-v-browser' ? '◎' : app.id === 'project-v-chat' ? '⇄' : '▣'}</span><span><strong>${app.label.toUpperCase()}</strong><small>${app.description}</small></span></div>
                <div class="v-app-bridge-state"><span data-v-bridge-state>NOT CONNECTED</span><code data-v-bridge-path>NO EXECUTABLE</code></div>
                <div class="v-app-bridge-actions">
                  <button type="button" data-v-bridge-action="open" data-v-bridge-app="${app.id}">OPEN</button>
                  <button type="button" data-v-bridge-action="configure" data-v-bridge-app="${app.id}">CONNECT</button>
                  <button type="button" data-v-bridge-action="disconnect" data-v-bridge-app="${app.id}">DISCONNECT</button>
                </div>
              </article>`).join('')}
            </div>
            <article class="v-app-bridge-card v-phoenix-bridge-card" data-v-phoenix-bridge-card>
              <div class="v-app-bridge-card-head"><span class="v-app-bridge-icon">AI</span><span><strong>PHOENIX AI</strong><small>Authenticated local alert + intelligence bridge</small></span></div>
              <div class="v-app-bridge-state"><span data-v-phoenix-state>NOT PAIRED</span><code data-v-phoenix-endpoint>127.0.0.1:17871</code></div>
              <div class="v-phoenix-bridge-settings">
                <label><input type="checkbox" data-v-phoenix-setting="auto"> AUTO FORWARD</label>
                <label>MIN
                  <select data-v-phoenix-setting="minimum">
                    <option value="info">INFO+</option>
                    <option value="watch">WATCH+</option>
                    <option value="elevated">ELEVATED+</option>
                    <option value="high">HIGH+</option>
                    <option value="critical">CRITICAL</option>
                  </select>
                </label>
              </div>
              <div class="v-app-bridge-actions v-phoenix-bridge-actions">
                <button type="button" data-v-phoenix-action="pair">PAIR PHOENIX</button>
                <button type="button" data-v-phoenix-action="test">TEST</button>
                <button type="button" data-v-phoenix-action="disconnect">DISCONNECT</button>
              </div>
              <p class="v-phoenix-bridge-detail" data-v-phoenix-detail>Copy receiver pairing JSON from Phoenix 0.9.8 and pair it here.</p>
            </article>
            <div class="v-command-action-row minor v-app-bridge-footer-actions">
              <button type="button" data-v-target="launchDeckBtn">OPEN LAUNCH DECK</button>
              <button type="button" data-v-bridge-action="refresh">REFRESH STATUS</button>
            </div>
            <p class="v-app-bridge-note">PHOENIX BRIDGE · Phoenix 0.9.8 pairing uses an authenticated loopback receiver. The token is stored in the desktop credential vault, never in Watchtower localStorage. Other Project V application cards remain Launch Deck handoffs.</p>
          </section>

          <section class="v-command-drawer-section" id="vMissionProfilesSection">
            <div class="v-command-drawer-section-title"><span>06</span> MISSION PROFILES</div>
            <div class="v-mission-profile-summary">
              <span>ONE-CLICK OPERATIONAL CONFIGURATION</span>
              <strong id="vMissionProfileActiveLabel">CUSTOM</strong>
            </div>
            <div class="v-mission-profile-grid" role="group" aria-label="Watchtower mission profiles">
              ${MISSION_PROFILES.map((profile) => `<button type="button" data-v-mission-profile="${profile.id}" aria-pressed="false"><span class="v-mission-profile-icon">${profile.icon}</span><span class="v-mission-profile-copy"><strong>${profile.label}</strong><small>${profile.description}</small><em>${profile.detail}</em></span><span class="v-mission-profile-state" data-v-mission-state>APPLY</span></button>`).join('')}
            </div>
            <p class="v-mission-profile-note">Profiles switch the operational desk, apply a purpose-built layout, and tune the Quick Bar. They do not change your theme, API keys, alerts, watchlists, cases, or connected Project V applications.</p>
          </section>

          <section class="v-command-drawer-section" id="vAccessGateSection">
            <div class="v-command-drawer-section-title"><span>07</span> ACCESS GATE</div>
            <div class="v-access-gate-drawer-summary">
              <span>LOCAL WATCHTOWER AUTHORIZATION</span>
              <strong id="vAccessGateState">NOT ARMED</strong>
            </div>
            <p class="v-access-gate-drawer-detail" id="vAccessGateDetail">Project Lock is available from Security Center. Set a PIN to enable startup authorization.</p>
            <div class="v-command-action-row minor">
              <button type="button" data-v-target="securityCenterBtn">SECURITY SETTINGS</button>
              <button type="button" data-v-access-action="lock">LOCK NOW</button>
            </div>
            <p class="v-access-gate-drawer-note">The Access Gate controls entry to the local Watchtower interface. It does not encrypt stored cases, layouts, or cached intelligence.</p>
          </section>

          <section class="v-command-drawer-section" id="vLiveLanguageSection">
            <div class="v-command-drawer-section-title"><span>08</span> LIVE LANGUAGE</div>
            <div class="v-live-language-drawer-summary">
              <span>LOCAL TRANSCRIPTION + TRANSLATION</span>
              <strong>WHISPER · OLLAMA</strong>
            </div>
            <button type="button" class="v-command-item v-live-language-drawer-open" data-v-panel-id="live-language" data-v-workspace="live-ops"><span class="v-command-item-icon">文</span><span><strong>OPEN LIVE LANGUAGE</strong><small>Shared audio, microphone, captions, transcript</small></span></button>
            <p class="v-live-language-drawer-note">Capture shared/system audio from Camera Wall or communications windows, or use the microphone. Speech recognition remains local; optional translation uses your configured Ollama model.</p>
          </section>

          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>09</span> APPEARANCE</div>
            <div class="v-command-theme-grid" role="radiogroup" aria-label="Watchtower theme">
              <button type="button" data-v-theme="classic" role="radio"><span class="v-theme-swatch classic"></span><span><strong>WATCHTOWER CLASSIC</strong><small>Original red command-center palette</small></span></button>
              <button type="button" data-v-theme="shadow" role="radio"><span class="v-theme-swatch shadow"></span><span><strong>PROJECT V SHADOW</strong><small>Deep black with electric blue accents</small></span></button>
              <button type="button" data-v-theme="midnight" role="radio"><span class="v-theme-swatch midnight"></span><span><strong>MIDNIGHT</strong><small>Dark navy intelligence palette</small></span></button>
            </div>
          </section>

          <section class="v-command-drawer-section">
            <div class="v-command-drawer-section-title"><span>10</span> SYSTEM</div>
            <div class="v-command-action-row system">
              <button type="button" data-v-target="searchBtn">SEARCH</button>
              <button type="button" data-v-target="apiSettingsBtn">API KEYS</button>
              <button type="button" data-v-target="unifiedSettingsBtn">SETTINGS</button>
            </div>
          </section>
        </div>
        <footer class="v-command-drawer-footer"><span>LIVE LANGUAGE · ACCESS GATE · MISSIONS · QUICK BAR</span><strong>V MENU</strong></footer>
      </aside>

      <div class="v-command-palette-backdrop" id="vCommandPaletteBackdrop"></div>
      <section class="v-command-palette" id="vCommandPalette" role="dialog" aria-modal="true" aria-labelledby="vCommandPaletteTitle" aria-hidden="true">
        <div class="v-command-palette-header">
          <div><span>PROJECT V // RAPID CONTROL</span><strong id="vCommandPaletteTitle">WATCHTOWER COMMAND</strong></div>
          <button type="button" id="vCommandPaletteClose" aria-label="Close command palette" title="Close command palette">×</button>
        </div>
        <label class="v-command-palette-search" for="vCommandPaletteInput">
          <span class="v-command-palette-glyph" aria-hidden="true">⌘</span>
          <input id="vCommandPaletteInput" type="search" placeholder="Type a command, workspace, tool, layout, or theme..." autocomplete="off" spellcheck="false">
          <kbd>ESC</kbd>
        </label>
        <div class="v-command-palette-meta">
          <span id="vCommandPaletteCount">0 COMMANDS</span>
          <span>↑ ↓ NAVIGATE · ENTER RUN</span>
        </div>
        <div class="v-command-palette-results" id="vCommandPaletteResults" role="listbox" aria-label="Watchtower commands"></div>
        <footer class="v-command-palette-footer"><span>CTRL+K OPENS FROM ANY DESK</span><strong>LOCAL COMMAND INDEX</strong></footer>
      </section>

      <main class="main-content">
        <section class="panels-grid" id="panelsGrid" aria-label="Watchtower modules">
          <section class="panel map-section v-deck-panel panel-wide col-span-3 span-2" id="mapSection" data-panel="map">
            <div class="panel-header">
              <div class="panel-header-left">
                <span class="v-panel-index">01</span>
                <span class="panel-title">${mapTitle} // ACTIVE THEATER</span>
              </div>
              <div class="v-panel-actions">
                <button class="map-pin-btn" id="mapFullscreenBtn" title="Fullscreen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                </button>
                <button class="map-pin-btn" id="mapPinBtn" title="${t('header.pinMap')}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1v3.76z"/></svg>
                </button>
              </div>
            </div>
            <div class="map-container panel-content" id="mapContainer"></div>
            ${SITE_VARIANT === 'happy' ? '<button class="tv-exit-btn" id="tvExitBtn">Exit TV Mode</button>' : ''}
            <div class="map-resize-handle panel-resize-handle" id="mapResizeHandle"></div>
            <div class="panel-col-resize-handle" id="mapColResizeHandle"></div>
          </section>
        </section>
      </main>

      <div class="v-module-library-backdrop" id="moduleLibraryBackdrop"></div>
      <aside class="v-module-library" id="moduleLibraryDrawer" aria-label="Module library">
        <div class="v-module-library-header">
          <div><span>PROJECT V // DECK</span><strong>MODULE LIBRARY</strong></div>
          <button type="button" id="moduleLibraryClose" aria-label="Close module library">×</button>
        </div>
        <p>Browse modules by category, restore hidden tools, reopen minimized panels, or remove modules from the active workspace.</p>
        <div class="v-module-library-tools">
          <input id="moduleLibrarySearch" type="search" placeholder="Search modules..." autocomplete="off">
          <div class="v-module-library-categories" id="moduleLibraryCategories">
            <button type="button" class="active" data-module-category="all">ALL</button>
            <button type="button" data-module-category="maps">MAPS</button>
            <button type="button" data-module-category="intelligence">INTEL</button>
            <button type="button" data-module-category="news">NEWS</button>
            <button type="button" data-module-category="operations">LIVE OPS</button>
            <button type="button" data-module-category="markets">MARKETS</button>
            <button type="button" data-module-category="weather">WEATHER</button>
            <button type="button" data-module-category="ai">AI</button>
            <button type="button" data-module-category="research">RESEARCH</button>
            <button type="button" data-module-category="system">SYSTEM</button>
          </div>
        </div>
        <div class="v-module-library-list" id="moduleLibraryList"></div>
      </aside>

      <div class="v-plugin-manager-backdrop" id="pluginManagerBackdrop"></div>
      <aside class="v-plugin-manager" id="pluginManagerDrawer" aria-label="Project V plugin manager">
        <div class="v-plugin-manager-header">
          <div><span>PROJECT V // EXTENSION BUS</span><strong>PLUGIN CONTROL</strong></div>
          <button type="button" id="pluginManagerClose" aria-label="Close plugin manager">×</button>
        </div>
        <p>Install reviewed local modules, inspect requested permissions, enable or disable plugins, and add them to the active command desk.</p>
        <div class="v-plugin-security-notice"><strong>RESTRICTED SANDBOX</strong><span>Imported plugins run without same-origin access, top navigation, forms, or unrestricted network access.</span></div>
        <div class="v-plugin-manager-tools">
          <input id="pluginManagerSearch" type="search" placeholder="Search installed plugins..." autocomplete="off">
          <div class="v-plugin-manager-toolbar">
            <button type="button" id="pluginImportBtn">IMPORT PLUGIN</button>
            <button type="button" id="pluginStarterBtn">STARTER PACK</button>
            <button type="button" id="pluginTemplateBtn">MANIFEST TEMPLATE</button>
            <button type="button" id="pluginExportAllBtn">EXPORT ALL</button>
          </div>
          <input id="pluginImportInput" type="file" accept="application/json,.json,.pvplugin" hidden>
        </div>
        <div class="v-plugin-manager-status" id="pluginManagerStatus"></div>
        <div class="v-plugin-manager-list" id="pluginManagerList"></div>
      </aside>

      <div class="v-workspace-manager-backdrop" id="workspaceManagerBackdrop"></div>
      <aside class="v-workspace-manager" id="workspaceManagerDrawer" aria-label="Workspace manager">
        <div class="v-workspace-manager-header">
          <div><span>PROJECT V // WATCHTOWER</span><strong>WORKSPACE CONTROL</strong></div>
          <button type="button" id="workspaceManagerClose" aria-label="Close workspace manager">×</button>
        </div>
        <p>Create separate command desks, duplicate a layout, choose a default startup desk, or manage custom workspaces.</p>
        <div class="v-workspace-manager-list" id="workspaceManagerList"></div>
        <div class="v-workspace-manager-actions">
          <button type="button" id="workspaceNewBtn">NEW DESK</button>
          <button type="button" id="workspaceDuplicateBtn">DUPLICATE</button>
          <button type="button" id="workspaceRenameBtn">RENAME</button>
          <button type="button" id="workspaceDefaultBtn">SET DEFAULT</button>
          <button type="button" id="workspaceDeleteBtn" class="danger">DELETE</button>
        </div>
      </aside>

      <div class="v-voice-control-backdrop" id="voiceControlBackdrop"></div>
      <aside class="v-voice-control" id="voiceControlDrawer" aria-label="Project V voice command center">
        <div class="v-voice-control-header">
          <div><span>PROJECT V // HANDS-FREE CONTROL</span><strong>VOICE COMMAND CENTER</strong></div>
          <button type="button" id="voiceControlClose" aria-label="Close voice command center">×</button>
        </div>
        <div id="voiceControlContent"></div>
      </aside>

      <div class="v-security-center-backdrop" id="securityCenterBackdrop"></div>
      <aside class="v-security-center" id="securityCenterDrawer" aria-label="Project V security center">
        <div class="v-security-center-header">
          <div><span>PROJECT V // HARDENED PLATFORM</span><strong>SECURITY CENTER</strong></div>
          <button type="button" id="securityCenterClose" aria-label="Close security center">×</button>
        </div>
        <div id="securityCenterContent"></div>
      </aside>
      <div class="v-project-lock-overlay" id="projectVLockOverlay" role="dialog" aria-modal="true" aria-label="Project V Watchtower locked"></div>
    `;

    this.createPanels();
    this.setupDeckModeToggle();
    this.setupWorkspaceControls();
    this.setupPluginSystem();
    this.setupLaunchDeckControl();
    this.setupCameraWallControl();
    this.setupAnalysisRoomControl();
    this.setupOsintDeskControl();
    this.setupRuntimeSettingsControl();
    this.setupOperationsControl();
    this.setupSecurityCenter();
    this.setupVoiceCommandCenter();
    this.setupCommandDrawer();
    this.setupCommandPalette();
    this.setupLiveLanguage();
    this.setupAirOperations();
    this.setupWeatherOperations();

    if (this.ctx.isMobile) {
      this.setupMobileMapToggle();
    }
  }

  private setupWeatherOperations(): void {
    this.weatherOperationsPanel?.destroy();
    this.weatherOperationsPanel = new WeatherOperationsPanel();
  }

  private setupAirOperations(): void {
    this.airOperationsOpenCleanup?.();

    // Air Operations remains a normal Live Ops panel for workspace persistence,
    // but AIR OPS promotes the *same* panel into a full-screen command surface.
    // Workspace restoration can rewrite panel classes/geometry after activation,
    // so the promotion is deliberately re-asserted for a short settling window.
    const airOperationsSetting = this.ctx.panelSettings['air-operations'];
    if (airOperationsSetting) airOperationsSetting.enabled = true;

    let moduleObserver: MutationObserver | null = null;
    let focusObserver: MutationObserver | null = null;
    let commandOpen = false;
    let promoteTimers: number[] = [];

    const clearPromoteTimers = () => {
      for (const timer of promoteTimers) window.clearTimeout(timer);
      promoteTimers = [];
    };

    const getAirOperationsElement = (): HTMLElement | null => {
      const controller = this.ctx.panels['air-operations'];
      return controller?.getElement()
        ?? document.querySelector<HTMLElement>('.v-air-operations-panel')
        ?? document.querySelector<HTMLElement>('[data-panel="air-operations"]');
    };

    const ensureMounted = (): HTMLElement | null => {
      const panel = getAirOperationsElement();
      if (!panel) return null;
      if (!panel.isConnected) document.getElementById('panelsGrid')?.appendChild(panel);
      return panel;
    };

    const applyCommandFocus = (): boolean => {
      if (!commandOpen) return false;
      const panel = ensureMounted();
      if (!panel) return false;

      // The focus class is the contract used by air-operations.css to turn the
      // docked card into the full-page Air Operations command deck.
      document.body.classList.add('v-air-operations-command-open');
      panel.classList.add('v-air-operations-command-focus');
      panel.style.removeProperty('display');
      window.dispatchEvent(new Event('project-v-air-operations-visible'));
      return true;
    };

    const closeFocus = () => {
      commandOpen = false;
      clearPromoteTimers();
      focusObserver?.disconnect();
      focusObserver = null;
      document.body.classList.remove('v-air-operations-command-open');
      getAirOperationsElement()?.classList.remove('v-air-operations-command-focus');
      window.dispatchEvent(new Event('project-v-air-operations-command-closed'));
    };

    const watchFocusedPanel = () => {
      focusObserver?.disconnect();
      const panel = getAirOperationsElement();
      if (!panel) return;

      focusObserver = new MutationObserver(() => {
        if (!commandOpen) return;
        const current = getAirOperationsElement();
        if (!current) return;
        if (!current.classList.contains('v-air-operations-command-focus')) {
          current.classList.add('v-air-operations-command-focus');
        }
        if (!document.body.classList.contains('v-air-operations-command-open')) {
          document.body.classList.add('v-air-operations-command-open');
        }
      });
      focusObserver.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
    };

    const schedulePromotion = () => {
      clearPromoteTimers();
      // Reassert after the workspace engine has had opportunities to restore
      // saved visibility and geometry. This prevents AIR OPS from degrading
      // into "switch to Live Ops and show the small card at the bottom".
      for (const delay of [0, 50, 120, 250, 500, 900]) {
        promoteTimers.push(window.setTimeout(() => {
          if (!commandOpen) return;
          if (applyCommandFocus()) watchFocusedPanel();
        }, delay));
      }
    };

    const openPanel = () => {
      const setting = this.ctx.panelSettings['air-operations'];
      if (setting) setting.enabled = true;
      commandOpen = true;

      this.deckWorkspaces?.activate('live-ops');
      ensureMounted();
      this.deckWorkspaces?.setPanelHidden('air-operations', false);
      this.ctx.panels['air-operations']?.toggle(true);
      document.getElementById('moduleLibraryClose')?.click();

      // Run once immediately and then through the workspace settling window.
      applyCommandFocus();
      schedulePromotion();
    };

    const onOpen = () => openPanel();
    const onClose = () => closeFocus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && commandOpen) {
        event.preventDefault();
        closeFocus();
      }
    };
    const onWorkspaceNavigation = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest('[data-deck-id], #workspaceManagerBtn')) return;
      if (commandOpen) closeFocus();
    };

    // Keep Air Operations visibly available in the Module Library even when a
    // stale interface-setting snapshot says otherwise.
    const wireModuleOpenButton = () => {
      const setting = this.ctx.panelSettings['air-operations'];
      if (setting) setting.enabled = true;

      const list = document.getElementById('moduleLibraryList');
      if (!list) return;

      const titleNode = Array.from(list.querySelectorAll<HTMLElement>('*'))
        .find((node) => node.children.length === 0 && node.textContent?.trim().toUpperCase() === 'AIR OPERATIONS MAP');
      if (!titleNode) return;

      let card: HTMLElement | null = titleNode;
      while (card?.parentElement && card.parentElement !== list) {
        const text = card.textContent?.toUpperCase() ?? '';
        if (text.includes('AIR OPERATIONS MAP') && (text.includes('WORKSPACE') || text.includes('INTERFACE SETTINGS') || card.querySelector('button'))) break;
        card = card.parentElement;
      }
      if (!card) return;

      for (const leaf of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        if (leaf.children.length > 0) continue;
        const text = leaf.textContent?.trim().toUpperCase() ?? '';
        if (text === 'DISABLED IN INTERFACE SETTINGS') leaf.textContent = 'INTERFACE ENABLED';
        if (text === 'INTERFACE SETTINGS') leaf.textContent = 'CORE MODULE';
      }

      if (card.querySelector('[data-air-operations-module-open]')) return;
      const templateButton = card.querySelector<HTMLButtonElement>('button')
        ?? list.querySelector<HTMLButtonElement>('button');
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = templateButton?.className || 'v-deck-action-btn';
      openButton.dataset.airOperationsModuleOpen = '1';
      openButton.textContent = 'OPEN';
      openButton.title = 'Open Air Operations command view';
      openButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
      });

      const removeButton = Array.from(card.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim().toUpperCase() === 'REMOVE');
      if (removeButton?.parentElement) removeButton.parentElement.insertBefore(openButton, removeButton);
      else card.appendChild(openButton);
    };

    const moduleList = document.getElementById('moduleLibraryList');
    if (moduleList) {
      moduleObserver = new MutationObserver(() => wireModuleOpenButton());
      moduleObserver.observe(moduleList, { childList: true, subtree: true });
      wireModuleOpenButton();
    }

    const moduleLibraryButton = document.getElementById('moduleLibraryBtn');
    const onModuleLibraryOpen = () => window.setTimeout(wireModuleOpenButton, 0);
    moduleLibraryButton?.addEventListener('click', onModuleLibraryOpen);

    window.addEventListener('project-v-air-operations-open', onOpen);
    window.addEventListener('project-v-air-operations-close', onClose);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onWorkspaceNavigation, true);

    this.airOperationsOpenCleanup = () => {
      closeFocus();
      moduleObserver?.disconnect();
      moduleObserver = null;
      moduleLibraryButton?.removeEventListener('click', onModuleLibraryOpen);
      window.removeEventListener('project-v-air-operations-open', onOpen);
      window.removeEventListener('project-v-air-operations-close', onClose);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onWorkspaceNavigation, true);
    };
  }

  private setupLiveLanguage(): void {
    this.liveLanguageOpenCleanup?.();
    this.liveLanguageOverlayCleanup?.();

    const openPanel = () => {
      this.deckWorkspaces?.activate('live-ops');
      this.deckWorkspaces?.setPanelHidden('live-language', false);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-panel="live-language"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 90);
    };

    this.liveLanguageOpenCleanup = installLiveLanguageOpenBridge(openPanel);
    this.liveLanguageOverlayCleanup = mountLiveLanguageOverlay(document.body);
  }

  private setupCommandDrawer(): void {
    this.commandDrawerCleanup?.();

    const trigger = document.getElementById('vCommandMenuBtn') as HTMLButtonElement | null;
    const drawer = document.getElementById('vCommandDrawer');
    const backdrop = document.getElementById('vCommandDrawerBackdrop');
    const closeButton = document.getElementById('vCommandDrawerClose');
    if (!trigger || !drawer || !backdrop) return;

    const sync = () => this.syncCommandDrawerState();
    const close = () => {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('v-command-drawer-open');
      document.removeEventListener('keydown', onKeyDown);
    };
    const open = () => {
      sync();
      void refreshPhoenixBridgeHealth();
      drawer.classList.add('open');
      backdrop.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('v-command-drawer-open');
      document.addEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const runExistingControl = (targetId: string) => {
      close();
      window.setTimeout(() => document.getElementById(targetId)?.click(), 0);
    };

    const onDrawerClick = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;

      const deckId = button.dataset.vDeckId as DeckWorkspaceId | undefined;
      if (deckId) {
        this.deckWorkspaces?.activate(deckId);
        close();
        return;
      }

      const panelId = button.dataset.vPanelId;
      if (panelId) {
        const workspaceId = button.dataset.vWorkspace as DeckWorkspaceId | undefined;
        if (workspaceId) this.deckWorkspaces?.activate(workspaceId);
        this.deckWorkspaces?.setPanelHidden(panelId, false);
        close();
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-panel="${CSS.escape(panelId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        return;
      }

      const presetId = button.dataset.vPresetId as Exclude<DeckPresetId, 'custom'> | undefined;
      if (presetId) {
        this.deckWorkspaces?.applyPreset(presetId);
        this.updatePresetUi();
        sync();
        return;
      }

      const mapSpan = button.dataset.vMapSpan;
      if (mapSpan) {
        close();
        window.setTimeout(() => {
          document.querySelector<HTMLButtonElement>(`#mapLayoutMenu [data-map-span="${CSS.escape(mapSpan)}"]`)?.click();
        }, 0);
        return;
      }

      const commandBarId = button.dataset.vCommandBar as CommandBarCommandId | undefined;
      if (commandBarId) {
        const pinned = this.readCommandBarPins();
        if (pinned.has(commandBarId)) pinned.delete(commandBarId);
        else pinned.add(commandBarId);
        this.writeCommandBarPins(pinned);
        sync();
        return;
      }

      const commandBarAction = button.dataset.vCommandBarAction;
      if (commandBarAction === 'original') {
        this.writeCommandBarPins(new Set(COMMAND_BAR_COMMANDS.map((command) => command.id)));
        sync();
        return;
      }
      if (commandBarAction === 'essential') {
        this.writeCommandBarPins(new Set(ESSENTIAL_COMMAND_BAR));
        sync();
        return;
      }

      const missionProfileId = button.dataset.vMissionProfile as MissionProfileId | undefined;
      if (missionProfileId && isMissionProfileId(missionProfileId)) {
        this.applyMissionProfile(missionProfileId);
        sync();
        return;
      }

      const phoenixAction = button.dataset.vPhoenixAction;
      if (phoenixAction) {
        if (phoenixAction === 'pair') {
          const pairing = window.prompt('Paste the JSON from Phoenix → Watchtower → Copy receiver pairing. The pairing token is stored in the desktop credential vault and is not kept in localStorage.');
          if (!pairing?.trim()) return;
          button.disabled = true;
          button.textContent = 'PAIRING…';
          void pairPhoenixBridge(pairing)
            .then(() => {
              sync();
              window.alert('Phoenix AI bridge paired. High and critical Watchtower alerts will forward automatically by default.');
            })
            .catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'Unable to pair Phoenix.'))
            .finally(() => {
              button.disabled = false;
              sync();
            });
          return;
        }
        if (phoenixAction === 'test') {
          button.disabled = true;
          button.textContent = 'SENDING…';
          void sendPhoenixBridgeTestAlert()
            .then((result) => window.alert(result.message))
            .catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'Phoenix bridge test failed.'))
            .finally(() => {
              button.disabled = false;
              sync();
            });
          return;
        }
        if (phoenixAction === 'disconnect') {
          if (!window.confirm('Disconnect Phoenix and remove the Watchtower pairing token from the desktop credential vault?')) return;
          button.disabled = true;
          void disconnectPhoenixBridge()
            .catch((error: unknown) => window.alert(error instanceof Error ? error.message : 'Unable to disconnect Phoenix.'))
            .finally(() => {
              button.disabled = false;
              sync();
            });
          return;
        }
      }

      const bridgeAction = button.dataset.vBridgeAction;
      if (bridgeAction) {
        if (bridgeAction === 'refresh') {
          sync();
          void refreshPhoenixBridgeHealth();
          return;
        }

        const bridgeAppId = button.dataset.vBridgeApp as ProjectVBridgeAppId | undefined;
        if (!bridgeAppId || !PROJECT_V_BRIDGE_APPS.some((app) => app.id === bridgeAppId)) return;

        if (bridgeAction === 'disconnect') {
          disconnectProjectVBridgeApp(bridgeAppId);
          sync();
          return;
        }

        if (bridgeAction === 'configure') {
          button.disabled = true;
          button.textContent = 'SELECTING…';
          void configureProjectVBridgeApp(bridgeAppId)
            .catch((error: unknown) => {
              window.alert(error instanceof Error ? error.message : 'Unable to connect the Project V application.');
            })
            .finally(() => {
              button.disabled = false;
              sync();
            });
          return;
        }

        if (bridgeAction === 'open') {
          close();
          void launchProjectVBridgeApp(bridgeAppId).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : 'Unable to launch the Project V application.');
          });
          return;
        }
      }

      const uiTheme = button.dataset.vTheme as WatchtowerUiTheme | undefined;
      if (uiTheme) {
        setWatchtowerUiTheme(uiTheme);
        sync();
        return;
      }

      const accessAction = button.dataset.vAccessAction;
      if (accessAction === 'lock') {
        close();
        this.securityCenter?.lockNow();
        return;
      }

      const targetId = button.dataset.vTarget;
      if (targetId) runExistingControl(targetId);
    };

    const onDrawerChange = (event: Event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const phoenixSetting = target.dataset.vPhoenixSetting;
      if (phoenixSetting === 'auto' && target instanceof HTMLInputElement) {
        setPhoenixBridgeAutoForward(target.checked);
        sync();
      } else if (phoenixSetting === 'minimum' && target instanceof HTMLSelectElement) {
        setPhoenixBridgeMinimumSeverity(target.value as PhoenixBridgeMinimumSeverity);
        sync();
      }
    };

    const onWorkspaceChanged = () => {
      this.markMissionProfileCustom();
      sync();
    };
    const onCommandBarChanged = () => {
      this.markMissionProfileCustom();
      sync();
    };
    const onThemeChanged = () => sync();
    const bridgeCleanup = subscribeProjectVBridge(sync);
    const phoenixBridgeCleanup = subscribePhoenixBridge(sync);

    trigger.addEventListener('click', () => drawer.classList.contains('open') ? close() : open());
    closeButton?.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    drawer.addEventListener('click', onDrawerClick);
    drawer.addEventListener('change', onDrawerChange);
    window.addEventListener('project-v-workspace-activated', onWorkspaceChanged);
    window.addEventListener('project-v-workspace-preset-change', onWorkspaceChanged);
    window.addEventListener('project-v-layout-change', onWorkspaceChanged);
    window.addEventListener('project-v-command-bar-change', onCommandBarChanged);
    window.addEventListener('project-v-module-state-change', onWorkspaceChanged);
    window.addEventListener('project-v-plugin-registry-change', sync);
    window.addEventListener('project-v-watchtower-theme-changed', onThemeChanged);
    window.addEventListener('project-v-security-settings-change', sync);

    this.commandDrawerCleanup = () => {
      close();
      drawer.removeEventListener('click', onDrawerClick);
      drawer.removeEventListener('change', onDrawerChange);
      window.removeEventListener('project-v-workspace-activated', onWorkspaceChanged);
      window.removeEventListener('project-v-workspace-preset-change', onWorkspaceChanged);
      window.removeEventListener('project-v-layout-change', onWorkspaceChanged);
      window.removeEventListener('project-v-command-bar-change', onCommandBarChanged);
      window.removeEventListener('project-v-module-state-change', onWorkspaceChanged);
      window.removeEventListener('project-v-plugin-registry-change', sync);
      window.removeEventListener('project-v-watchtower-theme-changed', onThemeChanged);
      window.removeEventListener('project-v-security-settings-change', sync);
      bridgeCleanup();
      phoenixBridgeCleanup();
    };

    const storedMissionProfile = this.readMissionProfile();
    if (storedMissionProfile === 'custom') this.applyCommandBarPreferences();
    else this.applyMissionProfile(storedMissionProfile);
    sync();
    void refreshPhoenixBridgeHealth();
  }


  private setupCommandPalette(): void {
    this.commandPaletteCleanup?.();

    const palette = document.getElementById('vCommandPalette');
    const backdrop = document.getElementById('vCommandPaletteBackdrop');
    const input = document.getElementById('vCommandPaletteInput') as HTMLInputElement | null;
    const results = document.getElementById('vCommandPaletteResults');
    const count = document.getElementById('vCommandPaletteCount');
    const closeButton = document.getElementById('vCommandPaletteClose');
    if (!palette || !backdrop || !input || !results) return;

    type PaletteCategory = 'WORKSPACES' | 'MISSIONS' | 'OPERATIONS' | 'ECOSYSTEM' | 'LAYOUT' | 'APPEARANCE' | 'SYSTEM';
    interface PaletteCommand {
      id: string;
      label: string;
      description: string;
      category: PaletteCategory;
      keywords?: string;
      shortcut?: string;
      run: () => void;
    }

    let filtered: PaletteCommand[] = [];
    let selectedIndex = 0;

    const clickExisting = (targetId: string) => {
      close();
      window.setTimeout(() => document.getElementById(targetId)?.click(), 0);
    };

    const showPanel = (panelId: string, workspaceId?: DeckWorkspaceId) => {
      close();
      if (workspaceId) this.deckWorkspaces?.activate(workspaceId);
      this.deckWorkspaces?.setPanelHidden(panelId, false);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-panel="${CSS.escape(panelId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 90);
    };

    const runBridgeApp = (appId: ProjectVBridgeAppId) => {
      close();
      void launchProjectVBridgeApp(appId).catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : 'Unable to launch the Project V application.');
      });
    };

    const openBridgeSection = () => {
      close();
      window.setTimeout(() => {
        const trigger = document.getElementById('vCommandMenuBtn');
        const drawer = document.getElementById('vCommandDrawer');
        if (!drawer?.classList.contains('open')) trigger?.click();
        window.setTimeout(() => document.getElementById('vApplicationBridgeSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }, 0);
    };

    const workspaceCommands: PaletteCommand[] = DECK_WORKSPACES.map((workspace) => ({
      id: `workspace-${workspace.id}`,
      label: `OPEN ${workspace.label}`,
      description: workspace.subtitle,
      category: 'WORKSPACES',
      keywords: `workspace desk ${workspace.label} ${workspace.subtitle}`,
      run: () => { this.deckWorkspaces?.activate(workspace.id); close(); },
    }));

    const missionCommands: PaletteCommand[] = MISSION_PROFILES.map((profile) => ({
      id: `mission-${profile.id}`,
      label: `MISSION: ${profile.label}`,
      description: profile.description,
      category: 'MISSIONS',
      keywords: `mission profile mode ${profile.label} ${profile.detail}`,
      run: () => { this.applyMissionProfile(profile.id); close(); },
    }));

    const bridgeCommands: PaletteCommand[] = PROJECT_V_BRIDGE_APPS.map((app) => ({
      id: `bridge-open-${app.id}`,
      label: `OPEN ${app.label.toUpperCase()}`,
      description: app.description,
      category: 'ECOSYSTEM',
      keywords: `project v ecosystem bridge application ${app.label} ${app.aliases.join(' ')}`,
      run: () => runBridgeApp(app.id),
    }));

    const presetCommands: PaletteCommand[] = DECK_PRESETS.map((preset) => ({
      id: `preset-${preset.id}`,
      label: `LAYOUT: ${preset.label}`,
      description: preset.description,
      category: 'LAYOUT',
      keywords: `layout preset workspace ${preset.label} ${preset.description}`,
      run: () => {
        this.deckWorkspaces?.applyPreset(preset.id);
        this.updatePresetUi();
        close();
      },
    }));

    const commands: PaletteCommand[] = [
      ...workspaceCommands,
      ...missionCommands,
      { id: 'manage-desks', label: 'MANAGE DESKS', description: 'Create, rename, duplicate, or choose a default workspace', category: 'WORKSPACES', keywords: 'workspace manager custom desks', run: () => clickExisting('workspaceManagerBtn') },

      { id: 'modules', label: 'OPEN MODULE LIBRARY', description: 'Browse and restore Watchtower modules', category: 'OPERATIONS', keywords: 'modules tools library panels', run: () => clickExisting('moduleLibraryBtn') },
      { id: 'plugins', label: 'OPEN PLUGIN CONTROL', description: 'Manage local Project V extensions', category: 'OPERATIONS', keywords: 'plugins extensions extension bus', run: () => clickExisting('pluginManagerBtn') },
      { id: 'apps', label: 'OPEN APPS', description: 'Open the Launch Deck', category: 'OPERATIONS', keywords: 'apps applications launch deck', run: () => clickExisting('launchDeckBtn') },
      { id: 'cameras', label: 'OPEN CAMERA WALL', description: 'Open the monitoring desk', category: 'OPERATIONS', keywords: 'camera cameras video monitoring wall', run: () => clickExisting('cameraWallBtn') },
      { id: 'analysis-room', label: 'OPEN ANALYSIS ROOM', description: 'Open local multi-agent research', category: 'OPERATIONS', keywords: 'analysis research agents ai room', run: () => clickExisting('analysisRoomBtn') },
      { id: 'osint', label: 'OPEN OSINT TOOLS', description: 'Open the public-source query desk', category: 'OPERATIONS', keywords: 'osint public source intelligence search', run: () => clickExisting('osintDeskBtn') },
      { id: 'alerts', label: 'OPEN ALERT CENTER', description: 'Review operational alerts', category: 'OPERATIONS', keywords: 'alerts warning critical operational', run: () => clickExisting('operationsAlertBtn') },
      { id: 'voice', label: 'OPEN VOICE CONTROL', description: 'Open hands-free command controls', category: 'OPERATIONS', keywords: 'voice microphone push to talk commands', run: () => clickExisting('voiceControlBtn') },
      { id: 'security', label: 'OPEN SECURITY CENTER', description: 'Lock, access gate, backup, network, and recovery controls', category: 'OPERATIONS', keywords: 'security lock access gate startup backup network recovery', run: () => clickExisting('securityCenterBtn') },
      { id: 'lock-watchtower', label: 'LOCK WATCHTOWER', description: 'Return the command deck to the local Watchtower access screen', category: 'OPERATIONS', keywords: 'lock access gate secure authorize pin session', run: () => { close(); window.setTimeout(() => this.securityCenter?.lockNow(), 0); } },
      { id: 'comms', label: 'OPEN COMMS WALL', description: 'Open the communications workspace', category: 'OPERATIONS', keywords: 'communications comms messages wall live ops', run: () => showPanel('communications-wall', 'live-ops') },
      { id: 'live-language', label: 'OPEN LIVE LANGUAGE', description: 'Start local transcription, captions, and translation controls', category: 'OPERATIONS', keywords: 'live language translate translation transcription captions whisper audio speech camera communications', run: () => showPanel('live-language', 'live-ops') },
      { id: 'air-operations', label: 'OPEN AIR OPERATIONS', description: 'Open the Project V aircraft tracking and analysis map', category: 'OPERATIONS', keywords: 'air aircraft flight flights adsb radar tracking aviation airspace', run: () => { close(); window.dispatchEvent(new Event('project-v-air-operations-open')); } },
      { id: 'weather-operations', label: 'OPEN WEATHER OPERATIONS', description: 'Open radar, active alerts, and location forecast intelligence', category: 'OPERATIONS', keywords: 'weather wx radar rain storm forecast temperature wind alerts', run: () => { close(); window.dispatchEvent(new Event('project-v-weather-operations-open')); } },
      { id: 'map-command', label: 'OPEN MAP COMMAND', description: 'Open map operations controls', category: 'OPERATIONS', keywords: 'map command operations controls', run: () => showPanel('map-operations', 'live-ops') },
      { id: 'assistant-panel', label: 'OPEN AI ASSISTANT', description: 'Open the local command assistant', category: 'OPERATIONS', keywords: 'ai assistant local ollama command', run: () => showPanel('command-assistant', 'assistant') },

      ...bridgeCommands,
      { id: 'bridge-configure', label: 'CONFIGURE PROJECT V BRIDGE', description: 'Connect Project V Browser, Chat, and Shadow Gallery executables', category: 'ECOSYSTEM', keywords: 'configure connect project v application bridge browser chat shadow gallery launch deck', run: openBridgeSection },
      { id: 'bridge-launch-deck', label: 'OPEN LAUNCH DECK', description: 'Manage approved external applications and handoff permissions', category: 'ECOSYSTEM', keywords: 'launch deck apps approved applications bridge', run: () => clickExisting('launchDeckBtn') },

      ...presetCommands,
      { id: 'layout-save', label: 'SAVE CURRENT LAYOUT', description: 'Persist the current desk arrangement', category: 'LAYOUT', keywords: 'save desk workspace layout', run: () => clickExisting('deckSaveBtn') },
      { id: 'layout-pack', label: 'AUTO ARRANGE', description: 'Pack visible modules without gaps', category: 'LAYOUT', keywords: 'arrange pack organize layout', run: () => clickExisting('deckPackBtn') },
      { id: 'layout-edit', label: 'EDIT DECK', description: 'Toggle layout editing mode', category: 'LAYOUT', keywords: 'edit deck layout move resize', run: () => clickExisting('deckModeBtn') },
      { id: 'layout-reset', label: 'RESET CURRENT LAYOUT', description: 'Restore this workspace to its default layout', category: 'LAYOUT', keywords: 'reset restore layout default', run: () => clickExisting('deckResetBtn') },
      { id: 'layout-export', label: 'EXPORT LAYOUTS', description: 'Save workspace layouts to a JSON file', category: 'LAYOUT', keywords: 'export backup layout json', run: () => clickExisting('deckExportBtn') },
      { id: 'layout-import', label: 'IMPORT LAYOUTS', description: 'Load workspace layouts from a JSON file', category: 'LAYOUT', keywords: 'import restore layout json', run: () => clickExisting('deckImportBtn') },
      { id: 'map-full', label: 'MAP WIDTH: FULL', description: 'Use the full 12-column map width', category: 'LAYOUT', keywords: 'map width full 12 columns', run: () => { close(); window.setTimeout(() => document.querySelector<HTMLButtonElement>('#mapLayoutMenu [data-map-span="3"]')?.click(), 0); } },
      { id: 'map-command-width', label: 'MAP WIDTH: COMMAND', description: 'Use the 8-column command map width', category: 'LAYOUT', keywords: 'map width command 8 columns', run: () => { close(); window.setTimeout(() => document.querySelector<HTMLButtonElement>('#mapLayoutMenu [data-map-span="2"]')?.click(), 0); } },
      { id: 'map-compact', label: 'MAP WIDTH: COMPACT', description: 'Use the 6-column compact map width', category: 'LAYOUT', keywords: 'map width compact 6 columns', run: () => { close(); window.setTimeout(() => document.querySelector<HTMLButtonElement>('#mapLayoutMenu [data-map-span="1"]')?.click(), 0); } },

      { id: 'theme-classic', label: 'THEME: WATCHTOWER CLASSIC', description: 'Original red command-center palette', category: 'APPEARANCE', keywords: 'theme classic red appearance', run: () => { setWatchtowerUiTheme('classic'); close(); } },
      { id: 'theme-shadow', label: 'THEME: PROJECT V SHADOW', description: 'Deep black with electric blue accents', category: 'APPEARANCE', keywords: 'theme shadow blue black project v appearance', run: () => { setWatchtowerUiTheme('shadow'); close(); } },
      { id: 'theme-midnight', label: 'THEME: MIDNIGHT', description: 'Dark navy intelligence palette', category: 'APPEARANCE', keywords: 'theme midnight navy dark appearance', run: () => { setWatchtowerUiTheme('midnight'); close(); } },

      { id: 'intel-search', label: 'SEARCH INTELLIGENCE', description: 'Open the existing Watchtower intelligence search', category: 'SYSTEM', keywords: 'search intelligence sources news events find', shortcut: 'SEARCH', run: () => { close(); window.setTimeout(() => window.dispatchEvent(new CustomEvent('project-v-search-modal-open')), 0); } },
      { id: 'api-keys', label: 'OPEN API KEYS', description: 'Configure API keys and data sources', category: 'SYSTEM', keywords: 'api keys data sources configuration settings', run: () => clickExisting('apiSettingsBtn') },
      { id: 'settings', label: 'OPEN SETTINGS', description: 'Open Watchtower settings', category: 'SYSTEM', keywords: 'settings preferences configuration', run: () => clickExisting('unifiedSettingsBtn') },
    ];

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const scoreCommand = (command: PaletteCommand, rawQuery: string): number => {
      const query = normalize(rawQuery);
      if (!query) return 1;
      const label = normalize(command.label);
      const description = normalize(command.description);
      const keywords = normalize(command.keywords || '');
      const category = normalize(command.category);
      const haystack = `${label} ${description} ${keywords} ${category}`;
      const tokens = query.split(/\s+/).filter(Boolean);
      if (!tokens.every((token) => haystack.includes(token))) return -1;
      if (label === query) return 100;
      if (label.startsWith(query)) return 80;
      if (label.includes(query)) return 60;
      if (keywords.includes(query)) return 45;
      return 20;
    };

    const updateSelection = () => {
      const items = [...results.querySelectorAll<HTMLButtonElement>('[data-v-palette-index]')];
      if (!items.length) return;
      selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
      items.forEach((item, index) => {
        const selected = index === selectedIndex;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
      });
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    };

    const render = (query = input.value) => {
      filtered = commands
        .map((command, order) => ({ command, order, score: scoreCommand(command, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((entry) => entry.command);
      selectedIndex = 0;

      if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? 'COMMAND' : 'COMMANDS'}`;
      if (!filtered.length) {
        results.innerHTML = `<div class="v-command-palette-empty"><strong>NO COMMAND MATCH</strong><span>Try camera, alerts, shadow, map width, OSINT, or search.</span></div>`;
        return;
      }

      let lastCategory = '';
      results.innerHTML = filtered.map((command, index) => {
        const category = command.category !== lastCategory
          ? `<div class="v-command-palette-category">${escapeHtml(command.category)}</div>`
          : '';
        lastCategory = command.category;
        return `${category}<button type="button" class="v-command-palette-item" role="option" aria-selected="${index === 0}" data-v-palette-index="${index}"><span class="v-command-palette-item-mark">›</span><span><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.description)}</small></span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : '<span class="v-command-palette-enter">ENTER</span>'}</button>`;
      }).join('');
      updateSelection();
    };

    const close = () => {
      palette.classList.remove('open');
      backdrop.classList.remove('open');
      palette.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('v-command-palette-open');
      input.value = '';
    };

    const open = () => {
      // The command palette supersedes the V drawer when opened.
      document.getElementById('vCommandDrawer')?.classList.remove('open');
      document.getElementById('vCommandDrawerBackdrop')?.classList.remove('open');
      document.getElementById('vCommandMenuBtn')?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('v-command-drawer-open');
      palette.classList.add('open');
      backdrop.classList.add('open');
      palette.setAttribute('aria-hidden', 'false');
      document.body.classList.add('v-command-palette-open');
      render('');
      window.requestAnimationFrame(() => input.focus());
    };

    const executeSelected = (index = selectedIndex) => {
      const command = filtered[index];
      if (!command) return;
      command.run();
    };

    const onInput = () => render();
    const onResultsClick = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-v-palette-index]');
      if (!button) return;
      const index = Number(button.dataset.vPaletteIndex);
      if (Number.isFinite(index)) executeSelected(index);
    };
    const onResultsMouseMove = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-v-palette-index]');
      if (!button) return;
      const index = Number(button.dataset.vPaletteIndex);
      if (!Number.isFinite(index) || index === selectedIndex) return;
      selectedIndex = index;
      updateSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (shortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (palette.classList.contains('open')) close();
        else open();
        return;
      }
      if (!palette.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filtered.length) selectedIndex = (selectedIndex + 1) % filtered.length;
        updateSelection();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filtered.length) selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        updateSelection();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        executeSelected();
      }
    };
    const onOpenRequest = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      open();
    };

    input.addEventListener('input', onInput);
    results.addEventListener('click', onResultsClick);
    results.addEventListener('mousemove', onResultsMouseMove);
    closeButton?.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('project-v-command-palette-open', onOpenRequest);

    this.commandPaletteCleanup = () => {
      close();
      input.removeEventListener('input', onInput);
      results.removeEventListener('click', onResultsClick);
      results.removeEventListener('mousemove', onResultsMouseMove);
      closeButton?.removeEventListener('click', close);
      backdrop.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('project-v-command-palette-open', onOpenRequest);
    };
  }

  private readMissionProfile(): MissionProfileId {
    try {
      const stored = localStorage.getItem(MISSION_PROFILE_STORAGE_KEY);
      return isMissionProfileId(stored) ? stored : 'custom';
    } catch {
      return 'custom';
    }
  }

  private writeMissionProfile(profileId: MissionProfileId): void {
    try {
      localStorage.setItem(MISSION_PROFILE_STORAGE_KEY, profileId);
    } catch {
      // The selected mission still applies for this session if storage is unavailable.
    }
    document.body.dataset.missionProfile = profileId;
    this.syncMissionProfileUi(profileId);
    window.dispatchEvent(new CustomEvent('project-v-mission-profile-change', { detail: { profileId } }));
  }

  private markMissionProfileCustom(): void {
    if (this.applyingMissionProfile) return;
    const storedProfileId = this.readMissionProfile();
    if (storedProfileId === 'custom') return;
    const profile = getMissionProfile(storedProfileId);
    if (!profile?.workspaceId || !profile.presetId || !this.deckWorkspaces) {
      this.writeMissionProfile('custom');
      return;
    }

    const activeDeckMatches = this.deckWorkspaces.getActiveDeck() === profile.workspaceId;
    const activePresetMatches = this.deckWorkspaces.getActivePreset() === profile.presetId;
    const currentPins = this.readCommandBarPins();
    const expectedPins = profile.quickBar.filter((id): id is CommandBarCommandId =>
      COMMAND_BAR_COMMANDS.some((command) => command.id === id));
    const quickBarMatches = currentPins.size === expectedPins.length
      && expectedPins.every((id) => currentPins.has(id));

    if (!activeDeckMatches || !activePresetMatches || !quickBarMatches) {
      this.writeMissionProfile('custom');
    }
  }

  private applyMissionProfile(profileId: MissionProfileId): void {
    const profile = getMissionProfile(profileId);
    if (!profile) return;
    if (profile.id === 'custom') {
      this.writeMissionProfile('custom');
      return;
    }
    if (!profile.workspaceId || !profile.presetId || !this.deckWorkspaces) return;

    this.applyingMissionProfile = true;
    try {
      this.deckWorkspaces.activate(profile.workspaceId);
      this.deckWorkspaces.applyPreset(profile.presetId);
      const allowedPins = profile.quickBar.filter((id): id is CommandBarCommandId =>
        COMMAND_BAR_COMMANDS.some((command) => command.id === id));
      this.writeCommandBarPins(new Set(allowedPins));
      this.writeMissionProfile(profile.id);
      this.updatePresetUi();
    } finally {
      this.applyingMissionProfile = false;
    }
    this.syncCommandDrawerState();
  }

  private syncMissionProfileUi(profileId = this.readMissionProfile()): void {
    const activeProfile = getMissionProfile(profileId) ?? getMissionProfile('custom');
    document.body.dataset.missionProfile = profileId;
    const label = document.getElementById('vMissionProfileActiveLabel');
    if (label) label.textContent = activeProfile?.label ?? 'CUSTOM';
    document.querySelectorAll<HTMLButtonElement>('#vCommandDrawer [data-v-mission-profile]').forEach((button) => {
      const active = button.dataset.vMissionProfile === profileId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      const state = button.querySelector<HTMLElement>('[data-v-mission-state]');
      if (state) state.textContent = active ? 'ACTIVE' : 'APPLY';
    });
  }

  private readCommandBarPins(): Set<CommandBarCommandId> {
    const all = new Set<CommandBarCommandId>(COMMAND_BAR_COMMANDS.map((command) => command.id));
    try {
      const raw = localStorage.getItem(COMMAND_BAR_STORAGE_KEY);
      if (!raw) return all;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return all;
      return new Set(parsed.filter((value): value is CommandBarCommandId =>
        typeof value === 'string' && COMMAND_BAR_COMMANDS.some((command) => command.id === value)));
    } catch {
      return all;
    }
  }

  private writeCommandBarPins(pinned: Set<CommandBarCommandId>): void {
    try {
      localStorage.setItem(COMMAND_BAR_STORAGE_KEY, JSON.stringify([...pinned]));
    } catch {
      // The command bar still updates for this session if persistent storage is unavailable.
    }
    this.applyCommandBarPreferences(pinned);
    window.dispatchEvent(new CustomEvent('project-v-command-bar-change', { detail: { pinned: [...pinned] } }));
  }

  private applyCommandBarPreferences(pinned = this.readCommandBarPins()): void {
    COMMAND_BAR_COMMANDS.forEach((command) => {
      const visible = pinned.has(command.id);
      document.querySelectorAll<HTMLElement>(`[data-v-command-key="${CSS.escape(command.id)}"]`).forEach((element) => {
        element.classList.toggle('v-command-bar-hidden', !visible);
        element.setAttribute('aria-hidden', String(!visible));
      });
    });
    this.syncCommandBarCustomizerState(pinned);
  }

  private syncCommandBarCustomizerState(pinned = this.readCommandBarPins()): void {
    document.querySelectorAll<HTMLButtonElement>('#vCommandDrawer [data-v-command-bar]').forEach((button) => {
      const commandId = button.dataset.vCommandBar as CommandBarCommandId | undefined;
      if (!commandId) return;
      const active = pinned.has(commandId);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      const state = button.querySelector<HTMLElement>('[data-v-command-bar-state]');
      if (state) state.textContent = active ? 'PINNED' : 'DRAWER ONLY';
    });

    const count = document.getElementById('vCommandBarPinnedCount');
    if (count) count.textContent = `${pinned.size} / ${COMMAND_BAR_COMMANDS.length} PINNED`;
  }

  private syncCommandDrawerState(): void {
    const activeDeck = this.deckWorkspaces?.getActiveDeck();
    document.querySelectorAll<HTMLButtonElement>('#vCommandDrawer [data-v-deck-id]').forEach((button) => {
      button.classList.toggle('active', button.dataset.vDeckId === activeDeck);
    });

    const activePreset = this.deckWorkspaces?.getActivePreset();
    document.querySelectorAll<HTMLButtonElement>('#vCommandDrawer [data-v-preset-id]').forEach((button) => {
      button.classList.toggle('active', button.dataset.vPresetId === activePreset);
    });

    const uiTheme = getCurrentWatchtowerUiTheme();
    document.querySelectorAll<HTMLButtonElement>('#vCommandDrawer [data-v-theme]').forEach((button) => {
      const active = button.dataset.vTheme === uiTheme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });

    this.syncMissionProfileUi();

    const copyCount = (sourceId: string, targetId: string) => {
      const source = document.getElementById(sourceId);
      const target = document.getElementById(targetId);
      if (source && target) target.textContent = source.textContent?.trim() || '0';
    };
    copyCount('moduleLibraryCount', 'vCommandModuleCount');
    copyCount('pluginManagerCount', 'vCommandPluginCount');
    copyCount('operationsAlertCount', 'vCommandAlertCount');

    const bridgeStatuses = listProjectVBridgeStatuses();
    const bridgeReady = bridgeStatuses.filter((status) => status.ready).length;
    const bridgeCount = document.getElementById('vAppBridgeConnectedCount');
    if (bridgeCount) bridgeCount.textContent = `${bridgeReady} / ${bridgeStatuses.length} READY`;
    bridgeStatuses.forEach((status) => {
      const card = document.querySelector<HTMLElement>(`[data-v-bridge-card="${CSS.escape(status.definition.id)}"]`);
      if (!card) return;
      const state = card.querySelector<HTMLElement>('[data-v-bridge-state]');
      const path = card.querySelector<HTMLElement>('[data-v-bridge-path]');
      const openButton = card.querySelector<HTMLButtonElement>('[data-v-bridge-action="open"]');
      const configureButton = card.querySelector<HTMLButtonElement>('[data-v-bridge-action="configure"]');
      const disconnectButton = card.querySelector<HTMLButtonElement>('[data-v-bridge-action="disconnect"]');

      card.classList.toggle('ready', status.ready);
      card.classList.toggle('detected', status.connection === 'detected');
      card.classList.toggle('needs-approval', Boolean(status.application) && !status.application?.approved);
      if (state) {
        state.textContent = status.ready
          ? (status.connection === 'detected' ? 'DETECTED · READY' : 'CONNECTED · READY')
          : status.application ? 'NEEDS APPROVAL' : 'NOT CONNECTED';
      }
      if (path) {
        path.textContent = status.application?.path ?? 'NO EXECUTABLE';
        path.title = status.application?.path ?? '';
      }
      if (openButton) openButton.disabled = !status.ready;
      if (configureButton) configureButton.textContent = status.application ? 'RECONNECT' : 'CONNECT';
      if (disconnectButton) disconnectButton.disabled = status.connection !== 'bound';
    });

    const phoenixBridge = getPhoenixBridgeSnapshot();
    const phoenixCard = document.querySelector<HTMLElement>('[data-v-phoenix-bridge-card]');
    if (phoenixCard) {
      const state = phoenixCard.querySelector<HTMLElement>('[data-v-phoenix-state]');
      const endpoint = phoenixCard.querySelector<HTMLElement>('[data-v-phoenix-endpoint]');
      const detail = phoenixCard.querySelector<HTMLElement>('[data-v-phoenix-detail]');
      const pairButton = phoenixCard.querySelector<HTMLButtonElement>('[data-v-phoenix-action="pair"]');
      const testButton = phoenixCard.querySelector<HTMLButtonElement>('[data-v-phoenix-action="test"]');
      const disconnectButton = phoenixCard.querySelector<HTMLButtonElement>('[data-v-phoenix-action="disconnect"]');
      const auto = phoenixCard.querySelector<HTMLInputElement>('[data-v-phoenix-setting="auto"]');
      const minimum = phoenixCard.querySelector<HTMLSelectElement>('[data-v-phoenix-setting="minimum"]');
      const paired = phoenixBridge.config.paired;
      const online = paired && phoenixBridge.runtime.online;
      phoenixCard.classList.toggle('ready', online);
      phoenixCard.classList.toggle('detected', paired && !online);
      if (state) state.textContent = online
        ? 'PAIRED · ONLINE'
        : paired ? (phoenixBridge.runtime.checking ? 'PAIRED · CHECKING' : 'PAIRED · OFFLINE') : 'NOT PAIRED';
      if (endpoint) {
        endpoint.textContent = phoenixBridge.config.endpoint;
        endpoint.title = phoenixBridge.config.endpoint;
      }
      if (detail) detail.textContent = paired ? phoenixBridge.runtime.detail : 'Copy receiver pairing JSON from Phoenix 0.9.8 and pair it here.';
      if (pairButton) pairButton.textContent = paired ? 'REPAIR' : 'PAIR PHOENIX';
      if (testButton) testButton.disabled = !paired;
      if (disconnectButton) disconnectButton.disabled = !paired;
      if (auto) auto.checked = phoenixBridge.config.autoForward;
      if (minimum) minimum.value = phoenixBridge.config.minimumSeverity;
    }

    const securitySettings = getSecuritySettings();
    const accessGateState = document.getElementById('vAccessGateState');
    const accessGateDetail = document.getElementById('vAccessGateDetail');
    if (accessGateState) {
      accessGateState.textContent = securitySettings.accessGateEnabled && securitySettings.pin
        ? 'ARMED'
        : securitySettings.pin ? 'PIN READY' : 'NOT ARMED';
    }
    if (accessGateDetail) {
      accessGateDetail.textContent = securitySettings.accessGateEnabled && securitySettings.pin
        ? 'Startup authorization is enabled. Watchtower will require the local PIN before revealing the command deck.'
        : securitySettings.pin
          ? 'A local PIN is configured. Open Security Settings to arm startup authorization.'
          : 'Project Lock is available from Security Center. Set a PIN to enable startup authorization.';
    }

    this.syncCommandBarCustomizerState();
  }

  private setupWorkspaceControls(): void {
    const grid = document.getElementById('panelsGrid');
    const mapSection = document.getElementById('mapSection');
    const scrollContainer = document.querySelector<HTMLElement>('.main-content');
    if (!grid || !mapSection) return;

    this.deckWorkspaces = new DeckWorkspaceManager({
      grid,
      mapSection,
      scrollContainer,
      onActivated: (workspace) => this.updateWorkspaceUi(workspace),
      onLayoutApplied: () => this.ctx.map?.render(),
    });
    this.deckWorkspaces.init();
    this.deckEditor = new DeckEditorController({
      grid,
      workspaces: this.deckWorkspaces,
      onMapLayoutChanged: () => this.ctx.map?.render(),
    });
    this.deckEditor.init();
    this.setupPresetControls();
    this.setupWorkspaceManager();

    document.querySelectorAll<HTMLButtonElement>('[data-deck-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const deckId = button.dataset.deckId as DeckWorkspaceId | undefined;
        if (deckId) this.deckWorkspaces?.activate(deckId);
      });
    });

    document.getElementById('deckResetBtn')?.addEventListener('click', () => {
      const active = this.deckWorkspaces?.getActiveWorkspace();
      if (!active) return;
      if (window.confirm(`Reset ${active.label} to its default layout?`)) {
        this.deckWorkspaces?.resetActive();
      }
    });

    document.getElementById('deckExportBtn')?.addEventListener('click', () => {
      if (!this.deckWorkspaces) return;
      const blob = new Blob([this.deckWorkspaces.exportLayouts()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `project-v-watchtower-decks-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });

    const importInput = document.getElementById('deckImportInput') as HTMLInputElement | null;
    document.getElementById('deckImportBtn')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file || !this.deckWorkspaces) return;
      try {
        this.deckWorkspaces.importLayouts(await file.text());
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import this layout file.';
        window.alert(message);
      }
    });
  }

  private setupPresetControls(): void {
    const button = document.getElementById('layoutPresetBtn') as HTMLButtonElement | null;
    const menu = document.getElementById('layoutPresetMenu');
    const closeButton = document.getElementById('layoutManagerCloseBtn') as HTMLButtonElement | null;
    if (!button || !menu) return;

    const close = () => {
      menu.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    };

    const refresh = () => {
      this.updatePresetUi();
      this.updateLayoutManagerUi();
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
      if (open) this.updateLayoutManagerUi();
    });

    closeButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      close();
      button.focus();
    });

    menu.addEventListener('click', (event) => {
      const target = event.target as Element;
      const choice = target.closest<HTMLButtonElement>('[data-preset-id]');
      if (choice && this.deckWorkspaces) {
        const preset = choice.dataset.presetId as Exclude<DeckPresetId, 'custom'> | undefined;
        if (!preset) return;
        this.deckWorkspaces.applyPreset(preset);
        close();
        refresh();
        return;
      }

      const mapChoice = target.closest<HTMLButtonElement>('[data-layout-map-span]');
      if (mapChoice) {
        const span = mapChoice.dataset.layoutMapSpan;
        if (!span) return;
        document.querySelector<HTMLButtonElement>(`#mapLayoutMenu [data-map-span="${CSS.escape(span)}"]`)?.click();
        window.requestAnimationFrame(refresh);
        return;
      }

      const actionButton = target.closest<HTMLButtonElement>('[data-layout-action]');
      const action = actionButton?.dataset.layoutAction;
      if (!action) return;

      const proxyClick = (id: string) => document.getElementById(id)?.click();
      switch (action) {
        case 'save':
          proxyClick('deckSaveBtn');
          break;
        case 'auto-arrange':
          proxyClick('deckPackBtn');
          break;
        case 'edit':
          proxyClick('deckModeBtn');
          break;
        case 'duplicate':
          proxyClick('workspaceDuplicateBtn');
          close();
          break;
        case 'new':
          proxyClick('workspaceNewBtn');
          close();
          break;
        case 'rename':
          proxyClick('workspaceRenameBtn');
          close();
          break;
        case 'default':
          proxyClick('workspaceDefaultBtn');
          break;
        case 'desks':
          close();
          proxyClick('workspaceManagerBtn');
          break;
        case 'export':
          proxyClick('deckExportBtn');
          close();
          break;
        case 'import':
          proxyClick('deckImportBtn');
          close();
          break;
        case 'reset':
          proxyClick('deckResetBtn');
          close();
          break;
        default:
          return;
      }
      window.requestAnimationFrame(refresh);
    });

    document.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.v-preset-control')) return;
      close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.classList.contains('open')) return;
      close();
      button.focus();
    });

    window.addEventListener('project-v-workspace-preset-change', refresh);
    window.addEventListener('project-v-workspace-activated', refresh);
    window.addEventListener('project-v-workspace-list-change', refresh);
    window.addEventListener('project-v-layout-change', refresh);
    window.addEventListener('project-v-layout-reset', refresh);
    refresh();
  }

  private updatePresetUi(): void {
    if (!this.deckWorkspaces) return;
    const activePreset = this.deckWorkspaces.getActivePreset();
    const label = document.getElementById('layoutPresetLabel');
    const presetDefinition = DECK_PRESETS.find((preset) => preset.id === activePreset);
    if (label) label.textContent = `LAYOUT: ${presetDefinition?.label ?? 'CUSTOM'}`;
    document.querySelectorAll<HTMLButtonElement>('[data-preset-id]').forEach((button) => {
      button.classList.toggle('active', button.dataset.presetId === activePreset);
    });
    document.body.dataset.deckPreset = activePreset;
    this.updateLayoutManagerUi();
  }

  private updateLayoutManagerUi(): void {
    if (!this.deckWorkspaces) return;
    const workspace = this.deckWorkspaces.getActiveWorkspace();
    const preset = this.deckWorkspaces.getActivePreset();
    const presetDefinition = DECK_PRESETS.find((item) => item.id === preset);
    const mapWidth = this.deckWorkspaces.getPanelGeometry('map')?.w ?? workspace.mapWidth;
    const mapMode = mapWidth >= 12 ? 'FULL' : mapWidth >= 8 ? 'COMMAND' : 'COMPACT';
    const defaultDeck = this.deckWorkspaces.getDefaultDeck();

    const deskName = document.getElementById('layoutManagerDeskName');
    const summary = document.getElementById('layoutManagerSummary');
    const kindBadge = document.getElementById('layoutManagerKindBadge');
    const defaultBadge = document.getElementById('layoutManagerDefaultBadge');
    const renameButton = document.getElementById('layoutManagerRenameBtn') as HTMLButtonElement | null;
    const defaultButton = document.getElementById('layoutManagerDefaultBtn') as HTMLButtonElement | null;

    if (deskName) deskName.textContent = workspace.label;
    if (summary) summary.textContent = `${presetDefinition?.label ?? 'CUSTOM'} · MAP ${mapMode}`;
    if (kindBadge) kindBadge.textContent = workspace.builtIn ? 'CORE DESK' : 'CUSTOM DESK';
    if (defaultBadge) defaultBadge.hidden = workspace.id !== defaultDeck;
    if (renameButton) {
      renameButton.disabled = workspace.builtIn;
      renameButton.title = workspace.builtIn ? 'Duplicate a core desk before renaming it' : 'Rename this custom desk';
    }
    if (defaultButton) {
      const isDefault = workspace.id === defaultDeck;
      defaultButton.disabled = isDefault;
      defaultButton.textContent = isDefault ? 'DEFAULT DESK' : 'SET DEFAULT';
    }

    document.querySelectorAll<HTMLButtonElement>('[data-layout-map-span]').forEach((mapButton) => {
      const span = Number.parseInt(mapButton.dataset.layoutMapSpan ?? '0', 10);
      const active = span === 3 ? mapWidth >= 12 : span === 2 ? mapWidth >= 8 && mapWidth < 12 : mapWidth < 8;
      mapButton.classList.toggle('active', active);
    });
  }

  private setupWorkspaceManager(): void {
    const openButton = document.getElementById('workspaceManagerBtn');
    const closeButton = document.getElementById('workspaceManagerClose');
    const drawer = document.getElementById('workspaceManagerDrawer');
    const backdrop = document.getElementById('workspaceManagerBackdrop');
    const list = document.getElementById('workspaceManagerList');

    const open = () => {
      this.renderWorkspaceManager();
      drawer?.classList.add('open');
      backdrop?.classList.add('open');
      document.body.classList.add('workspace-manager-open');
    };
    const close = () => {
      drawer?.classList.remove('open');
      backdrop?.classList.remove('open');
      document.body.classList.remove('workspace-manager-open');
    };

    openButton?.addEventListener('click', open);
    closeButton?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    list?.addEventListener('click', (event) => {
      const choice = (event.target as Element).closest<HTMLButtonElement>('[data-workspace-id]');
      const workspaceId = choice?.dataset.workspaceId;
      if (!workspaceId || !this.deckWorkspaces) return;
      this.deckWorkspaces.activate(workspaceId);
      this.renderWorkspaceManager();
    });

    document.getElementById('workspaceNewBtn')?.addEventListener('click', () => {
      if (!this.deckWorkspaces) return;
      const label = window.prompt('Name the new Project V workspace:', 'NEW COMMAND DESK');
      if (!label?.trim()) return;
      this.deckWorkspaces.createWorkspace(label.trim(), 'watchtower', false);
      this.renderWorkspaceManager();
    });

    document.getElementById('workspaceDuplicateBtn')?.addEventListener('click', () => {
      if (!this.deckWorkspaces) return;
      const current = this.deckWorkspaces.getActiveWorkspace();
      const label = window.prompt('Name the duplicated workspace:', `${current.label} COPY`);
      if (!label?.trim()) return;
      this.deckWorkspaces.duplicateActive(label.trim());
      this.renderWorkspaceManager();
    });

    document.getElementById('workspaceRenameBtn')?.addEventListener('click', () => {
      if (!this.deckWorkspaces) return;
      const current = this.deckWorkspaces.getActiveWorkspace();
      if (current.builtIn) {
        window.alert('Built-in Project V workspaces are protected. Duplicate it first, then rename the copy.');
        return;
      }
      const label = window.prompt('Rename this workspace:', current.label);
      if (!label?.trim()) return;
      this.deckWorkspaces.renameActive(label.trim());
      this.renderWorkspaceManager();
    });

    document.getElementById('workspaceDefaultBtn')?.addEventListener('click', () => {
      this.deckWorkspaces?.setActiveAsDefault();
      this.renderWorkspaceManager();
    });

    document.getElementById('workspaceDeleteBtn')?.addEventListener('click', () => {
      if (!this.deckWorkspaces) return;
      const current = this.deckWorkspaces.getActiveWorkspace();
      if (current.builtIn) {
        window.alert('Built-in Project V workspaces cannot be deleted.');
        return;
      }
      if (!window.confirm(`Delete the custom workspace “${current.label}”?`)) return;
      this.deckWorkspaces.deleteActiveWorkspace();
      this.renderWorkspaceManager();
    });

    const refresh = () => this.renderWorkspaceManager();
    window.addEventListener('project-v-workspace-list-change', refresh);
    window.addEventListener('project-v-workspace-activated', refresh);
    this.renderWorkspaceManager();
  }

  private renderWorkspaceManager(): void {
    const list = document.getElementById('workspaceManagerList');
    if (!list || !this.deckWorkspaces) return;
    const activeId = this.deckWorkspaces.getActiveDeck();
    const defaultId = this.deckWorkspaces.getDefaultDeck();
    const definitions = this.deckWorkspaces.getWorkspaceDefinitions();
    list.innerHTML = definitions.map((workspace) => {
      const active = workspace.id === activeId;
      const defaultDesk = workspace.id === defaultId;
      const kind = workspace.builtIn ? 'CORE' : 'CUSTOM';
      return `
        <button type="button" class="v-workspace-manager-item ${active ? 'active' : ''}" data-workspace-id="${escapeHtml(workspace.id)}">
          <span class="v-workspace-kind">${kind}</span>
          <span class="v-workspace-copy"><strong>${escapeHtml(workspace.label)}</strong><small>${escapeHtml(workspace.subtitle)}</small></span>
          ${defaultDesk ? '<span class="v-workspace-default">DEFAULT</span>' : ''}
          ${active ? '<span class="v-workspace-active">ACTIVE</span>' : ''}
        </button>
      `;
    }).join('');

    const customActive = this.deckWorkspaces.isActiveWorkspaceCustom();
    const rename = document.getElementById('workspaceRenameBtn') as HTMLButtonElement | null;
    const remove = document.getElementById('workspaceDeleteBtn') as HTMLButtonElement | null;
    if (rename) rename.disabled = !customActive;
    if (remove) remove.disabled = !customActive;
  }

  private updateWorkspaceUi(workspace: DeckWorkspaceDefinition): void {
    document.querySelectorAll<HTMLButtonElement>('[data-deck-id]').forEach((button) => {
      const active = button.dataset.deckId === workspace.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const managerButton = document.getElementById('workspaceManagerBtn');
    managerButton?.classList.toggle('active', !workspace.builtIn);
    if (managerButton) managerButton.textContent = workspace.builtIn ? 'DESKS ▾' : `${workspace.label} ▾`;
    const title = document.getElementById('workspaceTitle');
    const subtitle = document.getElementById('workspaceSubtitle');
    if (title) title.textContent = workspace.label;
    if (subtitle) subtitle.textContent = workspace.subtitle;
    this.updatePresetUi();
    this.renderWorkspaceManager();
  }

  private setupPluginSystem(): void {
    if (!this.deckWorkspaces) return;
    this.pluginManager?.destroy();
    this.pluginManager = new PluginManagerController({
      registry: this.moduleRegistry,
      workspaces: this.deckWorkspaces,
      getPanel: (panelId) => this.ctx.panels[panelId],
    });
    this.pluginManager.init();

    const onRegistryChange = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; pluginId?: string }>).detail;
      this.syncPluginPanels(detail?.pluginId, detail?.action);
    };
    window.addEventListener('project-v-plugin-registry-change', onRegistryChange);
    this.pluginRegistryCleanup = () => window.removeEventListener('project-v-plugin-registry-change', onRegistryChange);
  }

  private mountEnabledPluginPanels(grid: HTMLElement): void {
    if (isProjectVSafeModeActive()) return;
    for (const plugin of this.moduleRegistry.getEnabledPlugins()) {
      const panelId = pluginPanelId(plugin.manifest.id);
      if (this.ctx.panels[panelId]) continue;
      const panel = new PluginPanel({
        manifest: plugin.manifest,
        getWorkspaceId: () => this.deckWorkspaces?.getActiveDeck() ?? 'watchtower',
      });
      this.ctx.panels[panelId] = panel;
      grid.appendChild(panel.getElement());
      this.moduleRegistry.registerPluginPanel(panel.getElement(), plugin.manifest);
    }
  }

  private syncPluginPanels(changedPluginId?: string, action?: string): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const snapshot = this.deckWorkspaces?.getCurrentLayout();
    const enabledPlugins = isProjectVSafeModeActive() ? [] : this.moduleRegistry.getEnabledPlugins();
    const enabled = new Map(enabledPlugins.map((plugin) => [plugin.manifest.id, plugin]));
    const newlyMounted: string[] = [];
    let changed = false;

    for (const [panelId, panel] of Object.entries(this.ctx.panels)) {
      const pluginId = panel.getElement().dataset.pluginId;
      if (!pluginId) continue;
      const installed = enabled.get(pluginId);
      const forceReplace = pluginId === changedPluginId && (action === 'installed' || action === 'permissions');
      if (!installed || forceReplace) {
        panel.destroy();
        panel.getElement().remove();
        delete this.ctx.panels[panelId];
        this.moduleRegistry.unregisterPanel(panelId);
        changed = true;
      }
    }

    for (const plugin of enabled.values()) {
      const panelId = pluginPanelId(plugin.manifest.id);
      if (this.ctx.panels[panelId]) continue;
      const panel = new PluginPanel({
        manifest: plugin.manifest,
        getWorkspaceId: () => this.deckWorkspaces?.getActiveDeck() ?? 'watchtower',
      });
      this.ctx.panels[panelId] = panel;
      grid.appendChild(panel.getElement());
      this.moduleRegistry.registerPluginPanel(panel.getElement(), plugin.manifest);
      newlyMounted.push(panelId);
      changed = true;
    }

    this.moduleRegistry.registerBuiltInPanels(grid);
    if (changed && this.deckWorkspaces) {
      if (snapshot) this.deckWorkspaces.restoreSnapshot(snapshot);
      if ((action === 'installed' || action === 'enabled') && changedPluginId) {
        const panelId = pluginPanelId(changedPluginId);
        if (newlyMounted.includes(panelId)) this.deckWorkspaces.setPanelHidden(panelId, false);
      }
    }
    this.deckEditor?.refresh();
    this.pluginManager?.render();
    window.dispatchEvent(new CustomEvent('project-v-module-state-change'));
  }

  private setupVoiceCommandCenter(): void {
    if (!this.deckWorkspaces) return;
    this.voiceCommandCenter?.destroy();
    this.voiceCommandCenter = new VoiceCommandCenterController({
      activateWorkspace: (workspaceId) => this.deckWorkspaces?.activate(workspaceId),
      setMapView: (view) => {
        this.ctx.map?.setView(view);
        const select = document.getElementById('regionSelect') as HTMLSelectElement | null;
        if (select) select.value = view;
      },
      showPanel: (panelId, workspaceId) => {
        if (workspaceId) this.deckWorkspaces?.activate(workspaceId);
        this.deckWorkspaces?.setPanelHidden(panelId, false);
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-panel="${CSS.escape(panelId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      },
      openSecurityCenter: () => document.getElementById('securityCenterBtn')?.click(),
      openAlerts: () => document.getElementById('operationsAlertBtn')?.click(),
      lockWatchtower: () => this.securityCenter?.lockNow(),
      submitAssistant: (prompt, scope, speakReply) => {
        this.deckWorkspaces?.activate('assistant');
        this.deckWorkspaces?.setPanelHidden('command-assistant', false);
        window.setTimeout(() => {
          const panel = document.querySelector<HTMLElement>('[data-panel="command-assistant"]');
          panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.dispatchEvent(new CustomEvent('project-v-assistant-submit', { detail: { prompt, scope, speakReply } }));
        }, 100);
      },
      readLastAssistantResponse: () => {
        try {
          const history = JSON.parse(localStorage.getItem('project-v-command-assistant-history-v1') ?? '[]') as Array<{ role?: string; content?: string }>;
          const latest = history.slice().reverse().find((message) => message.role === 'assistant' && typeof message.content === 'string');
          return latest?.content ?? null;
        } catch {
          return null;
        }
      },
    });
    this.voiceCommandCenter.init();
  }

  private setupLaunchDeckControl(): void {
    document.getElementById('launchDeckBtn')?.addEventListener('click', () => void openProjectVWorkspaceWindow('launch-desk'));
  }

  private setupCameraWallControl(): void {
    document.getElementById('cameraWallBtn')?.addEventListener('click', () => void openProjectVWorkspaceWindow('camera-desk'));
  }

  private setupAnalysisRoomControl(): void {
    document.getElementById('analysisRoomBtn')?.addEventListener('click', () => void openProjectVWorkspaceWindow('analysis-room'));
  }

  private setupOsintDeskControl(): void {
    document.getElementById('osintDeskBtn')?.addEventListener('click', () => void openProjectVWorkspaceWindow('osint-desk'));
  }

  private setupSecurityCenter(): void {
    if (!this.deckWorkspaces) return;
    this.securityCenter?.destroy();
    this.securityCenter = new SecurityCenterController({
      ctx: this.ctx,
      workspaces: this.deckWorkspaces,
      registry: this.moduleRegistry,
    });
    this.securityCenter.init();
  }

  private setupOperationsControl(): void {
    const button = document.getElementById('operationsAlertBtn') as HTMLButtonElement | null;
    if (!button || !this.operationsCenter) return;
    const update = () => {
      const openAlerts = this.operationsCenter?.getAlerts().filter((alert) => alert.status === 'open') ?? [];
      const priority = openAlerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'high').length;
      const count = document.getElementById('operationsAlertCount');
      if (count) count.textContent = openAlerts.length > 99 ? '99+' : String(openAlerts.length);
      button.classList.toggle('has-alerts', openAlerts.length > 0);
      button.classList.toggle('has-critical', priority > 0);
      button.title = priority > 0
        ? `${priority} high-priority operational alerts need review.`
        : 'Open the operational Alert Center';
    };
    button.addEventListener('click', () => {
      this.deckWorkspaces?.activate('live-ops');
      this.deckWorkspaces?.setPanelHidden('alert-center', false);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-panel="alert-center"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    const mapActionHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: 'timeline' | 'alert' | 'sentinel'; item?: MapPopupIntelligenceItem }>).detail;
      if (!detail?.item || !detail.action || !this.operationsCenter) return;
      const item = detail.item;
      if (detail.action === 'timeline') {
        this.operationsCenter.addTimelineEvent({
          title: item.title,
          detail: item.detail || `Selected from the built-in Watchtower map (${item.category}).`,
          category: item.category,
          source: item.source,
          link: item.sourceUrl,
          occurredAt: item.occurredAt,
          confidence: 'unverified',
        });
      } else if (detail.action === 'alert') {
        this.operationsCenter.addExternalAlert({
          title: item.title,
          detail: item.detail || `Analyst-created alert from a ${item.category} map signal.`,
          severity: item.severity,
          category: item.category,
          source: item.source,
          link: item.sourceUrl,
          location: item.location,
          sourceTime: item.occurredAt,
          fingerprint: `map-popup:${item.id}`,
        });
      } else {
        this.operationsCenter.addPhoenixSentinelFromSignal({
          title: item.title,
          location: item.location,
          category: item.category,
        });
      }
    };
    window.addEventListener('project-v-map-intelligence-action', mapActionHandler as EventListener);
    this.mapIntelligenceCleanup = () => window.removeEventListener('project-v-map-intelligence-action', mapActionHandler as EventListener);
    update();
    this.operationsUiCleanup = this.operationsCenter.subscribe(update);
  }

  private setupRuntimeSettingsControl(): void {
    const button = document.getElementById('apiSettingsBtn') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', () => void openRuntimeSettings());

    const update = () => {
      const count = document.getElementById('apiSettingsCount');
      const missing = RUNTIME_FEATURES.filter((feature) =>
        isFeatureEnabled(feature.id) && !isFeatureAvailable(feature.id)
      ).length;
      const locallyManaged = this.ctx.isDesktopApp || isLocalRuntimeConfigEnabled();

      button.classList.toggle('has-missing', locallyManaged && missing > 0);
      button.classList.toggle('is-ready', locallyManaged && missing === 0);
      button.classList.toggle('is-managed', !locallyManaged);
      if (count) count.textContent = locallyManaged ? (missing > 0 ? `${missing} MISSING` : 'READY') : 'SERVER';
      button.title = locallyManaged && missing > 0
        ? `${missing} enabled data features still need credentials. Open API settings.`
        : 'Open API keys and data-source configuration';
    };

    update();
    this.runtimeConfigCleanup = subscribeRuntimeConfig(update);
  }

  private setupDeckModeToggle(): void {
    const button = document.getElementById('deckModeBtn') as HTMLButtonElement | null;
    if (!button) return;

    const update = (editing: boolean) => {
      document.body.classList.toggle('deck-edit-mode', editing);
      button.classList.toggle('active', editing);
      button.setAttribute('aria-pressed', String(editing));
      button.innerHTML = editing
        ? '<span class="v-deck-mode-icon">◆</span> LOCK DECK'
        : '<span class="v-deck-mode-icon">◇</span> EDIT DECK';
      button.title = editing
        ? 'Lock the dashboard to prevent accidental movement'
        : 'Enable panel movement and resizing';
    };

    update(localStorage.getItem('project-v-layout-editing') === 'true');

    button.addEventListener('click', () => {
      const editing = !document.body.classList.contains('deck-edit-mode');
      localStorage.setItem('project-v-layout-editing', String(editing));
      update(editing);
    });
  }

  private setupMobileMapToggle(): void {
    const mapSection = document.getElementById('mapSection');
    const headerLeft = mapSection?.querySelector('.panel-header-left');
    if (!mapSection || !headerLeft) return;

    const stored = localStorage.getItem('mobile-map-collapsed');
    const collapsed = stored === null || stored === 'true';
    if (collapsed) mapSection.classList.add('collapsed');

    const updateBtn = (btn: HTMLButtonElement, isCollapsed: boolean) => {
      btn.textContent = isCollapsed ? `▶ ${t('components.map.showMap')}` : `▼ ${t('components.map.hideMap')}`;
    };

    const btn = document.createElement('button');
    btn.className = 'map-collapse-btn';
    updateBtn(btn, collapsed);
    headerLeft.after(btn);

    btn.addEventListener('click', () => {
      const isCollapsed = mapSection.classList.toggle('collapsed');
      updateBtn(btn, isCollapsed);
      localStorage.setItem('mobile-map-collapsed', String(isCollapsed));
      if (!isCollapsed) window.dispatchEvent(new Event('resize'));
    });
  }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    if (this.ctx.isMobile) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
      }
      document.body.classList.remove('has-critical-banner');
      return;
    }

    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return;
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-posture-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    this.criticalBannerEl.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
        <span class="banner-headline">${escapeHtml(top.headline)}</span>
        <span class="banner-stats">${top.totalAircraft} aircraft • ${escapeHtml(top.summary)}</span>
        ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">×</button>
    `;

    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      trackCriticalBannerAction('view', top.theaterId);
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.ctx.map?.setCenter(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      trackCriticalBannerAction('dismiss', top.theaterId);
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });
  }

  applyPanelSettings(): void {
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      const panel = this.ctx.panels[key];
      panel?.toggle(config.enabled);
    });
  }

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;

    const mapContainer = document.getElementById('mapContainer') as HTMLElement;
    this.ctx.map = new MapContainer(mapContainer, {
      zoom: this.ctx.isMobile ? 2.5 : 1.0,
      pan: { x: 0, y: 0 },
      view: this.ctx.isMobile ? this.ctx.resolvedLocation : 'global',
      layers: this.ctx.mapLayers,
      timeRange: '7d',
    });

    this.ctx.map.initEscalationGetters();
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange();

    const politicsPanel = new NewsPanel('politics', t('panels.politics'));
    this.attachRelatedAssetHandlers(politicsPanel);
    this.ctx.newsPanels['politics'] = politicsPanel;
    this.ctx.panels['politics'] = politicsPanel;

    const techPanel = new NewsPanel('tech', t('panels.tech'));
    this.attachRelatedAssetHandlers(techPanel);
    this.ctx.newsPanels['tech'] = techPanel;
    this.ctx.panels['tech'] = techPanel;

    const financePanel = new NewsPanel('finance', t('panels.finance'));
    this.attachRelatedAssetHandlers(financePanel);
    this.ctx.newsPanels['finance'] = financePanel;
    this.ctx.panels['finance'] = financePanel;

    const heatmapPanel = new HeatmapPanel();
    this.ctx.panels['heatmap'] = heatmapPanel;

    const marketsPanel = new MarketPanel();
    this.ctx.panels['markets'] = marketsPanel;

    const monitorPanel = new MonitorPanel(this.ctx.monitors);
    this.ctx.panels['monitors'] = monitorPanel;
    monitorPanel.onChanged((monitors) => {
      this.ctx.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      this.callbacks.updateMonitorResults();
    });

    const commoditiesPanel = new CommoditiesPanel();
    this.ctx.panels['commodities'] = commoditiesPanel;

    const predictionPanel = new PredictionPanel();
    this.ctx.panels['polymarket'] = predictionPanel;

    const govPanel = new NewsPanel('gov', t('panels.gov'));
    this.attachRelatedAssetHandlers(govPanel);
    this.ctx.newsPanels['gov'] = govPanel;
    this.ctx.panels['gov'] = govPanel;

    const intelPanel = new NewsPanel('intel', t('panels.intel'));
    this.attachRelatedAssetHandlers(intelPanel);
    this.ctx.newsPanels['intel'] = intelPanel;
    this.ctx.panels['intel'] = intelPanel;

    const cryptoPanel = new CryptoPanel();
    this.ctx.panels['crypto'] = cryptoPanel;

    const middleeastPanel = new NewsPanel('middleeast', t('panels.middleeast'));
    this.attachRelatedAssetHandlers(middleeastPanel);
    this.ctx.newsPanels['middleeast'] = middleeastPanel;
    this.ctx.panels['middleeast'] = middleeastPanel;

    const layoffsPanel = new NewsPanel('layoffs', t('panels.layoffs'));
    this.attachRelatedAssetHandlers(layoffsPanel);
    this.ctx.newsPanels['layoffs'] = layoffsPanel;
    this.ctx.panels['layoffs'] = layoffsPanel;

    const aiPanel = new NewsPanel('ai', t('panels.ai'));
    this.attachRelatedAssetHandlers(aiPanel);
    this.ctx.newsPanels['ai'] = aiPanel;
    this.ctx.panels['ai'] = aiPanel;

    const startupsPanel = new NewsPanel('startups', t('panels.startups'));
    this.attachRelatedAssetHandlers(startupsPanel);
    this.ctx.newsPanels['startups'] = startupsPanel;
    this.ctx.panels['startups'] = startupsPanel;

    const vcblogsPanel = new NewsPanel('vcblogs', t('panels.vcblogs'));
    this.attachRelatedAssetHandlers(vcblogsPanel);
    this.ctx.newsPanels['vcblogs'] = vcblogsPanel;
    this.ctx.panels['vcblogs'] = vcblogsPanel;

    const regionalStartupsPanel = new NewsPanel('regionalStartups', t('panels.regionalStartups'));
    this.attachRelatedAssetHandlers(regionalStartupsPanel);
    this.ctx.newsPanels['regionalStartups'] = regionalStartupsPanel;
    this.ctx.panels['regionalStartups'] = regionalStartupsPanel;

    const unicornsPanel = new NewsPanel('unicorns', t('panels.unicorns'));
    this.attachRelatedAssetHandlers(unicornsPanel);
    this.ctx.newsPanels['unicorns'] = unicornsPanel;
    this.ctx.panels['unicorns'] = unicornsPanel;

    const acceleratorsPanel = new NewsPanel('accelerators', t('panels.accelerators'));
    this.attachRelatedAssetHandlers(acceleratorsPanel);
    this.ctx.newsPanels['accelerators'] = acceleratorsPanel;
    this.ctx.panels['accelerators'] = acceleratorsPanel;

    const fundingPanel = new NewsPanel('funding', t('panels.funding'));
    this.attachRelatedAssetHandlers(fundingPanel);
    this.ctx.newsPanels['funding'] = fundingPanel;
    this.ctx.panels['funding'] = fundingPanel;

    const producthuntPanel = new NewsPanel('producthunt', t('panels.producthunt'));
    this.attachRelatedAssetHandlers(producthuntPanel);
    this.ctx.newsPanels['producthunt'] = producthuntPanel;
    this.ctx.panels['producthunt'] = producthuntPanel;

    const securityPanel = new NewsPanel('security', t('panels.security'));
    this.attachRelatedAssetHandlers(securityPanel);
    this.ctx.newsPanels['security'] = securityPanel;
    this.ctx.panels['security'] = securityPanel;

    const policyPanel = new NewsPanel('policy', t('panels.policy'));
    this.attachRelatedAssetHandlers(policyPanel);
    this.ctx.newsPanels['policy'] = policyPanel;
    this.ctx.panels['policy'] = policyPanel;

    const hardwarePanel = new NewsPanel('hardware', t('panels.hardware'));
    this.attachRelatedAssetHandlers(hardwarePanel);
    this.ctx.newsPanels['hardware'] = hardwarePanel;
    this.ctx.panels['hardware'] = hardwarePanel;

    const cloudPanel = new NewsPanel('cloud', t('panels.cloud'));
    this.attachRelatedAssetHandlers(cloudPanel);
    this.ctx.newsPanels['cloud'] = cloudPanel;
    this.ctx.panels['cloud'] = cloudPanel;

    const devPanel = new NewsPanel('dev', t('panels.dev'));
    this.attachRelatedAssetHandlers(devPanel);
    this.ctx.newsPanels['dev'] = devPanel;
    this.ctx.panels['dev'] = devPanel;

    const githubPanel = new NewsPanel('github', t('panels.github'));
    this.attachRelatedAssetHandlers(githubPanel);
    this.ctx.newsPanels['github'] = githubPanel;
    this.ctx.panels['github'] = githubPanel;

    const ipoPanel = new NewsPanel('ipo', t('panels.ipo'));
    this.attachRelatedAssetHandlers(ipoPanel);
    this.ctx.newsPanels['ipo'] = ipoPanel;
    this.ctx.panels['ipo'] = ipoPanel;

    const thinktanksPanel = new NewsPanel('thinktanks', t('panels.thinktanks'));
    this.attachRelatedAssetHandlers(thinktanksPanel);
    this.ctx.newsPanels['thinktanks'] = thinktanksPanel;
    this.ctx.panels['thinktanks'] = thinktanksPanel;

    const economicPanel = new EconomicPanel();
    this.ctx.panels['economic'] = economicPanel;

    if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
      const tradePolicyPanel = new TradePolicyPanel();
      this.ctx.panels['trade-policy'] = tradePolicyPanel;

      const supplyChainPanel = new SupplyChainPanel();
      this.ctx.panels['supply-chain'] = supplyChainPanel;
    }

    const africaPanel = new NewsPanel('africa', t('panels.africa'));
    this.attachRelatedAssetHandlers(africaPanel);
    this.ctx.newsPanels['africa'] = africaPanel;
    this.ctx.panels['africa'] = africaPanel;

    const latamPanel = new NewsPanel('latam', t('panels.latam'));
    this.attachRelatedAssetHandlers(latamPanel);
    this.ctx.newsPanels['latam'] = latamPanel;
    this.ctx.panels['latam'] = latamPanel;

    const asiaPanel = new NewsPanel('asia', t('panels.asia'));
    this.attachRelatedAssetHandlers(asiaPanel);
    this.ctx.newsPanels['asia'] = asiaPanel;
    this.ctx.panels['asia'] = asiaPanel;

    const energyPanel = new NewsPanel('energy', t('panels.energy'));
    this.attachRelatedAssetHandlers(energyPanel);
    this.ctx.newsPanels['energy'] = energyPanel;
    this.ctx.panels['energy'] = energyPanel;

    for (const key of Object.keys(FEEDS)) {
      if (this.ctx.newsPanels[key]) continue;
      if (!Array.isArray((FEEDS as Record<string, unknown>)[key])) continue;
      const panelKey = this.ctx.panels[key] && !this.ctx.newsPanels[key] ? `${key}-news` : key;
      if (this.ctx.panels[panelKey]) continue;
      const panelConfig = DEFAULT_PANELS[panelKey] ?? DEFAULT_PANELS[key];
      const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const panel = new NewsPanel(panelKey, label);
      this.attachRelatedAssetHandlers(panel);
      this.ctx.newsPanels[key] = panel;
      this.ctx.panels[panelKey] = panel;
    }

    if (SITE_VARIANT === 'full') {
      const gdeltIntelPanel = new GdeltIntelPanel();
      this.ctx.panels['gdelt-intel'] = gdeltIntelPanel;

      if (this.ctx.isDesktopApp) {
        import('@/components/DeductionPanel').then(({ DeductionPanel }) => {
          const deductionPanel = new DeductionPanel(() => this.ctx.allNews);
          this.ctx.panels['deduction'] = deductionPanel;
        });
      }

      const ciiPanel = new CIIPanel();
      ciiPanel.setShareStoryHandler((code, name) => {
        this.callbacks.openCountryStory(code, name);
      });
      this.ctx.panels['cii'] = ciiPanel;

      const cascadePanel = new CascadePanel();
      this.ctx.panels['cascade'] = cascadePanel;

      const satelliteFiresPanel = new SatelliteFiresPanel();
      this.ctx.panels['satellite-fires'] = satelliteFiresPanel;

      const strategicRiskPanel = new StrategicRiskPanel();
      strategicRiskPanel.setLocationClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['strategic-risk'] = strategicRiskPanel;

      const strategicPosturePanel = new StrategicPosturePanel(() => this.ctx.allNews);
      strategicPosturePanel.setLocationClickHandler((lat, lon) => {
        console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.ctx.map });
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['strategic-posture'] = strategicPosturePanel;

      const ucdpEventsPanel = new UcdpEventsPanel();
      ucdpEventsPanel.setEventClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 5);
      });
      this.ctx.panels['ucdp-events'] = ucdpEventsPanel;

      const displacementPanel = new DisplacementPanel();
      displacementPanel.setCountryClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['displacement'] = displacementPanel;

      const climatePanel = new ClimateAnomalyPanel();
      climatePanel.setZoneClickHandler((lat, lon) => {
        this.ctx.map?.setCenter(lat, lon, 4);
      });
      this.ctx.panels['climate'] = climatePanel;

      const populationExposurePanel = new PopulationExposurePanel();
      this.ctx.panels['population-exposure'] = populationExposurePanel;

      const securityAdvisoriesPanel = new SecurityAdvisoriesPanel();
      securityAdvisoriesPanel.setRefreshHandler(() => {
        void this.callbacks.loadSecurityAdvisories?.();
      });
      this.ctx.panels['security-advisories'] = securityAdvisoriesPanel;

      const orefSirensPanel = new OrefSirensPanel();
      this.ctx.panels['oref-sirens'] = orefSirensPanel;

      const telegramIntelPanel = new TelegramIntelPanel();
      this.ctx.panels['telegram-intel'] = telegramIntelPanel;
    }

    if (SITE_VARIANT === 'finance') {
      const investmentsPanel = new InvestmentsPanel((inv) => {
        focusInvestmentOnMap(this.ctx.map, this.ctx.mapLayers, inv.lat, inv.lon);
      });
      this.ctx.panels['gcc-investments'] = investmentsPanel;

      const gulfEconomiesPanel = new GulfEconomiesPanel();
      this.ctx.panels['gulf-economies'] = gulfEconomiesPanel;
    }

    this.ctx.panels['world-clock'] = new WorldClockPanel();

    if (SITE_VARIANT !== 'happy') {
      if (!this.ctx.panels['gulf-economies']) {
        const gulfEconomiesPanel = new GulfEconomiesPanel();
        this.ctx.panels['gulf-economies'] = gulfEconomiesPanel;
      }

      const liveNewsPanel = new LiveNewsPanel();
      this.ctx.panels['live-news'] = liveNewsPanel;

      const liveWebcamsPanel = new LiveWebcamsPanel();
      this.ctx.panels['live-webcams'] = liveWebcamsPanel;

      this.ctx.panels['events'] = new TechEventsPanel('events', () => this.ctx.allNews);

      const serviceStatusPanel = new ServiceStatusPanel();
      this.ctx.panels['service-status'] = serviceStatusPanel;

      const techReadinessPanel = new TechReadinessPanel();
      this.ctx.panels['tech-readiness'] = techReadinessPanel;

      this.ctx.panels['macro-signals'] = new MacroSignalsPanel();
      this.ctx.panels['etf-flows'] = new ETFFlowsPanel();
      this.ctx.panels['stablecoins'] = new StablecoinPanel();
    }

    if (this.ctx.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.ctx.panels['runtime-config'] = runtimeConfigPanel;
    }

    const insightsPanel = new InsightsPanel();
    this.ctx.panels['insights'] = insightsPanel;

    if (SITE_VARIANT !== 'happy') {
      this.operationsCenter = new ProjectVOperationsCenter(this.ctx);
      this.operationsCenter.start();
      this.mapGeofenceMonitor = new MapGeofenceMonitor(this.ctx, this.operationsCenter);
      this.mapGeofenceMonitor.start();
      if (typeof BroadcastChannel !== 'undefined') {
        this.mapOperationsHandoffChannel = new BroadcastChannel('project-v-map-operations-handoff');
        this.mapOperationsHandoffChannel.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string; item?: { title?: string; detail?: string; category?: string; source?: string; occurredAt?: number; confidence?: 'confirmed' | 'unverified' | 'disputed' | 'analyst' } } | null;
          if (data?.type !== 'timeline' || !data.item?.title || !this.operationsCenter) return;
          this.operationsCenter.addTimelineEvent({
            title: data.item.title,
            detail: data.item.detail ?? '',
            category: data.item.category ?? 'MAP OPERATIONS',
            source: data.item.source ?? 'Project V Map Desk',
            occurredAt: Number.isFinite(data.item.occurredAt) ? Number(data.item.occurredAt) : Date.now(),
            confidence: data.item.confidence ?? 'analyst',
          });
        });
      }

      const commandAssistantPanel = new CommandAssistantPanel(this.ctx);
      this.ctx.panels['command-assistant'] = commandAssistantPanel;
      this.ctx.panels['multi-agent-research'] = new MultiAgentResearchPanel();

      const researchLibraryPanel = new ResearchLibraryPanel();
      this.ctx.panels['research-library'] = researchLibraryPanel;

      this.ctx.panels['alert-center'] = new AlertCenterPanel(this.operationsCenter);
      this.ctx.panels['alert-rules'] = new AlertRulesPanel(this.operationsCenter);
      this.ctx.panels.watchlists = new WatchlistsPanel(this.operationsCenter);
      this.ctx.panels['event-timeline'] = new EventTimelinePanel(this.operationsCenter);
      this.ctx.panels['source-health'] = new SourceHealthPanel(this.operationsCenter);
      this.ctx.panels['communications-wall'] = new CommunicationsWallPanel();
      this.ctx.panels['source-browser'] = new SourceBrowserPanel(this.operationsCenter);
      this.ctx.panels['case-status'] = new CaseStatusPanel();
      this.ctx.panels['data-library'] = new DataLibraryPanel();
      this.ctx.panels['map-operations'] = new MapOperationsPanel();
      this.ctx.panels['air-operations'] = new AirOperationsPanel();
      this.ctx.panels['launch-deck'] = new LaunchDeckPanel();
      this.ctx.panels['camera-wall'] = new CameraWallPanel();
      this.ctx.panels['live-language'] = new LiveLanguagePanel();
    }

    // Global Giving panel (all variants)
    this.ctx.panels['giving'] = new GivingPanel();

    // Happy variant panels
    if (SITE_VARIANT === 'happy') {
      this.ctx.positivePanel = new PositiveNewsFeedPanel();
      this.ctx.panels['positive-feed'] = this.ctx.positivePanel;

      this.ctx.countersPanel = new CountersPanel();
      this.ctx.panels['counters'] = this.ctx.countersPanel;
      this.ctx.countersPanel.startTicking();

      this.ctx.progressPanel = new ProgressChartsPanel();
      this.ctx.panels['progress'] = this.ctx.progressPanel;

      this.ctx.breakthroughsPanel = new BreakthroughsTickerPanel();
      this.ctx.panels['breakthroughs'] = this.ctx.breakthroughsPanel;

      this.ctx.heroPanel = new HeroSpotlightPanel();
      this.ctx.panels['spotlight'] = this.ctx.heroPanel;
      this.ctx.heroPanel.onLocationRequest = (lat: number, lon: number) => {
        this.ctx.map?.setCenter(lat, lon, 4);
        this.ctx.map?.flashLocation(lat, lon, 3000);
      };

      this.ctx.digestPanel = new GoodThingsDigestPanel();
      this.ctx.panels['digest'] = this.ctx.digestPanel;

      this.ctx.speciesPanel = new SpeciesComebackPanel();
      this.ctx.panels['species'] = this.ctx.speciesPanel;

      this.ctx.renewablePanel = new RenewableEnergyPanel();
      this.ctx.panels['renewable'] = this.ctx.renewablePanel;
    }

    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();
    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
      const insertIdx = valid.indexOf('politics') + 1 || 0;
      const newPanels = missing.filter(k => k !== 'monitors');
      valid.splice(insertIdx, 0, ...newPanels);
      if (SITE_VARIANT !== 'happy') {
        valid.push('monitors');
      }
      panelOrder = valid;
    }

    if (SITE_VARIANT !== 'happy') {
      const liveNewsIdx = panelOrder.indexOf('live-news');
      if (liveNewsIdx > 0) {
        panelOrder.splice(liveNewsIdx, 1);
        panelOrder.unshift('live-news');
      }

      const webcamsIdx = panelOrder.indexOf('live-webcams');
      if (webcamsIdx !== -1 && webcamsIdx !== panelOrder.indexOf('live-news') + 1) {
        panelOrder.splice(webcamsIdx, 1);
        const afterNews = panelOrder.indexOf('live-news') + 1;
        panelOrder.splice(afterNews, 0, 'live-webcams');
      }
    }

    if (this.ctx.isDesktopApp) {
      const runtimeIdx = panelOrder.indexOf('runtime-config');
      if (runtimeIdx > 1) {
        panelOrder.splice(runtimeIdx, 1);
        panelOrder.splice(1, 0, 'runtime-config');
      } else if (runtimeIdx === -1) {
        panelOrder.splice(1, 0, 'runtime-config');
      }
    }

    panelOrder.forEach((key: string) => {
      const panel = this.ctx.panels[key];
      if (panel) {
        const el = panel.getElement();
        panelsGrid.appendChild(el);
      }
    });

    this.moduleRegistry.registerBuiltInPanels(panelsGrid);
    this.mountEnabledPluginPanels(panelsGrid);

    this.ctx.map.onTimeRangeChanged((range) => {
      this.ctx.currentTimeRange = range;
      this.applyTimeRangeFilterDebounced();
    });

    this.applyPanelSettings();
    this.applyInitialUrlState();
  }

  private applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      const panel = this.ctx.newsPanels[category];
      if (!panel) return;
      const filtered = this.filterItemsByTimeRange(items);
      if (filtered.length === 0 && items.length > 0) {
        panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
        return;
      }
      panel.renderNews(filtered);
    });
  }

  private filterItemsByTimeRange(items: import('@/types').NewsItem[], range: import('@/components').TimeRange = this.ctx.currentTimeRange): import('@/types').NewsItem[] {
    if (range === 'all') return items;
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000, '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000, 'all': Infinity,
    };
    const cutoff = Date.now() - (ranges[range] ?? Infinity);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  private getTimeRangeLabel(): string {
    const labels: Record<string, string> = {
      '1h': 'the last hour', '6h': 'the last 6 hours',
      '24h': 'the last 24 hours', '48h': 'the last 48 hours',
      '7d': 'the last 7 days', 'all': 'all time',
    };
    return labels[this.ctx.currentTimeRange] ?? 'the last 7 days';
  }

  private applyInitialUrlState(): void {
    if (!this.ctx.initialUrlState || !this.ctx.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.ctx.initialUrlState;

    if (view) {
      this.ctx.map.setView(view);
    }

    if (timeRange) {
      this.ctx.map.setTimeRange(timeRange);
    }

    if (layers) {
      this.ctx.mapLayers = layers;
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
      this.ctx.map.setLayers(layers);
    }

    if (lat !== undefined && lon !== undefined) {
      const effectiveZoom = zoom ?? this.ctx.map.getState().zoom;
      if (effectiveZoom > 2) this.ctx.map.setCenter(lat, lon, zoom);
    } else if (!view && zoom !== undefined) {
      this.ctx.map.setZoom(zoom);
    }

    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.ctx.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(order));
    this.deckWorkspaces?.saveNow();
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => this.ctx.map?.highlightAssets(assets),
      onRelatedAssetsClear: () => this.ctx.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    if (!this.ctx.map) return;

    switch (asset.type) {
      case 'pipeline':
        this.ctx.map.enableLayer('pipelines');
        this.ctx.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        this.ctx.map.enableLayer('cables');
        this.ctx.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        this.ctx.map.enableLayer('datacenters');
        this.ctx.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerDatacenterClick(asset.id);
        break;
      case 'base':
        this.ctx.map.enableLayer('bases');
        this.ctx.mapLayers.bases = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerBaseClick(asset.id);
        break;
      case 'nuclear':
        this.ctx.map.enableLayer('nuclear');
        this.ctx.mapLayers.nuclear = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerNuclearClick(asset.id);
        break;
    }
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }

  getAllSourceNames(): string[] {
    const sources = new Set<string>();
    Object.values(FEEDS).forEach(feeds => {
      if (feeds) feeds.forEach(f => sources.add(f.name));
    });
    INTEL_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }
}
