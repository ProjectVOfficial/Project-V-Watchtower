import '@/styles/weather-operations.css';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import {
  fetchTropicalOperations,
  type TropicalOperationsData,
  type TropicalOutlookArea,
  type TropicalStormSummary,
} from '@/services/tropical-operations';
import { escapeHtml } from '@/utils/sanitize';

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const NOTES_KEY = 'project-v-tropical-operations-notes-v1';
const REFRESH_MS = 15 * 60_000;

const SOURCE = {
  outlookRegions: 'v-tropical-outlook-regions',
  outlookPoints: 'v-tropical-outlook-points',
  cone: 'v-tropical-cone',
  forecastTrack: 'v-tropical-forecast-track',
  forecastPoints: 'v-tropical-forecast-points',
  pastTrack: 'v-tropical-past-track',
  pastPoints: 'v-tropical-past-points',
  windRadii: 'v-tropical-wind-radii',
  windField: 'v-tropical-wind-field',
  watchWarning: 'v-tropical-watch-warning',
} as const;

const LAYER = {
  outlookFill: 'v-tropical-outlook-fill',
  outlookLine: 'v-tropical-outlook-line',
  outlookPoint: 'v-tropical-outlook-point',
  outlookLabel: 'v-tropical-outlook-label',
  coneFill: 'v-tropical-cone-fill',
  coneLine: 'v-tropical-cone-line',
  forecastTrack: 'v-tropical-forecast-track-line',
  forecastPoint: 'v-tropical-forecast-point',
  forecastLabel: 'v-tropical-forecast-label',
  pastTrack: 'v-tropical-past-track-line',
  pastPoint: 'v-tropical-past-point',
  windRadii: 'v-tropical-wind-radii-fill',
  windField: 'v-tropical-wind-field-fill',
  watchWarning: 'v-tropical-watch-warning-line',
} as const;

type TropicalNoteStore = Record<string, { text: string; updatedAt: number }>;

type FeatureProps = Record<string, unknown>;

function readNotes(): TropicalNoteStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TropicalNoteStore : {};
  } catch { return {}; }
}

function writeNotes(notes: TropicalNoteStore): void {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* best effort */ }
}

function asProps(feature: Feature): FeatureProps {
  return feature.properties && typeof feature.properties === 'object' ? feature.properties as FeatureProps : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function categoryLabel(category: number | undefined, stormType: string): string {
  if (Number.isFinite(category) && Number(category) > 0) return `CATEGORY ${Math.round(Number(category))}`;
  return stormType || 'TROPICAL CYCLONE';
}

function windMph(knots: number | undefined): string {
  if (!Number.isFinite(knots)) return 'N/A';
  return `${Math.round(Number(knots))} KT · ${Math.round(Number(knots) * 1.15078)} MPH`;
}

function coordinateLabel(value: number | undefined, positive: string, negative: string): string {
  if (!Number.isFinite(value)) return 'N/A';
  return `${Math.abs(Number(value)).toFixed(1)}°${Number(value) >= 0 ? positive : negative}`;
}

function bearingLabel(value: number | undefined): string {
  if (!Number.isFinite(value)) return 'N/A';
  const normalized = ((Number(value) % 360) + 360) % 360;
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const label = labels[Math.round(normalized / 45) % 8] ?? '';
  return `${Math.round(normalized)}° ${label}`;
}

function stormFeatureId(feature: Feature): string {
  const p = asProps(feature);
  const source = text(p.idp_source);
  return source ? source.slice(0, 3).toUpperCase() : [text(p.basin), text(p.stormnum), text(p.stormname)].filter(Boolean).join('-');
}

function filteredCollection(collection: FeatureCollection, stormId: string): FeatureCollection {
  if (!stormId) return collection;
  return {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) => stormFeatureId(feature) === stormId),
  };
}

