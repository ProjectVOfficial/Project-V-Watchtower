export type CameraStreamType = 'youtube' | 'hls' | 'iframe';
export type CameraStreamRegion = 'conflict' | 'americas' | 'europe' | 'middle-east' | 'asia-pacific' | 'global' | 'custom';
export type CameraWallLayout = 'focus-four' | 'two-by-two' | 'three-by-three' | 'single';

export interface CameraStreamDefinition {
  id: string;
  name: string;
  location: string;
  region: CameraStreamRegion;
  type: CameraStreamType;
  source: string;
  notes?: string;
  builtIn: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CameraStreamGroup {
  id: string;
  name: string;
  streamIds: string[];
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CameraWallStore {
  version: 1;
  streams: CameraStreamDefinition[];
  groups: CameraStreamGroup[];
  activeGroupId: string;
  selectedStreamIds: string[];
  archivedCoreStreamIds: string[];
  layout: CameraWallLayout;
  muted: boolean;
  autoReconnect: boolean;
  updatedAt: number;
}

export type CameraStreamUpdate = Partial<Pick<
  CameraStreamDefinition,
  'name' | 'location' | 'region' | 'type' | 'source' | 'notes' | 'enabled'
>>;

const STORAGE_KEY = 'project-v-camera-wall-v1';
const CHANGE_EVENT = 'project-v-camera-wall-change';
const CHANNEL_NAME = 'project-v-camera-wall';

const now = 1_775_520_000_000;

const BUILT_IN_STREAMS: CameraStreamDefinition[] = [
  stream('jerusalem', 'Jerusalem Live', 'Jerusalem, Israel', 'middle-east', 'UyduhBUpO7Q'),
  stream('tehran', 'Tehran Live', 'Tehran, Iran', 'conflict', '-zGuR1qVKrU'),
  stream('tel-aviv', 'Tel Aviv Live', 'Tel Aviv, Israel', 'conflict', '-VLcYT5QBrY'),
  stream('kyiv', 'Kyiv Live', 'Kyiv, Ukraine', 'conflict', '-Q7FuPINDjA'),
  stream('washington', 'Washington DC', 'Washington, DC', 'americas', '1wV9lLe14aU'),
  stream('new-york', 'New York City', 'New York, NY', 'americas', '4qyZLflp-sI'),
  stream('london', 'London Skyline', 'London, United Kingdom', 'europe', 'Lxqcg1qt0XU'),
  stream('taipei', 'Taipei Live', 'Taipei, Taiwan', 'asia-pacific', 'z_fY1pj1VBw'),
  stream('tokyo', 'Tokyo Live 4K', 'Tokyo, Japan', 'asia-pacific', '4pu9sF5Qssw'),
  stream('seoul', 'Seoul Live', 'Seoul, South Korea', 'asia-pacific', '-JhoMGoAfFc'),
  stream('sydney', 'Sydney Harbour', 'Sydney, Australia', 'asia-pacific', '7pcL-0Wo77U'),
  stream('mecca', 'Mecca Live', 'Mecca, Saudi Arabia', 'middle-east', 'DEcpmPUbkDQ'),
];

const BUILT_IN_GROUPS: CameraStreamGroup[] = [
  group('global-watch', 'GLOBAL WATCH', ['jerusalem', 'tehran', 'kyiv', 'washington', 'taipei', 'tokyo', 'new-york', 'london']),
  group('conflict-watch', 'CONFLICT WATCH', ['tehran', 'tel-aviv', 'jerusalem', 'kyiv']),
  group('americas', 'AMERICAS', ['washington', 'new-york']),
  group('asia-pacific', 'ASIA-PACIFIC', ['taipei', 'tokyo', 'seoul', 'sydney']),
  group('middle-east', 'MIDDLE EAST', ['jerusalem', 'tehran', 'tel-aviv', 'mecca']),
];

function stream(id: string, name: string, location: string, region: CameraStreamRegion, source: string): CameraStreamDefinition {
  return { id, name, location, region, type: 'youtube', source, builtIn: true, enabled: true, createdAt: now, updatedAt: now };
}

function group(id: string, name: string, streamIds: string[]): CameraStreamGroup {
  return { id, name, streamIds, builtIn: true, createdAt: now, updatedAt: now };
}

function cloneDefaults(): CameraWallStore {
  return {
    version: 1,
    streams: BUILT_IN_STREAMS.map((item) => ({ ...item })),
    groups: BUILT_IN_GROUPS.map((item) => ({ ...item, streamIds: [...item.streamIds] })),
    activeGroupId: 'global-watch',
    selectedStreamIds: [...(BUILT_IN_GROUPS[0]?.streamIds ?? [])],
    archivedCoreStreamIds: [],
    layout: 'focus-four',
    muted: true,
    autoReconnect: true,
    updatedAt: Date.now(),
  };
}

function cleanText(value: unknown, fallback: string, max = 96): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || fallback;
}

function validLayout(value: unknown): value is CameraWallLayout {
  return value === 'focus-four' || value === 'two-by-two' || value === 'three-by-three' || value === 'single';
}

function validType(value: unknown): value is CameraStreamType {
  return value === 'youtube' || value === 'hls' || value === 'iframe';
}

function validRegion(value: unknown): value is CameraStreamRegion {
  return value === 'conflict' || value === 'americas' || value === 'europe' || value === 'middle-east' || value === 'asia-pacific' || value === 'global' || value === 'custom';
}

function cleanYouTubeId(value: string): string {
  const candidate = value.trim();
  return /^[A-Za-z0-9_-]{6,32}$/.test(candidate) ? candidate : '';
}

export function normalizeCameraSource(type: CameraStreamType, rawSource: string): string {
  const source = rawSource.trim();
  if (type === 'youtube') {
    const directId = cleanYouTubeId(source);
    if (directId) return directId;
    try {
      const url = new URL(source);
      const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
      if (host === 'youtu.be') return cleanYouTubeId(url.pathname.split('/').filter(Boolean)[0] ?? '');
      if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
        const fromQuery = cleanYouTubeId(url.searchParams.get('v') ?? '');
        if (fromQuery) return fromQuery;
        const parts = url.pathname.split('/').filter(Boolean);
        const marker = parts.findIndex((part) => part === 'embed' || part === 'live' || part === 'shorts' || part === 'v');
        if (marker >= 0) return cleanYouTubeId(parts[marker + 1] ?? '');
      }
    } catch {
      return '';
    }
    return '';
  }
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function cameraSourceError(type: CameraStreamType): string {
  if (type === 'youtube') return 'Enter a valid YouTube video/live URL or video ID. Channel-only /live pages must be replaced with the current video URL or ID.';
  if (type === 'hls') return 'Enter a valid HTTP or HTTPS HLS stream URL.';
  return 'Enter a valid HTTP or HTTPS embed page URL.';
}

function normalizeStream(value: unknown, fallback?: CameraStreamDefinition): CameraStreamDefinition | null {
  if (!value || typeof value !== 'object') return fallback ? { ...fallback } : null;
  const candidate = value as Partial<CameraStreamDefinition>;
  const type = validType(candidate.type) ? candidate.type : fallback?.type ?? 'iframe';
  const source = normalizeCameraSource(type, typeof candidate.source === 'string' ? candidate.source : fallback?.source ?? '');
  if (!source) return fallback ? { ...fallback } : null;
  const id = cleanText(candidate.id, fallback?.id ?? `camera-${crypto.randomUUID()}`, 80).replace(/[^a-zA-Z0-9_-]/g, '-');
  const timestamp = Date.now();
  return {
    id,
    name: cleanText(candidate.name, fallback?.name ?? 'Untitled Stream', 80),
    location: cleanText(candidate.location, fallback?.location ?? 'Unknown location', 100),
    region: validRegion(candidate.region) ? candidate.region : fallback?.region ?? 'custom',
    type,
    source,
    notes: cleanText(candidate.notes, fallback?.notes ?? '', 300),
    builtIn: fallback?.builtIn ?? candidate.builtIn === true,
    enabled: candidate.enabled !== false,
    createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : fallback?.createdAt ?? timestamp,
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : timestamp,
  };
}

function normalizeGroup(value: unknown, streamIds: Set<string>, fallback?: CameraStreamGroup): CameraStreamGroup | null {
  if (!value || typeof value !== 'object') return fallback ? { ...fallback, streamIds: [...fallback.streamIds] } : null;
  const candidate = value as Partial<CameraStreamGroup>;
  const ids = Array.isArray(candidate.streamIds) ? candidate.streamIds.filter((id): id is string => typeof id === 'string' && streamIds.has(id)) : fallback?.streamIds ?? [];
  const timestamp = Date.now();
  return {
    id: cleanText(candidate.id, fallback?.id ?? `group-${crypto.randomUUID()}`, 80).replace(/[^a-zA-Z0-9_-]/g, '-'),
    name: cleanText(candidate.name, fallback?.name ?? 'CUSTOM GROUP', 64).toUpperCase(),
    streamIds: [...new Set(ids)],
    builtIn: fallback?.builtIn ?? candidate.builtIn === true,
    createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : fallback?.createdAt ?? timestamp,
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : timestamp,
  };
}

function normalizeStore(value: unknown): CameraWallStore {
  const defaults = cloneDefaults();
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<CameraWallStore>;
  const customCandidates = Array.isArray(candidate.streams) ? candidate.streams : [];
  const byId = new Map<string, CameraStreamDefinition>();
  BUILT_IN_STREAMS.forEach((builtIn) => {
    const stored = customCandidates.find((item) => item && typeof item === 'object' && (item as Partial<CameraStreamDefinition>).id === builtIn.id);
    byId.set(builtIn.id, normalizeStream(stored, builtIn) ?? { ...builtIn });
  });
  customCandidates.forEach((item) => {
    const normalized = normalizeStream(item);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  });
  const streams = [...byId.values()];
  const streamIds = new Set(streams.map((item) => item.id));
  const builtInIds = new Set(BUILT_IN_STREAMS.map((item) => item.id));
  const archivedCoreStreamIds = Array.isArray(candidate.archivedCoreStreamIds)
    ? [...new Set(candidate.archivedCoreStreamIds.filter((id): id is string => typeof id === 'string' && builtInIds.has(id)))]
    : [];
  const groupById = new Map<string, CameraStreamGroup>();
  const storedGroups = Array.isArray(candidate.groups) ? candidate.groups : [];
  BUILT_IN_GROUPS.forEach((builtIn) => {
    const stored = storedGroups.find((item) => item && typeof item === 'object' && (item as Partial<CameraStreamGroup>).id === builtIn.id);
    groupById.set(builtIn.id, normalizeGroup(stored, streamIds, builtIn) ?? { ...builtIn, streamIds: [...builtIn.streamIds] });
  });
  storedGroups.forEach((item) => {
    const normalized = normalizeGroup(item, streamIds);
    if (normalized && !groupById.has(normalized.id)) groupById.set(normalized.id, normalized);
  });
  const groups = [...groupById.values()];
  const requestedGroup = typeof candidate.activeGroupId === 'string' ? candidate.activeGroupId : defaults.activeGroupId;
  const activeGroup = groups.find((item) => item.id === requestedGroup) ?? groups[0]!;
  const selected = Array.isArray(candidate.selectedStreamIds)
    ? candidate.selectedStreamIds.filter((id): id is string => typeof id === 'string' && streamIds.has(id))
    : activeGroup.streamIds;
  const hasExplicitSelection = Array.isArray(candidate.selectedStreamIds);
  return {
    version: 1,
    streams,
    groups,
    activeGroupId: activeGroup.id,
    // An empty array is a valid manual wall state. Older builds silently restored
    // the active group whenever the analyst deselected the last stream, which is
    // why two or more cameras appeared to be permanently pinned to the wall.
    selectedStreamIds: hasExplicitSelection ? [...new Set(selected)] : [...activeGroup.streamIds],
    archivedCoreStreamIds,
    layout: validLayout(candidate.layout) ? candidate.layout : defaults.layout,
    muted: candidate.muted !== false,
    autoReconnect: candidate.autoReconnect !== false,
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
  };
}

export function loadCameraWallStore(): CameraWallStore {
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return cloneDefaults();
  }
}

