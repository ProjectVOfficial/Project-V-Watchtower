import type { OperationalSeverity } from './operations-center';

export type MapOperationType = 'marker' | 'circle' | 'rectangle' | 'polygon' | 'route';

export interface GeoPoint {
  lat: number;
  lon: number;
}


export interface MapOperationProperties {
  id: string;
  name: string;
  type: MapOperationType;
  notes: string;
  tags: string;
  color: string;
}

export type MapOperationGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;
export type MapOperationFeature = GeoJSON.Feature<MapOperationGeometry, MapOperationProperties>;
export type MapOperationFeatureCollection = GeoJSON.FeatureCollection<MapOperationGeometry, MapOperationProperties>;

export interface MapOperationItem {
  id: string;
  name: string;
  type: MapOperationType;
  points: GeoPoint[];
  radiusKm?: number;
  notes: string;
  tags: string[];
  color: string;
  visible: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MapGeofenceRule {
  id: string;
  name: string;
  areaId: string;
  enabled: boolean;
  keywords: string[];
  categories: string[];
  severity: OperationalSeverity;
  createdAt: number;
  updatedAt: number;
}

export interface MapSavedView {
  center: GeoPoint;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapOperationsState {
  version: 1;
  items: MapOperationItem[];
  rules: MapGeofenceRule[];
  lastView: MapSavedView;
}

export interface MapOperationsStats {
  total: number;
  areas: number;
  routes: number;
  markers: number;
  activeRules: number;
  recentlyUpdated?: MapOperationItem;
}

export interface GeofenceCandidate {
  id: string;
  title: string;
  source: string;
  link?: string;
  category?: string;
  location?: string;
  lat: number;
  lon: number;
  timestamp: number;
}

export interface GeofenceMatch {
  rule: MapGeofenceRule;
  area: MapOperationItem;
  candidate: GeofenceCandidate;
}

const STORAGE_KEY = 'project-v-map-operations-v1';
const EVENT_NAME = 'project-v-map-operations-change';
const CHANNEL_NAME = 'project-v-map-operations';
const DEFAULT_COLOR = '#c92f3e';
const VALID_COLORS = new Set(['#c92f3e', '#d9902f', '#2f9e88', '#3b82b6', '#9f7aea', '#d9d2c3']);

const DEFAULT_STATE: MapOperationsState = {
  version: 1,
  items: [],
  rules: [],
  lastView: { center: { lat: 20, lon: 0 }, zoom: 1.6, bearing: 0, pitch: 0 },
};

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
} catch { /* optional cross-window sync */ }

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanText(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Partial<GeoPoint>;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  return {
    lat: Math.max(-90, Math.min(90, Number(point.lat))),
    lon: Math.max(-180, Math.min(180, Number(point.lon))),
  };
}

function cleanItem(value: unknown): MapOperationItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<MapOperationItem>;
  if (!item.id || !item.type || !['marker', 'circle', 'rectangle', 'polygon', 'route'].includes(item.type)) return null;
  const points = Array.isArray(item.points) ? item.points.map(cleanPoint).filter((point): point is GeoPoint => Boolean(point)).slice(0, 5000) : [];
  if (points.length === 0) return null;
  const now = Date.now();
  return {
    id: cleanText(item.id, 100),
    name: cleanText(item.name, 140) || 'Untitled map item',
    type: item.type,
    points,
    radiusKm: item.type === 'circle' && Number.isFinite(item.radiusKm) ? Math.max(0.05, Math.min(20_000, Number(item.radiusKm))) : undefined,
    notes: cleanText(item.notes, 20_000),
    tags: Array.isArray(item.tags) ? Array.from(new Set(item.tags.map((tag) => cleanText(tag, 60).toLowerCase()).filter(Boolean))).slice(0, 50) : [],
    color: typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : DEFAULT_COLOR,
    visible: item.visible !== false,
    createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : now,
    updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : now,
  };
}

