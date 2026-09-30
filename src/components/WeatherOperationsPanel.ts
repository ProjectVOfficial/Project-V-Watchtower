import '@/styles/weather-operations.css';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties, LineString, Point, Polygon } from 'geojson';
import type { WeatherAlert } from '@/services/weather';
import {
  fetchNwsAlertDetails,
  fetchRainViewerTimeline,
  fetchWeatherOperationsAlerts,
  fetchWeatherSnapshot,
  nwsParameterValues,
  parseNwsStormMotion,
  rainViewerTileUrl,
  searchWeatherLocations,
  weatherCodeLabel,
  windDirectionLabel,
  type NwsAlertDetails,
  type RainViewerTimeline,
  type WeatherLocation,
  type WeatherSnapshot,
} from '@/services/weather-operations';
import { escapeHtml } from '@/utils/sanitize';
import { TropicalOperationsPanel } from '@/components/TropicalOperationsPanel';

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const RADAR_SOURCE_ID = 'v-weather-ops-radar';
const RADAR_LAYER_ID = 'v-weather-ops-radar-layer';
const ALERT_SOURCE_ID = 'v-weather-ops-alerts';
const ALERT_FILL_LAYER_ID = 'v-weather-ops-alert-fill';
const ALERT_LINE_LAYER_ID = 'v-weather-ops-alert-line';
const ALERT_POINT_LAYER_ID = 'v-weather-ops-alert-point';
const ALERT_SELECTED_FILL_LAYER_ID = 'v-weather-ops-alert-selected-fill';
const ALERT_SELECTED_LINE_LAYER_ID = 'v-weather-ops-alert-selected-line';
const ALERT_SELECTED_POINT_LAYER_ID = 'v-weather-ops-alert-selected-point';
const MOTION_SOURCE_ID = 'v-weather-ops-alert-motion';
const MOTION_LINE_LAYER_ID = 'v-weather-ops-alert-motion-line';
const MOTION_POINT_LAYER_ID = 'v-weather-ops-alert-motion-point';
const WATCH_SOURCE_ID = 'v-weather-ops-watch-targets';
const WATCH_POINT_LAYER_ID = 'v-weather-ops-watch-targets-point';
const LOCATION_SOURCE_ID = 'v-weather-ops-location';
const LOCATION_LAYER_ID = 'v-weather-ops-location-point';
const NOTES_KEY = 'project-v-weather-operations-notes-v1';
const WATCH_TARGETS_KEY = 'project-v-weather-operations-watch-targets-v1';
const HISTORY_KEY = 'project-v-weather-operations-history-v1';
const HISTORY_MAX_AGE_MS = 24 * 60 * 60_000;
const HISTORY_MIN_INTERVAL_MS = 5 * 60_000;
const HISTORY_MAX_POINTS = 144;
const RADAR_REFRESH_MS = 5 * 60_000;
const ALERT_REFRESH_MS = 5 * 60_000;
const LOCATION_REFRESH_MS = 10 * 60_000;

type NoteStore = Record<string, { text: string; updatedAt: number }>;
type WeatherHistoryPoint = { at: number; temperatureF?: number; pressureHpa?: number; windMph?: number; gustMph?: number; precipitationIn?: number; weatherCode?: number };
type WeatherHistoryStore = Record<string, WeatherHistoryPoint[]>;
type WatchTarget = { id: string; name: string; admin1?: string; country?: string; latitude: number; longitude: number; createdAt: number; updatedAt: number }; 
type AlertSeverityFilter = 'all' | 'Extreme' | 'Severe' | 'Moderate' | 'Minor';

function readNotes(): NoteStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as NoteStore : {};
  } catch {
    return {};
  }
}

function writeNotes(notes: NoteStore): void {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* best effort */ }
}


function readWatchTargets(): WatchTarget[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCH_TARGETS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WatchTarget => Boolean(item && typeof item === 'object'
      && Number.isFinite(Number((item as WatchTarget).latitude))
      && Number.isFinite(Number((item as WatchTarget).longitude))
      && typeof (item as WatchTarget).id === 'string'));
  } catch { return []; }
}

function writeWatchTargets(targets: WatchTarget[]): void {
  try { localStorage.setItem(WATCH_TARGETS_KEY, JSON.stringify(targets.slice(0, 12))); } catch { /* best effort */ }
}

function readWeatherHistory(): WeatherHistoryStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as WeatherHistoryStore : {};
  } catch { return {}; }
}

function writeWeatherHistory(history: WeatherHistoryStore): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* best effort */ }
}

function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '< 5 MIN';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}H ${remainder}M` : `${hours}H`;
}

function destinationNm(lon: number, lat: number, bearingDeg: number, distanceNm: number): [number, number] {
  const radiusNm = 3440.065;
  const angular = distanceNm / radiusNm;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
}

function alertAnchor(alert: WeatherAlert): [number, number] | null {
  if (alert.centroid) return alert.centroid;
  if (!alert.coordinates.length) return null;
  const sums = alert.coordinates.reduce((acc, coordinate) => [acc[0] + coordinate[0], acc[1] + coordinate[1]] as [number, number], [0, 0] as [number, number]);
  return [sums[0] / alert.coordinates.length, sums[1] / alert.coordinates.length];
}

function fmt(value: number | undefined, digits = 0, suffix = ''): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : 'N/A';
}

function severityRank(severity: WeatherAlert['severity']): number {
  if (severity === 'Extreme') return 4;
  if (severity === 'Severe') return 3;
  if (severity === 'Moderate') return 2;
  if (severity === 'Minor') return 1;
  return 0;
}

function safeDate(value: Date): string {
  const time = value.getTime();
  return Number.isFinite(time) ? value.toLocaleString() : 'N/A';
}

function locationKey(location: WeatherLocation | null): string {
  if (!location) return '';
  return `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
}

function parseCoordinateSearch(value: string): WeatherLocation | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latText = match[1];
  const lonText = match[2];
  if (latText === undefined || lonText === undefined) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: 'COORDINATE', latitude: lat, longitude: lon };
}

export class WeatherOperationsPanel {
  private readonly root: HTMLElement;
  private readonly tropicalPanel: TropicalOperationsPanel;
  private map: maplibregl.Map | null = null;
  private timeline: RainViewerTimeline | null = null;
  private radarFrameIndex = 0;
  private radarVisible = true;
  private radarOpacity = 0.68;
  private radarPlayTimer: number | null = null;
  private radarRefreshTimer: number | null = null;
  private alertRefreshTimer: number | null = null;
  private locationRefreshTimer: number | null = null;
  private radarAbort: AbortController | null = null;
  private locationAbort: AbortController | null = null;
  private searchAbort: AbortController | null = null;
  private alertDetailAbort: AbortController | null = null;
  private alerts: WeatherAlert[] = [];
  private alertFilter: AlertSeverityFilter = 'all';
  private selectedAlertId = '';
  private selectedAlertDetails: NwsAlertDetails | null = null;
  private alertsVisible = true;
  private selectedLocation: WeatherLocation | null = null;
  private snapshot: WeatherSnapshot | null = null;
  private notes = readNotes();
  private watchTargets = readWatchTargets();
  private weatherHistory = readWeatherHistory();
  private windMarker: maplibregl.Marker | null = null;
  private readonly openHandler: EventListener;
  private readonly closeHandler: EventListener;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly resizeHandler: () => void;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'v-weather-ops-root';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Project V Weather Operations');
    this.root.innerHTML = this.shellMarkup();
    document.body.appendChild(this.root);
    this.tropicalPanel = new TropicalOperationsPanel();
    this.wireUi();

