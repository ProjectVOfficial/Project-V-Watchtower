import type { PopupType } from '@/components/MapPopup';
import type { OperationalSeverity } from './operations-center';

export interface MapPopupIntelligenceItem {
  id: string;
  type: PopupType;
  title: string;
  detail: string;
  category: string;
  source: string;
  sourceUrl?: string;
  location?: string;
  lat?: number;
  lon?: number;
  severity: OperationalSeverity;
  occurredAt: number;
  raw: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(source: Record<string, unknown>, keys: string[], max = 800): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  return '';
}

function number(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function nestedCoordinates(source: Record<string, unknown>): { lat?: number; lon?: number } {
  const location = record(source.location);
  const coordinates = Array.isArray(source.coordinates) ? source.coordinates : [];
  const geometry = record(source.geometry);
  const geometryCoordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const lat = number(source, ['lat', 'latitude']) ?? number(location, ['lat', 'latitude'])
    ?? (typeof coordinates[1] === 'number' ? coordinates[1] : undefined)
    ?? (typeof geometryCoordinates[1] === 'number' ? geometryCoordinates[1] : undefined);
  const lon = number(source, ['lon', 'lng', 'longitude']) ?? number(location, ['lon', 'lng', 'longitude'])
    ?? (typeof coordinates[0] === 'number' ? coordinates[0] : undefined)
    ?? (typeof geometryCoordinates[0] === 'number' ? geometryCoordinates[0] : undefined);
  return {
    lat: lat !== undefined && lat >= -90 && lat <= 90 ? lat : undefined,
    lon: lon !== undefined && lon >= -180 && lon <= 180 ? lon : undefined,
  };
}

function severity(value: string, type: PopupType): OperationalSeverity {
  const normalized = value.toLowerCase();
  if (/critical|extreme|total|catastrophic/.test(normalized)) return 'critical';
  if (/high|major|severe|red/.test(normalized)) return 'high';
  if (/medium|elevated|moderate|orange/.test(normalized)) return 'elevated';
  if (/low|minor|watch|yellow/.test(normalized)) return 'watch';
  if (type === 'conflict' || type === 'iranEvent' || type === 'cyberThreat') return 'high';
  return 'watch';
}

function timestamp(source: Record<string, unknown>): number {
  for (const key of ['occurredAt', 'timestamp', 'reportedAt', 'updatedAt', 'startDate', 'date', 'time']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Date.now();
}

function compactRaw(source: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source).slice(0, 40)) {
    if (typeof value === 'string') output[key] = value.slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) output[key] = value;
  }
  return output;
}

export function normalizeMapPopupIntelligence(type: PopupType, value: unknown): MapPopupIntelligenceItem {
  const source = record(value);
  const firstItem = Array.isArray(source.items) && source.items.length ? record(source.items[0]) : {};
  const merged = Object.keys(firstItem).length ? { ...firstItem, ...source } : source;
  const coords = nestedCoordinates(merged);
  const title = text(merged, ['title', 'name', 'event', 'headline', 'place', 'locationName', 'shortName', 'city', 'region'], 220)
    || `${type.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').toUpperCase()} MAP SIGNAL`;
  const detail = text(merged, ['description', 'detail', 'headline', 'summary', 'cause', 'reason', 'notes', 'message'], 2000);
  const location = text(merged, ['locationName', 'place', 'areaDesc', 'location', 'city', 'region', 'country'], 180) || undefined;
  const sourceName = text(merged, ['source', 'provider', 'agency', 'operator', 'owner'], 100) || 'Watchtower Map';
  const sourceUrl = text(merged, ['sourceUrl', 'url', 'link', 'reportUrl'], 1000) || undefined;
  const severityValue = text(merged, ['severity', 'intensity', 'level', 'status', 'risk'], 80);
  const identifier = text(merged, ['id', 'eventId', 'h3', 'icao24', 'mmsi'], 120) || `${title}|${coords.lat ?? ''}|${coords.lon ?? ''}`;
  return {
    id: `${type}:${identifier}`,
    type,
    title,
    detail,
    category: type.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').trim().toUpperCase(),
    source: sourceName,
    sourceUrl,
    location,
    lat: coords.lat,
    lon: coords.lon,
    severity: severity(severityValue, type),
    occurredAt: timestamp(merged),
    raw: compactRaw(merged),
  };
}
