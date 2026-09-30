export type BuiltInDeckWorkspaceId = 'watchtower' | 'global-pulse' | 'live-ops' | 'intelligence' | 'assistant';
export type DeckWorkspaceId = string;
export type DeckPresetId = 'command' | 'map-focus' | 'analysis' | 'video-wall' | 'three-column' | 'minimal' | 'custom';

export interface DeckWorkspaceDefinition {
  id: DeckWorkspaceId;
  label: string;
  subtitle: string;
  preferredOrder: string[];
  mapWidth: number;
  mapRows: number;
  builtIn: boolean;
  baseWorkspaceId: BuiltInDeckWorkspaceId;
  createdAt?: number;
}

export interface DeckPanelGeometry {
  /** Zero-based dock column in the twelve-column command grid. */
  x?: number;
  /** Zero-based dock row. */
  y?: number;
  /** Width in command-grid columns. */
  w?: number;
  /** Height in command-grid rows. */
  h?: number;
  collapsed?: boolean;
  hidden?: boolean;
  /** Phase Two/Three compatibility fields; migrated but never written. */
  rowSpan?: number;
  colSpan?: number;
}

export interface DeckWorkspaceLayout {
  order: string[];
  geometry: Record<string, DeckPanelGeometry>;
  /** Kept only so Phase Two/Three exports can still be imported. */
  mapHeight?: string;
  updatedAt: number;
}

interface DeckWorkspaceStore {
  version: 4;
  activeDeck: DeckWorkspaceId;
  defaultDeck: DeckWorkspaceId;
  layouts: Record<DeckWorkspaceId, DeckWorkspaceLayout>;
  customWorkspaces: DeckWorkspaceDefinition[];
  presets: Record<DeckWorkspaceId, DeckPresetId>;
  scrollPositions: Record<DeckWorkspaceId, number>;
}

interface PhaseFourStore {
  version: 3;
  activeDeck: BuiltInDeckWorkspaceId;
  layouts: Partial<Record<BuiltInDeckWorkspaceId, DeckWorkspaceLayout>>;
}

interface LegacyDeckWorkspaceStore {
  version: 1 | 2;
  activeDeck: BuiltInDeckWorkspaceId;
  layouts: Partial<Record<BuiltInDeckWorkspaceId, DeckWorkspaceLayout>>;
}

export interface DeckWorkspaceManagerOptions {
  grid: HTMLElement;
  mapSection: HTMLElement;
  scrollContainer?: HTMLElement | null;
  onActivated?: (workspace: DeckWorkspaceDefinition) => void;
  onLayoutApplied?: () => void;
}

export const DOCK_COLUMNS = 12;
export const DOCK_ROW_HEIGHT_PX = 72;
export const DOCK_GAP_PX = 8;

export const DECK_PRESETS: ReadonlyArray<{ id: Exclude<DeckPresetId, 'custom'>; label: string; description: string }> = [
  { id: 'command', label: 'COMMAND', description: 'Balanced map, right rail, and operations modules' },
  { id: 'map-focus', label: 'MAP FOCUS', description: 'Large map with a compact intelligence rail' },
  { id: 'analysis', label: 'ANALYSIS', description: 'Research and risk modules prioritized' },
  { id: 'video-wall', label: 'VIDEO WALL', description: 'Live news and camera modules prioritized' },
  { id: 'three-column', label: 'THREE COLUMN', description: 'Dense equal-column analyst layout' },
  { id: 'minimal', label: 'MINIMAL', description: 'Map plus only essential intelligence modules' },
];

const STORAGE_KEY = 'project-v-workspaces-v4';
const PHASE_FOUR_STORAGE_KEY = 'project-v-docked-workspaces-v3';
const LEGACY_STORAGE_KEYS = [
  'project-v-deck-workspaces-v2',
  'project-v-deck-workspaces-v1',
] as const;
const ACTIVE_DECK_KEY = 'project-v-active-deck';
const LEGACY_ROW_CLASSES = ['span-1', 'span-2', 'span-3', 'span-4'] as const;
const LEGACY_COL_CLASSES = ['col-span-1', 'col-span-2', 'col-span-3'] as const;
const MAX_SCAN_ROWS = 400;

export const DECK_WORKSPACES: DeckWorkspaceDefinition[] = [
  {
    id: 'watchtower',
    label: 'WATCHTOWER',
    subtitle: 'COMMAND OVERVIEW',
    preferredOrder: [
      'map', 'strategic-posture', 'insights', 'strategic-risk', 'alert-center', 'live-news', 'intel',
      'watchlists', 'live-webcams', 'satellite-fires', 'cii', 'politics', 'markets', 'economic',
      'polymarket', 'case-status', 'data-library', 'map-operations', 'camera-wall', 'launch-deck', 'source-health', 'source-browser', 'service-status', 'monitors', 'world-clock',
    ],
    mapWidth: 8,
    mapRows: 7,
    builtIn: true,
    baseWorkspaceId: 'watchtower',
  },
  {
    id: 'global-pulse',
    label: 'GLOBAL PULSE',
    subtitle: 'NEWS · ECONOMY · HUMAN IMPACT',
    preferredOrder: [
      'map', 'insights', 'strategic-risk', 'politics', 'intel', 'world', 'gov',
      'middleeast', 'markets', 'economic', 'commodities', 'climate', 'ucdp-events',
      'displacement', 'population-exposure', 'giving', 'world-clock',
    ],
    mapWidth: 8,
    mapRows: 7,
    builtIn: true,
    baseWorkspaceId: 'global-pulse',
  },
  {
    id: 'live-ops',
    label: 'LIVE OPS',
    subtitle: 'REAL-TIME OPERATIONS',
    preferredOrder: [
      'map', 'alert-center', 'event-timeline', 'live-news', 'satellite-fires', 'live-webcams', 'strategic-posture',
      'watchlists', 'alert-rules', 'map-operations', 'camera-wall', 'live-language', 'launch-deck', 'communications-wall', 'source-browser', 'source-health', 'oref-sirens', 'telegram-intel', 'security-advisories', 'service-status',
      'gdelt-intel', 'ucdp-events', 'world-clock', 'monitors',
    ],
    mapWidth: 12,
    mapRows: 7,
    builtIn: true,
    baseWorkspaceId: 'live-ops',
  },
  {
    id: 'intelligence',
    label: 'INTELLIGENCE',
    subtitle: 'ANALYSIS · RISK · SIGNALS',
    preferredOrder: [
      'map', 'insights', 'strategic-risk', 'strategic-posture', 'gdelt-intel',
      'cii', 'cascade', 'deduction', 'telegram-intel', 'security-advisories',
      'event-timeline', 'watchlists', 'alert-center', 'case-status', 'data-library', 'map-operations', 'monitors', 'macro-signals', 'tech-readiness', 'source-health', 'service-status', 'world-clock',
      'research-library', 'source-browser', 'command-assistant', 'multi-agent-research',
    ],
    mapWidth: 8,
    mapRows: 7,
    builtIn: true,
    baseWorkspaceId: 'intelligence',
  },
  {
    id: 'assistant',
    label: 'ASSISTANT',
    subtitle: 'LOCAL AI · WORKSPACE CONTEXT',
    preferredOrder: [
      'command-assistant', 'multi-agent-research', 'research-library', 'case-status', 'data-library', 'map-operations', 'camera-wall', 'live-language', 'launch-deck', 'alert-rules', 'event-timeline', 'insights', 'strategic-risk', 'strategic-posture',
      'map', 'intel', 'gdelt-intel', 'cii', 'live-news', 'source-browser', 'communications-wall', 'source-health', 'monitors', 'world-clock',
    ],
    mapWidth: 8,
    mapRows: 6,
    builtIn: true,
    baseWorkspaceId: 'assistant',
  },
];

