import type { DeckPanelGeometry, DeckWorkspaceLayout, DeckWorkspaceManager } from './deck-workspaces';
import { DOCK_COLUMNS, DOCK_GAP_PX, DOCK_ROW_HEIGHT_PX } from './deck-workspaces';

interface DeckEditorOptions {
  grid: HTMLElement;
  workspaces: DeckWorkspaceManager;
  onMapLayoutChanged?: () => void;
}

interface GridMetrics {
  rect: DOMRect;
  gap: number;
  colWidth: number;
  rowHeight: number;
  rowUnit: number;
}

interface ActiveDrag {
  panel: HTMLElement;
  panelId: string;
  ghost: HTMLElement;
  placeholder: HTMLElement;
  pointerId: number;
  offsetCols: number;
  offsetRows: number;
  targetX: number;
  targetY: number;
  w: number;
  h: number;
}

interface ActiveResize {
  panel: HTMLElement;
  panelId: string;
  placeholder: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  targetW: number;
  targetH: number;
  x: number;
  y: number;
}

const HISTORY_LIMIT = 40;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneLayout(layout: DeckWorkspaceLayout): DeckWorkspaceLayout {
  return {
    order: [...layout.order],
    geometry: Object.fromEntries(
      Object.entries(layout.geometry).map(([key, value]) => [key, { ...value }]),
    ),
    updatedAt: layout.updatedAt,
  };
}

function layoutSignature(layout: DeckWorkspaceLayout): string {
  return JSON.stringify({ order: layout.order, geometry: layout.geometry });
}

function panelLabel(panel: HTMLElement): string {
  const raw = panel.querySelector<HTMLElement>('.panel-title')?.textContent?.trim();
  if (raw) return raw.replace(/\s*\/\/\s*ACTIVE THEATER$/i, '');
  return panel.dataset.panel?.replace(/-/g, ' ').toUpperCase() ?? 'MODULE';
}

function geometryValue(geometry: DeckPanelGeometry | null, key: 'x' | 'y' | 'w' | 'h', fallback: number): number {
  return Math.round(finite(geometry?.[key], fallback));
}

type ModuleCategory = 'maps' | 'intelligence' | 'news' | 'operations' | 'markets' | 'weather' | 'ai' | 'research' | 'system';

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function moduleCategory(panelId: string, label: string, panel?: HTMLElement): ModuleCategory {
  const declared = panel?.dataset.moduleCategory as ModuleCategory | undefined;
  if (declared && ['maps', 'intelligence', 'news', 'operations', 'markets', 'weather', 'ai', 'research', 'system'].includes(declared)) return declared;
  const source = `${panelId} ${label}`.toLowerCase();
  if (/map|heatmap|exposure|displacement|ucdp/.test(source)) return 'maps';
  if (/assistant|ollama|language model| ai\b/.test(source)) return 'ai';
  if (/document|research|archive|citation|evidence|timeline|notes/.test(source)) return 'research';
  if (/news|politic|world|government|middle east|finance|tech|ai |startup|layoff|positive/.test(source)) return 'news';
  if (/market|economic|commodit|crypto|polymarket|prediction|etf|stablecoin|trade|gulf|investment/.test(source)) return 'markets';
  if (/climate|weather|fire|renewable|species/.test(source)) return 'weather';
  if (/webcam|live|sirens|telegram|security|service|clock|monitor|counter|progress/.test(source)) return 'operations';
  if (/insight|risk|posture|intel|cii|cascade|deduction|macro|readiness|gdelt/.test(source)) return 'intelligence';
  return 'system';
}

const MODULE_CATEGORY_LABELS: Record<ModuleCategory, string> = {
  maps: 'MAPS & GEOSPATIAL',
  intelligence: 'INTELLIGENCE & ANALYSIS',
  news: 'NEWS & INFORMATION',
  operations: 'LIVE OPERATIONS',
  markets: 'MARKETS & ECONOMY',
  weather: 'WEATHER & HUMAN IMPACT',
  ai: 'AI & AUTOMATION',
  research: 'RESEARCH & DOCUMENTS',
  system: 'SYSTEM & UTILITIES',
};

