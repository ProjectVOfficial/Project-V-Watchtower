import type { MapLayers } from '@/types';
import { isFeatureAvailable } from './runtime-config';
import { isDesktopRuntime } from './runtime';

export type LiveAircraftProvider = 'adsb-lol' | 'opensky';
export type LiveAircraftProviderPreference = 'auto' | LiveAircraftProvider;
export type AircraftSourceType = 'ads-b' | 'ads-r' | 'tis-b' | 'ads-c' | 'mlat' | 'mode-s' | 'other';
export type AircraftStrategicFlag = 'military' | 'pia' | 'ladd';

export interface LiveAircraft {
  id: string;
  icao24: string;
  callsign: string;
  originCountry: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  geoAltitudeFt?: number;
  speedKt: number;
  indicatedAirspeedKt?: number;
  trueAirspeedKt?: number;
  mach?: number;
  heading: number;
  magneticHeading?: number;
  trueHeading?: number;
  trackRateDegS?: number;
  rollDeg?: number;
  verticalRateFpm?: number;
  onGround: boolean;
  squawk?: string;
  category?: string | number;
  registration?: string;
  aircraftType?: string;
  aircraftDescription?: string;
  emergency?: string;
  sourceType: AircraftSourceType;
  sourceRaw?: string;
  dbFlags?: number;
  military?: boolean;
  pia?: boolean;
  ladd?: boolean;
  interesting?: boolean;
  rssiDbfs?: number;
  messages?: number;
  seenSeconds?: number;
  seenPositionSeconds?: number;
  navQnhHpa?: number;
  navAltitudeMcpFt?: number;
  navAltitudeFmsFt?: number;
  navHeading?: number;
  navModes?: string[];
  windDirection?: number;
  windSpeedKt?: number;
  oatC?: number;
  tatC?: number;
  alert?: number;
  spi?: number;
  nic?: number;
  rcMeters?: number;
  provider: LiveAircraftProvider;
  lastContact: number;
}

export interface LiveAircraftFetchResult {
  aircraft: LiveAircraft[];
  provider: LiveAircraftProvider;
  providerLabel: string;
  requestCount: number;
}

export interface AircraftBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Map2SavedView {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zoom: number;
  basemap: 'tactical' | 'satellite';
  timeRange: '1h' | '6h' | '24h' | '48h' | '7d' | 'all';
  layers: MapLayers;
  liveAircraft: boolean;
  aircraftProvider: LiveAircraftProviderPreference;
  createdAt: number;
  updatedAt: number;
}

const VIEWS_KEY = 'project-v-map2-saved-views-v1';
const WATCH_KEY = 'project-v-map2-aircraft-watch-v1';
const AIRCRAFT_ENABLED_KEY = 'project-v-map2-live-aircraft-v1';
const AIRCRAFT_PROVIDER_KEY = 'project-v-map2-aircraft-provider-v1';

const isLocalhostRuntime = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const ADSB_LOL_DIRECT_BASE_URL = 'https://api.adsb.lol';

function buildAdsbLolUrl(path: string): string {
  if (import.meta.env.DEV && isLocalhostRuntime) {
    return `/__adsb_lol${path}`;
  }
  if (isDesktopRuntime()) {
    return `/api/local-adsb-lol?path=${encodeURIComponent(path)}`;
  }
  return `${ADSB_LOL_DIRECT_BASE_URL}${path}`;
}
const OPENSKY_PROXY_URL = '/api/opensky/states/all';
const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const DIRECT_OPENSKY_BASE_URL = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '') + '/opensky/states/all'
  : '';

// OpenSky state vector order:
// [icao24, callsign, origin_country, time_position, last_contact, longitude,
// latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate,
// sensors, geo_altitude, squawk, spi, position_source, category?]
type OpenSkyStateArray = [
  string,
  string | null,
  string,
  number | null,
  number,
  number | null,
  number | null,
  number | null,
  boolean,
  number | null,
  number | null,
  number | null,
  number[] | null,
  number | null,
  string | null,
  boolean,
  number,
  number?,
];