interface DockRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isBuiltInDeckWorkspaceId(value: unknown): value is BuiltInDeckWorkspaceId {
  return DECK_WORKSPACES.some((workspace) => workspace.id === value);
}

function isDeckPresetId(value: unknown): value is DeckPresetId {
  return value === 'command'
    || value === 'map-focus'
    || value === 'analysis'
    || value === 'video-wall'
    || value === 'three-column'
    || value === 'minimal'
    || value === 'custom';
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanWorkspaceLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return cleaned || fallback;
}

function cleanWorkspaceSubtitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 64);
  return cleaned || fallback;
}

function normalizeGeometry(value: DeckPanelGeometry | undefined, fallback: DockRect): DeckPanelGeometry {
  const legacyColSpan = clamp(finiteInteger(value?.colSpan, 1), 1, 3);
  const legacyRowSpan = clamp(finiteInteger(value?.rowSpan, 1), 1, 4);
  const fallbackWidth = typeof value?.colSpan === 'number' && typeof value?.w !== 'number'
    ? legacyColSpan * 4
    : fallback.w;
  const fallbackHeight = typeof value?.rowSpan === 'number' && typeof value?.h !== 'number'
    ? legacyRowSpan * 3
    : fallback.h;
  const w = clamp(finiteInteger(value?.w, fallbackWidth), 2, DOCK_COLUMNS);
  const h = clamp(finiteInteger(value?.h, fallbackHeight), 1, 14);
  return {
    x: clamp(finiteInteger(value?.x, fallback.x), 0, DOCK_COLUMNS - w),
    y: Math.max(0, finiteInteger(value?.y, fallback.y)),
    w,
    h,
    collapsed: value?.collapsed === true,
    hidden: value?.hidden === true,
  };
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

function cloneWorkspace(workspace: DeckWorkspaceDefinition): DeckWorkspaceDefinition {
  return { ...workspace, preferredOrder: [...workspace.preferredOrder] };
}

function parsePhaseFourStore(raw: string | null): PhaseFourStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PhaseFourStore>;
    if (parsed.version !== 3 || !parsed.layouts || !isBuiltInDeckWorkspaceId(parsed.activeDeck)) return null;
    return parsed as PhaseFourStore;
  } catch {
    return null;
  }
}

function parseLegacyStore(raw: string | null): LegacyDeckWorkspaceStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyDeckWorkspaceStore>;
    if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.layouts || !isBuiltInDeckWorkspaceId(parsed.activeDeck)) return null;
    return parsed as LegacyDeckWorkspaceStore;
  } catch {
    return null;
  }
}

function parsePhaseFiveStore(raw: string | null): DeckWorkspaceStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeckWorkspaceStore>;
    if (parsed.version !== 4 || !parsed.layouts || !Array.isArray(parsed.customWorkspaces)) return null;

    const customWorkspaces: DeckWorkspaceDefinition[] = [];
    const usedIds = new Set(DECK_WORKSPACES.map((workspace) => workspace.id));
    for (const candidate of parsed.customWorkspaces) {
      if (!candidate || typeof candidate.id !== 'string' || !candidate.id.startsWith('custom-') || usedIds.has(candidate.id)) continue;
      const base = isBuiltInDeckWorkspaceId(candidate.baseWorkspaceId) ? candidate.baseWorkspaceId : 'watchtower';
      const baseDefinition = DECK_WORKSPACES.find((workspace) => workspace.id === base)!;
      const definition: DeckWorkspaceDefinition = {
        id: candidate.id.slice(0, 64),
        label: cleanWorkspaceLabel(candidate.label, 'CUSTOM DESK'),
        subtitle: cleanWorkspaceSubtitle(candidate.subtitle, 'CUSTOM WORKSPACE'),
        preferredOrder: Array.isArray(candidate.preferredOrder)
          ? candidate.preferredOrder.filter((key): key is string => typeof key === 'string')
          : [...baseDefinition.preferredOrder],
        mapWidth: clamp(finiteInteger(candidate.mapWidth, baseDefinition.mapWidth), 6, 12),
        mapRows: clamp(finiteInteger(candidate.mapRows, baseDefinition.mapRows), 4, 10),
        builtIn: false,
        baseWorkspaceId: base,
        createdAt: finiteInteger(candidate.createdAt, Date.now()),
      };
      customWorkspaces.push(definition);
      usedIds.add(definition.id);
    }

    const validIds = new Set([...DECK_WORKSPACES.map((workspace) => workspace.id), ...customWorkspaces.map((workspace) => workspace.id)]);
    const activeDeck = typeof parsed.activeDeck === 'string' && validIds.has(parsed.activeDeck) ? parsed.activeDeck : 'watchtower';
    const defaultDeck = typeof parsed.defaultDeck === 'string' && validIds.has(parsed.defaultDeck) ? parsed.defaultDeck : 'watchtower';
    const layouts: Record<string, DeckWorkspaceLayout> = {};
    for (const [deckId, candidate] of Object.entries(parsed.layouts)) {
      if (!validIds.has(deckId) || !candidate || !Array.isArray(candidate.order) || !candidate.geometry) continue;
      layouts[deckId] = {
        order: candidate.order.filter((key): key is string => typeof key === 'string'),
        geometry: Object.fromEntries(
          Object.entries(candidate.geometry).map(([key, value]) => [key, normalizeGeometry(value, defaultSizeForPanel(key))]),
        ),
        updatedAt: finiteInteger(candidate.updatedAt, Date.now()),
      };
    }

    const presets: Record<string, DeckPresetId> = {};
    for (const deckId of validIds) {
      const value = parsed.presets?.[deckId];
      presets[deckId] = isDeckPresetId(value) ? value : layouts[deckId] ? 'custom' : 'command';
    }

    const scrollPositions: Record<string, number> = {};
    for (const deckId of validIds) {
      scrollPositions[deckId] = Math.max(0, finiteInteger(parsed.scrollPositions?.[deckId], 0));
    }

    return { version: 4, activeDeck, defaultDeck, layouts, customWorkspaces, presets, scrollPositions };
  } catch {
    return null;
  }
}