export class DeckEditorController {
  private readonly grid: HTMLElement;
  private readonly workspaces: DeckWorkspaceManager;
  private readonly onMapLayoutChanged?: () => void;
  private readonly cleanups: Array<() => void> = [];
  private activeDrag: ActiveDrag | null = null;
  private activeResize: ActiveResize | null = null;
  private pointerCleanup: (() => void) | null = null;
  private history: DeckWorkspaceLayout[] = [];
  private historyIndex = -1;
  private historyTimer: number | null = null;
  private suppressHistory = false;
  private maximizedPanel: HTMLElement | null = null;
  private moduleCategoryFilter: ModuleCategory | 'all' = 'all';
  private moduleSearchQuery = '';

  constructor(options: DeckEditorOptions) {
    this.grid = options.grid;
    this.workspaces = options.workspaces;
    this.onMapLayoutChanged = options.onMapLayoutChanged;
  }

  init(): void {
    this.decoratePanels();
    this.setupToolbar();
    this.setupModuleLibrary();
    this.setupHistory();
    this.setupKeyboardShortcuts();
    this.updateMapLayoutLabel();
    this.renderModuleLibrary();
    this.updatePanelControls();
  }

  destroy(): void {
    this.cancelPointerOperation();
    if (this.historyTimer !== null) window.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.closeModuleLibrary();
    this.exitMaximize();
  }

  refresh(): void {
    if (this.maximizedPanel && (!this.maximizedPanel.classList.contains('deck-maximized') || this.maximizedPanel.classList.contains('deck-hidden'))) {
      this.maximizedPanel.classList.remove('deck-maximized');
      this.maximizedPanel = null;
      document.body.classList.remove('deck-has-maximized');
    }
    this.decoratePanels();
    this.updatePanelControls();
    this.updateMapLayoutLabel();
    this.renderModuleLibrary();
  }

  private decoratePanels(): void {
    for (const child of Array.from(this.grid.children)) {
      const panel = child as HTMLElement;
      if (!panel.dataset.panel || panel.dataset.deckDecorated === 'phase4') continue;
      panel.dataset.deckDecorated = 'phase4';
      panel.querySelector(':scope > .panel-header > .v-panel-controls')?.remove();
      panel.querySelector(':scope > .v-panel-corner-resize')?.remove();
      this.addPanelControls(panel);
      this.addCornerResize(panel);
    }
  }

  private addPanelControls(panel: HTMLElement): void {
    const header = panel.querySelector<HTMLElement>(':scope > .panel-header');
    if (!header) return;

    const controls = document.createElement('div');
    controls.className = 'v-panel-controls';
    const accessibleLabel = escapeText(panelLabel(panel));
    controls.innerHTML = `
      <button class="v-panel-control v-panel-drag-handle" type="button" title="Dock module elsewhere" aria-label="Move ${accessibleLabel}">⠿</button>
      <button class="v-panel-control v-panel-collapse-btn" type="button" title="Minimize module" aria-label="Minimize ${accessibleLabel}">−</button>
      <button class="v-panel-control v-panel-maximize-btn" type="button" title="Maximize module" aria-label="Maximize ${accessibleLabel}">□</button>
      <button class="v-panel-control v-panel-hide-btn" type="button" title="Remove from this workspace" aria-label="Hide ${accessibleLabel}">×</button>
    `;
    header.appendChild(controls);

    const dragHandle = controls.querySelector<HTMLButtonElement>('.v-panel-drag-handle');
    const collapseButton = controls.querySelector<HTMLButtonElement>('.v-panel-collapse-btn');
    const maximizeButton = controls.querySelector<HTMLButtonElement>('.v-panel-maximize-btn');
    const hideButton = controls.querySelector<HTMLButtonElement>('.v-panel-hide-btn');

    const onDragStart = (event: PointerEvent) => this.startDrag(event, panel);
    const onCollapse = (event: MouseEvent) => {
      event.stopPropagation();
      const collapsed = !panel.classList.contains('deck-collapsed');
      this.workspaces.setPanelCollapsed(panel.dataset.panel!, collapsed);
      this.commitHistory();
    };
    const onMaximize = (event: MouseEvent) => {
      event.stopPropagation();
      if (panel.classList.contains('deck-maximized')) this.exitMaximize();
      else this.maximize(panel);
    };
    const onHide = (event: MouseEvent) => {
      event.stopPropagation();
      if (!document.body.classList.contains('deck-edit-mode')) return;
      this.workspaces.setPanelHidden(panel.dataset.panel!, true);
      this.commitHistory();
    };

    dragHandle?.addEventListener('pointerdown', onDragStart);
    collapseButton?.addEventListener('click', onCollapse);
    maximizeButton?.addEventListener('click', onMaximize);
    hideButton?.addEventListener('click', onHide);

    this.cleanups.push(() => {
      dragHandle?.removeEventListener('pointerdown', onDragStart);
      collapseButton?.removeEventListener('click', onCollapse);
      maximizeButton?.removeEventListener('click', onMaximize);
      hideButton?.removeEventListener('click', onHide);
    });
  }