interface OpenSkyResponse {
  time: number;
  states: OpenSkyStateArray[] | null;
}

interface AdsbLolAircraft {
  hex: string;
  flight?: string | null;
  lat?: number | null;
  lon?: number | null;
  alt_baro?: number | string | null;
  alt_geom?: number | null;
  gs?: number | null;
  ias?: number | null;
  tas?: number | null;
  mach?: number | null;
  track?: number | null;
  track_rate?: number | null;
  roll?: number | null;
  true_heading?: number | null;
  mag_heading?: number | null;
  baro_rate?: number | null;
  geom_rate?: number | null;
  squawk?: string | null;
  category?: string | null;
  emergency?: string | null;
  r?: string | null;
  t?: string | null;
  desc?: string | null;
  type?: string | null;
  dbFlags?: number | null;
  rssi?: number | null;
  messages?: number | null;
  seen: number;
  seen_pos?: number | null;
  nav_qnh?: number | null;
  nav_altitude_mcp?: number | null;
  nav_altitude_fms?: number | null;
  nav_heading?: number | null;
  nav_modes?: string[] | null;
  wd?: number | null;
  ws?: number | null;
  oat?: number | null;
  tat?: number | null;
  alert?: number | null;
  spi?: number | null;
  nic?: number | null;
  rc?: number | null;
  mlat?: string[];
  tisb?: string[];
}

