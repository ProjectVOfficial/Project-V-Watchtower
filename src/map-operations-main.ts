import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/workspace-windows.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import { installWorkspaceLockGuard } from '@/services/workspace-lock-guard';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { sendToCaseDesk } from '@/services/case-handoff';
import {
  deleteGeofenceRule,
  deleteMapOperationItem,
  describeMapOperation,
  getMapOperationsState,
  haversineKm,
  itemToGeoJsonFeature,
  mapOperationsFeatureCollection,
  polygonAreaKm2,
  replaceMapOperationsState,
  routeLengthKm,
  saveGeofenceRule,
  saveMapOperationItem,
  saveMapView,
  subscribeMapOperations,
  type GeoPoint,
  type MapOperationItem,
  type MapOperationType,
} from '@/services/map-operations';

applyStoredTheme();
installWorkspaceLockGuard();

const mount = document.getElementById('mapOperationsApp');
if (!mount) throw new Error('Map Operations mount point is missing.');

const HANDOFF_CHANNEL = 'project-v-map-operations-handoff';
const handoff = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(HANDOFF_CHANNEL) : null;

type DrawMode = MapOperationType | 'measure' | null;

let map: MapLibreMap | null = null;
let state = getMapOperationsState();
let selectedItemId: string | null = null;
let selectedRuleId: string | null = null;
let drawMode: DrawMode = null;
let draftPoints: GeoPoint[] = [];
let search = '';
let statusTimer: number | null = null;
let pendingViewSave: number | null = null;

const DARK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#080707' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.54, 'raster-saturation': -0.85, 'raster-contrast': 0.15, 'raster-brightness-min': 0.08, 'raster-brightness-max': 0.62 } },
  ],
};

function renderShell(): void {
  mount!.innerHTML = `
    <div class="pv-window-shell pv-map-ops-shell">
      <header class="pv-window-header">
        <div class="pv-window-brand"><span class="pv-window-mark">V</span><div><strong>PROJECT V // MAP OPERATIONS</strong><small>AREAS · ROUTES · GEOFENCES · OPERATIONAL MARKERS</small></div></div>
        <div class="pv-window-header-actions">
          <span data-map-status>READY</span>
          <button data-map-action="snapshot">SNAPSHOT</button>
          <button data-map-action="export">BACKUP</button>
          <button data-map-action="geojson">GEOJSON</button>
          <button data-map-action="import">IMPORT</button>
          <button data-map-action="close">CLOSE</button>
        </div>
      </header>
      <section class="pv-map-ops-toolbar">
        <button data-draw-mode="marker">MARKER</button>
        <button data-draw-mode="circle">CIRCLE</button>
        <button data-draw-mode="rectangle">RECTANGLE</button>
        <button data-draw-mode="polygon">POLYGON</button>
        <button data-draw-mode="route">ROUTE</button>
        <button data-draw-mode="measure">MEASURE</button>
        <span class="pv-toolbar-separator"></span>
        <button data-map-action="finish" disabled>FINISH</button>
        <button data-map-action="undo-point" disabled>UNDO POINT</button>
        <button data-map-action="cancel" disabled>CANCEL</button>
        <span data-draw-help>SELECT A TOOL TO BEGIN</span>
      </section>
      <main class="pv-map-ops-layout">
        <aside class="pv-map-ops-sidebar left">
          <div class="pv-sidebar-heading"><strong>SAVED MAP ITEMS</strong><span>${state.items.length}</span></div>
          <input data-item-search placeholder="SEARCH MAP ITEMS" value="${escapeHtml(search)}">
          <div class="pv-map-item-list" data-map-item-list></div>
        </aside>
        <section class="pv-map-ops-map-wrap">
          <div id="mapOperationsMap" class="pv-map-ops-map"></div>
          <div class="pv-map-crosshair" aria-hidden="true"></div>
          <div class="pv-map-coordinate-readout" data-coordinate-readout>LAT — · LON —</div>
          <div class="pv-map-measurement" data-measurement hidden></div>
        </section>
        <aside class="pv-map-ops-sidebar right">
          <div class="pv-sidebar-heading"><strong>INSPECTOR</strong><span data-inspector-type>NONE</span></div>
          <div data-map-inspector class="pv-map-inspector"></div>
          <div class="pv-sidebar-heading rules"><strong>GEOFENCE RULES</strong><span>${state.rules.filter((rule) => rule.enabled).length} ACTIVE</span></div>
          <div data-rule-list class="pv-geofence-rule-list"></div>
        </aside>
      </main>
      <input data-map-import type="file" accept=".json,.geojson,application/json,application/geo+json" hidden>
    </div>
  `;
  bindShell();
  renderItemList();
  renderInspector();
  renderRules();
}

