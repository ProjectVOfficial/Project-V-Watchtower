import { fetchWeatherAlerts, type WeatherAlert } from '@/services/weather';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const RAINVIEWER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export interface WeatherLocation {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface WeatherCurrent {
  time: string;
  temperatureF?: number;
  apparentTemperatureF?: number;
  humidityPct?: number;
  precipitationIn?: number;
  rainIn?: number;
  showersIn?: number;
  snowfallIn?: number;
  weatherCode?: number;
  cloudCoverPct?: number;
  surfacePressureHpa?: number;
  windSpeedMph?: number;
  windDirectionDeg?: number;
  windGustMph?: number;
}

export interface WeatherHourlyPoint {
  time: string;
  temperatureF?: number;
  precipitationProbabilityPct?: number;
  precipitationIn?: number;
  weatherCode?: number;
  windSpeedMph?: number;
  windGustMph?: number;
}

export interface WeatherDailyPoint {
  date: string;
  weatherCode?: number;
  temperatureMaxF?: number;
  temperatureMinF?: number;
  precipitationIn?: number;
  precipitationProbabilityMaxPct?: number;
  windGustMaxMph?: number;
}

export interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  timezone: string;
  elevationM?: number;
  current: WeatherCurrent;
  hourly: WeatherHourlyPoint[];
  daily: WeatherDailyPoint[];
  fetchedAt: number;
}

export interface RainViewerFrame {
  time: number;
  path: string;
}

export interface RainViewerTimeline {
  generated: number;
  host: string;
  frames: RainViewerFrame[];
}

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
}

interface GeocodingResponse {
  results?: Array<{
    name?: string;
    country?: string;
    admin1?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  }>;
}

interface RainViewerResponse {
  generated?: number;
  host?: string;
  radar?: {
    past?: Array<{ time?: number; path?: string }>;
  };
}

function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arrayValue(record: Record<string, unknown> | undefined, key: string, index: number): unknown {
  const value = record?.[key];
  return Array.isArray(value) ? value[index] : undefined;
}

export async function fetchWeatherSnapshot(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(5),
    longitude: longitude.toFixed(5),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'rain',
      'showers',
      'snowfall',
      'weather_code',
      'cloud_cover',
      'surface_pressure',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
    hourly: [
      'temperature_2m',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_gusts_10m_max',
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: '7',
    timezone: 'auto',
  });

  const response = await fetch(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const data = await response.json() as OpenMeteoResponse;
  const current = data.current ?? {};
  const hourly = data.hourly ?? {};
  const daily = data.daily ?? {};
  const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];

  return {
    latitude: num(data.latitude) ?? latitude,
    longitude: num(data.longitude) ?? longitude,
    timezone: str(data.timezone) || 'AUTO',
    elevationM: num(data.elevation),
    current: {
      time: str(current.time),
      temperatureF: num(current.temperature_2m),
      apparentTemperatureF: num(current.apparent_temperature),
      humidityPct: num(current.relative_humidity_2m),
      precipitationIn: num(current.precipitation),
      rainIn: num(current.rain),
      showersIn: num(current.showers),
      snowfallIn: num(current.snowfall),
      weatherCode: num(current.weather_code),
      cloudCoverPct: num(current.cloud_cover),
      surfacePressureHpa: num(current.surface_pressure),
      windSpeedMph: num(current.wind_speed_10m),
      windDirectionDeg: num(current.wind_direction_10m),
      windGustMph: num(current.wind_gusts_10m),
    },
    hourly: hourlyTimes.slice(0, 72).map((time, index) => ({
      time: str(time),
      temperatureF: num(arrayValue(hourly, 'temperature_2m', index)),
      precipitationProbabilityPct: num(arrayValue(hourly, 'precipitation_probability', index)),
      precipitationIn: num(arrayValue(hourly, 'precipitation', index)),
      weatherCode: num(arrayValue(hourly, 'weather_code', index)),
      windSpeedMph: num(arrayValue(hourly, 'wind_speed_10m', index)),
      windGustMph: num(arrayValue(hourly, 'wind_gusts_10m', index)),
    })),
    daily: dailyTimes.slice(0, 7).map((date, index) => ({
      date: str(date),
      weatherCode: num(arrayValue(daily, 'weather_code', index)),
      temperatureMaxF: num(arrayValue(daily, 'temperature_2m_max', index)),
      temperatureMinF: num(arrayValue(daily, 'temperature_2m_min', index)),
      precipitationIn: num(arrayValue(daily, 'precipitation_sum', index)),
      precipitationProbabilityMaxPct: num(arrayValue(daily, 'precipitation_probability_max', index)),
      windGustMaxMph: num(arrayValue(daily, 'wind_gusts_10m_max', index)),
    })),
    fetchedAt: Date.now(),
  };
}