interface AdsbLolResponse {
  ac: AdsbLolAircraft[];
  now: number;
  total: number;
  msg: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanBounds(bounds: AircraftBounds): AircraftBounds {
  return {
    south: clamp(bounds.south, -90, 90),
    north: clamp(bounds.north, -90, 90),
    west: clamp(bounds.west, -180, 180),
    east: clamp(bounds.east, -180, 180),
  };
}

function normalizeHeading(...candidates: Array<number | null | undefined>): number {
  const value = candidates.find((candidate) => Number.isFinite(candidate));
  return value == null ? 0 : ((Number(value) % 360) + 360) % 360;
}

function parseOpenSky(data: OpenSkyResponse): LiveAircraft[] {
  if (!Array.isArray(data.states)) return [];
  const aircraft: LiveAircraft[] = [];
  for (const state of data.states) {
    const lon = state[5];
    const lat = state[6];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const icao24 = String(state[0] || '').trim().toLowerCase();
    if (!icao24) continue;
    const baroMeters = Number.isFinite(state[7]) ? Number(state[7]) : 0;
    const geoMeters = Number.isFinite(state[13]) ? Number(state[13]) : undefined;
    const velocity = Number.isFinite(state[9]) ? Number(state[9]) : 0;
    const verticalRate = Number.isFinite(state[11]) ? Number(state[11]) : undefined;
    aircraft.push({
      id: `aircraft-${icao24}`,
      icao24,
      callsign: String(state[1] || '').trim() || icao24.toUpperCase(),
      originCountry: String(state[2] || 'Unknown'),
      lon: Number(lon),
      lat: Number(lat),
      altitudeFt: Math.max(0, Math.round(baroMeters * 3.28084)),
      geoAltitudeFt: geoMeters == null ? undefined : Math.max(0, Math.round(geoMeters * 3.28084)),
      speedKt: Math.max(0, Math.round(velocity * 1.94384)),
      heading: normalizeHeading(state[10]),
      verticalRateFpm: verticalRate == null ? undefined : Math.round(verticalRate * 196.850394),
      onGround: Boolean(state[8]),
      squawk: state[14] || undefined,
      category: Number.isFinite(state[17]) ? Number(state[17]) : undefined,
      sourceType: 'other',
      sourceRaw: 'opensky',
      provider: 'opensky',
      lastContact: Number.isFinite(state[4]) ? Number(state[4]) * 1000 : Date.now(),
    });
  }
  return aircraft;
}

function adsbSourceType(raw: string | null | undefined): AircraftSourceType {
  const value = String(raw || '').toLowerCase();
  if (value.startsWith('adsb_')) return 'ads-b';
  if (value.startsWith('adsr_')) return 'ads-r';
  if (value.startsWith('tisb_')) return 'tis-b';
  if (value === 'adsc') return 'ads-c';
  if (value === 'mlat') return 'mlat';
  if (value === 'mode_s') return 'mode-s';
  return 'other';
}

function flagState(dbFlags: number | null | undefined, forcedFlag?: AircraftStrategicFlag): {
  dbFlags: number | undefined; military: boolean; pia: boolean; ladd: boolean; interesting: boolean;
} {
  const flags = Number.isFinite(dbFlags) ? Number(dbFlags) : 0;
  return {
    dbFlags: flags || undefined,
    military: Boolean(flags & 1) || forcedFlag === 'military',
    interesting: Boolean(flags & 2),
    pia: Boolean(flags & 4) || forcedFlag === 'pia',
    ladd: Boolean(flags & 8) || forcedFlag === 'ladd',
  };
}

function parseAdsbLol(data: AdsbLolResponse, forcedFlag?: AircraftStrategicFlag): LiveAircraft[] {
  if (!Array.isArray(data.ac)) return [];
  const nowRaw = Number(data.now);
  const nowMs = Number.isFinite(nowRaw) ? (nowRaw > 10_000_000_000 ? nowRaw : nowRaw * 1000) : Date.now();
  const aircraft: LiveAircraft[] = [];

  for (const state of data.ac) {
    if (!Number.isFinite(state.lon) || !Number.isFinite(state.lat)) continue;
    const icao24 = String(state.hex || '').trim().toLowerCase();
    if (!icao24) continue;
    const onGround = typeof state.alt_baro === 'string' && state.alt_baro.toLowerCase() === 'ground';
    const baroAltitude = typeof state.alt_baro === 'number' && Number.isFinite(state.alt_baro) ? state.alt_baro : undefined;
    const geoAltitude = Number.isFinite(state.alt_geom) ? Number(state.alt_geom) : undefined;
    const altitudeFt = onGround ? 0 : Math.max(0, Math.round(baroAltitude ?? geoAltitude ?? 0));
    const verticalRate = Number.isFinite(state.baro_rate)
      ? Number(state.baro_rate)
      : Number.isFinite(state.geom_rate)
        ? Number(state.geom_rate)
        : undefined;
    const seenSeconds = Number.isFinite(state.seen) ? Math.max(0, Number(state.seen)) : 0;
    const flags = flagState(state.dbFlags, forcedFlag);

    aircraft.push({
      id: `aircraft-${icao24}`,
      icao24,
      callsign: String(state.flight || '').trim() || String(state.r || '').trim() || icao24.toUpperCase(),
      originCountry: 'Unknown',
      lon: Number(state.lon),
      lat: Number(state.lat),
      altitudeFt,
      geoAltitudeFt: geoAltitude == null ? undefined : Math.max(0, Math.round(geoAltitude)),
      speedKt: Number.isFinite(state.gs) ? Math.max(0, Math.round(Number(state.gs))) : 0,
      indicatedAirspeedKt: Number.isFinite(state.ias) ? Math.max(0, Math.round(Number(state.ias))) : undefined,
      trueAirspeedKt: Number.isFinite(state.tas) ? Math.max(0, Math.round(Number(state.tas))) : undefined,
      mach: Number.isFinite(state.mach) ? Number(state.mach) : undefined,
      heading: normalizeHeading(state.track, state.true_heading, state.mag_heading),
      magneticHeading: Number.isFinite(state.mag_heading) ? normalizeHeading(state.mag_heading) : undefined,
      trueHeading: Number.isFinite(state.true_heading) ? normalizeHeading(state.true_heading) : undefined,
      trackRateDegS: Number.isFinite(state.track_rate) ? Number(state.track_rate) : undefined,
      rollDeg: Number.isFinite(state.roll) ? Number(state.roll) : undefined,
      verticalRateFpm: verticalRate == null ? undefined : Math.round(verticalRate),
      onGround,
      squawk: state.squawk || undefined,
      category: state.category || undefined,
      registration: state.r?.trim() || undefined,
      aircraftType: state.t?.trim() || undefined,
      aircraftDescription: state.desc?.trim() || undefined,
      emergency: state.emergency && state.emergency !== 'none' ? state.emergency : undefined,
      sourceType: adsbSourceType(state.type),
      sourceRaw: state.type?.trim() || undefined,
      ...flags,
      rssiDbfs: Number.isFinite(state.rssi) ? Number(state.rssi) : undefined,
      messages: Number.isFinite(state.messages) ? Number(state.messages) : undefined,
      seenSeconds,
      seenPositionSeconds: Number.isFinite(state.seen_pos) ? Math.max(0, Number(state.seen_pos)) : undefined,
      navQnhHpa: Number.isFinite(state.nav_qnh) ? Number(state.nav_qnh) : undefined,
      navAltitudeMcpFt: Number.isFinite(state.nav_altitude_mcp) ? Number(state.nav_altitude_mcp) : undefined,
      navAltitudeFmsFt: Number.isFinite(state.nav_altitude_fms) ? Number(state.nav_altitude_fms) : undefined,
      navHeading: Number.isFinite(state.nav_heading) ? normalizeHeading(state.nav_heading) : undefined,
      navModes: Array.isArray(state.nav_modes) ? state.nav_modes.map(String) : undefined,
      windDirection: Number.isFinite(state.wd) ? normalizeHeading(state.wd) : undefined,
      windSpeedKt: Number.isFinite(state.ws) ? Math.max(0, Number(state.ws)) : undefined,
      oatC: Number.isFinite(state.oat) ? Number(state.oat) : undefined,
      tatC: Number.isFinite(state.tat) ? Number(state.tat) : undefined,
      alert: Number.isFinite(state.alert) ? Number(state.alert) : undefined,
      spi: Number.isFinite(state.spi) ? Number(state.spi) : undefined,
      nic: Number.isFinite(state.nic) ? Number(state.nic) : undefined,
      rcMeters: Number.isFinite(state.rc) ? Number(state.rc) : undefined,
      provider: 'adsb-lol',
      lastContact: nowMs - Math.round(seenSeconds * 1000),
    });
  }
  return aircraft;
}

class AircraftProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(providerLabel: string, status: number, retryAfter: string | null) {
    super(`${providerLabel} returned HTTP ${status}.`);
    this.name = 'AircraftProviderHttpError';
    this.status = status;
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
    this.retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(0, Math.round(retryAfterSeconds * 1000))
      : null;
  }
}

