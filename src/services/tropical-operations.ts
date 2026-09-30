import type { Feature, FeatureCollection, Geometry, GeoJsonProperties, Point } from 'geojson';

const NHC_SUMMARY_BASE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
const CACHE_MS = 15 * 60_000;

const LAYERS = {
  outlookPoints: 2,
  outlookRegions: 3,
  forecastPoints: 5,
  forecastTrack: 6,
  forecastCone: 7,
  watchWarning: 8,
  pastPoints: 10,
  pastTrack: 11,
  forecastWindRadii: 15,
  advisoryWindField: 16,
} as const;

export interface TropicalStormSummary {
  id: string;
  name: string;
  basin: string;
  stormType: string;
  advisoryNumber: string;
  advisoryDate: string;
  category?: number;
  maxWindKt?: number;
  gustKt?: number;
  pressureMb?: number;
  movementDirectionDeg?: number;
  movementSpeedKt?: number;
  latitude?: number;
  longitude?: number;
  source: string;
  forecast: TropicalForecastPoint[];
}

export interface TropicalForecastPoint {
  tauHours: number;
  validTime: string;
  label: string;
  stormType: string;
  category?: number;
  maxWindKt?: number;
  gustKt?: number;
  pressureMb?: number;
  latitude?: number;
  longitude?: number;
}

export interface TropicalOutlookArea {
  id: string;
  basin: string;
  probability2Day: string;
  probability7Day: string;
  risk2Day: string;
  risk7Day: string;
  latitude?: number;
  longitude?: number;
}

export interface TropicalOperationsData {
  fetchedAt: number;
  storms: TropicalStormSummary[];
  outlooks: TropicalOutlookArea[];
  outlookPoints: FeatureCollection;
  outlookRegions: FeatureCollection;
  forecastPoints: FeatureCollection;
  forecastTrack: FeatureCollection;
  forecastCone: FeatureCollection;
  watchWarning: FeatureCollection;
  pastPoints: FeatureCollection;
  pastTrack: FeatureCollection;
  forecastWindRadii: FeatureCollection;
  advisoryWindField: FeatureCollection;
  errors: string[];
}

type LayerName = keyof typeof LAYERS;