export async function searchWeatherLocations(query: string, signal?: AbortSignal): Promise<WeatherLocation[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const params = new URLSearchParams({ name: clean, count: '8', language: 'en', format: 'json' });
  const response = await fetch(`${OPEN_METEO_GEOCODE_URL}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Open-Meteo geocoding HTTP ${response.status}`);
  const data = await response.json() as GeocodingResponse;
  return (data.results ?? [])
    .map((result): WeatherLocation | null => {
      const lat = num(result.latitude);
      const lon = num(result.longitude);
      if (lat === undefined || lon === undefined || !result.name) return null;
      return {
        name: result.name,
        country: result.country,
        admin1: result.admin1,
        latitude: lat,
        longitude: lon,
        timezone: result.timezone,
      };
    })
    .filter((value): value is WeatherLocation => value !== null);
}

const DIRECT_NWS_ACTIVE_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual';
const DIRECT_NWS_ALERT_CACHE_MS = 30 * 60_000;

interface NwsActiveAlertFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown>;
}

interface NwsActiveAlertsResponse {
  features?: NwsActiveAlertFeature[];
}

let directNwsAlertCache: { at: number; alerts: WeatherAlert[] } | null = null;

function normalizeSeverity(value: unknown): WeatherAlert['severity'] {
  const text = String(value ?? '').trim();
  if (text === 'Extreme' || text === 'Severe' || text === 'Moderate' || text === 'Minor') return text;
  return 'Unknown';
}

function validCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function normalizeRing(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(validCoordinate)
    .map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])] as [number, number]);
}

function nwsFeatureRing(feature: NwsActiveAlertFeature): [number, number][] {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'Polygon') {
    return normalizeRing(geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    let best: [number, number][] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = normalizeRing(polygon[0]);
      if (ring.length > best.length) best = ring;
    }
    return best;
  }
  return [];
}

function ringCentroid(ring: [number, number][]): [number, number] | undefined {
  if (!ring.length) return undefined;
  const total = ring.reduce((sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]] as [number, number], [0, 0] as [number, number]);
  return [total[0] / ring.length, total[1] / ring.length];
}

function safeAlertDate(value: unknown, fallbackMs: number): Date {
  const date = new Date(typeof value === 'string' ? value : '');
  return Number.isFinite(date.getTime()) ? date : new Date(fallbackMs);
}

function mapDirectNwsAlert(feature: NwsActiveAlertFeature): WeatherAlert | null {
  const properties = feature.properties ?? {};
  const id = String(feature.id ?? properties.id ?? '').trim();
  const event = String(properties.event ?? 'Weather Alert').trim() || 'Weather Alert';
  if (!id) return null;
  const ring = nwsFeatureRing(feature);
  const now = Date.now();
  return {
    id,
    event,
    severity: normalizeSeverity(properties.severity),
    headline: String(properties.headline ?? event).trim() || event,
    description: String(properties.description ?? '').trim(),
    areaDesc: String(properties.areaDesc ?? 'United States').trim() || 'United States',
    onset: safeAlertDate(properties.onset ?? properties.effective ?? properties.sent, now),
    expires: safeAlertDate(properties.expires ?? properties.ends, now + 60 * 60_000),
    coordinates: ring,
    centroid: ringCentroid(ring),
  };
}