function bindShell(): void {
  mount!.querySelectorAll<HTMLButtonElement>('[data-draw-mode]').forEach((button) => {
    button.addEventListener('click', () => beginDraw(button.dataset.drawMode as DrawMode));
  });
  mount!.querySelector<HTMLButtonElement>('[data-map-action="finish"]')?.addEventListener('click', finishDraft);
  mount!.querySelector<HTMLButtonElement>('[data-map-action="undo-point"]')?.addEventListener('click', () => {
    draftPoints.pop();
    updateDraft();
  });
  mount!.querySelector<HTMLButtonElement>('[data-map-action="cancel"]')?.addEventListener('click', cancelDraw);
  mount!.querySelector<HTMLButtonElement>('[data-map-action="snapshot"]')?.addEventListener('click', saveSnapshot);
  mount!.querySelector<HTMLButtonElement>('[data-map-action="export"]')?.addEventListener('click', exportArchive);
  mount!.querySelector<HTMLButtonElement>('[data-map-action="geojson"]')?.addEventListener('click', exportGeoJson);
  mount!.querySelector<HTMLButtonElement>('[data-map-action="import"]')?.addEventListener('click', () => mount!.querySelector<HTMLInputElement>('[data-map-import]')?.click());
  mount!.querySelector<HTMLInputElement>('[data-map-import]')?.addEventListener('change', (event) => void importArchive(event));
  mount!.querySelector<HTMLButtonElement>('[data-map-action="close"]')?.addEventListener('click', () => void closeWindow());
  mount!.querySelector<HTMLInputElement>('[data-item-search]')?.addEventListener('input', (event) => {
    search = (event.target as HTMLInputElement).value.toLowerCase();
    renderItemList();
  });
}