async function fetchJson<T>(url: string, providerLabel: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new AircraftProviderHttpError(providerLabel, response.status, response.headers.get('retry-after'));
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) {
    const preview = (await response.text()).slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`${providerLabel} returned ${contentType || 'non-JSON'}${preview ? `: ${preview}` : ''}`);
  }
  return response.json() as Promise<T>;
}

const ADSB_LOL_REQUEST_SPACING_MS = 1500;
const ADSB_LOL_DEFAULT_COOLDOWN_MS = 90_000;
let adsbLolNextRequestAt = 0;
let adsbLolCooldownUntil = 0;

async function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForAdsbLolSlot(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  if (adsbLolCooldownUntil > now) {
    const seconds = Math.max(1, Math.ceil((adsbLolCooldownUntil - now) / 1000));
    throw new Error(`ADSB.lol rate limited; retry in ${seconds}s.`);
  }
  const slotAt = Math.max(now, adsbLolNextRequestAt);
  adsbLolNextRequestAt = slotAt + ADSB_LOL_REQUEST_SPACING_MS;
  await delayWithAbort(slotAt - now, signal);
}

function boundsDimensionsNm(bounds: AircraftBounds): { widthNm: number; heightNm: number; midLat: number } {
  const midLat = (bounds.south + bounds.north) / 2;
  const heightNm = Math.abs(bounds.north - bounds.south) * 60;
  const cosLat = Math.max(0.15, Math.cos(midLat * Math.PI / 180));
  const widthNm = Math.abs(bounds.east - bounds.west) * 60 * cosLat;
  return { widthNm, heightNm, midLat };
}