function cleanSeverity(value: unknown): OperationalSeverity {
  return value === 'info' || value === 'watch' || value === 'elevated' || value === 'high' || value === 'critical' ? value : 'watch';
}

function cleanRule(value: unknown, itemIds: Set<string>): MapGeofenceRule | null {
  if (!value || typeof value !== 'object') return null;
  const rule = value as Partial<MapGeofenceRule>;
  const areaId = cleanText(rule.areaId, 100);
  if (!rule.id || !areaId || !itemIds.has(areaId)) return null;
  const now = Date.now();
  return {
    id: cleanText(rule.id, 100),
    name: cleanText(rule.name, 140) || 'Untitled geofence rule',
    areaId,
    enabled: rule.enabled !== false,
    keywords: Array.isArray(rule.keywords) ? Array.from(new Set(rule.keywords.map((term) => cleanText(term, 80).toLowerCase()).filter(Boolean))).slice(0, 50) : [],
    categories: Array.isArray(rule.categories) ? Array.from(new Set(rule.categories.map((term) => cleanText(term, 80).toLowerCase()).filter(Boolean))).slice(0, 30) : [],
    severity: cleanSeverity(rule.severity),
    createdAt: Number.isFinite(rule.createdAt) ? Number(rule.createdAt) : now,
    updatedAt: Number.isFinite(rule.updatedAt) ? Number(rule.updatedAt) : now,
  };
}

function cleanState(value: unknown): MapOperationsState {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_STATE);
  const candidate = value as Partial<MapOperationsState>;
  const items = Array.isArray(candidate.items) ? candidate.items.map(cleanItem).filter((item): item is MapOperationItem => Boolean(item)).slice(0, 1000) : [];
  const itemIds = new Set(items.map((item) => item.id));
  const rules = Array.isArray(candidate.rules) ? candidate.rules.map((rule) => cleanRule(rule, itemIds)).filter((rule): rule is MapGeofenceRule => Boolean(rule)).slice(0, 1000) : [];
  const center = cleanPoint(candidate.lastView?.center) ?? DEFAULT_STATE.lastView.center;
  return {
    version: 1,
    items,
    rules,
    lastView: {
      center,
      zoom: Number.isFinite(candidate.lastView?.zoom) ? Math.max(0, Math.min(20, Number(candidate.lastView?.zoom))) : DEFAULT_STATE.lastView.zoom,
      bearing: Number.isFinite(candidate.lastView?.bearing) ? Number(candidate.lastView?.bearing) : 0,
      pitch: Number.isFinite(candidate.lastView?.pitch) ? Math.max(0, Math.min(85, Number(candidate.lastView?.pitch))) : 0,
    },
  };
}

export function getMapOperationsState(): MapOperationsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? cleanState(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function persist(state: MapOperationsState, broadcast = true): MapOperationsState {
  const cleaned = cleanState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cleaned }));
  if (broadcast) channel?.postMessage({ type: 'change', state: cleaned });
  return cleaned;
}

export function replaceMapOperationsState(state: unknown): MapOperationsState {
  return persist(cleanState(state));
}

