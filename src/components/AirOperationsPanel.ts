import '@/styles/air-operations.css';
import maplibregl from 'maplibre-gl';
import { Panel } from './Panel';
import {
  fetchGlobalStrategicAircraft,
  fetchVisibleAircraft,
  getAircraftWatchlist,
  setAircraftWatched,
  type AircraftSourceType,
  type LiveAircraft,
} from '@/services/map-2';
import { sendPromptToAssistant } from '@/services/assistant-handoff';
import { sendPhoenixIntelligenceAlert } from '@/services/phoenix-ai-bridge';
import { sendToCaseDesk } from '@/services/case-handoff';
import { escapeHtml } from '@/utils/sanitize';

const NOTES_KEY = 'project-v-air-operations-notes-v1';
const AIRCRAFT_LIMIT = 5000;
const REFRESH_MS = 45_000;
const DISPLAY_TICK_MS = 2_000;
const DISPLAY_DEAD_RECKON_MAX_S = 20;
const TRAIL_RETENTION_MS = 3 * 60 * 60_000;
const TRAIL_MAX_POINTS = 160;
const REGIONAL_MIN_ZOOM = 3.6;
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DEFAULT_MAP_CENTER: [number, number] = [-18, 22];
const DEFAULT_MAP_ZOOM = 2.15;
const SELECT_MAP_ZOOM = 5.2;
const LOCATE_MAP_ZOOM = 5.8;
const AIRCRAFT_SOURCE_ID = 'v-air-ops-aircraft';
const TRAIL_SOURCE_ID = 'v-air-ops-trail';

type AirFilter = 'all' | 'airborne' | 'emergency' | 'watched';
type AirScope = 'auto' | 'world' | 'region';
type DatabaseFilter = 'military' | 'pia' | 'ladd' | 'interesting';
type NoteStore = Record<string, { text: string; updatedAt: number }>;
type TrailPoint = { lon: number; lat: number; at: number };
type TrailStore = Map<string, { points: TrailPoint[]; lastSeen: number }>;

const SOURCE_LABELS: Record<AircraftSourceType, string> = {
  'ads-b': 'ADS-B',
  'ads-r': 'UAT / ADS-R',
  'tis-b': 'TIS-B',
  'ads-c': 'ADS-C',
  'mlat': 'MLAT',
  'mode-s': 'MODE-S',
  'other': 'OTHER',
};

function loadNotes(): NoteStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as NoteStore;
  } catch {
    return {};
  }
}

function saveNotes(notes: NoteStore): void {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* local notes are best-effort */ }
}

function altitudeColor(aircraft: LiveAircraft): string {
  if (aircraft.onGround) return '#87939d';
  if (aircraft.emergency || aircraft.squawk === '7700' || aircraft.squawk === '7600' || aircraft.squawk === '7500') return '#ff4f63';
  const altitude = aircraft.altitudeFt;
  if (altitude < 3000) return '#ff8a38';
  if (altitude < 8000) return '#f5d94e';
  if (altitude < 15000) return '#7adf68';
  if (altitude < 25000) return '#39d1ce';
  if (altitude < 35000) return '#4da3ff';
  return '#b95cff';
}

function fmtNumber(value: number | undefined, suffix = ''): string {
  return Number.isFinite(value) ? `${Math.round(Number(value)).toLocaleString()}${suffix}` : 'N/A';
}

function fmtDecimal(value: number | undefined, digits: number, suffix = ''): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : 'N/A';
}

function isEmergency(aircraft: LiveAircraft): boolean {
  return Boolean(aircraft.emergency) || ['7500', '7600', '7700'].includes(aircraft.squawk ?? '');
}

function aircraftLabel(aircraft: LiveAircraft): string {
  return aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
}

function sourceLabel(aircraft: LiveAircraft): string {
  return SOURCE_LABELS[aircraft.sourceType] ?? 'OTHER';
}

function aircraftSummary(aircraft: LiveAircraft): string {
  const flags = [
    aircraft.military ? 'military database flag' : '',
    aircraft.pia ? 'PIA' : '',
    aircraft.ladd ? 'LADD' : '',
  ].filter(Boolean).join(', ');
  return [
    `Aircraft ${aircraftLabel(aircraft)} (${aircraft.icao24.toUpperCase()})`,
    aircraft.registration ? `registration ${aircraft.registration}` : '',
    aircraft.aircraftType ? `type ${aircraft.aircraftType}` : '',
    aircraft.aircraftDescription || '',
    `at ${aircraft.lat.toFixed(4)}, ${aircraft.lon.toFixed(4)}`,
    `${fmtNumber(aircraft.altitudeFt, ' ft')}`,
    `${fmtNumber(aircraft.speedKt, ' kt')}`,
    `heading ${fmtNumber(aircraft.heading, '°')}`,
    aircraft.squawk ? `squawk ${aircraft.squawk}` : '',
    aircraft.emergency ? `emergency ${aircraft.emergency}` : '',
    `signal source ${sourceLabel(aircraft)}`,
    flags,
    `provider ${aircraft.provider === 'adsb-lol' ? 'ADSB.lol' : 'OpenSky'}`,
  ].filter(Boolean).join(', ');
}