function setGeoJson(map: maplibregl.Map, id: string, data: FeatureCollection): void {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

export class TropicalOperationsPanel {
  private readonly root: HTMLElement;
  private map: maplibregl.Map | null = null;
  private data: TropicalOperationsData | null = null;
  private selectedStormId = '';
  private selectedOutlookId = '';
  private notes = readNotes();
  private refreshTimer: number | null = null;
  private abortController: AbortController | null = null;
  private outlookVisible = true;
  private coneVisible = true;
  private windVisible = true;
  private readonly openHandler: EventListener;
  private readonly closeHandler: EventListener;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly resizeHandler: () => void;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'v-tropical-ops-root';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Project V Tropical Operations');
    this.root.innerHTML = this.shellMarkup();
    document.body.appendChild(this.root);
    this.wireUi();

    this.openHandler = (() => this.open()) as EventListener;
    this.closeHandler = (() => this.close()) as EventListener;
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !this.root.hidden) {
        event.preventDefault();
        this.close();
      }
    };
    this.resizeHandler = () => this.syncTopOffset();

    window.addEventListener('project-v-tropical-operations-open', this.openHandler);
    window.addEventListener('project-v-tropical-operations-close', this.closeHandler);
    window.addEventListener('resize', this.resizeHandler);
    document.addEventListener('keydown', this.keyHandler);
  }

  private shellMarkup(): string {
    return `
      <div class="v-tropical-ops-shell">
        <aside class="v-tropical-ops-left">
          <div class="v-weather-ops-panel-head">
            <span>PROJECT V // NHC TROPICAL DESK</span>
            <strong>ACTIVE CYCLONES</strong>
            <small>FORECAST TRACK · CONE · WIND FIELD · OUTLOOK</small>
          </div>
          <div class="v-tropical-ops-list" data-tropical-list>
            <div class="v-weather-ops-empty">LOADING NHC TROPICAL DATA</div>
          </div>
        </aside>

        <section class="v-tropical-ops-map-wrap">
          <div class="v-tropical-ops-map" data-tropical-map></div>
          <div class="v-weather-ops-toolbar v-tropical-ops-toolbar">
            <div class="v-weather-ops-brand"><span></span><strong>TROPICAL OPS</strong><small>NOAA / NHC OFFICIAL GIS</small></div>
            <button type="button" class="active" data-tropical-action="outlook">OUTLOOK ON</button>
            <button type="button" class="active" data-tropical-action="cone">CONE ON</button>
            <button type="button" class="active" data-tropical-action="wind">WIND ON</button>
            <button type="button" data-tropical-action="refresh">REFRESH</button>
            <button type="button" data-tropical-action="fit">FIT ACTIVE</button>
            <button type="button" data-tropical-action="return">RETURN TO WEATHER</button>
            <span class="v-weather-ops-status" data-tropical-status>STANDBY</span>
          </div>
          <div class="v-tropical-ops-legend">
            <span><i class="low"></i>LOW</span><span><i class="medium"></i>MEDIUM</span><span><i class="high"></i>HIGH DEVELOPMENT</span>
            <span><b>—</b> FORECAST TRACK</span><span><b class="past">—</b> PAST TRACK</span>
          </div>
          <div class="v-weather-ops-attribution">Tropical data © NOAA / National Hurricane Center / Central Pacific Hurricane Center · CARTO / OpenStreetMap basemap</div>
        </section>

        <aside class="v-tropical-ops-right">
          <div class="v-weather-ops-panel-head">
            <span>PROJECT V // SELECTED SYSTEM</span>
            <strong data-tropical-detail-title>TROPICAL INTELLIGENCE</strong>
            <small data-tropical-detail-subtitle>SELECT A CYCLONE OR OUTLOOK AREA</small>
          </div>
          <div class="v-tropical-ops-detail" data-tropical-detail>
            <div class="v-weather-ops-empty">SELECT A TROPICAL SYSTEM FOR DETAILS</div>
          </div>
        </aside>

        <section class="v-weather-ops-notes v-tropical-ops-notes">
          <textarea data-tropical-note placeholder="ANALYST NOTES — select a tropical system or outlook area"></textarea>
          <div>
            <button type="button" data-tropical-action="copy">COPY BRIEF</button>
            <button type="button" data-tropical-action="save-note">SAVE NOTE</button>
            <button type="button" data-tropical-action="clear-note">CLEAR</button>
          </div>
        </section>
      </div>
    `;
  }

  private wireUi(): void {
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="return"]')?.addEventListener('click', () => this.close());
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="refresh"]')?.addEventListener('click', () => void this.refresh(true));
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="fit"]')?.addEventListener('click', () => this.fitActive());
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="copy"]')?.addEventListener('click', () => void this.copyBrief());
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="save-note"]')?.addEventListener('click', () => this.saveNote());
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="clear-note"]')?.addEventListener('click', () => this.clearNote());

    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="outlook"]')?.addEventListener('click', (event) => {
      this.outlookVisible = !this.outlookVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle('active', this.outlookVisible);
      button.textContent = this.outlookVisible ? 'OUTLOOK ON' : 'OUTLOOK OFF';
      this.syncVisibility();
    });
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="cone"]')?.addEventListener('click', (event) => {
      this.coneVisible = !this.coneVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle('active', this.coneVisible);
      button.textContent = this.coneVisible ? 'CONE ON' : 'CONE OFF';
      this.syncVisibility();
    });
    this.root.querySelector<HTMLButtonElement>('[data-tropical-action="wind"]')?.addEventListener('click', (event) => {
      this.windVisible = !this.windVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle('active', this.windVisible);
      button.textContent = this.windVisible ? 'WIND ON' : 'WIND OFF';
      this.syncVisibility();
    });
  }

  private open(): void {
    this.root.hidden = false;
    document.body.classList.add('v-tropical-operations-open');
    this.syncTopOffset();
    this.ensureMap();
    window.setTimeout(() => {
      this.syncTopOffset();
      this.map?.resize();
      void this.refresh(false);
    }, 60);
  }

  private close(): void {
    this.root.hidden = true;
    document.body.classList.remove('v-tropical-operations-open');
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
    const container = this.root.querySelector<HTMLElement>('[data-tropical-map]');
    if (!container) return;
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [-80, 24],
      zoom: 2.8,
      minZoom: 1.3,
      maxZoom: 11,
      renderWorldCopies: false,
      attributionControl: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
    this.map.on('load', () => this.renderMapData());
    this.map.on('click', (event) => {
      const layers = [LAYER.forecastPoint, LAYER.outlookPoint, LAYER.coneFill].filter((id) => Boolean(this.map?.getLayer(id)));
      const features = layers.length ? this.map?.queryRenderedFeatures(event.point, { layers }) : [];
      const feature = features?.[0];
      if (!feature) return;
      const source = String(feature.source ?? '');
      const properties = feature.properties ?? {};
      if (source === SOURCE.outlookPoints) {
        const id = text(properties.idp_source) || `outlook-${text(properties.objectid)}`;
        this.selectOutlook(id);
        return;
      }
      const id = text(properties.idp_source);
      if (id) this.selectStorm(id, false);
    });
  }

  private setStatus(message: string, tone: 'normal' | 'loading' | 'error' = 'normal'): void {
    const element = this.root.querySelector<HTMLElement>('[data-tropical-status]');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('loading', tone === 'loading');
    element.classList.toggle('error', tone === 'error');
  }

  private async refresh(force: boolean): Promise<void> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.setStatus('REFRESHING NOAA / NHC', 'loading');
    try {
      const data = await fetchTropicalOperations(force, controller.signal);
      if (controller.signal.aborted) return;
      this.data = data;
      if (this.selectedStormId && !data.storms.some((storm) => storm.id === this.selectedStormId)) this.selectedStormId = '';
      if (!this.selectedStormId && data.storms[0]) this.selectedStormId = data.storms[0].id;
      this.renderList();
      this.renderMapData();
      this.renderDetail();
      this.loadNote();
      if (data.errors.length) this.setStatus(`PARTIAL · ${data.errors.length} NHC LAYER ERROR${data.errors.length === 1 ? '' : 'S'}`, 'error');
      else this.setStatus(`NHC ACTIVE · ${data.storms.length} CYCLONE${data.storms.length === 1 ? '' : 'S'} · ${data.outlooks.length} OUTLOOK${data.outlooks.length === 1 ? '' : 'S'}`);
      if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => void this.refresh(true), REFRESH_MS);
      if (force || (!this.selectedStormId && !this.selectedOutlookId)) this.fitActive();
    } catch (error) {
      if (!controller.signal.aborted) this.setStatus(error instanceof Error ? error.message : 'NHC TROPICAL DATA FAILED', 'error');
    }
  }

  private renderList(): void {
    const mount = this.root.querySelector<HTMLElement>('[data-tropical-list]');
    const data = this.data;
    if (!mount || !data) return;
    const stormMarkup = data.storms.length
      ? data.storms.map((storm) => `
          <button type="button" class="v-tropical-ops-list-item ${storm.id === this.selectedStormId ? 'selected' : ''}" data-storm-id="${escapeHtml(storm.id)}">
            <strong>${escapeHtml(storm.name)}</strong>
            <span>${escapeHtml(categoryLabel(storm.category, storm.stormType))}</span>
            <small>${escapeHtml(storm.basin || 'NHC')} · ${escapeHtml(windMph(storm.maxWindKt))}</small>
          </button>`).join('')
      : '<div class="v-tropical-ops-none"><strong>NO ACTIVE NHC CYCLONES</strong><span>SEVEN-DAY DEVELOPMENT OUTLOOK REMAINS ACTIVE BELOW</span></div>';

    const outlookMarkup = data.outlooks.length
      ? data.outlooks.map((outlook) => `
          <button type="button" class="v-tropical-ops-list-item outlook ${outlook.id === this.selectedOutlookId ? 'selected' : ''}" data-outlook-id="${escapeHtml(outlook.id)}">
            <strong>${escapeHtml(outlook.basin || 'DEVELOPMENT AREA')}</strong>
            <span>${escapeHtml(outlook.probability7Day || 'N/A')} · ${escapeHtml(outlook.risk7Day || 'UNKNOWN')} 7-DAY</span>
            <small>${escapeHtml(outlook.probability2Day || 'N/A')} 2-DAY</small>
          </button>`).join('')
      : '<div class="v-tropical-ops-none"><span>NO NHC DEVELOPMENT AREAS REPORTED</span></div>';

    mount.innerHTML = `
      <section><h4>ACTIVE TROPICAL CYCLONES · ${data.storms.length}</h4>${stormMarkup}</section>
      <section><h4>7-DAY TROPICAL OUTLOOK · ${data.outlooks.length}</h4>${outlookMarkup}</section>
      <div class="v-tropical-ops-source-state">UPDATED ${escapeHtml(new Date(data.fetchedAt).toLocaleTimeString())} · NOAA/NHC SUMMARY SERVICE</div>
    `;

    mount.querySelectorAll<HTMLButtonElement>('[data-storm-id]').forEach((button) => button.addEventListener('click', () => this.selectStorm(button.dataset.stormId ?? '', true)));
    mount.querySelectorAll<HTMLButtonElement>('[data-outlook-id]').forEach((button) => button.addEventListener('click', () => this.selectOutlook(button.dataset.outlookId ?? '')));
  }

  private renderMapData(): void {
    const map = this.map;
    const data = this.data;
    if (!map || !data || !map.isStyleLoaded()) return;

    setGeoJson(map, SOURCE.outlookRegions, data.outlookRegions);
    setGeoJson(map, SOURCE.outlookPoints, data.outlookPoints);
    setGeoJson(map, SOURCE.cone, this.selectedStormId ? filteredCollection(data.forecastCone, this.selectedStormId) : data.forecastCone);
    setGeoJson(map, SOURCE.forecastTrack, this.selectedStormId ? filteredCollection(data.forecastTrack, this.selectedStormId) : data.forecastTrack);
    setGeoJson(map, SOURCE.forecastPoints, this.selectedStormId ? filteredCollection(data.forecastPoints, this.selectedStormId) : data.forecastPoints);
    setGeoJson(map, SOURCE.pastTrack, this.selectedStormId ? filteredCollection(data.pastTrack, this.selectedStormId) : data.pastTrack);
    setGeoJson(map, SOURCE.pastPoints, this.selectedStormId ? filteredCollection(data.pastPoints, this.selectedStormId) : data.pastPoints);
    setGeoJson(map, SOURCE.windRadii, this.selectedStormId ? filteredCollection(data.forecastWindRadii, this.selectedStormId) : data.forecastWindRadii);
    setGeoJson(map, SOURCE.windField, this.selectedStormId ? filteredCollection(data.advisoryWindField, this.selectedStormId) : data.advisoryWindField);
    setGeoJson(map, SOURCE.watchWarning, this.selectedStormId ? filteredCollection(data.watchWarning, this.selectedStormId) : data.watchWarning);

    if (!map.getLayer(LAYER.outlookFill)) map.addLayer({ id: LAYER.outlookFill, type: 'fill', source: SOURCE.outlookRegions, paint: { 'fill-color': ['match', ['get', 'risk7day'], 'High', '#f14a5b', 'Medium', '#f4a83a', 'Low', '#f0dc4c', '#d4b93f'], 'fill-opacity': 0.16 } });
    if (!map.getLayer(LAYER.outlookLine)) map.addLayer({ id: LAYER.outlookLine, type: 'line', source: SOURCE.outlookRegions, paint: { 'line-color': ['match', ['get', 'risk7day'], 'High', '#ff6170', 'Medium', '#ffb34f', 'Low', '#f6e764', '#d9c35b'], 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    if (!map.getLayer(LAYER.windRadii)) map.addLayer({ id: LAYER.windRadii, type: 'fill', source: SOURCE.windRadii, paint: { 'fill-color': '#50b9ef', 'fill-opacity': 0.08, 'fill-outline-color': '#50b9ef' } });
    if (!map.getLayer(LAYER.windField)) map.addLayer({ id: LAYER.windField, type: 'fill', source: SOURCE.windField, paint: { 'fill-color': '#35dfb5', 'fill-opacity': 0.08, 'fill-outline-color': '#35dfb5' } });
    if (!map.getLayer(LAYER.coneFill)) map.addLayer({ id: LAYER.coneFill, type: 'fill', source: SOURCE.cone, paint: { 'fill-color': '#f1f4f5', 'fill-opacity': 0.12 } });
    if (!map.getLayer(LAYER.coneLine)) map.addLayer({ id: LAYER.coneLine, type: 'line', source: SOURCE.cone, paint: { 'line-color': '#e5f7ff', 'line-width': 1.5, 'line-opacity': 0.75 } });
    if (!map.getLayer(LAYER.pastTrack)) map.addLayer({ id: LAYER.pastTrack, type: 'line', source: SOURCE.pastTrack, paint: { 'line-color': '#748d9c', 'line-width': 2, 'line-dasharray': [2, 2] } });
    if (!map.getLayer(LAYER.forecastTrack)) map.addLayer({ id: LAYER.forecastTrack, type: 'line', source: SOURCE.forecastTrack, paint: { 'line-color': '#78daf7', 'line-width': 3 } });
    if (!map.getLayer(LAYER.watchWarning)) map.addLayer({ id: LAYER.watchWarning, type: 'line', source: SOURCE.watchWarning, paint: { 'line-color': '#ff5365', 'line-width': 5, 'line-opacity': 0.9 } });
    if (!map.getLayer(LAYER.pastPoint)) map.addLayer({ id: LAYER.pastPoint, type: 'circle', source: SOURCE.pastPoints, paint: { 'circle-radius': 3.5, 'circle-color': '#7e98a5', 'circle-stroke-color': '#d9ebf7', 'circle-stroke-width': 1 } });
    if (!map.getLayer(LAYER.forecastPoint)) map.addLayer({ id: LAYER.forecastPoint, type: 'circle', source: SOURCE.forecastPoints, paint: { 'circle-radius': ['case', ['==', ['get', 'tau'], 0], 8, 5], 'circle-color': ['match', ['get', 'dvlbl'], 'M', '#ff3f5f', 'H', '#ff7f32', 'S', '#f5d14b', 'D', '#55c9f3', '#c9eefb'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    if (!map.getLayer(LAYER.forecastLabel)) map.addLayer({ id: LAYER.forecastLabel, type: 'symbol', source: SOURCE.forecastPoints, layout: { 'text-field': ['coalesce', ['get', 'fldatelbl'], ['get', 'stormname']], 'text-size': 10, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': '#e9f8ff', 'text-halo-color': '#031018', 'text-halo-width': 1.5 } });
    if (!map.getLayer(LAYER.outlookPoint)) map.addLayer({ id: LAYER.outlookPoint, type: 'circle', source: SOURCE.outlookPoints, paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'risk7day'], 'High', '#ff4f63', 'Medium', '#f6a43c', 'Low', '#e7d84b', '#d5c458'], 'circle-stroke-color': '#071016', 'circle-stroke-width': 2 } });
    if (!map.getLayer(LAYER.outlookLabel)) map.addLayer({ id: LAYER.outlookLabel, type: 'symbol', source: SOURCE.outlookPoints, layout: { 'text-field': ['coalesce', ['get', 'prob7day'], 'OUTLOOK'], 'text-size': 10, 'text-offset': [0, 1.4], 'text-anchor': 'top' }, paint: { 'text-color': '#ffe777', 'text-halo-color': '#031018', 'text-halo-width': 1.5 } });
    this.syncVisibility();
  }

  private syncVisibility(): void {
    const map = this.map;
    if (!map) return;
    const set = (id: string, visible: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); };
    [LAYER.outlookFill, LAYER.outlookLine, LAYER.outlookPoint, LAYER.outlookLabel].forEach((id) => set(id, this.outlookVisible));
    [LAYER.coneFill, LAYER.coneLine].forEach((id) => set(id, this.coneVisible));
    [LAYER.windRadii, LAYER.windField].forEach((id) => set(id, this.windVisible));
  }

  private selectStorm(id: string, locate: boolean): void {
    const data = this.data;
    if (!data || !id) return;
    const storm = data.storms.find((item) => item.id === id);
    if (!storm) return;
    this.selectedStormId = id;
    this.selectedOutlookId = '';
    this.renderList();
    this.renderMapData();
    this.renderDetail();
    this.loadNote();
    if (locate && Number.isFinite(storm.longitude) && Number.isFinite(storm.latitude)) {
      this.map?.easeTo({ center: [Number(storm.longitude), Number(storm.latitude)], zoom: Math.max(4.2, this.map?.getZoom() ?? 4.2), duration: 600 });
    }
  }

  private selectOutlook(id: string): void {
    const data = this.data;
    if (!data || !id) return;
    const outlook = data.outlooks.find((item) => item.id === id);
    if (!outlook) return;
    this.selectedOutlookId = id;
    this.selectedStormId = '';
    this.renderList();
    this.renderMapData();
    this.renderDetail();
    this.loadNote();
    if (Number.isFinite(outlook.longitude) && Number.isFinite(outlook.latitude)) {
      this.map?.easeTo({ center: [Number(outlook.longitude), Number(outlook.latitude)], zoom: Math.max(4, this.map?.getZoom() ?? 4), duration: 600 });
    }
  }

  private renderDetail(): void {
    const mount = this.root.querySelector<HTMLElement>('[data-tropical-detail]');
    const title = this.root.querySelector<HTMLElement>('[data-tropical-detail-title]');
    const subtitle = this.root.querySelector<HTMLElement>('[data-tropical-detail-subtitle]');
    if (!mount || !title || !subtitle) return;
    const storm = this.currentStorm();
    if (storm) {
      title.textContent = storm.name.toUpperCase();
      subtitle.textContent = `${categoryLabel(storm.category, storm.stormType)} · ${storm.basin || 'NHC'} · ADVISORY ${storm.advisoryNumber || 'N/A'}`;
      const forecast = storm.forecast.slice(0, 8);
      mount.innerHTML = `
        <section class="v-tropical-ops-hero">
          <strong>${escapeHtml(storm.name)}</strong>
          <span>${escapeHtml(categoryLabel(storm.category, storm.stormType))}</span>
          <small>${escapeHtml(storm.advisoryDate || 'ADVISORY TIME N/A')}</small>
        </section>
        <section class="v-weather-ops-section"><h4>CURRENT INTENSITY</h4><div class="v-weather-ops-metrics">
          ${this.metric('MAX WIND', windMph(storm.maxWindKt))}
          ${this.metric('GUST', windMph(storm.gustKt))}
          ${this.metric('PRESSURE', Number.isFinite(storm.pressureMb) ? `${Math.round(Number(storm.pressureMb))} mb` : 'N/A')}
          ${this.metric('CATEGORY', Number.isFinite(storm.category) ? String(Math.round(Number(storm.category))) : 'N/A')}
          ${this.metric('LATITUDE', coordinateLabel(storm.latitude, 'N', 'S'))}
          ${this.metric('LONGITUDE', coordinateLabel(storm.longitude, 'E', 'W'))}
          ${this.metric('MOVEMENT', bearingLabel(storm.movementDirectionDeg))}
          ${this.metric('SPEED', Number.isFinite(storm.movementSpeedKt) ? `${Math.round(Number(storm.movementSpeedKt))} KT` : 'N/A')}
        </div></section>
        <section class="v-weather-ops-section"><h4>FORECAST POINTS</h4><div class="v-tropical-forecast-list">
          ${forecast.map((point) => `<div><span>+${Math.round(point.tauHours)}H</span><strong>${escapeHtml(point.label || point.validTime || 'FORECAST')}</strong><small>${escapeHtml(windMph(point.maxWindKt))} · ${escapeHtml(categoryLabel(point.category, point.stormType))}</small></div>`).join('') || '<div class="v-weather-ops-empty">NO FORECAST POINTS AVAILABLE</div>'}
        </div></section>
        <section class="v-weather-ops-section"><h4>OPERATIONAL NOTE</h4><p class="v-tropical-ops-explainer">The NHC forecast cone represents probable track uncertainty for the cyclone center. Hazardous weather can occur outside the cone; wind-field overlays show the reported/forecast extent where supplied by NHC.</p></section>
      `;
      return;
    }

    const outlook = this.currentOutlook();
    if (outlook) {
      title.textContent = 'DEVELOPMENT OUTLOOK';
      subtitle.textContent = `${outlook.basin || 'NHC'} · 7-DAY FORMATION POTENTIAL`;
      mount.innerHTML = `
        <section class="v-tropical-ops-hero outlook"><strong>${escapeHtml(outlook.basin || 'TROPICAL DISTURBANCE')}</strong><span>${escapeHtml(outlook.risk7Day || 'UNKNOWN')} RISK</span></section>
        <section class="v-weather-ops-section"><h4>FORMATION POTENTIAL</h4><div class="v-weather-ops-metrics">
          ${this.metric('2-DAY', outlook.probability2Day || 'N/A')}
          ${this.metric('2-DAY RISK', outlook.risk2Day || 'N/A')}
          ${this.metric('7-DAY', outlook.probability7Day || 'N/A')}
          ${this.metric('7-DAY RISK', outlook.risk7Day || 'N/A')}
          ${this.metric('LATITUDE', coordinateLabel(outlook.latitude, 'N', 'S'))}
          ${this.metric('LONGITUDE', coordinateLabel(outlook.longitude, 'E', 'W'))}
        </div></section>
        <section class="v-weather-ops-section"><h4>INTERPRETATION</h4><p class="v-tropical-ops-explainer">This is an NHC tropical-cyclone formation outlook area, not a forecast track for a named storm. Probability and risk values are shown exactly as provided by the NHC GIS service.</p></section>
      `;
      return;
    }

    title.textContent = 'TROPICAL INTELLIGENCE';
    subtitle.textContent = 'SELECT A CYCLONE OR OUTLOOK AREA';
    mount.innerHTML = '<div class="v-weather-ops-empty">SELECT A TROPICAL SYSTEM FOR DETAILS</div>';
  }

  private metric(label: string, value: string): string {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  private currentStorm(): TropicalStormSummary | null {
    return this.data?.storms.find((storm) => storm.id === this.selectedStormId) ?? null;
  }

  private currentOutlook(): TropicalOutlookArea | null {
    return this.data?.outlooks.find((outlook) => outlook.id === this.selectedOutlookId) ?? null;
  }

  private selectedNoteKey(): string {
    if (this.selectedStormId) return `storm:${this.selectedStormId}`;
    if (this.selectedOutlookId) return `outlook:${this.selectedOutlookId}`;
    return '';
  }

  private loadNote(): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-tropical-note]');
    const key = this.selectedNoteKey();
    if (!textarea) return;
    textarea.disabled = !key;
    textarea.value = key ? this.notes[key]?.text ?? '' : '';
  }

  private saveNote(): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-tropical-note]');
    const key = this.selectedNoteKey();
    if (!textarea || !key) return;
    const value = textarea.value.trim();
    if (value) this.notes[key] = { text: value, updatedAt: Date.now() };
    else delete this.notes[key];
    writeNotes(this.notes);
    this.setStatus(value ? 'TROPICAL NOTE SAVED' : 'TROPICAL NOTE CLEARED');
  }

  private clearNote(): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-tropical-note]');
    const key = this.selectedNoteKey();
    if (!textarea) return;
    textarea.value = '';
    if (key) {
      delete this.notes[key];
      writeNotes(this.notes);
    }
    this.setStatus('TROPICAL NOTE CLEARED');
  }

  private async copyBrief(): Promise<void> {
    const storm = this.currentStorm();
    const outlook = this.currentOutlook();
    let value = '';
    if (storm) {
      value = [
        'PROJECT V // TROPICAL CYCLONE BRIEF',
        `${storm.name} · ${categoryLabel(storm.category, storm.stormType)}`,
        `Advisory ${storm.advisoryNumber || 'N/A'} · ${storm.advisoryDate || 'N/A'}`,
        `Position ${coordinateLabel(storm.latitude, 'N', 'S')} ${coordinateLabel(storm.longitude, 'E', 'W')}`,
        `Maximum wind ${windMph(storm.maxWindKt)} · Gust ${windMph(storm.gustKt)}`,
        `Pressure ${Number.isFinite(storm.pressureMb) ? `${Math.round(Number(storm.pressureMb))} mb` : 'N/A'}`,
        `Movement ${bearingLabel(storm.movementDirectionDeg)} at ${Number.isFinite(storm.movementSpeedKt) ? `${Math.round(Number(storm.movementSpeedKt))} KT` : 'N/A'}`,
        `Forecast points ${storm.forecast.length}`,
        'Source: NOAA / National Hurricane Center GIS summary service',
      ].join('\n');
    } else if (outlook) {
      value = [
        'PROJECT V // TROPICAL DEVELOPMENT OUTLOOK',
        `${outlook.basin || 'NHC DEVELOPMENT AREA'}`,
        `2-day ${outlook.probability2Day || 'N/A'} · ${outlook.risk2Day || 'N/A'}`,
        `7-day ${outlook.probability7Day || 'N/A'} · ${outlook.risk7Day || 'N/A'}`,
        `Location ${coordinateLabel(outlook.latitude, 'N', 'S')} ${coordinateLabel(outlook.longitude, 'E', 'W')}`,
        'Source: NOAA / National Hurricane Center GIS summary service',
      ].join('\n');
    }
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.setStatus('TROPICAL BRIEF COPIED');
    } catch { this.setStatus('CLIPBOARD UNAVAILABLE', 'error'); }
  }

  private fitActive(): void {
    const map = this.map;
    const data = this.data;
    if (!map || !data) return;
    const points: [number, number][] = [];
    for (const storm of data.storms) {
      if (Number.isFinite(storm.longitude) && Number.isFinite(storm.latitude)) points.push([Number(storm.longitude), Number(storm.latitude)]);
      for (const forecast of storm.forecast) if (Number.isFinite(forecast.longitude) && Number.isFinite(forecast.latitude)) points.push([Number(forecast.longitude), Number(forecast.latitude)]);
    }
    for (const outlook of data.outlooks) if (Number.isFinite(outlook.longitude) && Number.isFinite(outlook.latitude)) points.push([Number(outlook.longitude), Number(outlook.latitude)]);
    if (!points.length) {
      map.easeTo({ center: [-80, 24], zoom: 2.8, duration: 500 });
      return;
    }
    const first = points[0];
    if (!first) return;
    const bounds = new maplibregl.LngLatBounds(first, first);
    points.slice(1).forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { padding: 80, maxZoom: 5.4, duration: 700 });
  }

  destroy(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.abortController?.abort();
    this.map?.remove();
    this.map = null;
    window.removeEventListener('project-v-tropical-operations-open', this.openHandler);
    window.removeEventListener('project-v-tropical-operations-close', this.closeHandler);
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
    document.body.classList.remove('v-tropical-operations-open');
  }
}