export function saveMapOperationItem(input: Omit<MapOperationItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MapOperationItem {
  const state = getMapOperationsState();
  const existing = input.id ? state.items.find((item) => item.id === input.id) : undefined;
  const now = Date.now();
  const item = cleanItem({
    ...input,
    id: input.id || id('map'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (!item) throw new Error('The map item does not contain valid geometry.');
  state.items = existing ? state.items.map((candidate) => candidate.id === item.id ? item : candidate) : [...state.items, item];
  persist(state);
  return item;
}

export function deleteMapOperationItem(itemId: string): void {
  const state = getMapOperationsState();
  state.items = state.items.filter((item) => item.id !== itemId);
  state.rules = state.rules.filter((rule) => rule.areaId !== itemId);
  persist(state);
}

export function saveGeofenceRule(input: Omit<MapGeofenceRule, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MapGeofenceRule {
  const state = getMapOperationsState();
  const existing = input.id ? state.rules.find((rule) => rule.id === input.id) : undefined;
  const itemIds = new Set(state.items.map((item) => item.id));
  const now = Date.now();
  const rule = cleanRule({ ...input, id: input.id || id('geofence'), createdAt: existing?.createdAt ?? now, updatedAt: now }, itemIds);
  if (!rule) throw new Error('Choose a valid saved area before creating a geofence rule.');
  state.rules = existing ? state.rules.map((candidate) => candidate.id === rule.id ? rule : candidate) : [...state.rules, rule];
  persist(state);
  return rule;
}

export function deleteGeofenceRule(ruleId: string): void {
  const state = getMapOperationsState();
  state.rules = state.rules.filter((rule) => rule.id !== ruleId);
  persist(state);
}

export function saveMapView(view: MapSavedView): void {
  const state = getMapOperationsState();
  state.lastView = {
    center: cleanPoint(view.center) ?? state.lastView.center,
    zoom: Math.max(0, Math.min(20, Number(view.zoom) || 0)),
    bearing: Number(view.bearing) || 0,
    pitch: Math.max(0, Math.min(85, Number(view.pitch) || 0)),
  };
  persist(state, false);
}

export function getMapOperationsStats(): MapOperationsStats {
  const state = getMapOperationsState();
  const recentlyUpdated = [...state.items].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return {
    total: state.items.length,
    areas: state.items.filter((item) => item.type === 'circle' || item.type === 'rectangle' || item.type === 'polygon').length,
    routes: state.items.filter((item) => item.type === 'route').length,
    markers: state.items.filter((item) => item.type === 'marker').length,
    activeRules: state.rules.filter((rule) => rule.enabled).length,
    recentlyUpdated,
  };
}

export function subscribeMapOperations(listener: () => void): () => void {
  const local = () => listener();
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  const broadcast = (event: MessageEvent) => {
    const data = event.data as { type?: string; state?: unknown } | null;
    if (data?.type !== 'change') return;
    if (data.state) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanState(data.state))); } catch { /* ignore */ }
    }
    listener();
  };
  window.addEventListener(EVENT_NAME, local);
  window.addEventListener('storage', storage);
  channel?.addEventListener('message', broadcast);
  return () => {
    window.removeEventListener(EVENT_NAME, local);
    window.removeEventListener('storage', storage);
    channel?.removeEventListener('message', broadcast);
  };
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const earthRadiusKm = 6371.0088;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon));
}

export function routeLengthKm(points: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineKm(points[index - 1]!, points[index]!);
  return total;
}

export function polygonAreaKm2(points: GeoPoint[]): number {
  if (points.length < 3) return 0;
  const earthRadiusKm = 6371.0088;
  const rad = Math.PI / 180;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    sum += (next.lon - current.lon) * rad * (2 + Math.sin(current.lat * rad) + Math.sin(next.lat * rad));
  }
  return Math.abs(sum * earthRadiusKm * earthRadiusKm / 2);
}