function mergeAircraft(...sets: LiveAircraft[][]): LiveAircraft[] {
  const merged = new Map<string, LiveAircraft>();
  for (const set of sets) {
    for (const aircraft of set) {
      const current = merged.get(aircraft.icao24);
      if (!current) {
        merged.set(aircraft.icao24, aircraft);
        continue;
      }
      const newer = aircraft.lastContact >= current.lastContact ? aircraft : current;
      const older = newer === aircraft ? current : aircraft;
      merged.set(aircraft.icao24, {
        ...older,
        ...newer,
        military: Boolean(current.military || aircraft.military),
        pia: Boolean(current.pia || aircraft.pia),
        ladd: Boolean(current.ladd || aircraft.ladd),
        interesting: Boolean(current.interesting || aircraft.interesting),
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.lastContact - a.lastContact);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} MIN`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}H ${minutes}M`;
}

function trailDistanceNm(points: TrailPoint[]): number {
  let total = 0;
  const earthRadiusNm = 3440.065;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const lat1 = previous.lat * Math.PI / 180;
    const lat2 = current.lat * Math.PI / 180;
    const dLat = (current.lat - previous.lat) * Math.PI / 180;
    const dLon = (current.lon - previous.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    total += earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }
  return total;
}

function displayCoordinate(aircraft: LiveAircraft, now = Date.now()): { lon: number; lat: number; smoothed: boolean; seconds: number } {
  if (aircraft.onGround || aircraft.speedKt < 25 || !Number.isFinite(aircraft.heading)) {
    return { lon: aircraft.lon, lat: aircraft.lat, smoothed: false, seconds: 0 };
  }
  const ageSeconds = Math.min(DISPLAY_DEAD_RECKON_MAX_S, Math.max(0, (now - aircraft.lastContact) / 1000));
  if (ageSeconds < 1) return { lon: aircraft.lon, lat: aircraft.lat, smoothed: false, seconds: 0 };

  const distanceNm = aircraft.speedKt * ageSeconds / 3600;
  const angularDistance = distanceNm / 3440.065;
  const bearing = aircraft.heading * Math.PI / 180;
  const lat1 = aircraft.lat * Math.PI / 180;
  const lon1 = aircraft.lon * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  const lon = ((lon2 * 180 / Math.PI + 540) % 360) - 180;
  return { lon, lat: lat2 * 180 / Math.PI, smoothed: true, seconds: ageSeconds };
}

function detailCell(label: string, value: string): string {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export class AirOperationsPanel extends Panel {
  private map: maplibregl.Map | null = null;
  private aircraft: LiveAircraft[] = [];
  private selected: LiveAircraft | null = null;
  private filter: AirFilter = 'all';
  private scope: AirScope = 'auto';
  private query = '';
  private sourceFilters = new Set<AircraftSourceType>();
  private databaseFilters = new Set<DatabaseFilter>();
  private minimumAltitude: number | null = null;
  private maximumAltitude: number | null = null;
  private loading = false;
  private refreshTimer: number | null = null;
  private displayTimer: number | null = null;
  private fetchController: AbortController | null = null;
  private notes: NoteStore = loadNotes();
  private resizeObserver: ResizeObserver | null = null;
  private openHandler: EventListener | null = null;
  private availabilityHandler: EventListener | null = null;
  private lastSuccessfulProviderLabel = 'ADSB.LOL';
  private intelCollapsed = false;
  private contactsCollapsed = false;
  private filtersExpanded = false;
  private followSelected = false;
  private trailVisible = true;
  private trails: TrailStore = new Map();
  private selectedAnchor: maplibregl.Marker | null = null;

  constructor() {
    super({
      id: 'air-operations',
      title: 'AIR OPERATIONS MAP',
      showCount: true,
      className: 'v-air-operations-panel panel-wide',
      infoTooltip: 'Project V-native aircraft workspace. Worldwide strategic aircraft, regional live traffic, source filters, selected-aircraft targeting, locally observed history, display smoothing, notes, Assistant handoff, and Case Desk handoff.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '6';
    element.dataset.moduleMinW = '5';
    element.dataset.moduleMinH = '4';
    element.dataset.moduleCategory = 'maps';
    this.renderShell();
    window.setTimeout(() => this.ensureMap(), 0);
    this.openHandler = () => {
      window.setTimeout(() => {
        this.ensureMap();
        this.map?.resize();
        void this.refresh(true);
      }, 120);
    };
    window.addEventListener('project-v-air-operations-visible', this.openHandler);
    this.availabilityHandler = ((event: Event) => {
      const detail = (event as CustomEvent<{ panelId?: string; visible?: boolean }>).detail;
      if (detail?.panelId !== 'air-operations' || detail.visible !== true) return;
      this.openHandler?.(event);
    }) as EventListener;
    window.addEventListener('project-v-panel-availability-change', this.availabilityHandler);
  }

  private renderShell(): void {
    this.content.innerHTML = `
      <div class="v-air-ops-shell">
        <aside class="v-air-ops-intel" data-air-intel>
          <button type="button" class="v-air-ops-panel-collapse v-air-ops-intel-collapse" data-action="collapse-intel" title="Collapse selected aircraft panel">◀</button>
          <div class="v-air-ops-intel-body">
            <div class="v-air-ops-intel-head">
              <span class="v-air-ops-kicker">PROJECT V // SELECTED AIRCRAFT</span>
              <strong>AIRCRAFT INTELLIGENCE</strong>
              <small>SCROLL FOR IDENTITY, SPATIAL, AIR DATA, NAVIGATION, SIGNAL, HISTORY, AND ACTIONS</small>
            </div>
            <div class="v-air-ops-inspector empty" data-air-inspector>SELECT AN AIRCRAFT ON THE MAP OR CONTACT LIST</div>
          </div>
        </aside>
        <section class="v-air-ops-map-wrap">
          <div class="v-air-ops-map" data-air-ops-map></div>
          <div class="v-air-ops-toolbar">
            <button type="button" data-filter="all" class="active">ALL</button>
            <button type="button" data-filter="airborne">AIRBORNE</button>
            <button type="button" data-filter="emergency">EMERGENCY</button>
            <button type="button" data-filter="watched">WATCHED</button>
            <select data-air-scope aria-label="Air Operations coverage mode">
              <option value="auto">AUTO · PROGRESSIVE</option>
              <option value="world">WORLD · SPECIAL TRAFFIC</option>
              <option value="region">REGIONAL · LIVE TRAFFIC</option>
            </select>
            <input type="search" data-air-search placeholder="CALLSIGN / HEX / REGISTRATION / TYPE" autocomplete="off">
            <button type="button" data-action="filters">FILTERS</button>
            <button type="button" data-action="refresh">REFRESH</button>
            <button type="button" data-action="zoom-out" title="Zoom map out one level">MAP −</button>
            <button type="button" data-action="zoom-in" title="Zoom map in one level">MAP +</button>
            <button type="button" data-action="world-view" title="Return Air Operations map to the world view">WORLD VIEW</button>
            <button type="button" data-action="external">ADSB GLOBAL</button>
            <button type="button" data-action="return">RETURN TO DECK</button>
            <span class="v-air-ops-status" data-air-status>STANDBY</span>
          </div>
        </section>
        <aside class="v-air-ops-contacts" data-air-contacts>
          <button type="button" class="v-air-ops-panel-collapse v-air-ops-contacts-collapse" data-action="collapse-contacts" title="Collapse contacts panel">▶</button>
          <div class="v-air-ops-contacts-body">
            <div class="v-air-ops-side-head">
              <span class="v-air-ops-kicker">PROJECT V // AIR OPERATIONS 2.1.2</span>
              <strong data-air-count>0 CONTACTS</strong>
              <small data-air-source>WORLD SPECIAL TRAFFIC + REGIONAL LIVE ADS-B</small>
            </div>
            <section class="v-air-ops-filter-panel" data-air-filter-panel hidden>
              <div class="v-air-ops-filter-title"><strong>TRANSPONDER / POSITION SOURCE</strong><small>NO SELECTION = ALL SOURCES</small></div>
              <div class="v-air-ops-chip-grid">
                ${Object.entries(SOURCE_LABELS).map(([key, label]) => `<button type="button" data-source-filter="${key}">${label}</button>`).join('')}
              </div>
              <div class="v-air-ops-filter-title"><strong>DATABASE FLAGS</strong><small>MATCH ANY SELECTED FLAG</small></div>
              <div class="v-air-ops-chip-grid flags">
                <button type="button" data-db-filter="military">MILITARY</button>
                <button type="button" data-db-filter="pia">PIA</button>
                <button type="button" data-db-filter="ladd">LADD</button>
                <button type="button" data-db-filter="interesting">INTERESTING</button>
              </div>
              <div class="v-air-ops-altitude-filter">
                <label>MIN ALT FT<input type="number" data-alt-min step="500" placeholder="ANY"></label>
                <label>MAX ALT FT<input type="number" data-alt-max step="500" placeholder="ANY"></label>
                <button type="button" data-action="reset-filters">RESET</button>
              </div>
            </section>
            <div class="v-air-ops-aircraft-list" data-air-list></div>
          </div>
        </aside>
        <section class="v-air-ops-notes">
          <textarea data-air-note placeholder="ANALYST NOTES — select an aircraft to bind this note to its ICAO address" disabled></textarea>
          <div class="v-air-ops-note-actions">
            <button type="button" data-action="save-note" disabled>SAVE NOTE</button>
            <button type="button" data-action="clear-note" disabled>CLEAR</button>
          </div>
        </section>
      </div>
    `;

    this.content.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.filter as AirFilter | undefined;
        if (!next) return;
        this.filter = next;
        this.content.querySelectorAll('[data-filter]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
        this.renderAircraft();
      });
    });
    this.content.querySelector<HTMLSelectElement>('[data-air-scope]')?.addEventListener('change', (event) => {
      this.scope = (event.currentTarget as HTMLSelectElement).value as AirScope;
      if (this.scope === 'region' && this.map && this.map.getZoom() < REGIONAL_MIN_ZOOM) {
        this.map.easeTo({ zoom: 4.5, duration: 450 });
      }
      void this.refresh(true);
    });
    this.content.querySelector<HTMLInputElement>('[data-air-search]')?.addEventListener('input', (event) => {
      this.query = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
      this.renderAircraft();
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-source-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.sourceFilter as AircraftSourceType | undefined;
        if (!key) return;
        if (this.sourceFilters.has(key)) this.sourceFilters.delete(key); else this.sourceFilters.add(key);
        this.updateFilterButtons();
        this.renderAircraft();
      });
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-db-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.dbFilter as DatabaseFilter | undefined;
        if (!key) return;
        if (this.databaseFilters.has(key)) this.databaseFilters.delete(key); else this.databaseFilters.add(key);
        this.updateFilterButtons();
        this.renderAircraft();
      });
    });
    this.content.querySelector<HTMLInputElement>('[data-alt-min]')?.addEventListener('input', (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      this.minimumAltitude = Number.isFinite(value) && (event.currentTarget as HTMLInputElement).value !== '' ? value : null;
      this.renderAircraft();
    });
    this.content.querySelector<HTMLInputElement>('[data-alt-max]')?.addEventListener('input', (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      this.maximumAltitude = Number.isFinite(value) && (event.currentTarget as HTMLInputElement).value !== '' ? value : null;
      this.renderAircraft();
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="filters"]')?.addEventListener('click', () => this.toggleFilters());
    this.content.querySelector<HTMLButtonElement>('[data-action="reset-filters"]')?.addEventListener('click', () => this.resetAdvancedFilters());
    this.content.querySelector<HTMLButtonElement>('[data-action="collapse-intel"]')?.addEventListener('click', () => this.toggleIntelPanel());
    this.content.querySelector<HTMLButtonElement>('[data-action="collapse-contacts"]')?.addEventListener('click', () => this.toggleContactsPanel());
    this.content.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => void this.refresh(true));
    this.content.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')?.addEventListener('click', () => this.zoomMap(-1));
    this.content.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')?.addEventListener('click', () => this.zoomMap(1));
    this.content.querySelector<HTMLButtonElement>('[data-action="world-view"]')?.addEventListener('click', () => this.resetMapView());
    this.content.querySelector<HTMLButtonElement>('[data-action="external"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('project-v-map2-open-airspace'));
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="return"]')?.addEventListener('click', () => {
      window.dispatchEvent(new Event('project-v-air-operations-close'));
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="save-note"]')?.addEventListener('click', () => this.persistCurrentNote());
    this.content.querySelector<HTMLButtonElement>('[data-action="clear-note"]')?.addEventListener('click', () => this.clearCurrentNote());
  }

  private toggleFilters(): void {
    this.filtersExpanded = !this.filtersExpanded;
    const panel = this.content.querySelector<HTMLElement>('[data-air-filter-panel]');
    const button = this.content.querySelector<HTMLButtonElement>('[data-action="filters"]');
    if (panel) panel.hidden = !this.filtersExpanded;
    button?.classList.toggle('active', this.filtersExpanded);
  }

  private toggleIntelPanel(): void {
    this.intelCollapsed = !this.intelCollapsed;
    const shell = this.content.querySelector<HTMLElement>('.v-air-ops-shell');
    const button = this.content.querySelector<HTMLButtonElement>('[data-action="collapse-intel"]');
    shell?.classList.toggle('intel-collapsed', this.intelCollapsed);
    if (button) {
      button.textContent = this.intelCollapsed ? '▶' : '◀';
      button.title = this.intelCollapsed ? 'Open selected aircraft panel' : 'Collapse selected aircraft panel';
    }
    window.setTimeout(() => this.map?.resize(), 180);
  }

  private toggleContactsPanel(): void {
    this.contactsCollapsed = !this.contactsCollapsed;
    const shell = this.content.querySelector<HTMLElement>('.v-air-ops-shell');
    const button = this.content.querySelector<HTMLButtonElement>('[data-action="collapse-contacts"]');
    shell?.classList.toggle('contacts-collapsed', this.contactsCollapsed);
    if (button) {
      button.textContent = this.contactsCollapsed ? '◀' : '▶';
      button.title = this.contactsCollapsed ? 'Open contacts panel' : 'Collapse contacts panel';
    }
    window.setTimeout(() => this.map?.resize(), 180);
  }

  private resetAdvancedFilters(): void {
    this.sourceFilters.clear();
    this.databaseFilters.clear();
    this.minimumAltitude = null;
    this.maximumAltitude = null;
    const min = this.content.querySelector<HTMLInputElement>('[data-alt-min]');
    const max = this.content.querySelector<HTMLInputElement>('[data-alt-max]');
    if (min) min.value = '';
    if (max) max.value = '';
    this.updateFilterButtons();
    this.renderAircraft();
  }

  private zoomMap(delta: number): void {
    const map = this.map;
    if (!map) return;
    const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
    map.easeTo({ zoom: nextZoom, duration: 220 });
  }

  private resetMapView(): void {
    const map = this.map;
    if (!map) return;
    this.followSelected = false;
    map.easeTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, bearing: 0, pitch: 0, duration: 450 });
    this.setStatus(this.aircraft.length ? `${this.aircraft.length} CONTACTS · WORLD VIEW` : 'WORLD VIEW');
    this.renderInspector();
  }

  private updateSelectedAnchor(): void {
    const map = this.map;
    const aircraft = this.selected;
    if (!map || !aircraft) {
      this.selectedAnchor?.remove();
      this.selectedAnchor = null;
      return;
    }
    const position = displayCoordinate(aircraft);
    if (!this.selectedAnchor) {
      const element = document.createElement('div');
      element.className = 'v-air-ops-selected-anchor';
      element.title = 'Selected aircraft position';
      this.selectedAnchor = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([position.lon, position.lat])
        .addTo(map);
    } else {
      this.selectedAnchor.setLngLat([position.lon, position.lat]);
    }
  }

  private updateFilterButtons(): void {
    this.content.querySelectorAll<HTMLButtonElement>('[data-source-filter]').forEach((button) => {
      button.classList.toggle('active', this.sourceFilters.has(button.dataset.sourceFilter as AircraftSourceType));
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-db-filter]').forEach((button) => {
      button.classList.toggle('active', this.databaseFilters.has(button.dataset.dbFilter as DatabaseFilter));
    });
  }

  private ensureMap(): void {
    if (this.map) return;
    const container = this.content.querySelector<HTMLElement>('[data-air-ops-map]');
    if (!container || !container.isConnected) return;
    try {
      this.map = new maplibregl.Map({
        container,
        style: STYLE_URL,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        minZoom: 1.35,
        maxZoom: 13,
        attributionControl: false,
      });
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      this.map.scrollZoom.enable();
      this.map.dragPan.enable();
      this.map.doubleClickZoom.enable();
      this.map.touchZoomRotate.enable();
      container.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
      this.map.on('load', () => {
        this.setupMapLayers();
        this.renderAircraft();
        void this.refresh(true);
      });
      this.map.on('moveend', () => void this.refresh(false));
      this.resizeObserver = new ResizeObserver(() => this.map?.resize());
      this.resizeObserver.observe(container);
      this.refreshTimer = window.setInterval(() => void this.refresh(false), REFRESH_MS);
      this.displayTimer = window.setInterval(() => {
        if (!this.map || this.map.getZoom() < 5 || this.getElement().classList.contains('hidden')) return;
        const visible = this.visibleAircraft();
        this.updateAircraftMap(visible);
        if (this.followSelected && this.selected) {
          const position = displayCoordinate(this.selected);
          this.map.jumpTo({ center: [position.lon, position.lat] });
        }
      }, DISPLAY_TICK_MS);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to initialize Air Operations map.', 'error');
    }
  }

  private setupMapLayers(): void {
    const map = this.map;
    if (!map || map.getSource(AIRCRAFT_SOURCE_ID)) return;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 64, 64);
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.moveTo(32, 3);
      context.lineTo(37.5, 24);
      context.lineTo(58, 32);
      context.lineTo(58, 38);
      context.lineTo(38.5, 35);
      context.lineTo(36, 52);
      context.lineTo(44, 58);
      context.lineTo(44, 62);
      context.lineTo(32, 58);
      context.lineTo(20, 62);
      context.lineTo(20, 58);
      context.lineTo(28, 52);
      context.lineTo(25.5, 35);
      context.lineTo(6, 38);
      context.lineTo(6, 32);
      context.lineTo(26.5, 24);
      context.closePath();
      context.fill();
      const image = context.getImageData(0, 0, 64, 64);
      if (!map.hasImage('v-aircraft-plane')) map.addImage('v-aircraft-plane', image, { sdf: true });
    }

    map.addSource(AIRCRAFT_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 5,
      clusterRadius: 42,
    });
    map.addLayer({
      id: 'v-air-ops-clusters',
      type: 'circle',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#082536',
        'circle-stroke-color': '#46b9ed',
        'circle-stroke-width': 1.2,
        'circle-radius': ['step', ['get', 'point_count'], 14, 30, 18, 100, 23, 500, 28],
        'circle-opacity': 0.9,
      },
    });
    map.addLayer({
      id: 'v-air-ops-cluster-count',
      type: 'symbol',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#dff6ff' },
    });
    map.addLayer({
      id: 'v-air-ops-watched-halo',
      type: 'circle',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'watched'], 1]],
      paint: {
        'circle-radius': 13,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#62f09a',
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'v-air-ops-emergency-halo',
      type: 'circle',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'emergency'], 1]],
      paint: {
        'circle-radius': 15,
        'circle-color': 'rgba(255,79,99,.08)',
        'circle-stroke-color': '#ff4f63',
        'circle-stroke-width': 2.4,
      },
    });
    map.addLayer({
      id: 'v-air-ops-selected-ring',
      type: 'circle',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'selected'], 1]],
      paint: {
        'circle-radius': 18,
        'circle-color': 'rgba(64, 196, 255, .08)',
        'circle-stroke-color': '#e8fbff',
        'circle-stroke-width': 2.6,
        'circle-blur': 0.08,
      },
    });
    map.addLayer({
      id: 'v-air-ops-aircraft-symbol',
      type: 'symbol',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': 'v-aircraft-plane',
        'icon-size': ['case', ['==', ['get', 'selected'], 1], 0.48, 0.36],
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-halo-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', '#061018'],
        'icon-halo-width': ['case', ['==', ['get', 'selected'], 1], 2.1, 0.8],
      },
    });


    map.addLayer({
      id: 'v-air-ops-aircraft-label',
      type: 'symbol',
      source: AIRCRAFT_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'selected'], 1]],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, -2.2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#f3fcff',
        'text-halo-color': '#031019',
        'text-halo-width': 2,
      },
    });

    map.addSource(TRAIL_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'v-air-ops-selected-trail',
      type: 'line',
      source: TRAIL_SOURCE_ID,
      paint: {
        'line-color': '#63d5ff',
        'line-width': 2.2,
        'line-opacity': 0.85,
      },
    });

    const selectMapAircraft = (event: any) => {
      const icao24 = String(event.features?.[0]?.properties?.icao24 ?? '');
      if (icao24) this.selectAircraft(icao24, false);
    };
    map.on('click', 'v-air-ops-aircraft-symbol', selectMapAircraft);
    map.on('click', 'v-air-ops-aircraft-label', selectMapAircraft);
    map.on('click', 'v-air-ops-clusters', (event: any) => {
      const coordinates = event.features?.[0]?.geometry?.coordinates;
      if (!Array.isArray(coordinates)) return;
      map.easeTo({ center: coordinates as [number, number], zoom: Math.min(map.getZoom() + 2.2, 7), duration: 450 });
    });
    for (const layer of ['v-air-ops-aircraft-symbol', 'v-air-ops-aircraft-label', 'v-air-ops-clusters']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
  }

  private setStatus(text: string, state: 'normal' | 'loading' | 'degraded' | 'error' = 'normal'): void {
    const status = this.content.querySelector<HTMLElement>('[data-air-status]');
    if (!status) return;
    status.textContent = text.toUpperCase();
    status.classList.toggle('loading', state === 'loading');
    status.classList.toggle('error', state === 'error');
    status.classList.toggle('degraded', state === 'degraded');
  }

  private async refresh(force: boolean): Promise<void> {
    if (!this.map || this.loading) return;
    if (!this.getElement().isConnected || this.getElement().classList.contains('hidden')) return;

    const zoom = this.map.getZoom();
    const wantWorld = this.scope === 'world' || (this.scope === 'auto' && zoom < REGIONAL_MIN_ZOOM);
    const wantRegional = this.scope === 'region' || (this.scope === 'auto' && zoom >= REGIONAL_MIN_ZOOM);
    if (this.scope === 'region' && zoom < REGIONAL_MIN_ZOOM) {
      this.setStatus(`REGIONAL MODE · ZOOM IN ≥ ${REGIONAL_MIN_ZOOM.toFixed(1)}`);
      return;
    }

    this.loading = true;
    this.fetchController?.abort();
    this.fetchController = new AbortController();
    this.setStatus(wantRegional ? 'LOADING AIR TRAFFIC' : 'LOADING WORLD SPECIAL TRAFFIC', 'loading');

    const results: LiveAircraft[][] = [];
    const labels: string[] = [];
    const errors: string[] = [];
    let requestCount = 0;
    let worldCount = 0;
    let regionalCount = 0;

    try {
      if (wantWorld) {
        try {
          const world = await fetchGlobalStrategicAircraft(this.fetchController.signal, force);
          results.push(world.aircraft);
          worldCount = world.aircraft.length;
          requestCount += world.requestCount;
          labels.push(world.providerLabel);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          errors.push(error instanceof Error ? error.message : 'Worldwide special-aircraft feed unavailable.');
        }
      }

      if (wantRegional) {
        const bounds = this.map.getBounds();
        const west = Math.max(-180, bounds.getWest());
        const east = Math.min(180, bounds.getEast());
        if (east > west) {
          try {
            const regional = await fetchVisibleAircraft({
              south: Math.max(-90, bounds.getSouth()),
              west,
              north: Math.min(90, bounds.getNorth()),
              east,
            }, this.fetchController.signal, 'auto');
            results.push(regional.aircraft);
            regionalCount = regional.aircraft.length;
            requestCount += regional.requestCount;
            labels.push(regional.providerLabel);
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            errors.push(error instanceof Error ? error.message : 'Regional aircraft feed unavailable.');
          }
        }
      }

      if (results.length === 0) throw new Error(errors.join(' · ') || 'Aircraft providers unavailable.');

      const merged = mergeAircraft(...results).slice(0, AIRCRAFT_LIMIT);
      this.aircraft = merged;
      this.recordTrails(merged);
      this.lastSuccessfulProviderLabel = labels.filter(Boolean).join(' + ') || this.lastSuccessfulProviderLabel;
      this.setCount(this.aircraft.length);
      this.setDataBadge(errors.length ? 'cached' : 'live', `${this.aircraft.length} AIR`);
      const source = this.content.querySelector<HTMLElement>('[data-air-source]');
      if (source) {
        const coverage = wantRegional
          ? `${regionalCount.toLocaleString()} REGIONAL LIVE`
          : `${worldCount.toLocaleString()} WORLD SPECIAL`;
        source.textContent = `${coverage} · ${requestCount} QUERY${requestCount === 1 ? '' : 'IES'} · 45S FEED · ≤20S DISPLAY SMOOTHING${errors.length ? ` · DEGRADED: ${errors.join(' · ')}` : ''}`;
      }
      this.setStatus(errors.length ? `${merged.length} CONTACTS · DEGRADED / LAST-KNOWN` : `${merged.length} CONTACTS`, errors.length ? 'degraded' : 'normal');
      if (this.selected) this.selected = this.aircraft.find((item) => item.icao24 === this.selected?.icao24) ?? this.selected;
      if (this.followSelected && this.selected) {
        this.map.easeTo({ center: [this.selected.lon, this.selected.lat], duration: 350 });
      }
      this.renderAircraft();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Aircraft provider unavailable.';
      const rateLimited = /429|rate limit/i.test(message);
      const source = this.content.querySelector<HTMLElement>('[data-air-source]');
      if (this.aircraft.length > 0) {
        this.setDataBadge('cached', `${this.aircraft.length} LAST KNOWN`);
        this.setStatus(rateLimited ? 'ADSB CACHED · RETRYING AUTOMATICALLY' : 'LIVE DATA DEGRADED · RETAINING LAST CONTACTS', 'degraded');
        if (source) source.textContent = `${this.lastSuccessfulProviderLabel} LAST SUCCESSFUL SET · ${message}`;
        this.renderAircraft();
        this.updateSelectedAnchor();
      } else {
        this.setDataBadge('unavailable', 'LIVE AIR');
        this.setStatus(message, 'error');
        if (source) source.textContent = `LIVE FEED UNAVAILABLE · ${message}`;
      }
    } finally {
      this.loading = false;
    }
  }

  private recordTrails(aircraft: LiveAircraft[]): void {
    const now = Date.now();
    for (const item of aircraft) {
      const entry = this.trails.get(item.icao24) ?? { points: [], lastSeen: now };
      const last = entry.points[entry.points.length - 1];
      if (!last || Math.abs(last.lon - item.lon) > 0.00005 || Math.abs(last.lat - item.lat) > 0.00005) {
        entry.points.push({ lon: item.lon, lat: item.lat, at: item.lastContact });
        if (entry.points.length > TRAIL_MAX_POINTS) entry.points.splice(0, entry.points.length - TRAIL_MAX_POINTS);
      }
      entry.lastSeen = now;
      this.trails.set(item.icao24, entry);
    }
    const cutoff = now - TRAIL_RETENTION_MS;
    const watched = getAircraftWatchlist();
    for (const [icao24, entry] of this.trails) {
      if (entry.lastSeen < cutoff && !watched.has(icao24) && this.selected?.icao24 !== icao24) this.trails.delete(icao24);
    }
    this.updateSelectedTrail();
  }

  private visibleAircraft(): LiveAircraft[] {
    const watched = getAircraftWatchlist();
    return this.aircraft.filter((aircraft) => {
      if (this.filter === 'airborne' && aircraft.onGround) return false;
      if (this.filter === 'emergency' && !isEmergency(aircraft)) return false;
      if (this.filter === 'watched' && !watched.has(aircraft.icao24)) return false;
      if (this.sourceFilters.size > 0 && !this.sourceFilters.has(aircraft.sourceType)) return false;
      if (this.databaseFilters.size > 0) {
        const matches = [...this.databaseFilters].some((flag) => Boolean(aircraft[flag]));
        if (!matches) return false;
      }
      if (this.minimumAltitude != null && aircraft.altitudeFt < this.minimumAltitude) return false;
      if (this.maximumAltitude != null && aircraft.altitudeFt > this.maximumAltitude) return false;
      if (!this.query) return true;
      const haystack = `${aircraft.callsign} ${aircraft.icao24} ${aircraft.registration ?? ''} ${aircraft.aircraftType ?? ''} ${aircraft.aircraftDescription ?? ''} ${sourceLabel(aircraft)}`.toLowerCase();
      return haystack.includes(this.query);
    });
  }

  private updateAircraftMap(visible = this.visibleAircraft()): void {
    const map = this.map;
    if (!map) return;
    const watched = getAircraftWatchlist();
    const now = Date.now();
    const source = map.getSource(AIRCRAFT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: visible.map((aircraft) => {
        const display = displayCoordinate(aircraft, now);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [display.lon, display.lat] },
          properties: {
            icao24: aircraft.icao24,
            label: aircraftLabel(aircraft),
            heading: aircraft.heading,
            color: altitudeColor(aircraft),
            selected: this.selected?.icao24 === aircraft.icao24 ? 1 : 0,
            watched: watched.has(aircraft.icao24) ? 1 : 0,
            emergency: isEmergency(aircraft) ? 1 : 0,
            smoothed: display.smoothed ? 1 : 0,
          },
        };
      }),
    } as any);
  }

  private renderAircraft(): void {
    const map = this.map;
    if (!map) return;
    const visible = this.visibleAircraft();
    this.updateAircraftMap(visible);

    const count = this.content.querySelector<HTMLElement>('[data-air-count]');
    if (count) count.textContent = `${visible.length.toLocaleString()} CONTACT${visible.length === 1 ? '' : 'S'}`;
    this.renderList(visible);
    this.renderInspector();
    this.updateSelectedTrail();
    this.updateSelectedAnchor();
  }

  private renderList(visible: LiveAircraft[]): void {
    const list = this.content.querySelector<HTMLElement>('[data-air-list]');
    if (!list) return;
    const sorted = visible.slice().sort((a, b) => {
      if (isEmergency(a) !== isEmergency(b)) return isEmergency(a) ? -1 : 1;
      if (Boolean(a.military) !== Boolean(b.military)) return a.military ? -1 : 1;
      return b.altitudeFt - a.altitudeFt;
    }).slice(0, 240);
    if (!sorted.length) {
      list.innerHTML = '<div class="v-air-ops-list-empty">NO CONTACTS MATCH CURRENT FILTER</div>';
      return;
    }
    list.innerHTML = sorted.map((aircraft) => `
      <button type="button" class="v-air-ops-row${this.selected?.icao24 === aircraft.icao24 ? ' selected' : ''}" data-icao="${escapeHtml(aircraft.icao24)}">
        <span class="identity"><strong>${escapeHtml(aircraftLabel(aircraft))}</strong><small>${escapeHtml(aircraft.registration || aircraft.icao24.toUpperCase())}</small></span>
        <span class="source">${escapeHtml(sourceLabel(aircraft))}</span>
        <span>${fmtNumber(aircraft.altitudeFt, ' FT')}</span>
        <span>${fmtNumber(aircraft.speedKt, ' KT')}</span>
      </button>
    `).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-icao]').forEach((button) => {
      button.addEventListener('click', () => this.selectAircraft(button.dataset.icao ?? '', true));
    });
  }

  private selectAircraft(icao24: string, center: boolean): void {
    const aircraft = this.aircraft.find((item) => item.icao24 === icao24);
    if (!aircraft) return;
    this.selected = aircraft;
    const map = this.map;
    const display = displayCoordinate(aircraft);
    if (center && map) {
      const targetZoom = Math.min(Math.max(map.getZoom(), SELECT_MAP_ZOOM), 6.2);
      map.easeTo({ center: [display.lon, display.lat], zoom: targetZoom, duration: 450 });
    }
    this.renderAircraft();
    this.updateSelectedAnchor();
    window.setTimeout(() => {
      this.content.querySelector<HTMLElement>(`.v-air-ops-row[data-icao="${CSS.escape(aircraft.icao24)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, 0);
    this.loadNoteIntoEditor();
  }

  private updateSelectedTrail(): void {
    const map = this.map;
    if (!map) return;
    const source = map.getSource(TRAIL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const entry = this.selected ? this.trails.get(this.selected.icao24) : undefined;
    const coordinates = this.trailVisible && entry ? entry.points.map((point) => [point.lon, point.lat]) : [];
    source.setData({
      type: 'FeatureCollection',
      features: coordinates.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] : [],
    } as any);
  }

  private renderInspector(): void {
    const inspector = this.content.querySelector<HTMLElement>('[data-air-inspector]');
    if (!inspector) return;
    const aircraft = this.selected;
    if (!aircraft) {
      inspector.className = 'v-air-ops-inspector empty';
      inspector.textContent = 'SELECT AN AIRCRAFT ON THE MAP OR CONTACT LIST';
      this.setNoteEnabled(false);
      return;
    }
    const watched = getAircraftWatchlist().has(aircraft.icao24);
    const flags = [
      aircraft.military ? '<span>MILITARY</span>' : '',
      aircraft.pia ? '<span>PIA</span>' : '',
      aircraft.ladd ? '<span>LADD</span>' : '',
      aircraft.interesting ? '<span>INTERESTING</span>' : '',
    ].filter(Boolean).join('');
    const navModes = aircraft.navModes?.length ? aircraft.navModes.map((mode) => mode.toUpperCase()).join(' · ') : 'N/A';
    const trailEntry = this.trails.get(aircraft.icao24);
    const trailPoints = trailEntry?.points ?? [];
    const trailDurationMs = trailPoints.length >= 2 ? Math.max(0, trailPoints[trailPoints.length - 1]!.at - trailPoints[0]!.at) : 0;
    const trailDistance = trailPoints.length >= 2 ? trailDistanceNm(trailPoints) : 0;
    const reportAgeSeconds = Math.max(0, (Date.now() - aircraft.lastContact) / 1000);
    const display = displayCoordinate(aircraft);
    inspector.className = 'v-air-ops-inspector';
    inspector.innerHTML = `
      <div class="v-air-ops-idline"><strong>${escapeHtml(aircraftLabel(aircraft))}</strong><span>${escapeHtml(aircraft.icao24.toUpperCase())}</span></div>
      <div class="v-air-ops-badges"><span class="source">${escapeHtml(sourceLabel(aircraft))}</span>${flags}</div>
      <details class="v-air-ops-detail" open>
        <summary>IDENTITY</summary>
        <div class="v-air-ops-grid">
          ${detailCell('REGISTRATION', aircraft.registration ?? 'N/A')}
          ${detailCell('TYPE', aircraft.aircraftType ?? 'N/A')}
          ${detailCell('DESCRIPTION', aircraft.aircraftDescription ?? 'N/A')}
          ${detailCell('CATEGORY', aircraft.category == null ? 'N/A' : String(aircraft.category))}
          ${detailCell('COUNTRY', aircraft.originCountry || 'Unknown')}
          ${detailCell('STATUS', isEmergency(aircraft) ? 'EMERGENCY' : aircraft.onGround ? 'GROUND' : 'AIRBORNE')}
        </div>
      </details>
      <details class="v-air-ops-detail" open>
        <summary>SPATIAL</summary>
        <div class="v-air-ops-grid">
          ${detailCell('LATITUDE', aircraft.lat.toFixed(5))}
          ${detailCell('LONGITUDE', aircraft.lon.toFixed(5))}
          ${detailCell('BARO ALTITUDE', fmtNumber(aircraft.altitudeFt, ' FT'))}
          ${detailCell('GEOM ALTITUDE', fmtNumber(aircraft.geoAltitudeFt, ' FT'))}
          ${detailCell('GROUND SPEED', fmtNumber(aircraft.speedKt, ' KT'))}
          ${detailCell('TRACK / HEADING', fmtNumber(aircraft.heading, '°'))}
          ${detailCell('VERTICAL RATE', fmtNumber(aircraft.verticalRateFpm, ' FPM'))}
          ${detailCell('SQUAWK', aircraft.squawk ?? 'N/A')}
          ${detailCell('REPORT AGE', `${reportAgeSeconds.toFixed(0)} S`)}
          ${detailCell('DISPLAY POSITION', display.smoothed ? `SMOOTHED +${display.seconds.toFixed(0)} S` : 'REPORTED')}
        </div>
      </details>
      <details class="v-air-ops-detail">
        <summary>AIR DATA</summary>
        <div class="v-air-ops-grid">
          ${detailCell('IAS', fmtNumber(aircraft.indicatedAirspeedKt, ' KT'))}
          ${detailCell('TAS', fmtNumber(aircraft.trueAirspeedKt, ' KT'))}
          ${detailCell('MACH', fmtDecimal(aircraft.mach, 3))}
          ${detailCell('TRUE HEADING', fmtNumber(aircraft.trueHeading, '°'))}
          ${detailCell('MAG HEADING', fmtNumber(aircraft.magneticHeading, '°'))}
          ${detailCell('TRACK RATE', fmtDecimal(aircraft.trackRateDegS, 2, '°/S'))}
          ${detailCell('ROLL', fmtDecimal(aircraft.rollDeg, 1, '°'))}
          ${detailCell('WIND', aircraft.windDirection == null && aircraft.windSpeedKt == null ? 'N/A' : `${fmtNumber(aircraft.windDirection, '°')} / ${fmtNumber(aircraft.windSpeedKt, ' KT')}`)}
          ${detailCell('OAT', aircraft.oatC == null ? 'N/A' : `${aircraft.oatC.toFixed(0)} °C`)}
          ${detailCell('TAT', aircraft.tatC == null ? 'N/A' : `${aircraft.tatC.toFixed(0)} °C`)}
        </div>
      </details>
      <details class="v-air-ops-detail">
        <summary>FMS / NAVIGATION</summary>
        <div class="v-air-ops-grid">
          ${detailCell('MCP ALTITUDE', fmtNumber(aircraft.navAltitudeMcpFt, ' FT'))}
          ${detailCell('FMS ALTITUDE', fmtNumber(aircraft.navAltitudeFmsFt, ' FT'))}
          ${detailCell('SELECTED HEADING', fmtNumber(aircraft.navHeading, '°'))}
          ${detailCell('QNH', fmtDecimal(aircraft.navQnhHpa, 1, ' HPA'))}
          ${detailCell('NAV MODES', navModes)}
          ${detailCell('ROUTE / HISTORY', trailPoints.length >= 2 ? 'LOCAL HISTORY AVAILABLE · ADSB FOR LONG-RANGE' : 'ADSB DETAIL FOR LONG-RANGE HISTORY')}
        </div>
      </details>
      <details class="v-air-ops-detail">
        <summary>SIGNAL / QUALITY</summary>
        <div class="v-air-ops-grid">
          ${detailCell('SOURCE', sourceLabel(aircraft))}
          ${detailCell('RAW SOURCE', aircraft.sourceRaw ?? 'N/A')}
          ${detailCell('RSSI', fmtDecimal(aircraft.rssiDbfs, 1, ' dBFS'))}
          ${detailCell('MESSAGES', fmtNumber(aircraft.messages))}
          ${detailCell('LAST MESSAGE', aircraft.seenSeconds == null ? 'N/A' : `${aircraft.seenSeconds.toFixed(1)} S AGO`)}
          ${detailCell('LAST POSITION', aircraft.seenPositionSeconds == null ? 'N/A' : `${aircraft.seenPositionSeconds.toFixed(1)} S AGO`)}
          ${detailCell('NIC', fmtNumber(aircraft.nic))}
          ${detailCell('RC', fmtNumber(aircraft.rcMeters, ' M'))}
        </div>
      </details>
      <details class="v-air-ops-detail" data-air-history>
        <summary>LOCAL FLIGHT HISTORY</summary>
        <div class="v-air-ops-grid">
          ${detailCell('OBSERVED POINTS', String(trailPoints.length))}
          ${detailCell('OBSERVED DURATION', trailPoints.length >= 2 ? formatDuration(trailDurationMs) : 'WAITING FOR NEXT REPORT')}
          ${detailCell('OBSERVED DISTANCE', trailPoints.length >= 2 ? `${trailDistance.toFixed(1)} NM` : 'N/A')}
          ${detailCell('FIRST OBSERVED', trailPoints.length ? new Date(trailPoints[0]!.at).toLocaleTimeString() : 'N/A')}
          ${detailCell('LAST OBSERVED', trailPoints.length ? new Date(trailPoints[trailPoints.length - 1]!.at).toLocaleTimeString() : 'N/A')}
          ${detailCell('HISTORY SCOPE', 'LOCAL WATCHTOWER OBSERVATIONS')}
        </div>
      </details>
      <div class="v-air-ops-actions">
        <button type="button" data-action="watch" class="${watched ? 'active' : ''}">${watched ? 'WATCHING' : 'WATCH'}</button>
        <button type="button" data-action="follow" class="${this.followSelected ? 'active' : ''}">${this.followSelected ? 'FOLLOWING' : 'FOLLOW'}</button>
        <button type="button" data-action="locate">LOCATE</button>
        <button type="button" data-action="trail" class="${this.trailVisible ? 'active' : ''}">${this.trailVisible ? 'TRAIL ON' : 'TRAIL OFF'}</button>
        <button type="button" data-action="history">HISTORY</button>
        <button type="button" data-action="adsb-detail">ADSB DETAIL</button>
        <button type="button" data-action="main-map">MAIN MAP</button>
        <button type="button" data-action="assistant">SEND TO AI</button>
        <button type="button" data-action="phoenix">SEND TO PHOENIX</button>
        <button type="button" data-action="case">ADD TO CASE</button>
      </div>
      <div class="v-air-ops-trail-note">${trailPoints.length >= 2
        ? `LOCAL TRAIL: ${trailPoints.length} OBSERVED POINTS · ${formatDuration(trailDurationMs)} · ${trailDistance.toFixed(1)} NM. Display smoothing never writes estimated positions into this trail.`
        : `TRAIL WAITING: ${trailPoints.length} OBSERVED POINT${trailPoints.length === 1 ? '' : 'S'}. A line appears after Watchtower receives a second distinct position. ADSB DETAIL remains the long-range history fallback.`}</div>
    `;
    inspector.querySelector<HTMLButtonElement>('[data-action="watch"]')?.addEventListener('click', () => {
      setAircraftWatched(aircraft.icao24, !watched);
      this.renderAircraft();
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="follow"]')?.addEventListener('click', () => {
      this.followSelected = !this.followSelected;
      const position = displayCoordinate(aircraft);
      if (this.followSelected && this.map) this.map.easeTo({ center: [position.lon, position.lat], zoom: Math.min(Math.max(this.map.getZoom(), SELECT_MAP_ZOOM), 6.2), duration: 350 });
      this.renderInspector();
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="locate"]')?.addEventListener('click', () => {
      const position = displayCoordinate(aircraft);
      this.map?.easeTo({ center: [position.lon, position.lat], zoom: LOCATE_MAP_ZOOM, duration: 420 });
      this.updateSelectedAnchor();
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="history"]')?.addEventListener('click', () => {
      const history = inspector.querySelector<HTMLDetailsElement>('[data-air-history]');
      if (!history) return;
      history.open = true;
      history.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="trail"]')?.addEventListener('click', () => {
      this.trailVisible = !this.trailVisible;
      this.updateSelectedTrail();
      this.renderInspector();
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="adsb-detail"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('project-v-map2-open-airspace', { detail: { icao24: aircraft.icao24 } }));
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="main-map"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('project-v-map2-focus', { detail: { lat: aircraft.lat, lon: aircraft.lon, zoom: 7, icao24: aircraft.icao24 } }));
      window.dispatchEvent(new Event('project-v-air-operations-close'));
      document.querySelector<HTMLElement>('[data-panel="map"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="assistant"]')?.addEventListener('click', () => {
      const note = this.notes[aircraft.icao24]?.text?.trim();
      const prompt = `Analyze this live aircraft observation from Project V Air Operations. ${aircraftSummary(aircraft)}.${note ? ` Analyst note: ${note}` : ''} Identify what can be established from the supplied data, what remains unknown, and useful follow-up checks. Do not infer sensitive identity or intent without evidence.`;
      void sendPromptToAssistant(prompt, 'workspace', false);
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="phoenix"]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const note = this.notes[aircraft.icao24]?.text?.trim();
      const label = aircraft.callsign?.trim() || aircraft.registration?.trim() || aircraft.icao24.toUpperCase();
      const summary = `${aircraftSummary(aircraft)}.${note ? ` Analyst note: ${note}` : ''}`;
      const original = button.textContent || 'SEND TO PHOENIX';
      button.disabled = true;
      button.textContent = 'SENDING…';
      void sendPhoenixIntelligenceAlert({
        id: `air-ops:${aircraft.icao24}:${Math.floor(Date.now() / 30000)}`,
        title: `Air Operations · ${label}`,
        severity: 'info',
        summary,
        timestamp: new Date().toISOString(),
        source: 'Project V Watchtower · Air Operations',
        location: `${aircraft.lat.toFixed(4)}, ${aircraft.lon.toFixed(4)}`,
      }).then((result) => {
        button.textContent = result.ok ? 'SENT' : 'FAILED';
        if (!result.ok) window.alert(result.message);
      }).catch((error: unknown) => {
        button.textContent = 'FAILED';
        window.alert(error instanceof Error ? error.message : 'Unable to send aircraft context to Phoenix.');
      }).finally(() => {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = original;
        }, 1600);
      });
    });
    inspector.querySelector<HTMLButtonElement>('[data-action="case"]')?.addEventListener('click', () => {
      const note = this.notes[aircraft.icao24]?.text?.trim();
      void sendToCaseDesk({
        type: 'event',
        title: `Aircraft ${aircraftLabel(aircraft)}`,
        detail: `${aircraftSummary(aircraft)}${note ? `\n\nAnalyst note: ${note}` : ''}`,
        confidence: 'analyst',
        source: aircraft.provider === 'adsb-lol' ? 'ADSB.lol via Project V Air Operations' : 'OpenSky via Project V Air Operations',
        occurredAt: aircraft.lastContact,
        metadata: {
          icao24: aircraft.icao24,
          callsign: aircraft.callsign,
          registration: aircraft.registration ?? '',
          aircraftType: aircraft.aircraftType ?? '',
          sourceType: sourceLabel(aircraft),
          military: String(Boolean(aircraft.military)),
          pia: String(Boolean(aircraft.pia)),
          ladd: String(Boolean(aircraft.ladd)),
          latitude: aircraft.lat.toFixed(6),
          longitude: aircraft.lon.toFixed(6),
          altitudeFt: String(aircraft.altitudeFt),
          speedKt: String(aircraft.speedKt),
          heading: String(Math.round(aircraft.heading)),
          squawk: aircraft.squawk ?? '',
        },
      });
    });
    this.setNoteEnabled(true);
  }

  private setNoteEnabled(enabled: boolean): void {
    const textarea = this.content.querySelector<HTMLTextAreaElement>('[data-air-note]');
    const save = this.content.querySelector<HTMLButtonElement>('[data-action="save-note"]');
    const clear = this.content.querySelector<HTMLButtonElement>('[data-action="clear-note"]');
    if (textarea) textarea.disabled = !enabled;
    if (save) save.disabled = !enabled;
    if (clear) clear.disabled = !enabled;
  }

  private loadNoteIntoEditor(): void {
    const textarea = this.content.querySelector<HTMLTextAreaElement>('[data-air-note]');
    if (!textarea || !this.selected) return;
    textarea.value = this.notes[this.selected.icao24]?.text ?? '';
    this.setNoteEnabled(true);
  }

  private persistCurrentNote(): void {
    const aircraft = this.selected;
    const textarea = this.content.querySelector<HTMLTextAreaElement>('[data-air-note]');
    if (!aircraft || !textarea) return;
    const text = textarea.value.trim().slice(0, 12_000);
    if (text) this.notes[aircraft.icao24] = { text, updatedAt: Date.now() };
    else delete this.notes[aircraft.icao24];
    saveNotes(this.notes);
    this.setStatus(text ? `NOTE SAVED · ${aircraft.icao24.toUpperCase()}` : 'NOTE CLEARED');
  }

  private clearCurrentNote(): void {
    if (!this.selected) return;
    delete this.notes[this.selected.icao24];
    saveNotes(this.notes);
    const textarea = this.content.querySelector<HTMLTextAreaElement>('[data-air-note]');
    if (textarea) textarea.value = '';
    this.setStatus(`NOTE CLEARED · ${this.selected.icao24.toUpperCase()}`);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.displayTimer !== null) window.clearInterval(this.displayTimer);
    this.displayTimer = null;
    this.fetchController?.abort();
    this.fetchController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.selectedAnchor?.remove();
    this.selectedAnchor = null;
    this.map?.remove();
    this.map = null;
    this.trails.clear();
    if (this.openHandler) window.removeEventListener('project-v-air-operations-visible', this.openHandler);
    this.openHandler = null;
    if (this.availabilityHandler) window.removeEventListener('project-v-panel-availability-change', this.availabilityHandler);
    this.availabilityHandler = null;
    super.destroy();
  }
}