function initMap(): void {
  const container = document.getElementById('mapOperationsMap');
  if (!container) return;
  map = new maplibregl.Map({
    container,
    style: DARK_STYLE,
    center: [state.lastView.center.lon, state.lastView.center.lat],
    zoom: state.lastView.zoom,
    bearing: state.lastView.bearing,
    pitch: state.lastView.pitch,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('load', () => {
    map?.addSource('project-v-map-items', { type: 'geojson', data: mapOperationsFeatureCollection(state) });
    map?.addSource('project-v-map-draft', { type: 'geojson', data: emptyCollection() });
    addOperationLayers();
    updateMapData();
    const requestedMode = new URLSearchParams(location.search).get('mode');
    if (requestedMode && ['marker', 'circle', 'rectangle', 'polygon', 'route', 'measure'].includes(requestedMode)) beginDraw(requestedMode as DrawMode);
  });
  map.on('mousemove', (event) => {
    const readout = mount!.querySelector<HTMLElement>('[data-coordinate-readout]');
    if (readout) readout.textContent = `LAT ${event.lngLat.lat.toFixed(5)} · LON ${event.lngLat.lng.toFixed(5)} · Z ${map?.getZoom().toFixed(1) ?? '—'}`;
  });
  map.on('click', (event) => {
    if (drawMode) {
      addDraftPoint({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      return;
    }
    const features = map?.queryRenderedFeatures(event.point, { layers: ['pv-map-point', 'pv-map-line', 'pv-map-fill'] }) ?? [];
    const id = features[0]?.properties?.id;
    if (typeof id === 'string') selectItem(id, true);
  });
  map.on('dblclick', (event) => {
    if (drawMode === 'polygon' || drawMode === 'route' || drawMode === 'measure') {
      event.preventDefault();
      finishDraft();
    }
  });
  const saveView = () => {
    if (!map) return;
    if (pendingViewSave !== null) window.clearTimeout(pendingViewSave);
    pendingViewSave = window.setTimeout(() => {
      if (!map) return;
      const center = map.getCenter();
      saveMapView({ center: { lat: center.lat, lon: center.lng }, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
      pendingViewSave = null;
    }, 500);
  };
  map.on('moveend', saveView);
  map.on('rotateend', saveView);
  map.on('pitchend', saveView);
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function addOperationLayers(): void {
  if (!map) return;
  map.addLayer({
    id: 'pv-map-fill',
    type: 'fill',
    source: 'project-v-map-items',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ['coalesce', ['get', 'color'], '#c92f3e'], 'fill-opacity': 0.18 },
  });
  map.addLayer({
    id: 'pv-map-line',
    type: 'line',
    source: 'project-v-map-items',
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
    paint: { 'line-color': ['coalesce', ['get', 'color'], '#c92f3e'], 'line-width': 2.5, 'line-opacity': 0.94 },
  });
  map.addLayer({
    id: 'pv-map-point',
    type: 'circle',
    source: 'project-v-map-items',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 7, 'circle-color': ['coalesce', ['get', 'color'], '#c92f3e'], 'circle-stroke-color': '#f3eee5', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'pv-map-labels',
    type: 'symbol',
    source: 'project-v-map-items',
    layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Open Sans Regular'] },
    paint: { 'text-color': '#f3eee5', 'text-halo-color': '#080707', 'text-halo-width': 1.5 },
  });
  map.addLayer({
    id: 'pv-draft-fill',
    type: 'fill',
    source: 'project-v-map-draft',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#d9902f', 'fill-opacity': 0.18 },
  });
  map.addLayer({
    id: 'pv-draft-line',
    type: 'line',
    source: 'project-v-map-draft',
    paint: { 'line-color': '#d9902f', 'line-width': 3, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'pv-draft-points',
    type: 'circle',
    source: 'project-v-map-draft',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#d9902f', 'circle-stroke-color': '#f3eee5', 'circle-stroke-width': 1 },
  });
}

function updateMapData(): void {
  if (!map?.isStyleLoaded()) return;
  const source = map.getSource('project-v-map-items') as GeoJSONSource | undefined;
  source?.setData(mapOperationsFeatureCollection(state));
  updateDraft();
}

function draftFeatureCollection(): GeoJSON.FeatureCollection {
  if (!drawMode || draftPoints.length === 0) return emptyCollection();
  const features: GeoJSON.Feature[] = draftPoints.map((point, index) => ({
    type: 'Feature',
    properties: { index },
    geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
  }));
  if ((drawMode === 'route' || drawMode === 'measure') && draftPoints.length >= 2) {
    features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draftPoints.map((point) => [point.lon, point.lat]) } });
  } else if (drawMode === 'polygon' && draftPoints.length >= 3) {
    features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...draftPoints, draftPoints[0]!].map((point) => [point.lon, point.lat])] } });
  } else if (drawMode === 'rectangle' && draftPoints.length >= 2) {
    const a = draftPoints[0]!; const b = draftPoints[1]!;
    features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a.lon, a.lat], [b.lon, a.lat], [b.lon, b.lat], [a.lon, b.lat], [a.lon, a.lat]]] } });
  } else if (drawMode === 'circle' && draftPoints.length >= 2) {
    const center = draftPoints[0]!;
    const radius = haversineKm(center, draftPoints[1]!);
    const coordinates: number[][] = [];
    for (let step = 0; step <= 96; step += 1) {
      const angle = 2 * Math.PI * step / 96;
      const northKm = Math.cos(angle) * radius;
      const eastKm = Math.sin(angle) * radius;
      coordinates.push([center.lon + eastKm / (111.32 * Math.max(0.1, Math.cos(center.lat * Math.PI / 180))), center.lat + northKm / 110.574]);
    }
    features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  }
  return { type: 'FeatureCollection', features };
}

function updateDraft(): void {
  if (map?.isStyleLoaded()) (map.getSource('project-v-map-draft') as GeoJSONSource | undefined)?.setData(draftFeatureCollection());
  const finish = mount!.querySelector<HTMLButtonElement>('[data-map-action="finish"]');
  const undo = mount!.querySelector<HTMLButtonElement>('[data-map-action="undo-point"]');
  const cancel = mount!.querySelector<HTMLButtonElement>('[data-map-action="cancel"]');
  if (finish) finish.disabled = !canFinish();
  if (undo) undo.disabled = draftPoints.length === 0;
  if (cancel) cancel.disabled = !drawMode;
  renderMeasurement();
}