function dataSize(element: HTMLElement | undefined, key: 'moduleDefaultW' | 'moduleDefaultH' | 'moduleMinW' | 'moduleMinH', fallback: number): number {
  const value = Number(element?.dataset[key]);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function defaultSizeForPanel(panelId: string, element?: HTMLElement): DockRect {
  let fallback: DockRect;
  if (panelId === 'map') fallback = { x: 0, y: 0, w: 8, h: 7 };
  else if (panelId === 'live-news' || panelId === 'live-webcams' || panelId === 'alert-center' || panelId === 'event-timeline' || panelId === 'communications-wall' || panelId === 'source-browser' || panelId === 'map-operations') fallback = { x: 0, y: 0, w: 8, h: 5 };
  else if (panelId === 'heatmap' || panelId === 'gdelt-intel' || panelId === 'cascade') fallback = { x: 0, y: 0, w: 8, h: 4 };
  else if (panelId === 'world-clock' || panelId === 'service-status') fallback = { x: 0, y: 0, w: 4, h: 2 };
  else if (element?.classList.contains('panel-wide')) fallback = { x: 0, y: 0, w: 8, h: 4 };
  else fallback = { x: 0, y: 0, w: 4, h: 3 };
  return {
    ...fallback,
    w: clamp(dataSize(element, 'moduleDefaultW', fallback.w), 2, DOCK_COLUMNS),
    h: clamp(dataSize(element, 'moduleDefaultH', fallback.h), 2, 14),
  };
}

function minimumSizeForPanel(panelId: string, element?: HTMLElement): ProjectVMinimumSize {
  const fallbackW = panelId === 'map' ? 6 : 2;
  const fallbackH = panelId === 'map' ? 4 : 2;
  return {
    w: clamp(dataSize(element, 'moduleMinW', fallbackW), 2, DOCK_COLUMNS),
    h: clamp(dataSize(element, 'moduleMinH', fallbackH), 1, 14),
  };
}

interface ProjectVMinimumSize {
  w: number;
  h: number;
}

function effectiveRect(geometry: DeckPanelGeometry): DockRect {
  return {
    x: finiteInteger(geometry.x, 0),
    y: finiteInteger(geometry.y, 0),
    w: clamp(finiteInteger(geometry.w, 4), 2, DOCK_COLUMNS),
    h: geometry.collapsed ? 1 : clamp(finiteInteger(geometry.h, 3), 1, 14),
  };
}

function overlaps(a: DockRect, b: DockRect): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function isFree(rect: DockRect, occupied: DockRect[]): boolean {
  return rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.w <= DOCK_COLUMNS
    && !occupied.some((other) => overlaps(rect, other));
}

function candidateColumns(preferredX: number, width: number): number[] {
  const maxX = DOCK_COLUMNS - width;
  const values: number[] = [];
  const preferred = clamp(preferredX, 0, maxX);
  values.push(preferred);
  for (let distance = 1; distance <= DOCK_COLUMNS; distance += 1) {
    const left = preferred - distance;
    const right = preferred + distance;
    if (left >= 0) values.push(left);
    if (right <= maxX) values.push(right);
  }
  return Array.from(new Set(values));
}

function findFreeRect(rect: DockRect, occupied: DockRect[], startAtTop = false): DockRect {
  const startY = startAtTop ? 0 : Math.max(0, rect.y);
  const columns = candidateColumns(rect.x, rect.w);
  for (let y = startY; y < startY + MAX_SCAN_ROWS; y += 1) {
    for (const x of columns) {
      const candidate = { ...rect, x, y };
      if (isFree(candidate, occupied)) return candidate;
    }
  }
  const bottom = occupied.reduce((max, current) => Math.max(max, current.y + current.h), 0);
  return { ...rect, x: clamp(rect.x, 0, DOCK_COLUMNS - rect.w), y: bottom };
}

function panelIsAvailable(element: HTMLElement): boolean {
  return !element.classList.contains('hidden');
}

function panelParticipates(geometry: DeckPanelGeometry, element?: HTMLElement): boolean {
  return geometry.hidden !== true && (!element || panelIsAvailable(element));
}

function sortOrderFromGeometry(order: string[], geometry: Record<string, DeckPanelGeometry>): string[] {
  const index = new Map(order.map((key, position) => [key, position]));
  return [...order].sort((a, b) => {
    const ga = effectiveRect(geometry[a] ?? {});
    const gb = effectiveRect(geometry[b] ?? {});
    return ga.y - gb.y || ga.x - gb.x || (index.get(a) ?? 0) - (index.get(b) ?? 0);
  });
}

function commandPresetGeometry(workspace: DeckWorkspaceDefinition): Record<string, DockRect> {
  const commonRightRail: Record<string, DockRect> = {
    'strategic-posture': { x: 8, y: 0, w: 4, h: 3 },
    insights: { x: 8, y: 3, w: 4, h: 3 },
    'strategic-risk': { x: 8, y: 6, w: 4, h: 3 },
  };

  if (workspace.baseWorkspaceId === 'live-ops') {
    return {
      map: { x: 0, y: 0, w: 12, h: 7 },
      'live-news': { x: 0, y: 7, w: 8, h: 4 },
      'satellite-fires': { x: 8, y: 7, w: 4, h: 4 },
      'live-webcams': { x: 0, y: 11, w: 8, h: 4 },
      'strategic-posture': { x: 8, y: 11, w: 4, h: 4 },
      'camera-wall': { x: 0, y: 15, w: 8, h: 4 },
      'oref-sirens': { x: 0, y: 19, w: 4, h: 3 },
      'telegram-intel': { x: 4, y: 19, w: 4, h: 3 },
      'security-advisories': { x: 8, y: 15, w: 4, h: 3 },
      'alert-center': { x: 0, y: 22, w: 8, h: 5 },
      'source-health': { x: 8, y: 18, w: 4, h: 5 },
      'event-timeline': { x: 0, y: 27, w: 8, h: 6 },
      watchlists: { x: 8, y: 23, w: 4, h: 5 },
      'alert-rules': { x: 8, y: 28, w: 4, h: 5 },
      'map-operations': { x: 0, y: 33, w: 8, h: 3 },
      'live-language': { x: 0, y: 36, w: 8, h: 5 },
    };
  }

  if (workspace.baseWorkspaceId === 'global-pulse') {
    return {
      map: { x: 0, y: 0, w: 8, h: 7 },
      insights: { x: 8, y: 0, w: 4, h: 3 },
      'strategic-risk': { x: 8, y: 3, w: 4, h: 4 },
      politics: { x: 0, y: 7, w: 4, h: 3 },
      intel: { x: 4, y: 7, w: 4, h: 3 },
      world: { x: 8, y: 7, w: 4, h: 3 },
      markets: { x: 0, y: 10, w: 4, h: 3 },
      economic: { x: 4, y: 10, w: 4, h: 3 },
      commodities: { x: 8, y: 10, w: 4, h: 3 },
    };
  }

  if (workspace.baseWorkspaceId === 'intelligence') {
    return {
      map: { x: 0, y: 0, w: 8, h: 7 },
      insights: { x: 8, y: 0, w: 4, h: 3 },
      'strategic-risk': { x: 8, y: 3, w: 4, h: 4 },
      'strategic-posture': { x: 0, y: 7, w: 4, h: 3 },
      'gdelt-intel': { x: 4, y: 7, w: 8, h: 4 },
      cii: { x: 0, y: 10, w: 4, h: 3 },
      'research-library': { x: 0, y: 13, w: 4, h: 7 },
      cascade: { x: 0, y: 21, w: 8, h: 4 },
      'command-assistant': { x: 4, y: 11, w: 8, h: 7 },
      'multi-agent-research': { x: 8, y: 30, w: 4, h: 4 },
      'telegram-intel': { x: 4, y: 18, w: 4, h: 3 },
      'security-advisories': { x: 8, y: 18, w: 4, h: 3 },
      'event-timeline': { x: 0, y: 25, w: 8, h: 6 },
      'alert-center': { x: 8, y: 21, w: 4, h: 4 },
      watchlists: { x: 8, y: 25, w: 4, h: 5 },
      'map-operations': { x: 0, y: 31, w: 4, h: 3 },
    };
  }

  if (workspace.baseWorkspaceId === 'assistant') {
    return {
      'command-assistant': { x: 0, y: 0, w: 8, h: 8 },
      'multi-agent-research': { x: 8, y: 8, w: 4, h: 4 },
      'research-library': { x: 8, y: 0, w: 4, h: 8 },
      insights: { x: 0, y: 8, w: 4, h: 3 },
      'strategic-risk': { x: 4, y: 8, w: 4, h: 4 },
      'strategic-posture': { x: 8, y: 12, w: 4, h: 3 },
      map: { x: 0, y: 12, w: 8, h: 6 },
      intel: { x: 8, y: 15, w: 4, h: 4 },
      'gdelt-intel': { x: 0, y: 18, w: 8, h: 4 },
      cii: { x: 8, y: 19, w: 4, h: 4 },
      'alert-rules': { x: 0, y: 22, w: 4, h: 5 },
      'event-timeline': { x: 4, y: 23, w: 8, h: 6 },
      'source-health': { x: 0, y: 27, w: 4, h: 5 },
      'map-operations': { x: 4, y: 29, w: 4, h: 3 },
    };
  }

  return {
    map: { x: 0, y: 0, w: workspace.mapWidth, h: workspace.mapRows },
    ...commonRightRail,
    'live-news': { x: 0, y: 7, w: 8, h: 4 },
    intel: { x: 8, y: 9, w: 4, h: 3 },
    'live-webcams': { x: 0, y: 11, w: 8, h: 4 },
    'satellite-fires': { x: 8, y: 12, w: 4, h: 3 },
    cii: { x: 8, y: 15, w: 4, h: 3 },
    'alert-center': { x: 0, y: 18, w: 8, h: 5 },
    watchlists: { x: 8, y: 18, w: 4, h: 5 },
    'source-health': { x: 8, y: 23, w: 4, h: 5 },
    'map-operations': { x: 0, y: 23, w: 4, h: 3 },
  };
}

function presetGeometry(workspace: DeckWorkspaceDefinition, preset: Exclude<DeckPresetId, 'custom'>): Record<string, DockRect> {
  if (preset === 'command') return commandPresetGeometry(workspace);

  const order = workspace.preferredOrder.filter((key) => key !== 'map');
  const first = order[0];
  const second = order[1];
  const third = order[2];
  const fourth = order[3];
  const fifth = order[4];
  const result: Record<string, DockRect> = {};

  if (preset === 'map-focus') {
    result.map = { x: 0, y: 0, w: 9, h: 8 };
    if (first) result[first] = { x: 9, y: 0, w: 3, h: 3 };
    if (second) result[second] = { x: 9, y: 3, w: 3, h: 3 };
    if (third) result[third] = { x: 9, y: 6, w: 3, h: 2 };
    if (fourth) result[fourth] = { x: 0, y: 8, w: 6, h: 4 };
    if (fifth) result[fifth] = { x: 6, y: 8, w: 6, h: 4 };
    return result;
  }

  if (preset === 'analysis') {
    result.map = { x: 0, y: 0, w: 6, h: 7 };
    if (first) result[first] = { x: 6, y: 0, w: 6, h: 3 };
    if (second) result[second] = { x: 6, y: 3, w: 6, h: 4 };
    if (third) result[third] = { x: 0, y: 7, w: 4, h: 3 };
    if (fourth) result[fourth] = { x: 4, y: 7, w: 4, h: 3 };
    if (fifth) result[fifth] = { x: 8, y: 7, w: 4, h: 3 };
    return result;
  }

  if (preset === 'video-wall') {
    result.map = { x: 0, y: 0, w: 6, h: 6 };
    result['live-news'] = { x: 6, y: 0, w: 6, h: 5 };
    result['live-webcams'] = { x: 0, y: 6, w: 6, h: 5 };
    result['camera-wall'] = { x: 6, y: 6, w: 6, h: 5 };
    result['live-language'] = { x: 0, y: 11, w: 12, h: 5 };
    if (first && first !== 'live-news' && first !== 'live-webcams' && first !== 'camera-wall' && first !== 'live-language') result[first] = { x: 0, y: 16, w: 6, h: 3 };
    if (second && second !== 'live-news' && second !== 'live-webcams' && second !== 'camera-wall' && second !== 'live-language') result[second] = { x: 6, y: 16, w: 6, h: 3 };
    return result;
  }

  if (preset === 'three-column') {
    result.map = { x: 0, y: 0, w: 4, h: 6 };
    if (first) result[first] = { x: 4, y: 0, w: 4, h: 3 };
    if (second) result[second] = { x: 8, y: 0, w: 4, h: 3 };
    if (third) result[third] = { x: 4, y: 3, w: 4, h: 3 };
    if (fourth) result[fourth] = { x: 8, y: 3, w: 4, h: 3 };
    if (fifth) result[fifth] = { x: 0, y: 6, w: 4, h: 3 };
    return result;
  }

  result.map = { x: 0, y: 0, w: 12, h: 8 };
  if (first) result[first] = { x: 0, y: 8, w: 6, h: 3 };
  if (second) result[second] = { x: 6, y: 8, w: 6, h: 3 };
  return result;
}

function visiblePanelsForPreset(workspace: DeckWorkspaceDefinition, preset: Exclude<DeckPresetId, 'custom'>): Set<string> {
  const preferred = workspace.preferredOrder;
  if (preset === 'minimal') return new Set(['map', ...preferred.filter((key) => key !== 'map').slice(0, 2)]);
  if (preset === 'map-focus') return new Set(['map', ...preferred.filter((key) => key !== 'map').slice(0, 5)]);
  if (preset === 'analysis') return new Set(['map', ...preferred.filter((key) => key !== 'map').slice(0, 9)]);
  if (preset === 'video-wall') {
    return new Set([
      'map', 'live-news', 'live-webcams', 'camera-wall', 'live-language', 'strategic-posture', 'insights', 'strategic-risk',
      'intel', 'telegram-intel', 'satellite-fires', 'oref-sirens',
    ]);
  }
  if (preset === 'three-column') return new Set(['map', ...preferred.filter((key) => key !== 'map').slice(0, 11)]);
  return new Set(preferred);
}

export class DeckWorkspaceManager {
  private readonly grid: HTMLElement;
  private readonly mapSection: HTMLElement;
  private readonly scrollContainer: HTMLElement | null;
  private readonly onActivated?: (workspace: DeckWorkspaceDefinition) => void;
  private readonly onLayoutApplied?: () => void;
  private store: DeckWorkspaceStore;
  private observer: MutationObserver | null = null;
  private saveTimer: number | null = null;
  private availabilityTimer: number | null = null;
  private scrollTimer: number | null = null;
  private applyingLayout = false;

  constructor(options: DeckWorkspaceManagerOptions) {
    this.grid = options.grid;
    this.mapSection = options.mapSection;
    this.scrollContainer = options.scrollContainer ?? document.querySelector<HTMLElement>('.main-content');
    this.onActivated = options.onActivated;
    this.onLayoutApplied = options.onLayoutApplied;

    const phaseFive = parsePhaseFiveStore(localStorage.getItem(STORAGE_KEY));
    const phaseFour = phaseFive ? null : parsePhaseFourStore(localStorage.getItem(PHASE_FOUR_STORAGE_KEY));
    let legacy: LegacyDeckWorkspaceStore | null = null;
    if (!phaseFive && !phaseFour) {
      for (const key of LEGACY_STORAGE_KEYS) {
        legacy = parseLegacyStore(localStorage.getItem(key));
        if (legacy) break;
      }
    }

    const fallbackActive = localStorage.getItem(ACTIVE_DECK_KEY);
    this.store = phaseFive ?? {
      version: 4,
      activeDeck: phaseFour?.activeDeck
        ?? legacy?.activeDeck
        ?? (isBuiltInDeckWorkspaceId(fallbackActive) ? fallbackActive : 'watchtower'),
      defaultDeck: 'watchtower',
      layouts: {},
      customWorkspaces: [],
      presets: {},
      scrollPositions: {},
    };

    if (phaseFour) this.migratePhaseFourStore(phaseFour);
    else if (legacy) this.migrateLegacyStates(legacy);
    this.ensureStoreCompleteness();

    // A saved default workspace opens at the beginning of a fresh browser or
    // desktop session. During the same session, workspace switching still
    // remembers the user's current desk.
    const sessionKey = 'project-v-workspace-session-v1';
    if (phaseFive && !sessionStorage.getItem(sessionKey) && this.hasWorkspace(this.store.defaultDeck)) {
      this.store.activeDeck = this.store.defaultDeck;
    }
    sessionStorage.setItem(sessionKey, 'active');
  }

  init(): void {
    this.ensureMapIsInGrid();
    this.grid.dataset.dockColumns = String(DOCK_COLUMNS);
    localStorage.setItem(ACTIVE_DECK_KEY, this.store.activeDeck);
    this.apply(this.store.activeDeck);

    this.observer = new MutationObserver(() => {
      if (!this.applyingLayout) this.scheduleSave();
    });
    this.observer.observe(this.grid, { childList: true, subtree: false });
    window.addEventListener('project-v-layout-change', this.handleExternalLayoutChange);
    window.addEventListener('project-v-panel-availability-change', this.handlePanelAvailabilityChange);
    this.scrollContainer?.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  destroy(): void {
    this.saveNow();
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('project-v-layout-change', this.handleExternalLayoutChange);
    window.removeEventListener('project-v-panel-availability-change', this.handlePanelAvailabilityChange);
    this.scrollContainer?.removeEventListener('scroll', this.handleScroll);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.availabilityTimer !== null) window.clearTimeout(this.availabilityTimer);
    if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer);
    this.saveTimer = null;
    this.availabilityTimer = null;
    this.scrollTimer = null;
  }

  getActiveDeck(): DeckWorkspaceId {
    return this.store.activeDeck;
  }

  getActiveWorkspace(): DeckWorkspaceDefinition {
    return cloneWorkspace(this.workspaceById(this.store.activeDeck));
  }

  getWorkspaceDefinitions(): DeckWorkspaceDefinition[] {
    return [...DECK_WORKSPACES.map(cloneWorkspace), ...this.store.customWorkspaces.map(cloneWorkspace)];
  }

  getActivePreset(): DeckPresetId {
    return this.store.presets[this.store.activeDeck] ?? 'command';
  }

  getDefaultDeck(): DeckWorkspaceId {
    return this.store.defaultDeck;
  }

  isActiveWorkspaceCustom(): boolean {
    return !this.workspaceById(this.store.activeDeck).builtIn;
  }

  getCurrentLayout(): DeckWorkspaceLayout {
    return cloneLayout(this.captureCurrentLayout());
  }

  getPanelGeometry(panelId: string): DeckPanelGeometry | null {
    const panel = this.findPanel(panelId);
    if (!panel) return null;
    return this.geometryFromElement(panel);
  }

  getPanelIds(): string[] {
    return Array.from(this.grid.children)
      .map((child) => (child as HTMLElement).dataset.panel)
      .filter((key): key is string => Boolean(key));
  }

  getPanelWorkspaceCount(panelId: string): number {
    let count = 0;
    for (const workspace of this.getWorkspaceDefinitions()) {
      const layout = this.store.layouts[workspace.id];
      const state = layout?.geometry[panelId];
      if (state) {
        if (state.hidden !== true) count += 1;
      } else if (workspace.preferredOrder.includes(panelId)) {
        count += 1;
      }
    }
    return count;
  }

  activate(deckId: DeckWorkspaceId): void {
    if (!this.hasWorkspace(deckId) || deckId === this.store.activeDeck) return;
    this.saveNow();
    this.store.activeDeck = deckId;
    localStorage.setItem(ACTIVE_DECK_KEY, deckId);
    this.persistStore();
    this.apply(deckId);
  }

  applyPreset(preset: Exclude<DeckPresetId, 'custom'>): void {
    const workspace = this.workspaceById(this.store.activeDeck);
    const layout = this.createPresetLayout(workspace, preset);
    this.store.presets[this.store.activeDeck] = preset;
    this.store.layouts[this.store.activeDeck] = cloneLayout(layout);
    this.store.scrollPositions[this.store.activeDeck] = 0;
    this.persistStore();
    this.apply(this.store.activeDeck, false, layout);
    this.restoreScrollPosition(true);
    window.dispatchEvent(new CustomEvent('project-v-workspace-preset-change', { detail: { preset } }));
    window.dispatchEvent(new CustomEvent('project-v-layout-reset'));
  }

  resetActive(): void {
    const preset = this.getActivePreset() === 'custom' ? 'command' : this.getActivePreset();
    this.applyPreset(preset as Exclude<DeckPresetId, 'custom'>);
  }

  createWorkspace(label: string, sourceDeckId: DeckWorkspaceId = this.store.activeDeck, duplicateLayout = false): DeckWorkspaceDefinition {
    const source = this.workspaceById(sourceDeckId);
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const definition: DeckWorkspaceDefinition = {
      id,
      label: cleanWorkspaceLabel(label, 'CUSTOM DESK').toUpperCase(),
      subtitle: `CUSTOM · BASED ON ${source.label}`,
      preferredOrder: [...source.preferredOrder],
      mapWidth: source.mapWidth,
      mapRows: source.mapRows,
      builtIn: false,
      baseWorkspaceId: source.baseWorkspaceId,
      createdAt: Date.now(),
    };

    this.saveNow();
    this.store.customWorkspaces.push(definition);
    if (duplicateLayout) {
      const sourceLayout = sourceDeckId === this.store.activeDeck
        ? this.captureCurrentLayout()
        : this.store.layouts[sourceDeckId];
      this.store.layouts[id] = sourceLayout
        ? cloneLayout(sourceLayout)
        : this.createPresetLayout(definition, 'command');
      this.store.presets[id] = 'custom';
    } else {
      this.store.layouts[id] = this.createPresetLayout(definition, 'command');
      this.store.presets[id] = 'command';
    }
    this.store.scrollPositions[id] = 0;
    this.store.activeDeck = id;
    localStorage.setItem(ACTIVE_DECK_KEY, id);
    this.persistStore();
    this.apply(id);
    window.dispatchEvent(new CustomEvent('project-v-workspace-list-change'));
    return cloneWorkspace(definition);
  }

  duplicateActive(label: string): DeckWorkspaceDefinition {
    return this.createWorkspace(label, this.store.activeDeck, true);
  }

  renameActive(label: string): boolean {
    const workspace = this.store.customWorkspaces.find((item) => item.id === this.store.activeDeck);
    if (!workspace) return false;
    workspace.label = cleanWorkspaceLabel(label, workspace.label).toUpperCase();
    workspace.subtitle = `CUSTOM · BASED ON ${this.workspaceById(workspace.baseWorkspaceId).label}`;
    this.persistStore();
    this.onActivated?.(cloneWorkspace(workspace));
    window.dispatchEvent(new CustomEvent('project-v-workspace-list-change'));
    return true;
  }

  deleteActiveWorkspace(): boolean {
    const active = this.store.activeDeck;
    const workspace = this.store.customWorkspaces.find((item) => item.id === active);
    if (!workspace) return false;
    this.saveCurrentScroll();
    this.store.customWorkspaces = this.store.customWorkspaces.filter((item) => item.id !== active);
    delete this.store.layouts[active];
    delete this.store.presets[active];
    delete this.store.scrollPositions[active];
    if (this.store.defaultDeck === active) this.store.defaultDeck = workspace.baseWorkspaceId;
    this.store.activeDeck = workspace.baseWorkspaceId;
    localStorage.setItem(ACTIVE_DECK_KEY, this.store.activeDeck);
    this.persistStore();
    this.apply(this.store.activeDeck);
    window.dispatchEvent(new CustomEvent('project-v-workspace-list-change'));
    return true;
  }

  setActiveAsDefault(): void {
    this.store.defaultDeck = this.store.activeDeck;
    this.persistStore();
    window.dispatchEvent(new CustomEvent('project-v-workspace-list-change'));
  }

  restoreSnapshot(layout: DeckWorkspaceLayout): void {
    const normalized = this.normalizeLayoutForAvailablePanels(layout);
    this.store.layouts[this.store.activeDeck] = cloneLayout(normalized);
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, normalized);
  }

  movePanel(panelId: string, x: number, y: number): void {
    const layout = this.captureCurrentLayout();
    const current = layout.geometry[panelId];
    if (!current) return;
    const rect = effectiveRect(current);
    current.x = clamp(Math.round(x), 0, DOCK_COLUMNS - rect.w);
    current.y = Math.max(0, Math.round(y));
    const resolved = this.resolveCollisions(layout, panelId);
    this.store.layouts[this.store.activeDeck] = resolved;
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, resolved);
  }

  resizePanel(panelId: string, width: number, height: number): void {
    const layout = this.captureCurrentLayout();
    const current = layout.geometry[panelId];
    if (!current) return;
    const minimum = minimumSizeForPanel(panelId, this.findPanel(panelId) ?? undefined);
    current.w = clamp(Math.round(width), minimum.w, DOCK_COLUMNS);
    current.h = clamp(Math.round(height), minimum.h, 14);
    current.x = clamp(finiteInteger(current.x, 0), 0, DOCK_COLUMNS - current.w);
    const resolved = this.resolveCollisions(layout, panelId);
    this.store.layouts[this.store.activeDeck] = resolved;
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, resolved);
  }

  autoArrange(): void {
    const layout = this.captureCurrentLayout();
    const resolved = this.resolveCollisions(layout, undefined, true);
    this.store.layouts[this.store.activeDeck] = resolved;
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, resolved);
  }

  setPanelHidden(panelId: string, hidden: boolean): void {
    const layout = this.captureCurrentLayout();
    const geometry = layout.geometry[panelId];
    if (!geometry) return;
    geometry.hidden = hidden;
    const resolved = this.resolveCollisions(layout, hidden ? undefined : panelId, hidden);
    this.store.layouts[this.store.activeDeck] = resolved;
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, resolved);
    window.dispatchEvent(new CustomEvent('project-v-module-state-change'));
  }

  setPanelCollapsed(panelId: string, collapsed: boolean): void {
    const layout = this.captureCurrentLayout();
    const geometry = layout.geometry[panelId];
    if (!geometry) return;
    geometry.collapsed = collapsed;
    const resolved = this.resolveCollisions(layout, panelId, collapsed);
    this.store.layouts[this.store.activeDeck] = resolved;
    this.markActiveCustom();
    this.persistStore();
    this.apply(this.store.activeDeck, false, resolved);
    window.dispatchEvent(new CustomEvent('project-v-module-state-change'));
  }

  /** Phase Three toolbar compatibility: 3=full, 2=two-thirds, 1=half. */
  setMapColSpan(span: number): void {
    const width = span >= 3 ? 12 : span === 2 ? 8 : 6;
    const mapGeometry = this.getPanelGeometry('map');
    this.resizePanel('map', width, finiteInteger(mapGeometry?.h, 7));
  }

  exportLayouts(): string {
    this.saveNow();
    return JSON.stringify({
      product: 'Project V Watchtower',
      layoutEngine: 'Phase Five Workspaces and Presets',
      exportedAt: new Date().toISOString(),
      ...this.store,
    }, null, 2);
  }

  importLayouts(serialized: string): void {
    const raw = JSON.parse(serialized) as {
      version?: number;
      activeDeck?: unknown;
      defaultDeck?: unknown;
      layouts?: Record<string, DeckWorkspaceLayout>;
      customWorkspaces?: DeckWorkspaceDefinition[];
      presets?: Record<string, DeckPresetId>;
      scrollPositions?: Record<string, number>;
    };
    if ((raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4) || !raw.layouts) {
      throw new Error('This file is not a Project V deck layout export.');
    }

    if (raw.version === 4) {
      const parsed = parsePhaseFiveStore(JSON.stringify(raw));
      if (!parsed) throw new Error('The Phase Five workspace file is invalid or damaged.');
      this.store = parsed;
      this.ensureStoreCompleteness();
    } else {
      const activeDeck = isBuiltInDeckWorkspaceId(raw.activeDeck) ? raw.activeDeck : 'watchtower';
      this.store = {
        version: 4,
        activeDeck,
        defaultDeck: 'watchtower',
        layouts: {},
        customWorkspaces: [],
        presets: {},
        scrollPositions: {},
      };
      for (const workspace of DECK_WORKSPACES) {
        const candidate = raw.layouts[workspace.id];
        if (!candidate) continue;
        if (raw.version === 3) {
          this.store.layouts[workspace.id] = this.normalizeLayoutForAvailablePanels(candidate, workspace.id);
          this.store.presets[workspace.id] = 'custom';
        } else {
          const preset = this.createPresetLayout(workspace, 'command');
          for (const [key, state] of Object.entries(candidate.geometry ?? {})) {
            if (!preset.geometry[key]) continue;
            preset.geometry[key]!.hidden = state?.hidden === true;
            preset.geometry[key]!.collapsed = state?.collapsed === true;
          }
          this.store.layouts[workspace.id] = preset;
          this.store.presets[workspace.id] = 'custom';
        }
      }
      this.ensureStoreCompleteness();
    }

    localStorage.setItem(ACTIVE_DECK_KEY, this.store.activeDeck);
    this.persistStore();
    this.apply(this.store.activeDeck);
    window.dispatchEvent(new CustomEvent('project-v-layout-imported'));
    window.dispatchEvent(new CustomEvent('project-v-workspace-list-change'));
  }

  saveNow(): void {
    if (this.applyingLayout) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.store.layouts[this.store.activeDeck] = this.captureCurrentLayout();
    this.saveCurrentScroll();
    this.persistStore();
  }

  private readonly handleExternalLayoutChange = (): void => {
    if (!this.applyingLayout) {
      this.markActiveCustom();
      this.scheduleSave();
    }
  };

  private readonly handlePanelAvailabilityChange = (): void => {
    if (this.applyingLayout) return;
    if (this.availabilityTimer !== null) window.clearTimeout(this.availabilityTimer);
    this.availabilityTimer = window.setTimeout(() => {
      this.availabilityTimer = null;
      const layout = this.captureCurrentLayout();
      const resolved = this.resolveCollisions(layout);
      this.store.layouts[this.store.activeDeck] = resolved;
      this.persistStore();
      this.apply(this.store.activeDeck, false, resolved);
    }, 80);
  };

  private readonly handleScroll = (): void => {
    if (this.applyingLayout) return;
    if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = null;
      this.saveCurrentScroll();
      this.persistStore();
    }, 120);
  };

  private hasWorkspace(deckId: DeckWorkspaceId): boolean {
    return DECK_WORKSPACES.some((workspace) => workspace.id === deckId)
      || this.store.customWorkspaces.some((workspace) => workspace.id === deckId);
  }

  private workspaceById(deckId: DeckWorkspaceId): DeckWorkspaceDefinition {
    return this.store.customWorkspaces.find((workspace) => workspace.id === deckId)
      ?? DECK_WORKSPACES.find((workspace) => workspace.id === deckId)
      ?? DECK_WORKSPACES[0]!;
  }

  private ensureStoreCompleteness(): void {
    const definitions = this.getWorkspaceDefinitions();
    const validIds = new Set(definitions.map((workspace) => workspace.id));
    if (!validIds.has(this.store.activeDeck)) this.store.activeDeck = 'watchtower';
    if (!validIds.has(this.store.defaultDeck)) this.store.defaultDeck = 'watchtower';
    for (const workspace of definitions) {
      if (!isDeckPresetId(this.store.presets[workspace.id])) {
        this.store.presets[workspace.id] = this.store.layouts[workspace.id] ? 'custom' : 'command';
      }
      if (!Number.isFinite(this.store.scrollPositions[workspace.id])) this.store.scrollPositions[workspace.id] = 0;
    }
    for (const key of Object.keys(this.store.layouts)) if (!validIds.has(key)) delete this.store.layouts[key];
    for (const key of Object.keys(this.store.presets)) if (!validIds.has(key)) delete this.store.presets[key];
    for (const key of Object.keys(this.store.scrollPositions)) if (!validIds.has(key)) delete this.store.scrollPositions[key];
    this.persistStore();
  }

  private markActiveCustom(): void {
    if (this.store.presets[this.store.activeDeck] === 'custom') return;
    this.store.presets[this.store.activeDeck] = 'custom';
    window.dispatchEvent(new CustomEvent('project-v-workspace-preset-change', { detail: { preset: 'custom' } }));
  }

  private findPanel(panelId: string): HTMLElement | null {
    return this.grid.querySelector<HTMLElement>(`:scope > [data-panel="${CSS.escape(panelId)}"]`);
  }

  private ensureMapIsInGrid(): void {
    if (this.mapSection.parentElement !== this.grid) this.grid.prepend(this.mapSection);
  }

  private geometryFromElement(element: HTMLElement): DeckPanelGeometry {
    const panelId = element.dataset.panel ?? '';
    const fallback = defaultSizeForPanel(panelId, element);
    return normalizeGeometry({
      x: finiteInteger(Number(element.dataset.deckX), fallback.x),
      y: finiteInteger(Number(element.dataset.deckY), fallback.y),
      w: finiteInteger(Number(element.dataset.deckW), fallback.w),
      h: finiteInteger(Number(element.dataset.deckH), fallback.h),
      collapsed: element.classList.contains('deck-collapsed'),
      hidden: element.classList.contains('deck-hidden'),
    }, fallback);
  }

  private captureCurrentLayout(): DeckWorkspaceLayout {
    const order: string[] = [];
    const geometry: Record<string, DeckPanelGeometry> = {};
    for (const child of Array.from(this.grid.children)) {
      const panel = child as HTMLElement;
      const key = panel.dataset.panel;
      if (!key) continue;
      order.push(key);
      geometry[key] = this.geometryFromElement(panel);
    }
    return { order: sortOrderFromGeometry(order, geometry), geometry, updatedAt: Date.now() };
  }

  private createPresetLayout(
    workspace: DeckWorkspaceDefinition,
    preset: Exclude<DeckPresetId, 'custom'> = 'command',
  ): DeckWorkspaceLayout {
    const available = new Map<string, HTMLElement>();
    for (const child of Array.from(this.grid.children)) {
      const element = child as HTMLElement;
      if (element.dataset.panel) available.set(element.dataset.panel, element);
    }

    const preferred = workspace.preferredOrder.filter((key) => available.has(key));
    const remaining = Array.from(available.keys()).filter((key) => !preferred.includes(key));
    const order = [...preferred, ...remaining];
    const geometry: Record<string, DeckPanelGeometry> = {};
    const occupied: DockRect[] = [];
    const prescribed = presetGeometry(workspace, preset);
    const visibleSet = visiblePanelsForPreset(workspace, preset);

    for (const key of order) {
      const element = available.get(key)!;
      const availableInInterface = panelIsAvailable(element);
      const visibleInPreset = visibleSet.has(key);
      const base = prescribed[key] ?? defaultSizeForPanel(key, element);
      const rect = visibleInPreset && availableInInterface
        ? (isFree(base, occupied) ? base : findFreeRect(base, occupied, true))
        : findFreeRect({ ...base, y: occupied.reduce((max, item) => Math.max(max, item.y + item.h), 0) }, occupied);
      geometry[key] = {
        ...rect,
        collapsed: false,
        hidden: !visibleInPreset,
      };
      if (visibleInPreset && availableInInterface) occupied.push(rect);
    }

    return { order: sortOrderFromGeometry(order, geometry), geometry, updatedAt: Date.now() };
  }

  private normalizeLayoutForAvailablePanels(
    candidate: DeckWorkspaceLayout,
    deckId = this.store.activeDeck,
  ): DeckWorkspaceLayout {
    const workspace = this.workspaceById(deckId);
    const presetId = this.store.presets[deckId];
    const fallbackPreset = presetId && presetId !== 'custom' ? presetId : 'command';
    const preset = this.createPresetLayout(workspace, fallbackPreset);
    const order = candidate.order.filter((key) => preset.geometry[key]);
    for (const key of preset.order) if (!order.includes(key)) order.push(key);
    const geometry: Record<string, DeckPanelGeometry> = {};
    for (const key of order) {
      const presetGeometryForPanel = preset.geometry[key] ?? defaultSizeForPanel(key);
      const fallback = effectiveRect(presetGeometryForPanel);
      const candidateGeometry = candidate.geometry?.[key];
      geometry[key] = candidateGeometry
        ? normalizeGeometry(candidateGeometry, fallback)
        : normalizeGeometry(presetGeometryForPanel, fallback);
    }
    return this.resolveCollisions({ order, geometry, updatedAt: Date.now() });
  }

  private resolveCollisions(
    source: DeckWorkspaceLayout,
    anchorId?: string,
    compact = false,
  ): DeckWorkspaceLayout {
    const layout = cloneLayout(source);
    const elementById = new Map<string, HTMLElement>();
    for (const child of Array.from(this.grid.children)) {
      const element = child as HTMLElement;
      if (element.dataset.panel) elementById.set(element.dataset.panel, element);
    }

    const order = layout.order.filter((key) => layout.geometry[key]);
    for (const key of Object.keys(layout.geometry)) if (!order.includes(key)) order.push(key);
    const occupied: DockRect[] = [];
    const resolved: Record<string, DeckPanelGeometry> = {};

    const place = (key: string, pin: boolean) => {
      const element = elementById.get(key);
      const fallback = defaultSizeForPanel(key, element);
      const normalized = normalizeGeometry(layout.geometry[key], fallback);
      if (!panelParticipates(normalized, element)) {
        resolved[key] = normalized;
        return;
      }
      const desired = effectiveRect(normalized);
      const placed = pin && isFree(desired, occupied)
        ? desired
        : findFreeRect(desired, occupied, compact && !pin);
      resolved[key] = { ...normalized, ...placed };
      occupied.push(placed);
    };

    if (anchorId && order.includes(anchorId)) place(anchorId, true);
    const remaining = order
      .filter((key) => key !== anchorId)
      .sort((a, b) => {
        const ga = effectiveRect(layout.geometry[a] ?? {});
        const gb = effectiveRect(layout.geometry[b] ?? {});
        return ga.y - gb.y || ga.x - gb.x || order.indexOf(a) - order.indexOf(b);
      });
    for (const key of remaining) place(key, false);

    const finalOrder = sortOrderFromGeometry(order, resolved);
    return { order: finalOrder, geometry: resolved, updatedAt: Date.now() };
  }

  private apply(
    deckId: DeckWorkspaceId,
    forcePreset = false,
    suppliedLayout?: DeckWorkspaceLayout,
  ): void {
    const workspace = this.workspaceById(deckId);
    const deckChanged = document.body.dataset.activeDeck !== workspace.id;
    const selectedPreset = this.store.presets[deckId] ?? 'command';
    const hasSavedLayout = !forcePreset && Boolean(this.store.layouts[deckId]);
    const candidate = suppliedLayout
      ?? (hasSavedLayout
        ? this.store.layouts[deckId]!
        : this.createPresetLayout(workspace, selectedPreset === 'custom' ? 'command' : selectedPreset));
    const layout = this.normalizeLayoutForAvailablePanels(candidate, deckId);

    this.applyingLayout = true;
    try {
      this.ensureMapIsInGrid();
      const available = new Map<string, HTMLElement>();
      for (const child of Array.from(this.grid.children)) {
        const panel = child as HTMLElement;
        if (panel.dataset.panel) available.set(panel.dataset.panel, panel);
      }

      for (const key of layout.order) {
        const element = available.get(key);
        const geometry = layout.geometry[key];
        if (!element || !geometry) continue;
        const rect = effectiveRect(geometry);
        element.classList.remove(...LEGACY_ROW_CLASSES, ...LEGACY_COL_CLASSES, 'resized', 'deck-maximized');
        element.classList.toggle('deck-collapsed', geometry.collapsed === true);
        element.classList.toggle('deck-hidden', geometry.hidden === true);
        element.dataset.deckX = String(rect.x);
        element.dataset.deckY = String(rect.y);
        element.dataset.deckW = String(rect.w);
        element.dataset.deckH = String(clamp(finiteInteger(geometry.h, rect.h), 1, 14));
        element.style.removeProperty('height');
        const dockColumn = `${rect.x + 1} / span ${rect.w}`;
        const dockRow = `${rect.y + 1} / span ${rect.h}`;
        element.style.setProperty('--pv-dock-column', dockColumn);
        element.style.setProperty('--pv-dock-row', dockRow);
        element.style.gridColumn = dockColumn;
        element.style.gridRow = dockRow;
      }

      document.body.classList.remove('deck-has-maximized');
      this.mapSection.dataset.workspace = workspace.id;
      document.body.dataset.activeDeck = workspace.id;
      document.body.dataset.deckEngine = 'docked-v3';
      document.body.dataset.deckPreset = this.store.presets[deckId] ?? 'command';
      this.store.layouts[deckId] = cloneLayout(layout);
      this.persistStore();
    } finally {
      this.applyingLayout = false;
    }

    this.onActivated?.(cloneWorkspace(workspace));
    if (deckChanged) {
      window.dispatchEvent(new CustomEvent('project-v-workspace-activated', { detail: { deckId } }));
    }
    window.dispatchEvent(new CustomEvent('project-v-module-state-change'));
    window.dispatchEvent(new CustomEvent('project-v-dock-layout-applied', { detail: { deckId } }));
    requestAnimationFrame(() => {
      this.restoreScrollPosition(deckChanged);
      window.dispatchEvent(new Event('resize'));
      this.onLayoutApplied?.();
    });
  }

  private migratePhaseFourStore(phaseFour: PhaseFourStore): void {
    this.store.activeDeck = phaseFour.activeDeck;
    for (const workspace of DECK_WORKSPACES) {
      const builtInId = workspace.id as BuiltInDeckWorkspaceId;
      const old = phaseFour.layouts[builtInId];
      if (!old) continue;
      this.store.layouts[workspace.id] = cloneLayout(old);
      this.store.presets[workspace.id] = 'custom';
      this.store.scrollPositions[workspace.id] = 0;
    }
    this.persistStore();
  }

  private migrateLegacyStates(legacy: LegacyDeckWorkspaceStore): void {
    this.store.activeDeck = legacy.activeDeck;
    for (const workspace of DECK_WORKSPACES) {
      const builtInId = workspace.id as BuiltInDeckWorkspaceId;
      const old = legacy.layouts[builtInId];
      if (!old) continue;
      const preset = this.createPresetLayout(workspace, 'command');
      for (const [key, state] of Object.entries(old.geometry ?? {}) as Array<[string, DeckPanelGeometry]>) {
        const geometry = preset.geometry[key];
        if (!geometry) continue;
        geometry.hidden = state.hidden === true;
        geometry.collapsed = state.collapsed === true;
      }
      this.store.layouts[workspace.id] = this.resolveCollisions(preset);
      this.store.presets[workspace.id] = 'custom';
    }
    this.persistStore();
  }

  private saveCurrentScroll(): void {
    if (!this.scrollContainer) return;
    this.store.scrollPositions[this.store.activeDeck] = Math.max(0, Math.round(this.scrollContainer.scrollTop));
  }

  private restoreScrollPosition(forceTop = false): void {
    if (!this.scrollContainer) return;
    const top = forceTop ? 0 : Math.max(0, this.store.scrollPositions[this.store.activeDeck] ?? 0);
    this.scrollContainer.scrollTop = top;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 180);
  }

  private persistStore(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
  }
}