async function fetchDirectNwsActiveAlerts(): Promise<WeatherAlert[]> {
  const response = await fetch(DIRECT_NWS_ACTIVE_ALERTS_URL, {
    headers: { Accept: 'application/geo+json, application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Direct NWS active alerts HTTP ${response.status}`);
  const data = await response.json() as NwsActiveAlertsResponse;
  const alerts = (data.features ?? [])
    .map(mapDirectNwsAlert)
    .filter((alert): alert is WeatherAlert => alert !== null);
  directNwsAlertCache = { at: Date.now(), alerts };
  return alerts;
}

export async function fetchWeatherOperationsAlerts(): Promise<WeatherAlert[]> {
  // Prefer Watchtower's inherited/bootstrap weather feed because it can include
  // normalized/cached records. In desktop development that route can be absent or
  // temporarily return an empty circuit-breaker fallback, so Weather Ops also has
  // an independent official NWS path instead of turning an upstream bootstrap
  // outage into a misleading nationwide "0 alerts" display.
  try {
    const inherited = await fetchWeatherAlerts();
    if (inherited.length > 0) return inherited;
  } catch {
    // Continue to the official NWS fallback below.
  }

  try {
    return await fetchDirectNwsActiveAlerts();
  } catch (error) {
    if (directNwsAlertCache && Date.now() - directNwsAlertCache.at < DIRECT_NWS_ALERT_CACHE_MS) {
      return directNwsAlertCache.alerts;
    }
    throw error;
  }
}

export async function fetchRainViewerTimeline(signal?: AbortSignal): Promise<RainViewerTimeline> {
  const response = await fetch(RAINVIEWER_MAPS_URL, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);
  const data = await response.json() as RainViewerResponse;
  const host = str(data.host);
  if (!host) throw new Error('RainViewer did not return a radar tile host.');
  const frames = (data.radar?.past ?? [])
    .map((frame): RainViewerFrame | null => {
      const time = num(frame.time);
      const path = str(frame.path);
      if (time === undefined || !path) return null;
      return { time, path };
    })
    .filter((frame): frame is RainViewerFrame => frame !== null)
    .sort((a, b) => a.time - b.time);
  if (frames.length === 0) throw new Error('RainViewer returned no radar frames.');
  return { generated: num(data.generated) ?? Math.floor(Date.now() / 1000), host, frames };
}

export function rainViewerTileUrl(timeline: RainViewerTimeline, frame: RainViewerFrame): string {
  return `${timeline.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

export function weatherCodeLabel(code: number | undefined): string {
  if (code === undefined) return 'UNKNOWN';
  if (code === 0) return 'CLEAR';
  if (code === 1) return 'MAINLY CLEAR';
  if (code === 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'OVERCAST';
  if (code === 45 || code === 48) return 'FOG';
  if ([51, 53, 55, 56, 57].includes(code)) return 'DRIZZLE';
  if ([61, 63, 65, 66, 67].includes(code)) return 'RAIN';
  if ([71, 73, 75, 77].includes(code)) return 'SNOW';
  if ([80, 81, 82].includes(code)) return 'RAIN SHOWERS';
  if ([85, 86].includes(code)) return 'SNOW SHOWERS';
  if (code === 95) return 'THUNDERSTORM';
  if (code === 96 || code === 99) return 'THUNDERSTORM + HAIL';
  return `WMO ${code}`;
}

export function windDirectionLabel(degrees: number | undefined): string {
  if (degrees === undefined) return 'N/A';
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return labels[index] ?? 'N/A';
}

// Phase 20.4 — Severe Weather Intelligence ---------------------------------

const NWS_ALERTS_BASE_URL = 'https://api.weather.gov/alerts';
const NWS_DETAIL_CACHE_MS = 5 * 60_000;

export interface NwsAlertDetails {
  id: string;
  event?: string;
  status?: string;
  messageType?: string;
  category?: string;
  severity?: string;
  certainty?: string;
  urgency?: string;
  response?: string;
  senderName?: string;
  effective?: string;
  onset?: string;
  ends?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  parameters: Record<string, string[]>;
}

export interface NwsStormMotion {
  bearingDeg?: number;
  speedKt?: number;
  raw: string;
}

interface NwsAlertApiResponse {
  id?: string;
  properties?: Record<string, unknown>;
}

const nwsDetailCache = new Map<string, { at: number; value: NwsAlertDetails }>();

function optionalString(value: unknown): string | undefined {
  const valueString = typeof value === 'string' ? value.trim() : '';
  return valueString || undefined;
}

function normalizeNwsParameters(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(raw)) {
      const values = raw.map((item) => String(item ?? '').trim()).filter(Boolean);
      if (values.length) result[key] = values;
    } else if (raw !== undefined && raw !== null) {
      const text = String(raw).trim();
      if (text) result[key] = [text];
    }
  }
  return result;
}

function nwsAlertDetailUrl(id: string): string {
  const clean = id.trim();
  if (/^https:\/\/api\.weather\.gov\/alerts\//i.test(clean)) return clean;
  return `${NWS_ALERTS_BASE_URL}/${encodeURIComponent(clean)}`;
}

export async function fetchNwsAlertDetails(id: string, signal?: AbortSignal): Promise<NwsAlertDetails> {
  const clean = id.trim();
  if (!clean) throw new Error('NWS alert identifier is missing.');
  const cached = nwsDetailCache.get(clean);
  if (cached && Date.now() - cached.at < NWS_DETAIL_CACHE_MS) return cached.value;

  const response = await fetch(nwsAlertDetailUrl(clean), {
    signal,
    headers: { Accept: 'application/geo+json, application/ld+json, application/json' },
  });
  if (!response.ok) throw new Error(`NWS alert detail HTTP ${response.status}`);
  const data = await response.json() as NwsAlertApiResponse;
  const properties = data.properties ?? {};
  const parameters = normalizeNwsParameters(properties.parameters);
  const responseTypes = properties.response;
  const categories = properties.category;

  const details: NwsAlertDetails = {
    id: optionalString(data.id) ?? clean,
    event: optionalString(properties.event),
    status: optionalString(properties.status),
    messageType: optionalString(properties.messageType),
    category: Array.isArray(categories) ? categories.map(String).join(', ') : optionalString(categories),
    severity: optionalString(properties.severity),
    certainty: optionalString(properties.certainty),
    urgency: optionalString(properties.urgency),
    response: Array.isArray(responseTypes) ? responseTypes.map(String).join(', ') : optionalString(responseTypes),
    senderName: optionalString(properties.senderName) ?? optionalString(properties.sender),
    effective: optionalString(properties.effective) ?? optionalString(properties.sent),
    onset: optionalString(properties.onset),
    ends: optionalString(properties.ends),
    expires: optionalString(properties.expires),
    headline: optionalString(properties.headline),
    description: optionalString(properties.description),
    instruction: optionalString(properties.instruction),
    web: optionalString(properties.web),
    parameters,
  };
  nwsDetailCache.set(clean, { at: Date.now(), value: details });
  return details;
}

export function nwsParameterValues(details: NwsAlertDetails | null | undefined, names: string[]): string[] {
  if (!details) return [];
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, values] of Object.entries(details.parameters)) {
    if (wanted.has(key.toLowerCase())) return values;
  }
  return [];
}

export function parseNwsStormMotion(details: NwsAlertDetails | null | undefined): NwsStormMotion | null {
  const raw = nwsParameterValues(details, ['eventMotionDescription', 'eventMotion'])[0]?.trim();
  if (!raw) return null;
  const bearingMatch = raw.match(/(?:^|\s)(\d{1,3})\s*DEG\b/i);
  const speedMatch = raw.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*KT\b/i);
  const bearing = bearingMatch?.[1] === undefined ? undefined : Number(bearingMatch[1]);
  const speed = speedMatch?.[1] === undefined ? undefined : Number(speedMatch[1]);
  return {
    bearingDeg: Number.isFinite(bearing) ? ((Number(bearing) % 360) + 360) % 360 : undefined,
    speedKt: Number.isFinite(speed) ? Number(speed) : undefined,
    raw,
  };
}