function buildAdsbLolQueries(bounds: AircraftBounds): string[] {
  const { widthNm, heightNm } = boundsDimensionsNm(bounds);
  // A 250 nm circle covers a roughly 350 nm square corner-to-corner. Use up
  // to a 3x3 grid so a regional Watchtower view can be filled without turning
  // every pan into dozens of public API requests.
  const columns = clamp(Math.ceil(Math.max(1, widthNm) / 340), 1, 3);
  const rows = clamp(Math.ceil(Math.max(1, heightNm) / 340), 1, 3);
  const cellWidthNm = widthNm / columns;
  const cellHeightNm = heightNm / rows;
  const radius = clamp(Math.ceil(Math.hypot(cellWidthNm / 2, cellHeightNm / 2) + 15), 25, 250);
  const latSpan = bounds.north - bounds.south;
  const lonSpan = bounds.east - bounds.west;
  const urls: string[] = [];

  for (let row = 0; row < rows; row += 1) {
    const lat = bounds.south + latSpan * ((row + 0.5) / rows);
    for (let column = 0; column < columns; column += 1) {
      const lon = bounds.west + lonSpan * ((column + 0.5) / columns);
      urls.push(buildAdsbLolUrl(`/v2/point/${lat.toFixed(5)}/${lon.toFixed(5)}/${radius}`));
    }
  }
  return urls;
}