function beginDraw(mode: DrawMode): void {
  drawMode = mode;
  draftPoints = [];
  selectedItemId = null;
  selectedRuleId = null;
  mount!.querySelectorAll<HTMLButtonElement>('[data-draw-mode]').forEach((button) => button.classList.toggle('active', button.dataset.drawMode === mode));
  const help = mount!.querySelector<HTMLElement>('[data-draw-help]');
  if (help) {
    const guidance: Record<string, string> = { marker: 'CLICK ONCE TO PLACE A MARKER', circle: 'CLICK CENTER, THEN EDGE', rectangle: 'CLICK OPPOSITE CORNERS', polygon: 'CLICK 3+ POINTS · DOUBLE-CLICK OR FINISH', route: 'CLICK 2+ WAYPOINTS · DOUBLE-CLICK OR FINISH', measure: 'CLICK 2+ POINTS · DOUBLE-CLICK OR FINISH' };
    help.textContent = mode ? (guidance[mode] ?? 'CLICK THE MAP TO BEGIN') : 'SELECT A TOOL TO BEGIN';
  }
  map?.getCanvas().classList.toggle('drawing', Boolean(mode));
  map?.doubleClickZoom.disable();
  updateDraft();
  renderInspector();
}

function cancelDraw(): void {
  drawMode = null;
  draftPoints = [];
  mount!.querySelectorAll<HTMLButtonElement>('[data-draw-mode]').forEach((button) => button.classList.remove('active'));
  const help = mount!.querySelector<HTMLElement>('[data-draw-help]');
  if (help) help.textContent = 'SELECT A TOOL TO BEGIN';
  map?.getCanvas().classList.remove('drawing');
  map?.doubleClickZoom.enable();
  updateDraft();
}

function addDraftPoint(point: GeoPoint): void {
  if (!drawMode) return;
  draftPoints.push(point);
  updateDraft();
  if (drawMode === 'marker' || ((drawMode === 'circle' || drawMode === 'rectangle') && draftPoints.length >= 2)) finishDraft();
}

function canFinish(): boolean {
  if (!drawMode) return false;
  if (drawMode === 'marker') return draftPoints.length >= 1;
  if (drawMode === 'circle' || drawMode === 'rectangle' || drawMode === 'route' || drawMode === 'measure') return draftPoints.length >= 2;
  return draftPoints.length >= 3;
}

function finishDraft(): void {
  if (!drawMode || !canFinish()) return;
  if (drawMode === 'measure') {
    status(`MEASUREMENT: ${routeLengthKm(draftPoints).toFixed(2)} KM`);
    return;
  }
  const name = window.prompt('Name this map item:', defaultName(drawMode))?.trim();
  if (!name) return;
  const item = saveMapOperationItem({
    name,
    type: drawMode,
    points: [...draftPoints],
    radiusKm: drawMode === 'circle' ? haversineKm(draftPoints[0]!, draftPoints[1]!) : undefined,
    notes: '',
    tags: [],
    color: '#c92f3e',
    visible: true,
  });
  state = getMapOperationsState();
  cancelDraw();
  selectItem(item.id, true);
  status(`${item.type.toUpperCase()} SAVED`);
}

function defaultName(mode: MapOperationType): string {
  return ({ marker: 'Operational Marker', circle: 'Circular Area of Interest', rectangle: 'Rectangular Area of Interest', polygon: 'Area of Interest', route: 'Operational Route' })[mode];
}

