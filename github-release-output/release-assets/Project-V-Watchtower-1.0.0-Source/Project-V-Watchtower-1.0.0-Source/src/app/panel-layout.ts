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
import { PluginManagerController } from '@/app/plugin-manager';
import { ProjectVModuleRegistry, pluginPanelId } from '@/modules/plugin-registry';
import { ProjectVOperationsCenter } from '@/services/operations-center';
import { SecurityCenterController } from '@/app/security-center';
import { initializeSecuritySession, isProjectVSafeModeActive } from '@/services/security-center';
import { MapGeofenceMonitor } from '@/services/map-geofence-monitor';
import { VoiceCommandCenterController } from '@/app/voice-command-center';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import type { MapPopupIntelligenceItem } from '@/services/map-popup-intelligence';

export interface PanelLayoutCallbacks {
  openCountryStory: (code: string, name: string) => void;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
  loadSecurityAdvisories?: () => Promise<void>;
}

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
          <div class="v-mark" aria-label="Project V"><span>V</span></div>
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
          <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> SEARCH</button>
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
          <button class="v-deck-action-btn v-icon-action" id="deckUndoBtn" type="button" title="Undo last layout change" aria-label="Undo layout change">↶</button>
          <button class="v-deck-action-btn v-icon-action" id="deckRedoBtn" type="button" title="Redo layout change" aria-label="Redo layout change">↷</button>
          <div class="v-preset-control">
            <button class="v-deck-action-btn" id="layoutPresetBtn" type="button" aria-expanded="false" title="Choose a layout preset"><span id="layoutPresetLabel">LAYOUT: COMMAND</span> ▾</button>
            <div class="v-layout-preset-menu" id="layoutPresetMenu" role="menu">
              ${DECK_PRESETS.map((preset) => `<button type="button" data-preset-id="${preset.id}"><strong>${preset.label}</strong><span>${preset.description}</span></button>`).join('')}
            </div>
          </div>
          <button class="v-deck-action-btn" id="deckSaveBtn" type="button" title="Save the current workspace layout">SAVE</button>
          <button class="v-deck-action-btn" id="deckPackBtn" type="button" title="Remove gaps and arrange all visible modules without overlap">AUTO ARRANGE</button>
          <button class="v-deck-action-btn v-module-library-btn" id="moduleLibraryBtn" type="button" title="Open the module library">MODULES <span id="moduleLibraryCount">0</span></button>
          <button class="v-deck-action-btn v-plugin-manager-btn" id="pluginManagerBtn" type="button" title="Manage local Project V plugins">PLUGINS <span id="pluginManagerCount">0</span></button>
          <button class="v-deck-action-btn v-launch-deck-btn" id="launchDeckBtn" type="button" title="Open approved desktop applications">APPS <span>OPEN</span></button>
          <button class="v-deck-action-btn v-camera-wall-btn" id="cameraWallBtn" type="button" title="Open the Project V camera monitoring wall">CAMERAS <span>WALL</span></button>
          <button class="v-deck-action-btn v-analysis-room-btn" id="analysisRoomBtn" type="button" title="Open the Project V local multi-agent Analysis Room">ANALYSIS <span>ROOM</span></button>
          <button class="v-deck-action-btn v-osint-desk-btn" id="osintDeskBtn" type="button" title="Open the Project V public-source OSINT query desk">OSINT <span>TOOLS</span></button>
          <button class="v-deck-action-btn v-operations-alert-btn" id="operationsAlertBtn" type="button" title="Open the operational Alert Center">ALERTS <span id="operationsAlertCount">0</span></button>
          <button class="v-deck-action-btn v-voice-control-btn" id="voiceControlBtn" type="button" title="Open push-to-talk voice control (Ctrl+Shift+V)">VOICE <span data-voice-header-state>READY</span></button>
          <button class="v-deck-action-btn v-security-center-btn" id="securityCenterBtn" type="button" title="Open Project V security, backup, network, and recovery controls">SECURITY <span>OPEN</span></button>
          <div class="v-map-layout-control">
            <button class="v-deck-action-btn" id="mapLayoutBtn" type="button" aria-expanded="false" title="Choose map width"><span id="mapLayoutLabel">MAP: FULL</span> ▾</button>
            <div class="v-map-layout-menu" id="mapLayoutMenu" role="menu">
              <button type="button" data-map-span="3">FULL WIDTH <span>12 columns</span></button>
              <button type="button" data-map-span="2">COMMAND <span>8 columns</span></button>
              <button type="button" data-map-span="1">COMPACT <span>6 columns</span></button>
            </div>
          </div>
          <button class="v-deck-action-btn" id="deckResetBtn" type="button" title="Reset this workspace to its default layout">RESET</button>
          <button class="v-deck-action-btn" id="deckExportBtn" type="button" title="Export all workspace layouts">EXPORT</button>
          <button class="v-deck-action-btn" id="deckImportBtn" type="button" title="Import workspace layouts">IMPORT</button>
          <input id="deckImportInput" type="file" accept="application/json,.json" hidden>
          <button class="v-deck-mode-btn" id="deckModeBtn" type="button" aria-pressed="false"></button>
          <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener" class="v-attribution" title="Upstream source and AGPL license">BASED ON WORLD MONITOR · AGPL</a>
        </div>
      </div>

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

    if (this.ctx.isMobile) {
      this.setupMobileMapToggle();
    }
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
    if (!button || !menu) return;

    const close = () => {
      menu.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });

    menu.addEventListener('click', (event) => {
      const choice = (event.target as Element).closest<HTMLButtonElement>('[data-preset-id]');
      if (!choice || !this.deckWorkspaces) return;
      const preset = choice.dataset.presetId as Exclude<DeckPresetId, 'custom'> | undefined;
      if (!preset) return;
      this.deckWorkspaces.applyPreset(preset);
      close();
      this.updatePresetUi();
    });

    document.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.v-preset-control')) return;
      close();
    });

    window.addEventListener('project-v-workspace-preset-change', () => this.updatePresetUi());
    window.addEventListener('project-v-workspace-activated', () => this.updatePresetUi());
    this.updatePresetUi();
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
      const detail = (event as CustomEvent<{ action?: 'timeline' | 'alert'; item?: MapPopupIntelligenceItem }>).detail;
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
      } else {
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
      this.ctx.panels['launch-deck'] = new LaunchDeckPanel();
      this.ctx.panels['camera-wall'] = new CameraWallPanel();
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