async function fetchAdsbLol(bounds: AircraftBounds, signal?: AbortSignal): Promise<LiveAircraftFetchResult> {
  const urls = buildAdsbLolQueries(bounds);
  const responses: AdsbLolResponse[] = [];
  let attempted = 0;
  let firstFailure: unknown = null;

  // ADSB.lol uses dynamic rate limits. Wide Watchtower views can require
  // multiple regional point queries, so never burst those requests in parallel.
  for (const url of urls) {
    try {
      await waitForAdsbLolSlot(signal);
      attempted += 1;
      responses.push(await fetchJson<AdsbLolResponse>(url, 'ADSB.lol', signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      firstFailure ??= error;
      if (error instanceof AircraftProviderHttpError && error.status === 429) {
        adsbLolCooldownUntil = Date.now() + (error.retryAfterMs ?? ADSB_LOL_DEFAULT_COOLDOWN_MS);
        break;
      }
      // Keep any successful regional tiles instead of discarding the entire view.
    }
  }

  if (responses.length === 0) {
    throw firstFailure instanceof Error ? firstFailure : new Error('ADSB.lol is unavailable.');
  }

  const deduped = new Map<string, LiveAircraft>();
  for (const response of responses) {
    for (const aircraft of parseAdsbLol(response)) {
      const current = deduped.get(aircraft.icao24);
      if (!current || aircraft.lastContact > current.lastContact) deduped.set(aircraft.icao24, aircraft);
    }
  }

  return {
    aircraft: [...deduped.values()].sort((a, b) => a.icao24.localeCompare(b.icao24)).slice(0, 4000),
    provider: 'adsb-lol',
    providerLabel: responses.length < urls.length ? 'ADSB.LOL · PARTIAL' : 'ADSB.LOL',
    requestCount: attempted,
  };
}

const GLOBAL_SPECIAL_CACHE_MS = 180_000;
let globalSpecialCache: { updatedAt: number; aircraft: LiveAircraft[] } | null = null;

export async function fetchGlobalStrategicAircraft(
  signal?: AbortSignal,
  force = false,
): Promise<LiveAircraftFetchResult> {
  const now = Date.now();
  if (!force && globalSpecialCache && now - globalSpecialCache.updatedAt < GLOBAL_SPECIAL_CACHE_MS) {
    return {
      aircraft: globalSpecialCache.aircraft.slice(),
      provider: 'adsb-lol',
      providerLabel: 'ADSB.LOL · WORLD SPECIAL · CACHE',
      requestCount: 0,
    };
  }

  const endpoints: Array<{ path: string; flag: AircraftStrategicFlag }> = [
    { path: '/v2/mil', flag: 'military' },
    { path: '/v2/pia', flag: 'pia' },
    { path: '/v2/ladd', flag: 'ladd' },
  ];
  const deduped = new Map<string, LiveAircraft>();
  let attempted = 0;
  let firstFailure: unknown = null;

  for (const endpoint of endpoints) {
    try {
      await waitForAdsbLolSlot(signal);
      attempted += 1;
      const response = await fetchJson<AdsbLolResponse>(buildAdsbLolUrl(endpoint.path), 'ADSB.lol', signal);
      for (const aircraft of parseAdsbLol(response, endpoint.flag)) {
        const current = deduped.get(aircraft.icao24);
        if (!current) {
          deduped.set(aircraft.icao24, aircraft);
        } else {
          deduped.set(aircraft.icao24, {
            ...current,
            ...aircraft,
            military: Boolean(current.military || aircraft.military),
            pia: Boolean(current.pia || aircraft.pia),
            ladd: Boolean(current.ladd || aircraft.ladd),
            interesting: Boolean(current.interesting || aircraft.interesting),
          });
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      firstFailure ??= error;
      if (error instanceof AircraftProviderHttpError && error.status === 429) {
        adsbLolCooldownUntil = Date.now() + (error.retryAfterMs ?? ADSB_LOL_DEFAULT_COOLDOWN_MS);
        break;
      }
    }
  }

  const aircraft = [...deduped.values()].sort((a, b) => a.icao24.localeCompare(b.icao24));
  if (aircraft.length > 0) {
    globalSpecialCache = { updatedAt: Date.now(), aircraft };
    return {
      aircraft,
      provider: 'adsb-lol',
      providerLabel: attempted < endpoints.length ? 'ADSB.LOL · WORLD SPECIAL · PARTIAL' : 'ADSB.LOL · WORLD SPECIAL',
      requestCount: attempted,
    };
  }

  if (globalSpecialCache?.aircraft.length) {
    return {
      aircraft: globalSpecialCache.aircraft.slice(),
      provider: 'adsb-lol',
      providerLabel: 'ADSB.LOL · WORLD SPECIAL · LAST KNOWN',
      requestCount: attempted,
    };
  }

  throw firstFailure instanceof Error ? firstFailure : new Error('ADSB.lol worldwide special-aircraft feed is unavailable.');
}

async function fetchOpenSky(bounds: AircraftBounds, signal?: AbortSignal): Promise<LiveAircraftFetchResult> {
  if (!isFeatureAvailable('openskyRelay')) throw new Error('OpenSky relay is disabled in Watchtower runtime settings.');
  const query = new URLSearchParams({
    lamin: bounds.south.toFixed(5),
    lamax: bounds.north.toFixed(5),
    lomin: bounds.west.toFixed(5),
    lomax: bounds.east.toFixed(5),
    extended: '1',
  }).toString();
  const urls = [`${OPENSKY_PROXY_URL}?${query}`];
  if (isLocalhostRuntime && DIRECT_OPENSKY_BASE_URL) urls.push(`${DIRECT_OPENSKY_BASE_URL}?${query}`);

  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return {
        aircraft: parseOpenSky(await fetchJson<OpenSkyResponse>(url, 'OpenSky relay', signal)).slice(0, 2500),
        provider: 'opensky',
        providerLabel: 'OPEN SKY',
        requestCount: 1,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('OpenSky relay unavailable.');
}

export async function fetchVisibleAircraft(
  boundsInput: AircraftBounds,
  signal?: AbortSignal,
  preference: LiveAircraftProviderPreference = getAircraftProviderPreference(),
): Promise<LiveAircraftFetchResult> {
  const bounds = cleanBounds(boundsInput);
  if (bounds.north <= bounds.south || bounds.east <= bounds.west) {
    return { aircraft: [], provider: preference === 'opensky' ? 'opensky' : 'adsb-lol', providerLabel: preference === 'opensky' ? 'OPEN SKY' : 'ADSB.LOL', requestCount: 0 };
  }

  const providers: LiveAircraftProvider[] = preference === 'auto'
    ? ['adsb-lol', 'opensky']
    : [preference];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === 'adsb-lol') return await fetchAdsbLol(bounds, signal);
      return await fetchOpenSky(bounds, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      errors.push(error instanceof Error ? error.message : `${provider} unavailable.`);
    }
  }

  throw new Error(errors.filter(Boolean).join(' · ') || 'Live aircraft providers unavailable.');
}

function cleanSavedView(value: unknown): Map2SavedView | null {
  if (!value || typeof value !== 'object') return null;
  const view = value as Partial<Map2SavedView>;
  if (!view.id || !view.name || !Number.isFinite(view.lat) || !Number.isFinite(view.lon) || !Number.isFinite(view.zoom) || !view.layers) return null;
  return {
    id: String(view.id).slice(0, 120),
    name: String(view.name).trim().slice(0, 80) || 'Saved view',
    lat: clamp(Number(view.lat), -90, 90),
    lon: clamp(Number(view.lon), -180, 180),
    zoom: clamp(Number(view.zoom), 0, 20),
    basemap: view.basemap === 'satellite' ? 'satellite' : 'tactical',
    timeRange: view.timeRange === '1h' || view.timeRange === '6h' || view.timeRange === '24h' || view.timeRange === '48h' || view.timeRange === 'all' ? view.timeRange : '7d',
    layers: { ...view.layers },
    liveAircraft: view.liveAircraft === true,
    aircraftProvider: view.aircraftProvider === 'adsb-lol' || view.aircraftProvider === 'opensky' ? view.aircraftProvider : 'auto',
    createdAt: Number.isFinite(view.createdAt) ? Number(view.createdAt) : Date.now(),
    updatedAt: Number.isFinite(view.updatedAt) ? Number(view.updatedAt) : Date.now(),
  };
}

export function listMap2SavedViews(): Map2SavedView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]') as unknown[];
    return Array.isArray(raw)
      ? raw.map(cleanSavedView).filter((item): item is Map2SavedView => Boolean(item)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export function saveMap2View(input: Omit<Map2SavedView, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Map2SavedView {
  const views = listMap2SavedViews();
  const existing = input.id ? views.find((view) => view.id === input.id) : undefined;
  const now = Date.now();
  const saved = cleanSavedView({
    ...input,
    id: input.id || `map2-${now}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (!saved) throw new Error('Unable to save this map view.');
  const next = existing ? views.map((view) => view.id === saved.id ? saved : view) : [saved, ...views];
  localStorage.setItem(VIEWS_KEY, JSON.stringify(next.slice(0, 30)));
  return saved;
}

export function deleteMap2View(id: string): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(listMap2SavedViews().filter((view) => view.id !== id)));
}

export function getAircraftWatchlist(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]') as unknown[];
    return new Set(Array.isArray(raw) ? raw.map(String).map((value) => value.toLowerCase()).filter(Boolean).slice(0, 250) : []);
  } catch {
    return new Set();
  }
}

export function setAircraftWatched(icao24: string, watched: boolean): Set<string> {
  const next = getAircraftWatchlist();
  const key = icao24.toLowerCase();
  if (watched) next.add(key); else next.delete(key);
  localStorage.setItem(WATCH_KEY, JSON.stringify([...next].slice(0, 250)));
  return next;
}

export function getLiveAircraftEnabled(): boolean {
  return localStorage.getItem(AIRCRAFT_ENABLED_KEY) === '1';
}

export function setLiveAircraftEnabled(enabled: boolean): void {
  localStorage.setItem(AIRCRAFT_ENABLED_KEY, enabled ? '1' : '0');
}

export function getAircraftProviderPreference(): LiveAircraftProviderPreference {
  const value = localStorage.getItem(AIRCRAFT_PROVIDER_KEY);
  return value === 'adsb-lol' || value === 'opensky' ? value : 'auto';
}

export function setAircraftProviderPreference(preference: LiveAircraftProviderPreference): void {
  localStorage.setItem(AIRCRAFT_PROVIDER_KEY, preference);
}