function renderMeasurement(): void {
  const element = mount!.querySelector<HTMLElement>('[data-measurement]');
  if (!element) return;
  if (!drawMode || draftPoints.length === 0) {
    element.hidden = true;
    return;
  }
  let text = `${draftPoints.length} POINT${draftPoints.length === 1 ? '' : 'S'}`;
  if (drawMode === 'circle' && draftPoints.length >= 2) text = `RADIUS ${haversineKm(draftPoints[0]!, draftPoints[1]!).toFixed(2)} KM`;
  if (drawMode === 'route' || drawMode === 'measure') text = `DISTANCE ${routeLengthKm(draftPoints).toFixed(2)} KM`;
  if (drawMode === 'polygon' && draftPoints.length >= 3) text = `AREA ${polygonAreaKm2(draftPoints).toFixed(2)} KM²`;
  if (drawMode === 'rectangle' && draftPoints.length >= 2) {
    const a = draftPoints[0]!; const b = draftPoints[1]!;
    text = `WIDTH ${haversineKm(a, { lat: a.lat, lon: b.lon }).toFixed(2)} KM · HEIGHT ${haversineKm(a, { lat: b.lat, lon: a.lon }).toFixed(2)} KM`;
  }
  element.hidden = false;
  element.textContent = text;
}

function renderItemList(): void {
  const list = mount!.querySelector<HTMLElement>('[data-map-item-list]');
  if (!list) return;
  const filtered = state.items.filter((item) => `${item.name} ${item.type} ${item.tags.join(' ')} ${item.notes}`.toLowerCase().includes(search));
  list.innerHTML = filtered.length ? [...filtered].sort((a, b) => b.updatedAt - a.updatedAt).map((item) => `
    <button class="pv-map-list-item ${item.id === selectedItemId ? 'active' : ''}" data-map-item-id="${item.id}">
      <span class="pv-map-item-symbol ${item.type}" style="--item-color:${escapeHtml(item.color)}"></span>
      <span><strong>${escapeHtml(item.name)}</strong><small>${item.type.toUpperCase()} · ${escapeHtml(describeMapOperation(item))}</small></span>
      <em>${item.visible ? 'VISIBLE' : 'HIDDEN'}</em>
    </button>
  `).join('') : '<div class="pv-empty-state">NO MAP ITEMS MATCH</div>';
  list.querySelectorAll<HTMLButtonElement>('[data-map-item-id]').forEach((button) => button.addEventListener('click', () => selectItem(button.dataset.mapItemId!, true)));
}

function selectItem(itemId: string, fit = false): void {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  selectedItemId = item.id;
  selectedRuleId = null;
  cancelDraw();
  renderItemList();
  renderInspector();
  renderRules();
  if (fit) fitItem(item);
}

function fitItem(item: MapOperationItem): void {
  if (!map) return;
  if (item.type === 'marker') {
    map.flyTo({ center: [item.points[0]!.lon, item.points[0]!.lat], zoom: Math.max(7, map.getZoom()), essential: true });
    return;
  }
  const geometry = itemToGeoJsonFeature(item).geometry;
  if (!geometry) return;
  const flat: number[][] = geometry.type === 'LineString'
    ? geometry.coordinates
    : geometry.type === 'Polygon'
      ? (geometry.coordinates[0] ?? [])
      : [];
  if (flat.length === 0) return;
  const bounds = flat.reduce((result, coordinate) => result.extend(coordinate as [number, number]), new maplibregl.LngLatBounds(flat[0] as [number, number], flat[0] as [number, number]));
  map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 700 });
}