  private addCornerResize(panel: HTMLElement): void {
    const handle = document.createElement('div');
    handle.className = 'v-panel-corner-resize';
    handle.title = 'Resize docked module';
    panel.appendChild(handle);
    const onPointerDown = (event: PointerEvent) => this.startResize(event, panel);
    handle.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() => handle.removeEventListener('pointerdown', onPointerDown));
  }

  private getGridMetrics(): GridMetrics {
    const rect = this.grid.getBoundingClientRect();
    const style = window.getComputedStyle(this.grid);
    const gap = Number.parseFloat(style.columnGap || style.gap || String(DOCK_GAP_PX)) || DOCK_GAP_PX;
    const colWidth = Math.max(1, (rect.width - gap * (DOCK_COLUMNS - 1)) / DOCK_COLUMNS);
    const parsedRow = Number.parseFloat(style.gridAutoRows || String(DOCK_ROW_HEIGHT_PX));
    const rowHeight = Number.isFinite(parsedRow) && parsedRow > 0 ? parsedRow : DOCK_ROW_HEIGHT_PX;
    return { rect, gap, colWidth, rowHeight, rowUnit: rowHeight + gap };
  }

  private startDrag(event: PointerEvent, panel: HTMLElement): void {
    if (!document.body.classList.contains('deck-edit-mode')) return;
    if (event.button !== 0 || panel.dataset.resizing === 'true') return;
    const panelId = panel.dataset.panel;
    if (!panelId) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelPointerOperation();

    const geometry = this.workspaces.getPanelGeometry(panelId);
    if (!geometry) return;
    const metrics = this.getGridMetrics();
    const panelRect = panel.getBoundingClientRect();
    const w = geometryValue(geometry, 'w', 4);
    const h = panel.classList.contains('deck-collapsed') ? 1 : geometryValue(geometry, 'h', 3);
    const x = geometryValue(geometry, 'x', 0);
    const y = geometryValue(geometry, 'y', 0);
    const offsetCols = clamp(Math.floor((event.clientX - panelRect.left) / (metrics.colWidth + metrics.gap)), 0, w - 1);
    const offsetRows = clamp(Math.floor((event.clientY - panelRect.top) / metrics.rowUnit), 0, h - 1);

    const placeholder = this.createPlaceholder(x, y, w, h, 'DROP MODULE');
    const ghost = document.createElement('div');
    ghost.className = 'v-deck-drag-ghost';
    ghost.innerHTML = `<span>MOVE MODULE</span><strong>${escapeText(panelLabel(panel))}</strong><small>${w} × ${h} DOCK CELLS</small>`;
    ghost.style.width = `${Math.min(panelRect.width, 420)}px`;
    document.body.appendChild(ghost);

    panel.classList.add('v-deck-drag-source');
    document.body.classList.add('deck-drag-active');
    this.activeDrag = {
      panel,
      panelId,
      ghost,
      placeholder,
      pointerId: event.pointerId,
      offsetCols,
      offsetRows,
      targetX: x,
      targetY: y,
      w,
      h,
    };
    this.positionGhost(event.clientX, event.clientY);

    const onMove = (moveEvent: PointerEvent) => this.moveDrag(moveEvent);
    const onUp = (upEvent: PointerEvent) => {
      if (this.activeDrag?.pointerId !== upEvent.pointerId) return;
      this.finishDrag(true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    this.pointerCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }

  private moveDrag(event: PointerEvent): void {
    const active = this.activeDrag;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const metrics = this.getGridMetrics();
    const pointerCol = Math.floor((event.clientX - metrics.rect.left) / (metrics.colWidth + metrics.gap));
    const pointerRow = Math.floor((event.clientY - metrics.rect.top) / metrics.rowUnit);
    active.targetX = clamp(pointerCol - active.offsetCols, 0, DOCK_COLUMNS - active.w);
    active.targetY = Math.max(0, pointerRow - active.offsetRows);
    this.positionPlaceholder(active.placeholder, active.targetX, active.targetY, active.w, active.h);
    this.positionGhost(event.clientX, event.clientY);
    this.autoScroll(event.clientY);
  }

  private finishDrag(commit: boolean): void {
    const active = this.activeDrag;
    if (!active) return;
    this.activeDrag = null;
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    active.panel.classList.remove('v-deck-drag-source');
    active.placeholder.remove();
    active.ghost.remove();
    document.body.classList.remove('deck-drag-active');
    if (commit) {
      this.workspaces.movePanel(active.panelId, active.targetX, active.targetY);
      this.commitHistory();
      this.onMapLayoutChanged?.();
    }
  }

  private startResize(event: PointerEvent, panel: HTMLElement): void {
    if (!document.body.classList.contains('deck-edit-mode')) return;
    if (event.button !== 0) return;
    const panelId = panel.dataset.panel;
    if (!panelId) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelPointerOperation();

    const geometry = this.workspaces.getPanelGeometry(panelId);
    if (!geometry) return;
    const x = geometryValue(geometry, 'x', 0);
    const y = geometryValue(geometry, 'y', 0);
    const w = geometryValue(geometry, 'w', 4);
    const h = geometryValue(geometry, 'h', 3);
    const placeholder = this.createPlaceholder(x, y, w, h, 'RESIZE MODULE');
    panel.classList.add('corner-resizing');
    panel.dataset.resizing = 'true';
    document.body.classList.add('panel-resize-active');

    this.activeResize = {
      panel,
      panelId,
      placeholder,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: w,
      startH: h,
      targetW: w,
      targetH: h,
      x,
      y,
    };

    const onMove = (moveEvent: PointerEvent) => this.moveResize(moveEvent);
    const onUp = (upEvent: PointerEvent) => {
      if (this.activeResize?.pointerId !== upEvent.pointerId) return;
      this.finishResize(true);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    this.pointerCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }

  private moveResize(event: PointerEvent): void {
    const active = this.activeResize;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const metrics = this.getGridMetrics();
    const deltaCols = Math.round((event.clientX - active.startX) / (metrics.colWidth + metrics.gap));
    const deltaRows = Math.round((event.clientY - active.startY) / metrics.rowUnit);
    const minWValue = Number(active.panel.dataset.moduleMinW);
    const minHValue = Number(active.panel.dataset.moduleMinH);
    const minW = Number.isFinite(minWValue) ? Math.max(2, Math.round(minWValue)) : 2;
    const minH = Number.isFinite(minHValue) ? Math.max(1, Math.round(minHValue)) : (active.panel.dataset.panel === 'map' ? 4 : 2);
    active.targetW = clamp(active.startW + deltaCols, minW, DOCK_COLUMNS - active.x);
    active.targetH = clamp(active.startH + deltaRows, minH, 14);
    this.positionPlaceholder(active.placeholder, active.x, active.y, active.targetW, active.targetH);
    active.placeholder.querySelector('small')!.textContent = `${active.targetW} × ${active.targetH} DOCK CELLS`;
    this.autoScroll(event.clientY);
  }

  private finishResize(commit: boolean): void {
    const active = this.activeResize;
    if (!active) return;
    this.activeResize = null;
    this.pointerCleanup?.();
    this.pointerCleanup = null;
    active.panel.classList.remove('corner-resizing');
    delete active.panel.dataset.resizing;
    active.placeholder.remove();
    document.body.classList.remove('panel-resize-active');
    if (commit) {
      this.workspaces.resizePanel(active.panelId, active.targetW, active.targetH);
      this.commitHistory();
      this.updateMapLayoutLabel();
      this.onMapLayoutChanged?.();
    }
  }

  private createPlaceholder(x: number, y: number, w: number, h: number, label: string): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'v-dock-preview';
    placeholder.innerHTML = `<span>${label}</span><small>${w} × ${h} DOCK CELLS</small>`;
    placeholder.setAttribute('aria-hidden', 'true');
    this.grid.appendChild(placeholder);
    this.positionPlaceholder(placeholder, x, y, w, h);
    return placeholder;
  }

  private positionPlaceholder(element: HTMLElement, x: number, y: number, w: number, h: number): void {
    element.style.gridColumn = `${x + 1} / span ${w}`;
    element.style.gridRow = `${y + 1} / span ${h}`;
  }

  private positionGhost(clientX: number, clientY: number): void {
    const ghost = this.activeDrag?.ghost;
    if (!ghost) return;
    const margin = 14;
    const maxLeft = Math.max(margin, window.innerWidth - ghost.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - ghost.offsetHeight - margin);
    ghost.style.left = `${clamp(clientX + 16, margin, maxLeft)}px`;
    ghost.style.top = `${clamp(clientY + 16, margin, maxTop)}px`;
  }

  private autoScroll(clientY: number): void {
    const edge = 70;
    const scrollSurface = document.querySelector<HTMLElement>('.main-content');
    if (!scrollSurface) return;
    if (clientY < edge) scrollSurface.scrollBy({ top: -18, behavior: 'auto' });
    else if (clientY > window.innerHeight - edge) scrollSurface.scrollBy({ top: 18, behavior: 'auto' });
  }

  private cancelPointerOperation(): void {
    if (this.activeDrag) this.finishDrag(false);
    if (this.activeResize) this.finishResize(false);
    this.pointerCleanup?.();
    this.pointerCleanup = null;
  }

  private setupToolbar(): void {
    const undo = document.getElementById('deckUndoBtn') as HTMLButtonElement | null;
    const redo = document.getElementById('deckRedoBtn') as HTMLButtonElement | null;
    const save = document.getElementById('deckSaveBtn') as HTMLButtonElement | null;
    const pack = document.getElementById('deckPackBtn') as HTMLButtonElement | null;
    const mapButton = document.getElementById('mapLayoutBtn') as HTMLButtonElement | null;
    const mapMenu = document.getElementById('mapLayoutMenu');

    const onUndo = () => this.undo();
    const onRedo = () => this.redo();
    const onSave = () => {
      this.workspaces.saveNow();
      this.flashToolbarButton(save, 'SAVED');
    };
    const onPack = () => {
      this.workspaces.autoArrange();
      this.commitHistory();
      this.flashToolbarButton(pack, 'ARRANGED');
    };
    undo?.addEventListener('click', onUndo);
    redo?.addEventListener('click', onRedo);
    save?.addEventListener('click', onSave);
    pack?.addEventListener('click', onPack);

    const toggleMapMenu = (event: MouseEvent) => {
      event.stopPropagation();
      mapMenu?.classList.toggle('open');
      mapButton?.setAttribute('aria-expanded', String(mapMenu?.classList.contains('open') ?? false));
    };
    mapButton?.addEventListener('click', toggleMapMenu);

    const onMapChoice = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-map-span]');
      if (!button) return;
      const span = Number.parseInt(button.dataset.mapSpan ?? '2', 10);
      this.workspaces.setMapColSpan(span);
      mapMenu?.classList.remove('open');
      mapButton?.setAttribute('aria-expanded', 'false');
      this.updateMapLayoutLabel();
      this.commitHistory();
      this.onMapLayoutChanged?.();
    };
    mapMenu?.addEventListener('click', onMapChoice);

    const closeMapMenu = (event: MouseEvent) => {
      if ((event.target as Element).closest('.v-map-layout-control')) return;
      mapMenu?.classList.remove('open');
      mapButton?.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', closeMapMenu);

    this.cleanups.push(() => {
      undo?.removeEventListener('click', onUndo);
      redo?.removeEventListener('click', onRedo);
      save?.removeEventListener('click', onSave);
      pack?.removeEventListener('click', onPack);
      mapButton?.removeEventListener('click', toggleMapMenu);
      mapMenu?.removeEventListener('click', onMapChoice);
      document.removeEventListener('click', closeMapMenu);
    });
  }

  private setupModuleLibrary(): void {
    const openButton = document.getElementById('moduleLibraryBtn');
    const closeButton = document.getElementById('moduleLibraryClose');
    const backdrop = document.getElementById('moduleLibraryBackdrop');
    const list = document.getElementById('moduleLibraryList');
    const search = document.getElementById('moduleLibrarySearch') as HTMLInputElement | null;
    const categories = document.getElementById('moduleLibraryCategories');

    const open = () => this.openModuleLibrary();
    const close = () => this.closeModuleLibrary();
    openButton?.addEventListener('click', open);
    closeButton?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    const onListClick = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-module-action]');
      if (!button) return;
      const panelId = button.dataset.panelId;
      if (!panelId) return;
      const action = button.dataset.moduleAction;
      if (action === 'restore') this.workspaces.setPanelHidden(panelId, false);
      if (action === 'hide') this.workspaces.setPanelHidden(panelId, true);
      if (action === 'expand') this.workspaces.setPanelCollapsed(panelId, false);
      this.commitHistory();
      this.renderModuleLibrary();
      this.updatePanelControls();
    };
    list?.addEventListener('click', onListClick);

    const onSearch = () => {
      this.moduleSearchQuery = search?.value.trim().toLowerCase() ?? '';
      this.renderModuleLibrary();
    };
    search?.addEventListener('input', onSearch);

    const onCategory = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-module-category]');
      if (!button) return;
      const category = button.dataset.moduleCategory as ModuleCategory | 'all' | undefined;
      if (!category) return;
      this.moduleCategoryFilter = category;
      categories?.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      this.renderModuleLibrary();
    };
    categories?.addEventListener('click', onCategory);

    const onStateChange = () => this.refresh();
    window.addEventListener('project-v-module-state-change', onStateChange);
    window.addEventListener('project-v-workspace-activated', onStateChange);
    window.addEventListener('project-v-dock-layout-applied', onStateChange);

    this.cleanups.push(() => {
      openButton?.removeEventListener('click', open);
      closeButton?.removeEventListener('click', close);
      backdrop?.removeEventListener('click', close);
      list?.removeEventListener('click', onListClick);
      search?.removeEventListener('input', onSearch);
      categories?.removeEventListener('click', onCategory);
      window.removeEventListener('project-v-module-state-change', onStateChange);
      window.removeEventListener('project-v-workspace-activated', onStateChange);
      window.removeEventListener('project-v-dock-layout-applied', onStateChange);
    });
  }

  private openModuleLibrary(): void {
    this.renderModuleLibrary();
    document.body.classList.add('module-library-open');
    document.getElementById('moduleLibraryDrawer')?.classList.add('open');
    document.getElementById('moduleLibraryBackdrop')?.classList.add('open');
  }

  private closeModuleLibrary(): void {
    document.body.classList.remove('module-library-open');
    document.getElementById('moduleLibraryDrawer')?.classList.remove('open');
    document.getElementById('moduleLibraryBackdrop')?.classList.remove('open');
  }

  private renderModuleLibrary(): void {
    const list = document.getElementById('moduleLibraryList');
    const count = document.getElementById('moduleLibraryCount');
    if (!list) return;

    const panels = Array.from(this.grid.children)
      .map((child) => child as HTMLElement)
      .filter((panel) => Boolean(panel.dataset.panel));
    const hiddenCount = panels.filter((panel) => panel.classList.contains('deck-hidden')).length;
    if (count) count.textContent = String(hiddenCount);

    const entries = panels.map((panel) => {
      const panelId = panel.dataset.panel!;
      const label = panelLabel(panel);
      const category = moduleCategory(panelId, label, panel);
      const disabled = panel.classList.contains('hidden');
      const hidden = panel.classList.contains('deck-hidden');
      const collapsed = panel.classList.contains('deck-collapsed');
      const geometry = this.workspaces.getPanelGeometry(panelId);
      const dimensions = `${geometryValue(geometry, 'w', 4)} × ${geometryValue(geometry, 'h', 3)}`;
      const needsConfig = /not configured|api[_\s-]?key|open settings/i.test(panel.textContent ?? '');
      const workspaceCount = this.workspaces.getPanelWorkspaceCount(panelId);
      const source = panel.dataset.moduleSource === 'plugin' ? 'PLUGIN' : 'CORE';
      const version = panel.dataset.moduleVersion ?? '';
      const permissions = (panel.dataset.modulePermissions ?? '').split(',').filter(Boolean);
      const description = panel.dataset.moduleDescription ?? '';
      const state = disabled
        ? 'DISABLED IN INTERFACE SETTINGS'
        : hidden
          ? 'AVAILABLE · NOT ON THIS DESK'
          : collapsed
            ? 'MINIMIZED'
            : `DOCKED ${dimensions}`;
      return { panel, panelId, label, category, disabled, hidden, collapsed, needsConfig, workspaceCount, source, version, permissions, description, state };
    }).filter((entry) => {
      const categoryMatches = this.moduleCategoryFilter === 'all' || entry.category === this.moduleCategoryFilter;
      const queryMatches = !this.moduleSearchQuery
        || entry.label.toLowerCase().includes(this.moduleSearchQuery)
        || entry.panelId.toLowerCase().includes(this.moduleSearchQuery)
        || entry.description.toLowerCase().includes(this.moduleSearchQuery)
        || entry.source.toLowerCase().includes(this.moduleSearchQuery)
        || MODULE_CATEGORY_LABELS[entry.category].toLowerCase().includes(this.moduleSearchQuery);
      return categoryMatches && queryMatches;
    });

    if (entries.length === 0) {
      list.innerHTML = '<div class="v-module-library-empty">NO MODULES MATCH THIS FILTER</div>';
      return;
    }

    const grouped = new Map<ModuleCategory, typeof entries>();
    for (const entry of entries) {
      const group = grouped.get(entry.category) ?? [];
      group.push(entry);
      grouped.set(entry.category, group);
    }

    list.innerHTML = Array.from(grouped.entries()).map(([category, group]) => `
      <section class="v-module-library-group" data-category="${category}">
        <div class="v-module-library-group-title"><span>${MODULE_CATEGORY_LABELS[category]}</span><small>${group.length}</small></div>
        ${group.map((entry) => {
          const action = entry.disabled
            ? '<span class="v-module-disabled">INTERFACE SETTINGS</span>'
            : entry.hidden
              ? `<button type="button" data-module-action="restore" data-panel-id="${escapeText(entry.panelId)}">ADD TO DESK</button>`
              : entry.collapsed
                ? `<button type="button" data-module-action="expand" data-panel-id="${escapeText(entry.panelId)}">EXPAND</button>`
                : `<button type="button" data-module-action="hide" data-panel-id="${escapeText(entry.panelId)}">REMOVE</button>`;
          return `
            <div class="v-module-library-item ${entry.hidden ? 'is-hidden' : ''} ${entry.needsConfig ? 'needs-config' : ''}" data-module-source="${entry.source.toLowerCase()}">
              <div class="v-module-library-copy">
                <strong>${escapeText(entry.label)}</strong>
                <span>${entry.state}</span>
                <small>${entry.source}${entry.version && entry.version !== 'core' ? ` v${entry.version}` : ''} · ${entry.workspaceCount} WORKSPACE${entry.workspaceCount === 1 ? '' : 'S'}${entry.permissions.length ? ` · ${entry.permissions.length} PERMISSION${entry.permissions.length === 1 ? '' : 'S'}` : ''}${entry.needsConfig ? ' · CONFIGURATION REQUIRED' : ''}</small>
              </div>
              ${action}
            </div>
          `;
        }).join('')}
      </section>
    `).join('');
  }

  private setupHistory(): void {
    this.resetHistory();
    const onLayoutChange = () => {
      if (this.suppressHistory || this.activeDrag || this.activeResize) return;
      if (this.historyTimer !== null) window.clearTimeout(this.historyTimer);
      this.historyTimer = window.setTimeout(() => {
        this.historyTimer = null;
        this.commitHistory();
      }, 100);
    };
    const onWorkspace = () => { if (!this.suppressHistory) this.resetHistory(); };
    window.addEventListener('project-v-layout-change', onLayoutChange);
    window.addEventListener('project-v-workspace-activated', onWorkspace);
    window.addEventListener('project-v-layout-reset', onWorkspace);
    window.addEventListener('project-v-layout-imported', onWorkspace);
    this.cleanups.push(() => {
      window.removeEventListener('project-v-layout-change', onLayoutChange);
      window.removeEventListener('project-v-workspace-activated', onWorkspace);
      window.removeEventListener('project-v-layout-reset', onWorkspace);
      window.removeEventListener('project-v-layout-imported', onWorkspace);
    });
  }

  private resetHistory(): void {
    const snapshot = this.workspaces.getCurrentLayout();
    this.history = [cloneLayout(snapshot)];
    this.historyIndex = 0;
    this.updateHistoryButtons();
  }

  private commitHistory(): void {
    if (this.suppressHistory) return;
    const snapshot = this.workspaces.getCurrentLayout();
    const current = this.history[this.historyIndex];
    if (current && layoutSignature(current) === layoutSignature(snapshot)) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(cloneLayout(snapshot));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.updateHistoryButtons();
  }

  private undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.restoreHistoryEntry();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.restoreHistoryEntry();
  }

  private restoreHistoryEntry(): void {
    const entry = this.history[this.historyIndex];
    if (!entry) return;
    this.suppressHistory = true;
    this.workspaces.restoreSnapshot(cloneLayout(entry));
    requestAnimationFrame(() => {
      this.suppressHistory = false;
      this.refresh();
      this.updateHistoryButtons();
    });
  }

  private updateHistoryButtons(): void {
    const undo = document.getElementById('deckUndoBtn') as HTMLButtonElement | null;
    const redo = document.getElementById('deckRedoBtn') as HTMLButtonElement | null;
    if (undo) undo.disabled = this.historyIndex <= 0;
    if (redo) redo.disabled = this.historyIndex >= this.history.length - 1;
  }

  private setupKeyboardShortcuts(): void {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || active instanceof HTMLSelectElement
        || (active instanceof HTMLElement && active.isContentEditable);
      if (typing) return;
      if (event.key === 'Escape') {
        this.cancelPointerOperation();
        this.closeModuleLibrary();
        this.exitMaximize();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    this.cleanups.push(() => document.removeEventListener('keydown', onKeyDown));
  }

  private maximize(panel: HTMLElement): void {
    this.exitMaximize();
    this.maximizedPanel = panel;
    panel.classList.add('deck-maximized');
    document.body.classList.add('deck-has-maximized');
    this.updatePanelControls();
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      this.onMapLayoutChanged?.();
    });
  }

  private exitMaximize(): void {
    if (!this.maximizedPanel) return;
    this.maximizedPanel.classList.remove('deck-maximized');
    this.maximizedPanel = null;
    document.body.classList.remove('deck-has-maximized');
    this.updatePanelControls();
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      this.onMapLayoutChanged?.();
    });
  }

  private updatePanelControls(): void {
    for (const child of Array.from(this.grid.children)) {
      const panel = child as HTMLElement;
      if (!panel.dataset.panel) continue;
      const collapse = panel.querySelector<HTMLButtonElement>('.v-panel-collapse-btn');
      const maximize = panel.querySelector<HTMLButtonElement>('.v-panel-maximize-btn');
      if (collapse) {
        const collapsed = panel.classList.contains('deck-collapsed');
        collapse.textContent = collapsed ? '+' : '−';
        collapse.title = collapsed ? 'Restore module' : 'Minimize module';
      }
      if (maximize) {
        const maximized = panel.classList.contains('deck-maximized');
        maximize.textContent = maximized ? '⊟' : '□';
        maximize.title = maximized ? 'Return module to deck' : 'Maximize module';
      }
    }
  }

  private updateMapLayoutLabel(): void {
    const geometry = this.workspaces.getPanelGeometry('map');
    const width = geometryValue(geometry, 'w', 8);
    const label = document.getElementById('mapLayoutLabel');
    if (label) label.textContent = width >= 12 ? 'MAP: FULL' : width >= 8 ? 'MAP: COMMAND' : 'MAP: COMPACT';
    document.querySelectorAll<HTMLButtonElement>('[data-map-span]').forEach((button) => {
      const span = Number.parseInt(button.dataset.mapSpan ?? '0', 10);
      const active = span === 3 ? width >= 12 : span === 2 ? width >= 8 && width < 12 : width < 8;
      button.classList.toggle('active', active);
    });
  }

  private flashToolbarButton(button: HTMLButtonElement | null, text: string): void {
    if (!button) return;
    const original = button.textContent ?? 'SAVE';
    button.textContent = text;
    button.classList.add('confirmed');
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('confirmed');
    }, 1100);
  }
}