export function saveCameraWallStore(store: CameraWallStore): CameraWallStore {
  const normalized = normalizeStore({ ...store, version: 1, updatedAt: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'changed', updatedAt: normalized.updatedAt });
    channel.close();
  } catch {
    // BroadcastChannel is optional.
  }
  return normalized;
}

export function subscribeCameraWall(listener: () => void): () => void {
  const onWindow = () => listener();
  window.addEventListener(CHANGE_EVENT, onWindow);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', onWindow);
  } catch {
    channel = null;
  }
  return () => {
    window.removeEventListener(CHANGE_EVENT, onWindow);
    channel?.removeEventListener('message', onWindow);
    channel?.close();
  };
}

export function addCameraStream(input: Omit<CameraStreamDefinition, 'id' | 'builtIn' | 'createdAt' | 'updatedAt' | 'enabled'>): CameraStreamDefinition {
  const source = normalizeCameraSource(input.type, input.source);
  if (!source) throw new Error(cameraSourceError(input.type));
  const normalized = normalizeStream({ ...input, source, id: `camera-${crypto.randomUUID()}`, builtIn: false, enabled: true, createdAt: Date.now(), updatedAt: Date.now() });
  if (!normalized) throw new Error(cameraSourceError(input.type));
  const store = loadCameraWallStore();
  store.streams.push(normalized);
  store.selectedStreamIds = [...new Set([...store.selectedStreamIds, normalized.id])];
  saveCameraWallStore(store);
  return normalized;
}