let cached: TropicalOperationsData | null = null;

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function props(feature: Feature): Record<string, unknown> {
  const value = feature.properties;
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stormKey(feature: Feature): string {
  const p = props(feature);
  const source = text(p.idp_source);
  if (source) return source.slice(0, 3).toUpperCase();
  return [text(p.basin), text(p.stormnum), text(p.stormname)].filter(Boolean).join('-') || `storm-${text(p.objectid)}`;
}

function pointCoordinates(feature: Feature): [number, number] | undefined {
  if (feature.geometry?.type !== 'Point') return undefined;
  const coordinates = (feature.geometry as Point).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : undefined;
}

function forecastPoint(feature: Feature): TropicalForecastPoint {
  const p = props(feature);
  const coordinate = pointCoordinates(feature);
  return {
    tauHours: numberValue(p.tau) ?? numberValue(p.fcstprd) ?? 0,
    validTime: text(p.validtime) || text(p.fldatelbl) || text(p.datelbl),
    label: text(p.fldatelbl) || text(p.datelbl),
    stormType: text(p.tcdvlp) || text(p.stormtype) || text(p.dvlbl),
    category: numberValue(p.ssnum),
    maxWindKt: numberValue(p.maxwind),
    gustKt: numberValue(p.gust),
    pressureMb: numberValue(p.mslp),
    latitude: numberValue(p.lat) ?? coordinate?.[1],
    longitude: numberValue(p.lon) ?? coordinate?.[0],
  };
}

function summarizeStorms(collection: FeatureCollection): TropicalStormSummary[] {
  const groups = new Map<string, Feature[]>();
  for (const feature of collection.features) {
    const key = stormKey(feature);
    const list = groups.get(key) ?? [];
    list.push(feature);
    groups.set(key, list);
  }

  const storms: TropicalStormSummary[] = [];
  for (const [id, features] of groups.entries()) {
    const ordered = features.slice().sort((a, b) => forecastPoint(a).tauHours - forecastPoint(b).tauHours);
    const first = ordered[0];
    if (!first) continue;
    const p = props(first);
    const current = forecastPoint(first);
    storms.push({
      id,
      name: text(p.stormname) || id,
      basin: text(p.basin),
      stormType: current.stormType || text(p.stormtype) || text(p.stormsrc),
      advisoryNumber: text(p.advisnum),
      advisoryDate: text(p.advdate),
      category: current.category,
      maxWindKt: current.maxWindKt,
      gustKt: current.gustKt,
      pressureMb: current.pressureMb,
      movementDirectionDeg: numberValue(p.tcdir),
      movementSpeedKt: numberValue(p.tcspd),
      latitude: current.latitude,
      longitude: current.longitude,
      source: text(p.idp_source) || id,
      forecast: ordered.map(forecastPoint),
    });
  }

  return storms.sort((a, b) => (b.maxWindKt ?? 0) - (a.maxWindKt ?? 0) || a.name.localeCompare(b.name));
}

function summarizeOutlooks(collection: FeatureCollection): TropicalOutlookArea[] {
  return collection.features.map((feature, index) => {
    const p = props(feature);
    const coordinate = pointCoordinates(feature);
    return {
      id: text(p.idp_source) || `outlook-${index}`,
      basin: text(p.basin),
      probability2Day: text(p.prob2day),
      probability7Day: text(p.prob7day),
      risk2Day: text(p.risk2day),
      risk7Day: text(p.risk7day),
      latitude: coordinate?.[1],
      longitude: coordinate?.[0],
    };
  });
}

async function fetchLayer(name: LayerName, signal?: AbortSignal): Promise<FeatureCollection> {
  const id = LAYERS[name];
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson',
  });
  const response = await fetch(`${NHC_SUMMARY_BASE}/${id}/query?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/geo+json, application/json' },
  });
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  const data = await response.json() as Partial<FeatureCollection<Geometry, GeoJsonProperties>>;
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${name} returned invalid GeoJSON`);
  return { type: 'FeatureCollection', features: data.features as Feature[] };
}

export async function fetchTropicalOperations(force = false, signal?: AbortSignal): Promise<TropicalOperationsData> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;

  const names = Object.keys(LAYERS) as LayerName[];
  const results = await Promise.allSettled(names.map((name) => fetchLayer(name, signal)));
  const layers = new Map<LayerName, FeatureCollection>();
  const errors: string[] = [];

  results.forEach((result, index) => {
    const name = names[index];
    if (!name) return;
    if (result.status === 'fulfilled') layers.set(name, result.value);
    else errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });

  const forecastPoints = layers.get('forecastPoints') ?? emptyCollection();
  const outlookPoints = layers.get('outlookPoints') ?? emptyCollection();
  const next: TropicalOperationsData = {
    fetchedAt: Date.now(),
    storms: summarizeStorms(forecastPoints),
    outlooks: summarizeOutlooks(outlookPoints),
    outlookPoints,
    outlookRegions: layers.get('outlookRegions') ?? emptyCollection(),
    forecastPoints,
    forecastTrack: layers.get('forecastTrack') ?? emptyCollection(),
    forecastCone: layers.get('forecastCone') ?? emptyCollection(),
    watchWarning: layers.get('watchWarning') ?? emptyCollection(),
    pastPoints: layers.get('pastPoints') ?? emptyCollection(),
    pastTrack: layers.get('pastTrack') ?? emptyCollection(),
    forecastWindRadii: layers.get('forecastWindRadii') ?? emptyCollection(),
    advisoryWindField: layers.get('advisoryWindField') ?? emptyCollection(),
    errors,
  };

  if (!signal?.aborted) cached = next;
  return next;
}