    this.openHandler = ((event: Event) => {
      const detail = (event as CustomEvent<{ lat?: number; lon?: number; zoom?: number }>).detail;
      this.open(detail);
    }) as EventListener;
    this.closeHandler = (() => this.close()) as EventListener;
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !this.root.hidden) {
        event.preventDefault();
        this.close();
      }
    };
    this.resizeHandler = () => this.syncTopOffset();

    window.addEventListener('project-v-weather-operations-open', this.openHandler);
    window.addEventListener('project-v-weather-operations-close', this.closeHandler);
    window.addEventListener('resize', this.resizeHandler);
    document.addEventListener('keydown', this.keyHandler);
  }

  private shellMarkup(): string {
    return `
      <div class="v-weather-ops-shell">
        <aside class="v-weather-ops-left">
          <div class="v-weather-ops-panel-head">
            <span>PROJECT V // SELECTED LOCATION</span>
            <strong>WEATHER INTELLIGENCE</strong>
            <small>CURRENT CONDITIONS · LOCAL HISTORY · WATCH TARGETS</small>
          </div>
          <div class="v-weather-ops-location-scroll" data-weather-location-panel>
            <div class="v-weather-ops-empty">CLICK THE MAP OR SEARCH FOR A LOCATION</div>
          </div>
        </aside>

        <section class="v-weather-ops-map-wrap">
          <div class="v-weather-ops-map" data-weather-map></div>
          <div class="v-weather-ops-toolbar">
            <div class="v-weather-ops-brand"><span></span><strong>WEATHER OPS</strong><small>RADAR + ALERTS + FORECAST</small></div>
            <form data-weather-search-form>
              <input type="search" data-weather-search placeholder="CITY / REGION / LAT,LON" autocomplete="off">
              <button type="submit">LOCATE</button>
            </form>
            <button type="button" class="active" data-action="radar">RADAR ON</button>
            <button type="button" data-action="play">PLAY</button>
            <button type="button" class="active" data-action="alerts">ALERTS ON</button>
            <button type="button" class="v-weather-ops-tropical-launch" data-action="tropical">TROPICAL OPS</button>
            <button type="button" data-action="refresh">REFRESH</button>
            <button type="button" data-action="return">RETURN TO DECK</button>
            <span class="v-weather-ops-status" data-weather-status>STANDBY</span>
          </div>
          <div class="v-weather-ops-search-results" data-weather-search-results hidden></div>
          <div class="v-weather-ops-radar-timeline">
            <button type="button" data-action="previous-frame" title="Previous radar frame">◀</button>
            <input type="range" min="0" max="0" value="0" step="1" data-weather-radar-slider aria-label="Radar timeline">
            <button type="button" data-action="next-frame" title="Next radar frame">▶</button>
            <strong data-weather-radar-time>RADAR STANDBY</strong>
            <label>OPACITY <input type="range" min="20" max="100" value="68" step="1" data-weather-radar-opacity></label>
          </div>
          <div class="v-weather-ops-attribution">Radar © RainViewer · Forecast © Open-Meteo · U.S. alerts: National Weather Service · CARTO / OpenStreetMap basemap</div>
        </section>

        <aside class="v-weather-ops-right">
          <div class="v-weather-ops-panel-head">
            <span>PROJECT V // ACTIVE WEATHER</span>
            <strong data-weather-alert-count>0 ALERTS</strong>
            <small>NWS ACTIVE ALERTS · U.S. COVERAGE</small>
          </div>
          <div class="v-weather-ops-alert-filters">
            <button type="button" class="active" data-alert-filter="all">ALL</button>
            <button type="button" data-alert-filter="Extreme">EXTREME</button>
            <button type="button" data-alert-filter="Severe">SEVERE</button>
            <button type="button" data-alert-filter="Moderate">MODERATE</button>
          </div>
          <div class="v-weather-ops-alert-list" data-weather-alert-list></div>
          <div class="v-weather-ops-alert-detail" data-weather-alert-detail>
            <div class="v-weather-ops-empty">SELECT AN ACTIVE ALERT FOR DETAILS</div>
          </div>
        </aside>

        <section class="v-weather-ops-notes">
          <textarea data-weather-note placeholder="ANALYST NOTES — select a location to bind this note to its coordinates"></textarea>
          <div>
            <button type="button" data-action="save-note">SAVE NOTE</button>
            <button type="button" data-action="clear-note">CLEAR</button>
          </div>
        </section>
      </div>
    `;
  }

  private wireUi(): void {
    this.root.querySelector<HTMLButtonElement>('[data-action="return"]')?.addEventListener('click', () => this.close());
    this.root.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => void this.refreshAll(true));
    this.root.querySelector<HTMLButtonElement>('[data-action="radar"]')?.addEventListener('click', (event) => {
      this.radarVisible = !this.radarVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle('active', this.radarVisible);
      button.textContent = this.radarVisible ? 'RADAR ON' : 'RADAR OFF';
      this.syncRadarVisibility();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="alerts"]')?.addEventListener('click', (event) => {
      this.alertsVisible = !this.alertsVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle('active', this.alertsVisible);
      button.textContent = this.alertsVisible ? 'ALERTS ON' : 'ALERTS OFF';
      this.syncAlertVisibility();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="play"]')?.addEventListener('click', () => this.toggleRadarPlayback());
    this.root.querySelector<HTMLButtonElement>('[data-action="tropical"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('project-v-tropical-operations-open'));
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="previous-frame"]')?.addEventListener('click', () => this.stepRadar(-1));
    this.root.querySelector<HTMLButtonElement>('[data-action="next-frame"]')?.addEventListener('click', () => this.stepRadar(1));
    this.root.querySelector<HTMLInputElement>('[data-weather-radar-slider]')?.addEventListener('input', (event) => {
      this.radarFrameIndex = Math.max(0, Number((event.currentTarget as HTMLInputElement).value) || 0);
      this.renderRadarFrame();
    });
    this.root.querySelector<HTMLInputElement>('[data-weather-radar-opacity]')?.addEventListener('input', (event) => {
      this.radarOpacity = Math.min(1, Math.max(0.2, (Number((event.currentTarget as HTMLInputElement).value) || 68) / 100));
      if (this.map?.getLayer(RADAR_LAYER_ID)) this.map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', this.radarOpacity);
    });

    this.root.querySelector<HTMLFormElement>('[data-weather-search-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>('[data-weather-search]');
      if (input) void this.searchLocation(input.value);
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-alert-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        this.alertFilter = (button.dataset.alertFilter || 'all') as AlertSeverityFilter;
        this.root.querySelectorAll<HTMLButtonElement>('[data-alert-filter]').forEach((item) => item.classList.toggle('active', item === button));
        this.renderAlertList();
      });
    });

    this.root.querySelector<HTMLButtonElement>('[data-action="save-note"]')?.addEventListener('click', () => this.saveNote());
    this.root.querySelector<HTMLButtonElement>('[data-action="clear-note"]')?.addEventListener('click', () => this.clearNote());
  }

  private open(detail?: { lat?: number; lon?: number; zoom?: number }): void {
    this.root.hidden = false;
    document.body.classList.add('v-weather-operations-open');
    this.syncTopOffset();
    this.ensureMap();
    window.setTimeout(() => {
      this.syncTopOffset();
      this.map?.resize();
      if (Number.isFinite(detail?.lat) && Number.isFinite(detail?.lon)) {
        this.map?.jumpTo({ center: [Number(detail?.lon), Number(detail?.lat)], zoom: Number.isFinite(detail?.zoom) ? Math.max(2, Number(detail?.zoom)) : 5 });
      }
      void this.refreshAll(false);
    }, 80);
  }

  private close(): void {
    this.pauseRadar();
    this.root.hidden = true;
    document.body.classList.remove('v-weather-operations-open');
    const results = this.root.querySelector<HTMLElement>('[data-weather-search-results]');
    if (results) results.hidden = true;
  }

  private syncTopOffset(): void {
    if (this.root.hidden) return;
    const header = document.querySelector<HTMLElement>('.v-command-header');
    const ops = document.querySelector<HTMLElement>('.v-opsbar');
    const top = Math.max(header?.getBoundingClientRect().bottom ?? 0, ops?.getBoundingClientRect().bottom ?? 0, 72);
    this.root.style.top = `${Math.ceil(top)}px`;
    this.map?.resize();
  }

  private ensureMap(): void {
    if (this.map) return;
    const container = this.root.querySelector<HTMLElement>('[data-weather-map]');
    if (!container) return;
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [-96, 38],
      zoom: 3.1,
      minZoom: 1.4,
      maxZoom: 12,
      renderWorldCopies: false,
      attributionControl: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
    this.map.on('load', () => {
      this.renderRadarFrame();
      this.renderAlertsOnMap();
      this.renderSelectedLocationMarker();
      this.renderWatchTargets();
      this.renderWindMarker();
    });
    this.map.on('click', (event) => {
      const features = this.map?.queryRenderedFeatures(event.point, { layers: [ALERT_FILL_LAYER_ID, ALERT_LINE_LAYER_ID, ALERT_POINT_LAYER_ID].filter((id) => Boolean(this.map?.getLayer(id))) });
      const alertId = features?.[0]?.properties?.id;
      if (typeof alertId === 'string' && alertId) {
        void this.selectAlert(alertId, false);
        return;
      }
      void this.selectLocation({
        name: 'MAP POINT',
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      }, false);
    });
  }

  private setStatus(message: string, tone: 'normal' | 'loading' | 'error' = 'normal'): void {
    const element = this.root.querySelector<HTMLElement>('[data-weather-status]');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('loading', tone === 'loading');
    element.classList.toggle('error', tone === 'error');
  }

  private async refreshAll(force: boolean): Promise<void> {
    this.setStatus('REFRESHING WEATHER SOURCES', 'loading');
    const tasks: Promise<unknown>[] = [this.refreshRadar(force), this.refreshAlerts(force)];
    if (this.selectedLocation) tasks.push(this.selectLocation(this.selectedLocation, false));
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((result) => result.status === 'rejected').length;
    this.setStatus(failed ? `PARTIAL · ${failed} SOURCE ERROR${failed === 1 ? '' : 'S'}` : 'WEATHER SOURCES ACTIVE', failed ? 'error' : 'normal');
  }

  private async refreshRadar(force: boolean): Promise<void> {
    if (!force && this.timeline && Date.now() - this.timeline.generated * 1000 < RADAR_REFRESH_MS) return;
    this.radarAbort?.abort();
    const controller = new AbortController();
    this.radarAbort = controller;
    try {
      const timeline = await fetchRainViewerTimeline(controller.signal);
      if (controller.signal.aborted) return;
      this.timeline = timeline;
      this.radarFrameIndex = Math.max(0, timeline.frames.length - 1);
      const slider = this.root.querySelector<HTMLInputElement>('[data-weather-radar-slider]');
      if (slider) {
        slider.max = String(Math.max(0, timeline.frames.length - 1));
        slider.value = String(this.radarFrameIndex);
      }
      this.renderRadarFrame();
      if (this.radarRefreshTimer) window.clearTimeout(this.radarRefreshTimer);
      this.radarRefreshTimer = window.setTimeout(() => void this.refreshRadar(true), RADAR_REFRESH_MS);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  }

  private renderRadarFrame(): void {
    const map = this.map;
    const timeline = this.timeline;
    if (!map || !timeline || !map.isStyleLoaded()) return;
    const frame = timeline.frames[this.radarFrameIndex];
    if (!frame) return;
    const tileUrl = rainViewerTileUrl(timeline, frame);
    if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
    if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
    map.addSource(RADAR_SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: 7,
      attribution: 'Radar © RainViewer',
    });
    map.addLayer({
      id: RADAR_LAYER_ID,
      type: 'raster',
      source: RADAR_SOURCE_ID,
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-opacity': this.radarVisible ? this.radarOpacity : 0,
        'raster-fade-duration': 120,
      },
    });
    const slider = this.root.querySelector<HTMLInputElement>('[data-weather-radar-slider]');
    if (slider) slider.value = String(this.radarFrameIndex);
    const label = this.root.querySelector<HTMLElement>('[data-weather-radar-time]');
    if (label) label.textContent = `RADAR ${new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  private syncRadarVisibility(): void {
    if (this.map?.getLayer(RADAR_LAYER_ID)) this.map.setPaintProperty(RADAR_LAYER_ID, 'raster-opacity', this.radarVisible ? this.radarOpacity : 0);
  }

  private toggleRadarPlayback(): void {
    if (this.radarPlayTimer !== null) {
      this.pauseRadar();
      return;
    }
    if (!this.timeline || this.timeline.frames.length < 2) return;
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (button) {
      button.textContent = 'PAUSE';
      button.classList.add('active');
    }
    this.radarPlayTimer = window.setInterval(() => {
      if (!this.timeline || this.timeline.frames.length === 0) return;
      this.radarFrameIndex = (this.radarFrameIndex + 1) % this.timeline.frames.length;
      this.renderRadarFrame();
    }, 850);
  }

  private pauseRadar(): void {
    if (this.radarPlayTimer !== null) window.clearInterval(this.radarPlayTimer);
    this.radarPlayTimer = null;
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (button) {
      button.textContent = 'PLAY';
      button.classList.remove('active');
    }
  }

  private stepRadar(delta: number): void {
    this.pauseRadar();
    const count = this.timeline?.frames.length ?? 0;
    if (!count) return;
    this.radarFrameIndex = Math.min(count - 1, Math.max(0, this.radarFrameIndex + delta));
    this.renderRadarFrame();
  }

  private async refreshAlerts(force: boolean): Promise<void> {
    if (!force && this.alerts.length > 0) return;
    const alerts = await fetchWeatherOperationsAlerts();
    this.alerts = alerts.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.expires.getTime() - b.expires.getTime());
    this.renderAlertList();
    this.renderAlertsOnMap();
    if (this.alertRefreshTimer) window.clearTimeout(this.alertRefreshTimer);
    this.alertRefreshTimer = window.setTimeout(() => void this.refreshAlerts(true), ALERT_REFRESH_MS);
  }

  private alertGeoJson(): FeatureCollection<Geometry, GeoJsonProperties> {
    const features: Array<Feature<Polygon | Point, GeoJsonProperties>> = [];
    for (const alert of this.alerts) {
      const properties = { id: alert.id, event: alert.event, severity: alert.severity, areaDesc: alert.areaDesc };
      if (alert.coordinates.length >= 3) {
        const ring = alert.coordinates.slice();
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
        features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } });
      } else if (alert.centroid) {
        features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: alert.centroid } });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  private renderAlertsOnMap(): void {
    const map = this.map;
    if (!map || !map.isStyleLoaded()) return;
    const data = this.alertGeoJson();
    if (map.getLayer(ALERT_FILL_LAYER_ID)) map.removeLayer(ALERT_FILL_LAYER_ID);
    if (map.getLayer(ALERT_LINE_LAYER_ID)) map.removeLayer(ALERT_LINE_LAYER_ID);
    if (map.getLayer(ALERT_POINT_LAYER_ID)) map.removeLayer(ALERT_POINT_LAYER_ID);
    if (map.getLayer(ALERT_SELECTED_FILL_LAYER_ID)) map.removeLayer(ALERT_SELECTED_FILL_LAYER_ID);
    if (map.getLayer(ALERT_SELECTED_LINE_LAYER_ID)) map.removeLayer(ALERT_SELECTED_LINE_LAYER_ID);
    if (map.getLayer(ALERT_SELECTED_POINT_LAYER_ID)) map.removeLayer(ALERT_SELECTED_POINT_LAYER_ID);
    if (map.getSource(ALERT_SOURCE_ID)) map.removeSource(ALERT_SOURCE_ID);
    map.addSource(ALERT_SOURCE_ID, { type: 'geojson', data });
    const colorExpression: maplibregl.ExpressionSpecification = [
      'match', ['get', 'severity'],
      'Extreme', '#ff3151',
      'Severe', '#ff7a28',
      'Moderate', '#ffc94d',
      'Minor', '#5ba9ff',
      '#7894a5',
    ];
    map.addLayer({
      id: ALERT_FILL_LAYER_ID,
      type: 'fill',
      source: ALERT_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': colorExpression, 'fill-opacity': this.alertsVisible ? 0.18 : 0 },
    });
    map.addLayer({
      id: ALERT_LINE_LAYER_ID,
      type: 'line',
      source: ALERT_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': colorExpression, 'line-width': 1.8, 'line-opacity': this.alertsVisible ? 0.92 : 0 },
    });
    map.addLayer({
      id: ALERT_POINT_LAYER_ID,
      type: 'circle',
      source: ALERT_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 8,
        'circle-color': colorExpression,
        'circle-opacity': this.alertsVisible ? 0.9 : 0,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-stroke-opacity': this.alertsVisible ? 0.8 : 0,
      },
    });
    map.addLayer({
      id: ALERT_SELECTED_FILL_LAYER_ID,
      type: 'fill',
      source: ALERT_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'id'], this.selectedAlertId || '__none__']],
      paint: { 'fill-color': '#ffffff', 'fill-opacity': this.alertsVisible ? 0.08 : 0 },
    });
    map.addLayer({
      id: ALERT_SELECTED_LINE_LAYER_ID,
      type: 'line',
      source: ALERT_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'id'], this.selectedAlertId || '__none__']],
      paint: { 'line-color': '#dff8ff', 'line-width': 4, 'line-opacity': this.alertsVisible ? 1 : 0 },
    });
    map.addLayer({
      id: ALERT_SELECTED_POINT_LAYER_ID,
      type: 'circle',
      source: ALERT_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'id'], this.selectedAlertId || '__none__']],
      paint: { 'circle-radius': 13, 'circle-color': '#ffffff', 'circle-opacity': 0.08, 'circle-stroke-color': '#dff8ff', 'circle-stroke-width': 3, 'circle-stroke-opacity': this.alertsVisible ? 1 : 0 },
    });
    this.renderAlertMotionVector();
  }

  private syncAlertVisibility(): void {
    if (!this.map) return;
    if (this.map.getLayer(ALERT_FILL_LAYER_ID)) this.map.setPaintProperty(ALERT_FILL_LAYER_ID, 'fill-opacity', this.alertsVisible ? 0.18 : 0);
    if (this.map.getLayer(ALERT_LINE_LAYER_ID)) this.map.setPaintProperty(ALERT_LINE_LAYER_ID, 'line-opacity', this.alertsVisible ? 0.92 : 0);
    if (this.map.getLayer(ALERT_POINT_LAYER_ID)) {
      this.map.setPaintProperty(ALERT_POINT_LAYER_ID, 'circle-opacity', this.alertsVisible ? 0.9 : 0);
      this.map.setPaintProperty(ALERT_POINT_LAYER_ID, 'circle-stroke-opacity', this.alertsVisible ? 0.8 : 0);
    }
    if (this.map.getLayer(ALERT_SELECTED_FILL_LAYER_ID)) this.map.setPaintProperty(ALERT_SELECTED_FILL_LAYER_ID, 'fill-opacity', this.alertsVisible ? 0.08 : 0);
    if (this.map.getLayer(ALERT_SELECTED_LINE_LAYER_ID)) this.map.setPaintProperty(ALERT_SELECTED_LINE_LAYER_ID, 'line-opacity', this.alertsVisible ? 1 : 0);
    if (this.map.getLayer(ALERT_SELECTED_POINT_LAYER_ID)) this.map.setPaintProperty(ALERT_SELECTED_POINT_LAYER_ID, 'circle-stroke-opacity', this.alertsVisible ? 1 : 0);
  }

  private filteredAlerts(): WeatherAlert[] {
    return this.alertFilter === 'all' ? this.alerts : this.alerts.filter((alert) => alert.severity === this.alertFilter);
  }

  private renderAlertList(): void {
    const list = this.root.querySelector<HTMLElement>('[data-weather-alert-list]');
    const count = this.root.querySelector<HTMLElement>('[data-weather-alert-count]');
    if (!list || !count) return;
    count.textContent = `${this.alerts.length} ALERT${this.alerts.length === 1 ? '' : 'S'}`;
    const alerts = this.filteredAlerts();
    if (alerts.length === 0) {
      list.innerHTML = '<div class="v-weather-ops-empty">NO ACTIVE ALERTS MATCH THIS FILTER</div>';
      return;
    }
    list.innerHTML = alerts.map((alert) => `
      <button type="button" class="v-weather-ops-alert-row severity-${alert.severity.toLowerCase()}${alert.id === this.selectedAlertId ? ' selected' : ''}" data-alert-id="${escapeHtml(alert.id)}">
        <strong>${escapeHtml(alert.event)}</strong>
        <span>${escapeHtml(alert.severity)}</span>
        <small>${escapeHtml(alert.areaDesc)}</small>
        <em>EXPIRES ${escapeHtml(safeDate(alert.expires))}</em>
      </button>
    `).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-alert-id]').forEach((button) => {
      button.addEventListener('click', () => void this.selectAlert(button.dataset.alertId || '', true));
    });
  }

  private async selectAlert(id: string, focus: boolean): Promise<void> {
    const alert = this.alerts.find((item) => item.id === id);
    if (!alert) return;
    this.selectedAlertId = id;
    this.selectedAlertDetails = null;
    this.alertDetailAbort?.abort();
    const controller = new AbortController();
    this.alertDetailAbort = controller;
    this.renderAlertList();
    this.syncSelectedAlertHighlight();
    this.clearAlertMotionVector();
    const detail = this.root.querySelector<HTMLElement>('[data-weather-alert-detail]');
    if (detail) {
      detail.innerHTML = this.basicAlertDetailMarkup(alert, true);
      this.wireAlertDetailActions(alert);
    }

    if (focus && this.map) {
      const bounds = new maplibregl.LngLatBounds();
      for (const coordinate of alert.coordinates) bounds.extend(coordinate);
      if (!bounds.isEmpty()) this.map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 650 });
      else if (alert.centroid) this.map.easeTo({ center: alert.centroid, zoom: 7, duration: 650 });
    }

    try {
      const details = await fetchNwsAlertDetails(alert.id, controller.signal);
      if (controller.signal.aborted || this.selectedAlertId !== id) return;
      this.selectedAlertDetails = details;
      if (detail) detail.innerHTML = this.richAlertDetailMarkup(alert, details);
      this.wireAlertDetailActions(alert);
      this.renderAlertMotionVector();
      this.setStatus('NWS ALERT DETAIL LIVE');
    } catch (error) {
      if (controller.signal.aborted || this.selectedAlertId !== id) return;
      if (detail) detail.innerHTML = this.basicAlertDetailMarkup(alert, false, error instanceof Error ? error.message : 'Direct NWS detail unavailable.');
      this.wireAlertDetailActions(alert);
      this.setStatus('ALERT DETAIL · BASIC FEED', 'normal');
    }
  }

  private basicAlertDetailMarkup(alert: WeatherAlert, loading: boolean, note = ''): string {
    return `
      <div class="v-weather-ops-alert-detail-head"><span>${escapeHtml(alert.severity)}</span><strong>${escapeHtml(alert.event)}</strong></div>
      <dl>
        <div><dt>AREA</dt><dd>${escapeHtml(alert.areaDesc)}</dd></div>
        <div><dt>ONSET</dt><dd>${escapeHtml(safeDate(alert.onset))}</dd></div>
        <div><dt>EXPIRES</dt><dd>${escapeHtml(safeDate(alert.expires))}</dd></div>
      </dl>
      ${loading ? '<div class="v-weather-ops-detail-state">LOADING DIRECT NWS CAP DETAILS…</div>' : ''}
      ${note ? `<div class="v-weather-ops-detail-state warning">${escapeHtml(note)} · USING NORMALIZED ALERT FEED.</div>` : ''}
      <p>${escapeHtml(alert.headline)}</p>
      <p>${escapeHtml(alert.description)}</p>
      <div class="v-weather-ops-alert-actions">
        <button type="button" data-alert-action="watch-area">WATCH AREA</button>
        <button type="button" data-alert-action="copy-brief">COPY BRIEF</button>
      </div>
    `;
  }

  private richAlertDetailMarkup(alert: WeatherAlert, details: NwsAlertDetails): string {
    const motion = parseNwsStormMotion(details);
    const windGust = nwsParameterValues(details, ['windGust', 'maxWindGust']);
    const hail = nwsParameterValues(details, ['hailSize', 'maxHailSize']);
    const tornadoDetection = nwsParameterValues(details, ['tornadoDetection']);
    const tornadoThreat = nwsParameterValues(details, ['tornadoDamageThreat']);
    const flashFloodThreat = nwsParameterValues(details, ['flashFloodDamageThreat']);
    const waterspout = nwsParameterValues(details, ['waterspoutDetection']);
    const machineRows = [
      motion ? ['STORM MOTION', `${motion.bearingDeg === undefined ? 'N/A' : `${Math.round(motion.bearingDeg)}°`} · ${motion.speedKt === undefined ? 'N/A' : `${motion.speedKt.toFixed(0)} KT`}`] : null,
      windGust.length ? ['WIND GUST', windGust.join(' · ')] : null,
      hail.length ? ['HAIL', hail.join(' · ')] : null,
      tornadoDetection.length ? ['TORNADO DETECTION', tornadoDetection.join(' · ')] : null,
      tornadoThreat.length ? ['TORNADO THREAT', tornadoThreat.join(' · ')] : null,
      flashFloodThreat.length ? ['FLASH FLOOD THREAT', flashFloodThreat.join(' · ')] : null,
      waterspout.length ? ['WATERSPOUT', waterspout.join(' · ')] : null,
    ].filter((row): row is string[] => row !== null);
    return `
      <div class="v-weather-ops-alert-detail-head"><span>${escapeHtml(details.severity || alert.severity)}</span><strong>${escapeHtml(details.event || alert.event)}</strong></div>
      <div class="v-weather-ops-threat-grid">
        ${this.threatCell('URGENCY', details.urgency || 'N/A')}
        ${this.threatCell('CERTAINTY', details.certainty || 'N/A')}
        ${this.threatCell('STATUS', details.status || 'N/A')}
        ${this.threatCell('RESPONSE', details.response || 'N/A')}
      </div>
      <dl>
        <div><dt>AREA</dt><dd>${escapeHtml(alert.areaDesc)}</dd></div>
        <div><dt>ISSUER</dt><dd>${escapeHtml(details.senderName || 'NWS')}</dd></div>
        <div><dt>EFFECTIVE</dt><dd>${escapeHtml(this.formatApiDate(details.effective))}</dd></div>
        <div><dt>ONSET</dt><dd>${escapeHtml(this.formatApiDate(details.onset) || safeDate(alert.onset))}</dd></div>
        <div><dt>ENDS</dt><dd>${escapeHtml(this.formatApiDate(details.ends))}</dd></div>
        <div><dt>EXPIRES</dt><dd>${escapeHtml(this.formatApiDate(details.expires) || safeDate(alert.expires))}</dd></div>
      </dl>
      ${machineRows.length ? `<section class="v-weather-ops-severe-machine"><h4>SEVERE WEATHER INTELLIGENCE</h4>${machineRows.map(([label, value]) => `<div><span>${escapeHtml(label ?? '')}</span><strong>${escapeHtml(value ?? '')}</strong></div>`).join('')}</section>` : ''}
      ${motion ? `<div class="v-weather-ops-motion-note">NWS MOTION VECTOR · DASHED MAP GUIDE PROJECTS ${motion.speedKt === undefined ? 'REPORTED MOTION' : '20 MINUTES AT REPORTED SPEED'} · NOT A FORECAST CONE</div>` : ''}
      <h4 class="v-weather-ops-detail-section-title">HEADLINE</h4>
      <p>${escapeHtml(details.headline || alert.headline)}</p>
      <h4 class="v-weather-ops-detail-section-title">DESCRIPTION</h4>
      <p>${escapeHtml(details.description || alert.description)}</p>
      ${details.instruction ? `<h4 class="v-weather-ops-detail-section-title danger">OFFICIAL INSTRUCTIONS</h4><p class="v-weather-ops-instructions">${escapeHtml(details.instruction)}</p>` : ''}
      <div class="v-weather-ops-alert-actions">
        <button type="button" data-alert-action="watch-area">WATCH AREA</button>
        <button type="button" data-alert-action="copy-brief">COPY BRIEF</button>
      </div>
      <div class="v-weather-ops-source-note">DIRECT NWS CAP/JSON DETAIL · MACHINE FIELDS SHOWN ONLY WHEN PROVIDED BY THE ISSUING PRODUCT</div>
    `;
  }

  private threatCell(label: string, value: string): string {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  private formatApiDate(value: string | undefined): string {
    if (!value) return 'N/A';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
  }

  private wireAlertDetailActions(alert: WeatherAlert): void {
    const watch = this.root.querySelector<HTMLButtonElement>('[data-alert-action="watch-area"]');
    const copy = this.root.querySelector<HTMLButtonElement>('[data-alert-action="copy-brief"]');
    watch?.addEventListener('click', () => {
      const anchor = alertAnchor(alert);
      if (!anchor) {
        this.setStatus('ALERT HAS NO MAPPABLE ANCHOR', 'error');
        return;
      }
      const location: WeatherLocation = { name: alert.event, admin1: alert.areaDesc, latitude: anchor[1], longitude: anchor[0] };
      this.addWatchTarget(location);
      void this.selectLocation(location, false);
    });
    copy?.addEventListener('click', () => void this.copyAlertBrief(alert));
  }

  private syncSelectedAlertHighlight(): void {
    if (!this.map) return;
    const filter: maplibregl.FilterSpecification = ['==', ['get', 'id'], this.selectedAlertId || '__none__'];
    if (this.map.getLayer(ALERT_SELECTED_FILL_LAYER_ID)) this.map.setFilter(ALERT_SELECTED_FILL_LAYER_ID, ['all', ['==', ['geometry-type'], 'Polygon'], filter]);
    if (this.map.getLayer(ALERT_SELECTED_LINE_LAYER_ID)) this.map.setFilter(ALERT_SELECTED_LINE_LAYER_ID, ['all', ['==', ['geometry-type'], 'Polygon'], filter]);
    if (this.map.getLayer(ALERT_SELECTED_POINT_LAYER_ID)) this.map.setFilter(ALERT_SELECTED_POINT_LAYER_ID, ['all', ['==', ['geometry-type'], 'Point'], filter]);
  }

  private clearAlertMotionVector(): void {
    if (!this.map) return;
    if (this.map.getLayer(MOTION_LINE_LAYER_ID)) this.map.removeLayer(MOTION_LINE_LAYER_ID);
    if (this.map.getLayer(MOTION_POINT_LAYER_ID)) this.map.removeLayer(MOTION_POINT_LAYER_ID);
    if (this.map.getSource(MOTION_SOURCE_ID)) this.map.removeSource(MOTION_SOURCE_ID);
  }

  private renderAlertMotionVector(): void {
    const map = this.map;
    const alert = this.alerts.find((item) => item.id === this.selectedAlertId);
    const motion = parseNwsStormMotion(this.selectedAlertDetails);
    if (!map || !map.isStyleLoaded()) return;
    this.clearAlertMotionVector();
    if (!alert || !motion || motion.bearingDeg === undefined) return;
    const start = alertAnchor(alert);
    if (!start) return;
    const distanceNm = motion.speedKt === undefined ? 12 : Math.max(5, Math.min(40, motion.speedKt / 3));
    const end = destinationNm(start[0], start[1], motion.bearingDeg, distanceNm);
    const line: FeatureCollection<LineString | Point> = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'motion' }, geometry: { type: 'LineString', coordinates: [start, end] } },
        { type: 'Feature', properties: { kind: 'endpoint' }, geometry: { type: 'Point', coordinates: end } },
      ],
    };
    map.addSource(MOTION_SOURCE_ID, { type: 'geojson', data: line });
    map.addLayer({ id: MOTION_LINE_LAYER_ID, type: 'line', source: MOTION_SOURCE_ID, filter: ['==', ['get', 'kind'], 'motion'], paint: { 'line-color': '#b8f3ff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.95 } });
    map.addLayer({ id: MOTION_POINT_LAYER_ID, type: 'circle', source: MOTION_SOURCE_ID, filter: ['==', ['get', 'kind'], 'endpoint'], paint: { 'circle-radius': 5, 'circle-color': '#b8f3ff', 'circle-stroke-color': '#061018', 'circle-stroke-width': 2 } });
  }

  private async copyAlertBrief(alert: WeatherAlert): Promise<void> {
    const details = this.selectedAlertDetails;
    const motion = parseNwsStormMotion(details);
    const text = [
      `PROJECT V // WEATHER ALERT`,
      `${details?.event || alert.event} · ${details?.severity || alert.severity}`,
      `Area: ${alert.areaDesc}`,
      `Urgency: ${details?.urgency || 'N/A'} · Certainty: ${details?.certainty || 'N/A'}`,
      `Onset: ${details?.onset || alert.onset.toISOString()}`,
      `Expires: ${details?.expires || alert.expires.toISOString()}`,
      motion ? `Motion: ${motion.bearingDeg ?? 'N/A'}° @ ${motion.speedKt ?? 'N/A'} kt` : '',
      details?.headline || alert.headline,
      details?.instruction ? `Instructions: ${details.instruction}` : '',
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('ALERT BRIEF COPIED');
    } catch {
      this.setStatus('CLIPBOARD UNAVAILABLE', 'error');
    }
  }

  private async searchLocation(query: string): Promise<void> {
    const direct = parseCoordinateSearch(query);
    if (direct) {
      const results = this.root.querySelector<HTMLElement>('[data-weather-search-results]');
      if (results) results.hidden = true;
      await this.selectLocation(direct, true);
      return;
    }
    this.searchAbort?.abort();
    const controller = new AbortController();
    this.searchAbort = controller;
    this.setStatus('SEARCHING LOCATION', 'loading');
    try {
      const locations = await searchWeatherLocations(query, controller.signal);
      if (controller.signal.aborted) return;
      this.renderSearchResults(locations);
      this.setStatus(locations.length ? `${locations.length} LOCATION MATCH${locations.length === 1 ? '' : 'ES'}` : 'NO LOCATION MATCH', locations.length ? 'normal' : 'error');
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setStatus(error instanceof Error ? error.message : 'Location search failed.', 'error');
    }
  }

  private renderSearchResults(locations: WeatherLocation[]): void {
    const results = this.root.querySelector<HTMLElement>('[data-weather-search-results]');
    if (!results) return;
    if (locations.length === 0) {
      results.hidden = true;
      return;
    }
    results.innerHTML = locations.map((location, index) => `
      <button type="button" data-weather-location-index="${index}">
        <strong>${escapeHtml(location.name)}</strong>
        <span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(', '))}</span>
        <small>${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}</small>
      </button>
    `).join('');
    results.hidden = false;
    results.querySelectorAll<HTMLButtonElement>('[data-weather-location-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.weatherLocationIndex);
        const location = locations[index];
        if (!location) return;
        results.hidden = true;
        void this.selectLocation(location, true);
      });
    });
  }

  private async selectLocation(location: WeatherLocation, focus: boolean): Promise<void> {
    this.locationAbort?.abort();
    if (this.locationRefreshTimer) window.clearTimeout(this.locationRefreshTimer);
    const controller = new AbortController();
    this.locationAbort = controller;
    this.selectedLocation = location;
    this.snapshot = null;
    this.renderLocationPanel(true);
    this.renderSelectedLocationMarker();
    this.loadNote();
    if (focus) this.map?.easeTo({ center: [location.longitude, location.latitude], zoom: Math.max(6, this.map?.getZoom() ?? 6), duration: 650 });
    this.setStatus('LOADING LOCATION WEATHER', 'loading');
    try {
      const snapshot = await fetchWeatherSnapshot(location.latitude, location.longitude, controller.signal);
      if (controller.signal.aborted) return;
      this.snapshot = snapshot;
      this.recordWeatherObservation(location, snapshot);
      this.renderLocationPanel(false);
      this.renderWindMarker();
      this.renderWatchTargets();
      this.setStatus('LOCATION WEATHER LIVE');
      const selectedKey = locationKey(location);
      this.locationRefreshTimer = window.setTimeout(() => {
        if (this.selectedLocation && locationKey(this.selectedLocation) === selectedKey) void this.selectLocation(this.selectedLocation, false);
      }, LOCATION_REFRESH_MS);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.renderLocationError(error instanceof Error ? error.message : 'Weather request failed.');
      this.setStatus('LOCATION WEATHER ERROR', 'error');
      throw error;
    }
  }

  private renderSelectedLocationMarker(): void {
    const map = this.map;
    const location = this.selectedLocation;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer(LOCATION_LAYER_ID)) map.removeLayer(LOCATION_LAYER_ID);
    if (map.getSource(LOCATION_SOURCE_ID)) map.removeSource(LOCATION_SOURCE_ID);
    if (!location) return;
    const data: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] } }],
    };
    map.addSource(LOCATION_SOURCE_ID, { type: 'geojson', data });
    map.addLayer({
      id: LOCATION_LAYER_ID,
      type: 'circle',
      source: LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': '#22b8ff',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95,
      },
    });
  }

  private renderWatchTargets(): void {
    const map = this.map;
    if (!map || !map.isStyleLoaded()) return;
    const data: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: this.watchTargets.map((target) => ({
        type: 'Feature',
        properties: { id: target.id, name: target.name },
        geometry: { type: 'Point', coordinates: [target.longitude, target.latitude] },
      })),
    };
    const source = map.getSource(WATCH_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource(WATCH_SOURCE_ID, { type: 'geojson', data });
      map.addLayer({
        id: WATCH_POINT_LAYER_ID,
        type: 'circle',
        source: WATCH_SOURCE_ID,
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#4ef2a3',
          'circle-stroke-width': 2,
          'circle-opacity': 0.95,
        },
      });
    }
  }

  private renderWindMarker(): void {
    this.windMarker?.remove();
    this.windMarker = null;
    const location = this.selectedLocation;
    const current = this.snapshot?.current;
    if (!this.map || !location || current?.windDirectionDeg === undefined || current.windSpeedMph === undefined) return;
    const element = document.createElement('div');
    element.className = 'v-weather-ops-wind-marker';
    const toward = (current.windDirectionDeg + 180) % 360;
    element.innerHTML = `<span style="transform:rotate(${toward.toFixed(0)}deg)">↑</span><small>${Math.round(current.windSpeedMph)} MPH</small>`;
    element.title = `Surface wind from ${windDirectionLabel(current.windDirectionDeg)} (${Math.round(current.windDirectionDeg)}°), ${Math.round(current.windSpeedMph)} mph`;
    this.windMarker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -13] })
      .setLngLat([location.longitude, location.latitude])
      .addTo(this.map);
  }

  private renderLocationPanel(loading: boolean): void {
    const panel = this.root.querySelector<HTMLElement>('[data-weather-location-panel]');
    const location = this.selectedLocation;
    if (!panel || !location) return;
    if (loading || !this.snapshot) {
      panel.innerHTML = `
        <div class="v-weather-ops-location-title"><strong>${escapeHtml(location.name)}</strong><span>${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}</span></div>
        <div class="v-weather-ops-loading">LOADING FORECAST DATA…</div>
      `;
      return;
    }
    const snapshot = this.snapshot;
    const current = snapshot.current;
    const nextHours = snapshot.hourly.filter((point) => {
      const time = new Date(point.time).getTime();
      return Number.isFinite(time) && time >= Date.now() - 60 * 60_000;
    }).slice(0, 12);
    panel.innerHTML = `
      <div class="v-weather-ops-location-title">
        <strong>${escapeHtml(location.name)}</strong>
        <span>${escapeHtml([location.admin1, location.country].filter(Boolean).join(' · ') || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`)}</span>
      </div>
      <div class="v-weather-ops-current-hero">
        <div><strong>${fmt(current.temperatureF, 0, '°F')}</strong><span>${escapeHtml(weatherCodeLabel(current.weatherCode))}</span></div>
        <small>FEELS ${fmt(current.apparentTemperatureF, 0, '°F')} · UPDATED ${escapeHtml(current.time ? new Date(current.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A')}</small>
      </div>
      <div class="v-weather-ops-metrics">
        ${this.metric('HUMIDITY', fmt(current.humidityPct, 0, '%'))}
        ${this.metric('PRECIP', fmt(current.precipitationIn, 2, ' in'))}
        ${this.metric('CLOUD', fmt(current.cloudCoverPct, 0, '%'))}
        ${this.metric('PRESSURE', fmt(current.surfacePressureHpa, 0, ' hPa'))}
        ${this.metric('WIND', `${fmt(current.windSpeedMph, 0, ' mph')} ${escapeHtml(windDirectionLabel(current.windDirectionDeg))}`)}
        ${this.metric('GUST', fmt(current.windGustMph, 0, ' mph'))}
      </div>
      ${this.locationActionMarkup(location)}
      ${this.weatherHistoryMarkup(location)}
      <section class="v-weather-ops-section">
        <h4>NEXT 12 HOURS</h4>
        <div class="v-weather-ops-hourly">
          ${nextHours.map((point) => `
            <div><strong>${escapeHtml(new Date(point.time).toLocaleTimeString([], { hour: 'numeric' }))}</strong><span>${fmt(point.temperatureF, 0, '°')}</span><small>${fmt(point.precipitationProbabilityPct, 0, '%')} PRECIP</small><em>${escapeHtml(weatherCodeLabel(point.weatherCode))}</em></div>
          `).join('') || '<div class="v-weather-ops-empty">NO HOURLY DATA</div>'}
        </div>
      </section>
      <section class="v-weather-ops-section">
        <h4>7 DAY OUTLOOK</h4>
        <div class="v-weather-ops-daily">
          ${snapshot.daily.map((day) => `
            <div><strong>${escapeHtml(new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' }).toUpperCase())}</strong><span>${fmt(day.temperatureMaxF, 0, '°')} / ${fmt(day.temperatureMinF, 0, '°')}</span><small>${fmt(day.precipitationProbabilityMaxPct, 0, '%')} PRECIP</small><em>${escapeHtml(weatherCodeLabel(day.weatherCode))}</em></div>
          `).join('')}
        </div>
      </section>
      <div class="v-weather-ops-source-note">OPEN-METEO BEST-MATCH MODEL · ${escapeHtml(snapshot.timezone)} · ELEVATION ${fmt(snapshot.elevationM, 0, ' m')}</div>
    `;
    this.wireLocationActions();
  }

  private locationActionMarkup(location: WeatherLocation): string {
    const watched = this.isLocationWatched(location);
    return `<div class="v-weather-ops-location-actions">
      <button type="button" class="${watched ? 'active' : ''}" data-location-action="watch">${watched ? 'WATCHING' : 'WATCH LOCATION'}</button>
      <button type="button" data-location-action="locate">LOCATE</button>
      <button type="button" data-location-action="copy">COPY BRIEF</button>
    </div>`;
  }

  private weatherHistoryMarkup(location: WeatherLocation): string {
    const points = this.historyPoints(location);
    if (!points.length) return `<section class="v-weather-ops-section v-weather-ops-history"><h4>LOCAL WEATHER HISTORY</h4><div class="v-weather-ops-empty">FIRST WATCHTOWER OBSERVATION RECORDED · MORE TREND DATA WILL APPEAR AFTER FUTURE REFRESHES</div></section>${this.watchTargetListMarkup()}`;
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return this.watchTargetListMarkup();
    const temperatureDelta = first.temperatureF === undefined || last.temperatureF === undefined ? undefined : last.temperatureF - first.temperatureF;
    const pressureDelta = first.pressureHpa === undefined || last.pressureHpa === undefined ? undefined : last.pressureHpa - first.pressureHpa;
    const peakGust = points.reduce<number | undefined>((max, point) => point.gustMph === undefined ? max : max === undefined ? point.gustMph : Math.max(max, point.gustMph), undefined);
    const pressureTrend = pressureDelta === undefined ? 'N/A' : pressureDelta > 1.5 ? 'RISING' : pressureDelta < -1.5 ? 'FALLING' : 'STEADY';
    const recent = points.slice(-6).reverse();
    return `
      <section class="v-weather-ops-section v-weather-ops-history">
        <h4>LOCAL WEATHER HISTORY</h4>
        <div class="v-weather-ops-history-grid">
          ${this.metric('OBSERVED POINTS', String(points.length))}
          ${this.metric('OBSERVED SPAN', durationLabel(last.at - first.at))}
          ${this.metric('TEMP Δ', temperatureDelta === undefined ? 'N/A' : `${temperatureDelta >= 0 ? '+' : ''}${temperatureDelta.toFixed(1)}°F`)}
          ${this.metric('PRESSURE', pressureDelta === undefined ? 'N/A' : `${pressureTrend} ${pressureDelta >= 0 ? '+' : ''}${pressureDelta.toFixed(1)} hPa`)}
          ${this.metric('PEAK GUST', fmt(peakGust, 0, ' mph'))}
          ${this.metric('LATEST PRECIP', fmt(last.precipitationIn, 2, ' in'))}
        </div>
        <div class="v-weather-ops-history-list">
          ${recent.map((point) => `<div><span>${escapeHtml(new Date(point.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span><strong>${fmt(point.temperatureF, 0, '°F')}</strong><small>${fmt(point.pressureHpa, 0, ' hPa')} · ${fmt(point.windMph, 0, ' mph')} WIND</small></div>`).join('')}
        </div>
        <small class="v-weather-ops-history-note">WATCHTOWER LOCAL OBSERVATIONS · SELECTED LOCATION AUTO-REFRESHES EVERY 10 MIN · SAVED WATCH TARGETS UPDATE WHEN SELECTED</small>
      </section>
      ${this.watchTargetListMarkup()}
    `;
  }

  private watchTargetListMarkup(): string {
    if (!this.watchTargets.length) return '';
    return `<section class="v-weather-ops-section v-weather-ops-watch-list"><h4>WATCHED LOCATIONS · ${this.watchTargets.length}/12</h4>${this.watchTargets.map((target) => `<button type="button" data-watch-id="${escapeHtml(target.id)}"><strong>${escapeHtml(target.name)}</strong><span>${target.latitude.toFixed(2)}, ${target.longitude.toFixed(2)}</span></button>`).join('')}</section>`;
  }

  private wireLocationActions(): void {
    this.root.querySelector<HTMLButtonElement>('[data-location-action="watch"]')?.addEventListener('click', () => this.toggleCurrentWatchTarget());
    this.root.querySelector<HTMLButtonElement>('[data-location-action="locate"]')?.addEventListener('click', () => {
      const location = this.selectedLocation;
      if (location) this.map?.easeTo({ center: [location.longitude, location.latitude], zoom: Math.max(7, this.map?.getZoom() ?? 7), duration: 500 });
    });
    this.root.querySelector<HTMLButtonElement>('[data-location-action="copy"]')?.addEventListener('click', () => void this.copyLocationBrief());
    this.root.querySelectorAll<HTMLButtonElement>('[data-watch-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = this.watchTargets.find((item) => item.id === button.dataset.watchId);
        if (!target) return;
        void this.selectLocation({ name: target.name, admin1: target.admin1, country: target.country, latitude: target.latitude, longitude: target.longitude }, true);
      });
    });
  }

  private historyPoints(location: WeatherLocation): WeatherHistoryPoint[] {
    return this.weatherHistory[locationKey(location)] ?? [];
  }

  private recordWeatherObservation(location: WeatherLocation, snapshot: WeatherSnapshot): void {
    const key = locationKey(location);
    const now = snapshot.fetchedAt || Date.now();
    const cutoff = now - HISTORY_MAX_AGE_MS;
    const existing = (this.weatherHistory[key] ?? []).filter((point) => point.at >= cutoff);
    const point: WeatherHistoryPoint = {
      at: now,
      temperatureF: snapshot.current.temperatureF,
      pressureHpa: snapshot.current.surfacePressureHpa,
      windMph: snapshot.current.windSpeedMph,
      gustMph: snapshot.current.windGustMph,
      precipitationIn: snapshot.current.precipitationIn,
      weatherCode: snapshot.current.weatherCode,
    };
    const last = existing[existing.length - 1];
    if (last && now - last.at < HISTORY_MIN_INTERVAL_MS) existing[existing.length - 1] = point;
    else existing.push(point);
    this.weatherHistory[key] = existing.slice(-HISTORY_MAX_POINTS);
    const activeKeys = new Set([key, ...this.watchTargets.map((target) => `${target.latitude.toFixed(3)},${target.longitude.toFixed(3)}`)]);
    for (const storedKey of Object.keys(this.weatherHistory)) {
      const points = (this.weatherHistory[storedKey] ?? []).filter((item) => item.at >= cutoff);
      if (!points.length && !activeKeys.has(storedKey)) delete this.weatherHistory[storedKey];
      else this.weatherHistory[storedKey] = points.slice(-HISTORY_MAX_POINTS);
    }
    writeWeatherHistory(this.weatherHistory);
  }

  private isLocationWatched(location: WeatherLocation): boolean {
    const key = locationKey(location);
    return this.watchTargets.some((target) => `${target.latitude.toFixed(3)},${target.longitude.toFixed(3)}` === key);
  }

  private addWatchTarget(location: WeatherLocation): void {
    const key = locationKey(location);
    const existingIndex = this.watchTargets.findIndex((target) => `${target.latitude.toFixed(3)},${target.longitude.toFixed(3)}` === key);
    const now = Date.now();
    const target: WatchTarget = {
      id: existingIndex >= 0 ? this.watchTargets[existingIndex]?.id ?? `wx-${now}` : `wx-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: location.name || 'WATCHED LOCATION',
      admin1: location.admin1,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      createdAt: existingIndex >= 0 ? this.watchTargets[existingIndex]?.createdAt ?? now : now,
      updatedAt: now,
    };
    if (existingIndex >= 0) this.watchTargets.splice(existingIndex, 1, target);
    else this.watchTargets.unshift(target);
    this.watchTargets = this.watchTargets.slice(0, 12);
    writeWatchTargets(this.watchTargets);
    this.renderWatchTargets();
    this.renderLocationPanel(false);
    this.setStatus('WEATHER LOCATION WATCHED');
  }

  private toggleCurrentWatchTarget(): void {
    const location = this.selectedLocation;
    if (!location) return;
    const key = locationKey(location);
    const index = this.watchTargets.findIndex((target) => `${target.latitude.toFixed(3)},${target.longitude.toFixed(3)}` === key);
    if (index >= 0) {
      this.watchTargets.splice(index, 1);
      writeWatchTargets(this.watchTargets);
      this.renderWatchTargets();
      this.renderLocationPanel(false);
      this.setStatus('WEATHER WATCH REMOVED');
      return;
    }
    this.addWatchTarget(location);
  }

  private async copyLocationBrief(): Promise<void> {
    const location = this.selectedLocation;
    const snapshot = this.snapshot;
    if (!location || !snapshot) return;
    const current = snapshot.current;
    const points = this.historyPoints(location);
    const first = points[0];
    const last = points[points.length - 1];
    const tempDelta = first?.temperatureF === undefined || last?.temperatureF === undefined ? 'N/A' : `${(last.temperatureF - first.temperatureF).toFixed(1)}°F`;
    const text = [
      `PROJECT V // WEATHER LOCATION BRIEF`,
      `${location.name} · ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`,
      `${fmt(current.temperatureF, 0, '°F')} · ${weatherCodeLabel(current.weatherCode)}`,
      `Humidity ${fmt(current.humidityPct, 0, '%')} · Pressure ${fmt(current.surfacePressureHpa, 0, ' hPa')}`,
      `Wind ${fmt(current.windSpeedMph, 0, ' mph')} ${windDirectionLabel(current.windDirectionDeg)} · Gust ${fmt(current.windGustMph, 0, ' mph')}`,
      `Precip ${fmt(current.precipitationIn, 2, ' in')}`,
      `Local history: ${points.length} points · temp delta ${tempDelta}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('LOCATION BRIEF COPIED');
    } catch {
      this.setStatus('CLIPBOARD UNAVAILABLE', 'error');
    }
  }

  private metric(label: string, value: string): string {
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  }

  private renderLocationError(message: string): void {
    const panel = this.root.querySelector<HTMLElement>('[data-weather-location-panel]');
    if (!panel) return;
    panel.innerHTML = `<div class="v-weather-ops-empty error">${escapeHtml(message)}</div>`;
  }

  private loadNote(): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-weather-note]');
    const key = locationKey(this.selectedLocation);
    if (!textarea) return;
    textarea.disabled = !key;
    textarea.value = key ? this.notes[key]?.text ?? '' : '';
    textarea.placeholder = key
      ? `ANALYST NOTES — ${this.selectedLocation?.latitude.toFixed(3)}, ${this.selectedLocation?.longitude.toFixed(3)}`
      : 'ANALYST NOTES — select a location to bind this note to its coordinates';
  }

  private saveNote(): void {
    const key = locationKey(this.selectedLocation);
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-weather-note]');
    if (!key || !textarea) return;
    const text = textarea.value.trim();
    if (text) this.notes[key] = { text, updatedAt: Date.now() };
    else delete this.notes[key];
    writeNotes(this.notes);
    this.setStatus(text ? 'LOCATION NOTE SAVED' : 'LOCATION NOTE CLEARED');
  }

  private clearNote(): void {
    const key = locationKey(this.selectedLocation);
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-weather-note]');
    if (!textarea) return;
    textarea.value = '';
    if (key) {
      delete this.notes[key];
      writeNotes(this.notes);
    }
    this.setStatus('LOCATION NOTE CLEARED');
  }

  destroy(): void {
    this.pauseRadar();
    if (this.radarRefreshTimer) window.clearTimeout(this.radarRefreshTimer);
    if (this.alertRefreshTimer) window.clearTimeout(this.alertRefreshTimer);
    if (this.locationRefreshTimer) window.clearTimeout(this.locationRefreshTimer);
    this.radarAbort?.abort();
    this.locationAbort?.abort();
    this.searchAbort?.abort();
    this.alertDetailAbort?.abort();
    this.windMarker?.remove();
    this.windMarker = null;
    this.tropicalPanel.destroy();
    this.map?.remove();
    this.map = null;
    window.removeEventListener('project-v-weather-operations-open', this.openHandler);
    window.removeEventListener('project-v-weather-operations-close', this.closeHandler);
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
    document.body.classList.remove('v-weather-operations-open');
  }
}