function circlePolygon(center: GeoPoint, radiusKm: number, steps = 96): number[][] {
  const earthRadiusKm = 6371.0088;
  const angular = radiusKm / earthRadiusKm;
  const lat1 = center.lat * Math.PI / 180;
  const lon1 = center.lon * Math.PI / 180;
  const coordinates: number[][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const bearing = 2 * Math.PI * index / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    coordinates.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return coordinates;
}

function rectanglePolygon(points: GeoPoint[]): number[][] {
  const a = points[0]!;
  const b = points[1] ?? points[0]!;
  return [[a.lon, a.lat], [b.lon, a.lat], [b.lon, b.lat], [a.lon, b.lat], [a.lon, a.lat]];
}

export function itemToGeoJsonFeature(item: MapOperationItem): MapOperationFeature {
  const properties = {
    id: item.id,
    name: item.name,
    type: item.type,
    notes: item.notes,
    tags: item.tags.join(', '),
    color: VALID_COLORS.has(item.color) ? item.color : DEFAULT_COLOR,
  };
  if (item.type === 'marker') {
    return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [item.points[0]!.lon, item.points[0]!.lat] } };
  }
  if (item.type === 'route') {
    return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: item.points.map((point) => [point.lon, point.lat]) } };
  }
  let coordinates: number[][];
  if (item.type === 'circle') coordinates = circlePolygon(item.points[0]!, item.radiusKm ?? 1);
  else if (item.type === 'rectangle') coordinates = rectanglePolygon(item.points);
  else coordinates = [...item.points, item.points[0]!].map((point) => [point.lon, point.lat]);
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [coordinates] } };
}

export function mapOperationsFeatureCollection(state = getMapOperationsState()): MapOperationFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: state.items.filter((item) => item.visible).map(itemToGeoJsonFeature),
  };
}

function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.lon; const yi = polygon[i]!.lat;
    const xj = polygon[j]!.lon; const yj = polygon[j]!.lat;
    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && (point.lon < (xj - xi) * (point.lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInsideMapItem(point: GeoPoint, item: MapOperationItem): boolean {
  if (item.type === 'marker' || item.type === 'route') return false;
  if (item.type === 'circle') return haversineKm(point, item.points[0]!) <= (item.radiusKm ?? 0);
  if (item.type === 'rectangle') {
    const a = item.points[0]!; const b = item.points[1] ?? a;
    return point.lat >= Math.min(a.lat, b.lat) && point.lat <= Math.max(a.lat, b.lat)
      && point.lon >= Math.min(a.lon, b.lon) && point.lon <= Math.max(a.lon, b.lon);
  }
  return pointInPolygon(point, item.points);
}

export function findGeofenceMatches(candidates: GeofenceCandidate[], state = getMapOperationsState()): GeofenceMatch[] {
  const areas = new Map(state.items.map((item) => [item.id, item]));
  const matches: GeofenceMatch[] = [];
  for (const rule of state.rules) {
    if (!rule.enabled) continue;
    const area = areas.get(rule.areaId);
    if (!area || (area.type !== 'circle' && area.type !== 'rectangle' && area.type !== 'polygon')) continue;
    for (const candidate of candidates) {
      if (!pointInsideMapItem({ lat: candidate.lat, lon: candidate.lon }, area)) continue;
      const haystack = `${candidate.title} ${candidate.source} ${candidate.category ?? ''} ${candidate.location ?? ''}`.toLowerCase();
      if (rule.keywords.length > 0 && !rule.keywords.some((keyword) => haystack.includes(keyword))) continue;
      if (rule.categories.length > 0 && !rule.categories.some((category) => (candidate.category ?? '').toLowerCase().includes(category))) continue;
      matches.push({ rule, area, candidate });
    }
  }
  return matches;
}

export function describeMapOperation(item: MapOperationItem): string {
  if (item.type === 'marker') return `${item.points[0]!.lat.toFixed(4)}, ${item.points[0]!.lon.toFixed(4)}`;
  if (item.type === 'circle') return `${(item.radiusKm ?? 0).toFixed(1)} km radius`;
  if (item.type === 'route') return `${routeLengthKm(item.points).toFixed(1)} km route`;
  const area = item.type === 'rectangle'
    ? polygonAreaKm2([
      item.points[0]!,
      { lat: item.points[0]!.lat, lon: item.points[1]?.lon ?? item.points[0]!.lon },
      item.points[1] ?? item.points[0]!,
      { lat: item.points[1]?.lat ?? item.points[0]!.lat, lon: item.points[0]!.lon },
    ])
    : polygonAreaKm2(item.points);
  return `${area.toFixed(area < 100 ? 1 : 0)} km² area`;
}