function renderInspector(): void {
  const inspector = mount!.querySelector<HTMLElement>('[data-map-inspector]');
  const type = mount!.querySelector<HTMLElement>('[data-inspector-type]');
  if (!inspector || !type) return;
  const item = state.items.find((candidate) => candidate.id === selectedItemId);
  if (!item) {
    type.textContent = drawMode ? String(drawMode).toUpperCase() : 'NONE';
    inspector.innerHTML = drawMode
      ? `<div class="pv-empty-state"><strong>${String(drawMode).toUpperCase()} TOOL ACTIVE</strong><span>Use the map to add geometry points.</span></div>`
      : '<div class="pv-empty-state"><strong>SELECT A MAP ITEM</strong><span>Edit geometry metadata, create a geofence, file it to a case, or add it to the incident timeline.</span></div>';
    return;
  }
  type.textContent = item.type.toUpperCase();
  const rule = state.rules.find((candidate) => candidate.areaId === item.id);
  const canFence = item.type === 'circle' || item.type === 'rectangle' || item.type === 'polygon';
  inspector.innerHTML = `
    <label>NAME<input data-item-field="name" maxlength="140" value="${escapeHtml(item.name)}"></label>
    <label>NOTES<textarea data-item-field="notes" rows="5" maxlength="20000">${escapeHtml(item.notes)}</textarea></label>
    <label>TAGS<input data-item-field="tags" value="${escapeHtml(item.tags.join(', '))}" placeholder="region, operation, infrastructure"></label>
    <label>COLOR<select data-item-field="color">
      ${['#c92f3e', '#d9902f', '#2f9e88', '#3b82b6', '#9f7aea', '#d9d2c3'].map((color) => `<option value="${color}" ${item.color === color ? 'selected' : ''}>${color.toUpperCase()}</option>`).join('')}
    </select></label>
    <label class="pv-inline-check"><input type="checkbox" data-item-field="visible" ${item.visible ? 'checked' : ''}> VISIBLE ON MAP</label>
    <div class="pv-inspector-stat"><span>GEOMETRY</span><strong>${escapeHtml(describeMapOperation(item))}</strong></div>
    <div class="pv-inspector-actions">
      <button data-item-action="save">SAVE</button>
      <button data-item-action="fit">FIT MAP</button>
      <button data-item-action="case">SEND TO CASE</button>
      <button data-item-action="timeline">ADD TO TIMELINE</button>
      ${canFence ? `<button data-item-action="geofence">${rule ? 'EDIT GEOFENCE' : 'CREATE GEOFENCE'}</button>` : ''}
      <button data-item-action="delete" class="danger">DELETE</button>
    </div>
  `;
  inspector.querySelector<HTMLButtonElement>('[data-item-action="save"]')?.addEventListener('click', saveInspector);
  inspector.querySelector<HTMLButtonElement>('[data-item-action="fit"]')?.addEventListener('click', () => fitItem(item));
  inspector.querySelector<HTMLButtonElement>('[data-item-action="case"]')?.addEventListener('click', () => void fileToCase(item));
  inspector.querySelector<HTMLButtonElement>('[data-item-action="timeline"]')?.addEventListener('click', () => addToTimeline(item));
  inspector.querySelector<HTMLButtonElement>('[data-item-action="geofence"]')?.addEventListener('click', () => editGeofence(item));
  inspector.querySelector<HTMLButtonElement>('[data-item-action="delete"]')?.addEventListener('click', () => removeItem(item));
}