export function updateCameraStream(streamId: string, input: CameraStreamUpdate): CameraStreamDefinition {
  const store = loadCameraWallStore();
  const existing = store.streams.find((item) => item.id === streamId);
  if (!existing) throw new Error('Camera stream was not found.');
  const nextType = validType(input.type) ? input.type : existing.type;
  const requestedSource = typeof input.source === 'string' ? input.source : existing.source;
  const source = normalizeCameraSource(nextType, requestedSource);
  if (!source) throw new Error(cameraSourceError(nextType));
  const normalized = normalizeStream({
    ...existing,
    ...input,
    type: nextType,
    source,
    id: existing.id,
    builtIn: existing.builtIn,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }, existing);
  if (!normalized) throw new Error(cameraSourceError(nextType));
  store.streams = store.streams.map((item) => item.id === streamId ? normalized : item);
  const saved = saveCameraWallStore(store);
  const persisted = saved.streams.find((item) => item.id === streamId);
  if (!persisted || persisted.type !== normalized.type || persisted.source !== normalized.source) {
    throw new Error('Camera source could not be persisted. The previous source was left unchanged.');
  }
  return persisted;
}

export function resetBuiltInCameraStream(streamId: string): CameraStreamDefinition {
  const defaults = BUILT_IN_STREAMS.find((item) => item.id === streamId);
  if (!defaults) throw new Error('Only built-in camera sources can be reset.');
  const store = loadCameraWallStore();
  const replacement = { ...defaults, updatedAt: Date.now() };
  store.streams = store.streams.map((item) => item.id === streamId ? replacement : item);
  saveCameraWallStore(store);
  return replacement;
}

