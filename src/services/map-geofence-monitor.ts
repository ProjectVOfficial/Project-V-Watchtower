import type { AppContext } from '@/app/app-context';
import type { ProjectVOperationsCenter } from './operations-center';
import { findGeofenceMatches, subscribeMapOperations, type GeofenceCandidate } from './map-operations';

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function newsTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const timestamp = new Date(String(value ?? '')).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export class MapGeofenceMonitor {
  private readonly ctx: AppContext;
  private readonly operations: ProjectVOperationsCenter;
  private cleanupMap: (() => void) | null = null;
  private scanTimer: number | null = null;
  private boundDataUpdated = () => this.scan();
  private activeMatches = new Set<string>();

  constructor(ctx: AppContext, operations: ProjectVOperationsCenter) {
    this.ctx = ctx;
    this.operations = operations;
  }

  start(): void {
    if (this.scanTimer !== null) return;
    this.cleanupMap = subscribeMapOperations(() => this.scan());
    window.addEventListener('project-v-data-updated', this.boundDataUpdated);
    this.scanTimer = window.setInterval(() => this.scan(), 30_000);
    this.scan();
  }

  destroy(): void {
    this.cleanupMap?.();
    this.cleanupMap = null;
    window.removeEventListener('project-v-data-updated', this.boundDataUpdated);
    if (this.scanTimer !== null) window.clearInterval(this.scanTimer);
    this.scanTimer = null;
  }

  scan(): void {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const newsCandidates: GeofenceCandidate[] = this.ctx.allNews.flatMap((item) => {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return [];
      const timestamp = newsTimestamp(item.pubDate);
      if (timestamp < cutoff) return [];
      return [{
        id: `news:${hash(`${item.link}|${item.title}|${item.source}`)}`,
        title: item.title,
        source: item.source,
        link: item.link,
        category: item.threat?.category ? String(item.threat.category) : 'news',
        location: item.locationName,
        lat: Number(item.lat),
        lon: Number(item.lon),
        timestamp,
      }];
    });

    const military = this.ctx.intelligenceCache.military;
    const flightCandidates: GeofenceCandidate[] = (military?.flights ?? []).flatMap((item) => {
      const timestamp = newsTimestamp(item.lastSeen);
      if (timestamp < cutoff || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return [];
      const label = item.callsign || item.aircraftModel || item.registration || item.id;
      return [{
        id: `flight:${item.id}`,
        title: `${label} military flight detected`,
        source: item.enriched?.operatorName || item.operatorCountry || 'Military flight tracking',
        category: 'military-flight',
        location: item.destination || item.origin || item.operatorCountry,
        lat: item.lat,
        lon: item.lon,
        timestamp,
      }];
    });

    const vesselCandidates: GeofenceCandidate[] = (military?.vessels ?? []).flatMap((item) => {
      const timestamp = newsTimestamp(item.lastAisUpdate);
      if (timestamp < cutoff || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return [];
      return [{
        id: `vessel:${item.id}`,
        title: `${item.name || item.hullNumber || item.id} military vessel detected`,
        source: item.operatorCountry || 'Military vessel tracking',
        link: item.usniArticleUrl,
        category: 'military-vessel',
        location: item.nearChokepoint || item.nearBase || item.usniRegion || item.destination,
        lat: item.lat,
        lon: item.lon,
        timestamp,
      }];
    });

    const earthquakeCandidates: GeofenceCandidate[] = (this.ctx.intelligenceCache.earthquakes ?? []).flatMap((item) => {
      const timestamp = newsTimestamp(item.occurredAt);
      const lat = item.location?.latitude;
      const lon = item.location?.longitude;
      if (timestamp < cutoff || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return [{
        id: `earthquake:${item.id}`,
        title: `M${item.magnitude.toFixed(1)} earthquake — ${item.place}`,
        source: 'Earthquake feed',
        link: item.sourceUrl,
        category: 'earthquake',
        location: item.place,
        lat: Number(lat),
        lon: Number(lon),
        timestamp,
      }];
    });

    const matches = findGeofenceMatches([...newsCandidates, ...flightCandidates, ...vesselCandidates, ...earthquakeCandidates]);
    const currentMatches = new Set<string>();
    for (const match of matches) {
      const { rule, area, candidate } = match;
      const activeKey = `${rule.id}:${candidate.id}`;
      currentMatches.add(activeKey);
      if (this.activeMatches.has(activeKey)) continue;
      const dynamic = candidate.category === 'military-flight' || candidate.category === 'military-vessel';
      const timeBucket = dynamic ? `:${Math.floor(candidate.timestamp / 3_600_000)}` : '';
      this.operations.addExternalAlert({
        title: candidate.title,
        detail: `Matched geofence “${rule.name}” inside ${area.name}.`,
        severity: rule.severity,
        category: 'GEOFENCE',
        source: candidate.source || 'Watchtower',
        link: candidate.link,
        location: candidate.location || area.name,
        sourceTime: candidate.timestamp,
        ruleId: rule.id,
        fingerprint: `geofence:${rule.id}:${candidate.id}${timeBucket}`,
      });
    }
    this.activeMatches = currentMatches;
  }
}