function saveInspector(): void {
  const item = state.items.find((candidate) => candidate.id === selectedItemId);
  const inspector = mount!.querySelector<HTMLElement>('[data-map-inspector]');
  if (!item || !inspector) return;
  const name = inspector.querySelector<HTMLInputElement>('[data-item-field="name"]')?.value.trim() || item.name;
  const notes = inspector.querySelector<HTMLTextAreaElement>('[data-item-field="notes"]')?.value ?? item.notes;
  const tags = (inspector.querySelector<HTMLInputElement>('[data-item-field="tags"]')?.value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const color = inspector.querySelector<HTMLSelectElement>('[data-item-field="color"]')?.value ?? item.color;
  const visible = inspector.querySelector<HTMLInputElement>('[data-item-field="visible"]')?.checked ?? item.visible;
  saveMapOperationItem({
    id: item.id,
    name,
    type: item.type,
    points: item.points,
    radiusKm: item.radiusKm,
    notes,
    tags,
    color,
    visible,
  });
  state = getMapOperationsState();
  renderItemList();
  renderInspector();
  updateMapData();
  status('MAP ITEM SAVED');
}

function editGeofence(item: MapOperationItem): void {
  const existing = state.rules.find((candidate) => candidate.areaId === item.id);
  const name = window.prompt('Geofence rule name:', existing?.name ?? `${item.name} Watch`)?.trim();
  if (!name) return;
  const keywords = window.prompt('Optional keywords, comma separated. Leave blank to match every geolocated item inside the area:', existing?.keywords.join(', ') ?? '') ?? '';
  const categories = window.prompt('Optional categories, comma separated:', existing?.categories.join(', ') ?? '') ?? '';
  const severityInput = window.prompt('Severity: info, watch, elevated, high, or critical', existing?.severity ?? 'watch')?.toLowerCase();
  const severity = severityInput === 'info' || severityInput === 'watch' || severityInput === 'elevated' || severityInput === 'high' || severityInput === 'critical' ? severityInput : 'watch';
  saveGeofenceRule({
    id: existing?.id,
    name,
    areaId: item.id,
    enabled: existing?.enabled ?? true,
    keywords: keywords.split(',').map((term) => term.trim()).filter(Boolean),
    categories: categories.split(',').map((term) => term.trim()).filter(Boolean),
    severity,
  });
  state = getMapOperationsState();
  renderInspector();
  renderRules();
  status('GEOFENCE RULE SAVED');
}

function renderRules(): void {
  const list = mount!.querySelector<HTMLElement>('[data-rule-list]');
  if (!list) return;
  list.innerHTML = state.rules.length ? state.rules.map((rule) => {
    const area = state.items.find((item) => item.id === rule.areaId);
    return `<article class="pv-geofence-rule ${rule.id === selectedRuleId ? 'selected' : ''}">
      <header><strong>${escapeHtml(rule.name)}</strong><span class="severity ${rule.severity}">${rule.severity.toUpperCase()}</span></header>
      <p>${escapeHtml(area?.name ?? 'Missing area')}</p>
      <small>${rule.keywords.length ? `KEYWORDS: ${escapeHtml(rule.keywords.join(', '))}` : 'ALL GEOLOCATED ITEMS'}${rule.categories.length ? ` · CATEGORIES: ${escapeHtml(rule.categories.join(', '))}` : ''}</small>
      <footer><label><input type="checkbox" data-rule-toggle="${rule.id}" ${rule.enabled ? 'checked' : ''}> ACTIVE</label><button data-rule-edit="${rule.id}">EDIT</button><button data-rule-delete="${rule.id}" class="danger">DELETE</button></footer>
    </article>`;
  }).join('') : '<div class="pv-empty-state">NO GEOFENCE RULES</div>';
  list.querySelectorAll<HTMLInputElement>('[data-rule-toggle]').forEach((toggle) => toggle.addEventListener('change', () => {
    const rule = state.rules.find((candidate) => candidate.id === toggle.dataset.ruleToggle);
    if (!rule) return;
    saveGeofenceRule({
      id: rule.id,
      name: rule.name,
      areaId: rule.areaId,
      enabled: toggle.checked,
      keywords: rule.keywords,
      categories: rule.categories,
      severity: rule.severity,
    });
    state = getMapOperationsState();
    renderRules();
  }));
  list.querySelectorAll<HTMLButtonElement>('[data-rule-edit]').forEach((button) => button.addEventListener('click', () => {
    const rule = state.rules.find((candidate) => candidate.id === button.dataset.ruleEdit);
    const area = rule && state.items.find((item) => item.id === rule.areaId);
    if (area) { selectedRuleId = rule!.id; selectedItemId = area.id; editGeofence(area); }
  }));
  list.querySelectorAll<HTMLButtonElement>('[data-rule-delete]').forEach((button) => button.addEventListener('click', () => {
    const rule = state.rules.find((candidate) => candidate.id === button.dataset.ruleDelete);
    if (!rule || !window.confirm(`Delete geofence rule “${rule.name}”?`)) return;
    deleteGeofenceRule(rule.id);
    state = getMapOperationsState();
    renderRules();
    renderInspector();
  }));
}

async function fileToCase(item: MapOperationItem): Promise<void> {
  await sendToCaseDesk({
    type: item.type === 'marker' ? 'event' : 'dataset',
    title: item.name,
    detail: `${item.notes || describeMapOperation(item)}\n\nGeometry type: ${item.type}.`,
    confidence: 'analyst',
    source: 'Project V Map Operations',
    metadata: {
      'Map Item ID': item.id,
      Geometry: item.type,
      Measurement: describeMapOperation(item),
      Coordinates: item.points.map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`).join(' | '),
      Tags: item.tags.join(', '),
    },
  });
}

function addToTimeline(item: MapOperationItem): void {
  handoff?.postMessage({
    type: 'timeline',
    item: {
      title: item.name,
      detail: item.notes || describeMapOperation(item),
      category: 'MAP OPERATIONS',
      source: 'Project V Map Desk',
      occurredAt: Date.now(),
      confidence: 'analyst',
      metadata: { itemId: item.id, geometry: item.type },
    },
  });
  status('SENT TO EVENT TIMELINE');
}

function removeItem(item: MapOperationItem): void {
  if (!window.confirm(`Delete “${item.name}” and its geofence rules?`)) return;
  deleteMapOperationItem(item.id);
  state = getMapOperationsState();
  selectedItemId = null;
  selectedRuleId = null;
  renderItemList();
  renderInspector();
  renderRules();
  updateMapData();
}

function exportGeoJson(): void {
  const payload = JSON.stringify(mapOperationsFeatureCollection(state), null, 2);
  download(`project-v-map-operations-${new Date().toISOString().slice(0, 10)}.geojson`, new Blob([payload], { type: 'application/geo+json' }));
}

function exportArchive(): void {
  const payload = JSON.stringify({ kind: 'project-v-map-operations', exportedAt: new Date().toISOString(), state }, null, 2);
  download(`project-v-map-operations-${new Date().toISOString().slice(0, 10)}.json`, new Blob([payload], { type: 'application/json' }));
}

async function importArchive(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (isProjectVMapArchive(parsed)) {
      replaceMapOperationsState(parsed.state);
    } else if (isGeoJsonFeatureCollection(parsed)) {
      for (const feature of parsed.features) importFeature(feature);
    } else {
      throw new Error('This file is not a Project V map archive or GeoJSON FeatureCollection.');
    }
    state = getMapOperationsState();
    renderItemList();
    renderInspector();
    renderRules();
    updateMapData();
    status('MAP ARCHIVE IMPORTED');
  } catch (error) {
    status(error instanceof Error ? error.message : 'Map import failed.', true);
  }
}


function isProjectVMapArchive(value: unknown): value is { state: unknown } {
  return Boolean(value && typeof value === 'object' && 'state' in value);
}

function isGeoJsonFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features);
}

function coordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function importFeature(feature: GeoJSON.Feature): void {
  const geometry = feature.geometry;
  if (!geometry) return;
  const name = typeof feature.properties?.name === 'string' ? feature.properties.name : 'Imported map item';
  const notes = typeof feature.properties?.notes === 'string' ? feature.properties.notes : '';
  const color = typeof feature.properties?.color === 'string' ? feature.properties.color : '#c92f3e';
  if (geometry.type === 'Point') {
    const point = coordinatePair(geometry.coordinates);
    if (point) saveMapOperationItem({ name, type: 'marker', points: [{ lon: point[0], lat: point[1] }], notes, tags: ['imported'], color, visible: true });
  } else if (geometry.type === 'LineString') {
    const points = geometry.coordinates.map(coordinatePair).filter((point): point is [number, number] => Boolean(point)).map(([lon, lat]) => ({ lon, lat }));
    if (points.length >= 2) saveMapOperationItem({ name, type: 'route', points, notes, tags: ['imported'], color, visible: true });
  } else if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0] ?? [];
    const coordinates = ring.length > 1 && JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
    const points = coordinates.map(coordinatePair).filter((point): point is [number, number] => Boolean(point)).map(([lon, lat]) => ({ lon, lat }));
    if (points.length >= 3) saveMapOperationItem({ name, type: 'polygon', points, notes, tags: ['imported'], color, visible: true });
  }
}

function saveSnapshot(): void {
  if (!map) return;
  try {
    map.getCanvas().toBlob((blob) => {
      if (!blob) { status('SNAPSHOT COULD NOT BE CREATED', true); return; }
      download(`project-v-map-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, blob);
      status('MAP SNAPSHOT SAVED');
    }, 'image/png');
  } catch (error) {
    status(error instanceof Error ? error.message : 'Map snapshot failed.', true);
  }
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function status(message: string, error = false): void {
  const element = mount!.querySelector<HTMLElement>('[data-map-status]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => { element.textContent = 'READY'; element.classList.remove('error'); }, 5000);
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    await tryInvokeTauri<void>('close_map_operations_window');
    return;
  }
  window.close();
}

const unsubscribe = subscribeMapOperations(() => {
  state = getMapOperationsState();
  if (selectedItemId && !state.items.some((item) => item.id === selectedItemId)) selectedItemId = null;
  renderItemList();
  renderInspector();
  renderRules();
  updateMapData();
});

window.addEventListener('beforeunload', () => {
  unsubscribe();
  handoff?.close();
  map?.remove();
});

renderShell();
initMap();