export function archiveBuiltInCameraStream(streamId: string): void {
  const defaults = BUILT_IN_STREAMS.find((item) => item.id === streamId);
  if (!defaults) throw new Error('Only core camera sources can be removed from the core catalog.');
  const store = loadCameraWallStore();
  store.archivedCoreStreamIds = [...new Set([...store.archivedCoreStreamIds, streamId])];
  store.selectedStreamIds = store.selectedStreamIds.filter((id) => id !== streamId);
  saveCameraWallStore(store);
}

export function restoreBuiltInCameraStreams(streamId?: string): number {
  const store = loadCameraWallStore();
  const before = store.archivedCoreStreamIds.length;
  if (streamId) {
    store.archivedCoreStreamIds = store.archivedCoreStreamIds.filter((id) => id !== streamId);
  } else {
    store.archivedCoreStreamIds = [];
  }
  const restored = before - store.archivedCoreStreamIds.length;
  if (restored > 0) saveCameraWallStore(store);
  return restored;
}

export function getArchivedBuiltInCameraStreams(store = loadCameraWallStore()): CameraStreamDefinition[] {
  const archived = new Set(store.archivedCoreStreamIds);
  return store.streams.filter((item) => item.builtIn && archived.has(item.id));
}

export function removeCameraStream(streamId: string): void {
  const store = loadCameraWallStore();
  const stream = store.streams.find((item) => item.id === streamId);
  if (!stream || stream.builtIn) return;
  store.streams = store.streams.filter((item) => item.id !== streamId);
  store.groups = store.groups.map((item) => ({ ...item, streamIds: item.streamIds.filter((id) => id !== streamId) }));
  store.selectedStreamIds = store.selectedStreamIds.filter((id) => id !== streamId);
  saveCameraWallStore(store);
}

export function saveCameraGroup(name: string, selectedStreamIds: string[], existingId?: string): CameraStreamGroup {
  const store = loadCameraWallStore();
  const validIds = new Set(store.streams.map((item) => item.id));
  const streamIds = [...new Set(selectedStreamIds.filter((id) => validIds.has(id)))];
  if (!streamIds.length) throw new Error('Select at least one stream before saving a group.');
  const existing = existingId ? store.groups.find((item) => item.id === existingId && !item.builtIn) : undefined;
  const timestamp = Date.now();
  const groupItem: CameraStreamGroup = {
    id: existing?.id ?? `group-${crypto.randomUUID()}`,
    name: cleanText(name, 'CUSTOM GROUP', 64).toUpperCase(),
    streamIds,
    builtIn: false,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  store.groups = existing ? store.groups.map((item) => item.id === existing.id ? groupItem : item) : [...store.groups, groupItem];
  store.activeGroupId = groupItem.id;
  store.selectedStreamIds = [...streamIds];
  saveCameraWallStore(store);
  return groupItem;
}

export function removeCameraGroup(groupId: string): void {
  const store = loadCameraWallStore();
  const target = store.groups.find((item) => item.id === groupId);
  if (!target || target.builtIn) return;
  store.groups = store.groups.filter((item) => item.id !== groupId);
  const fallback = store.groups[0]!;
  if (store.activeGroupId === groupId) {
    store.activeGroupId = fallback.id;
    store.selectedStreamIds = [...fallback.streamIds];
  }
  saveCameraWallStore(store);
}

export function getCameraWallVisibleStreams(store = loadCameraWallStore()): CameraStreamDefinition[] {
  const selected = new Set(store.selectedStreamIds);
  const archived = new Set(store.archivedCoreStreamIds);
  return store.streams.filter((item) => item.enabled && selected.has(item.id) && !(item.builtIn && archived.has(item.id)));
}
