import type { AppContext } from '@/app/app-context';
import type { NewsItem } from '@/types';
import { inspectLocalAi } from '@/services/local-ai-command';
import { speakProjectVText } from '@/services/voice-control';
import { sendOperationalAlertToPhoenix, sendPhoenixIntelligenceAlert } from '@/services/phoenix-ai-bridge';
import {
  RUNTIME_FEATURES,
  isFeatureAvailable,
  isFeatureEnabled,
  subscribeRuntimeConfig,
} from '@/services/runtime-config';

export type OperationalSeverity = 'info' | 'watch' | 'elevated' | 'high' | 'critical';
export type OperationalAlertStatus = 'open' | 'acknowledged' | 'resolved';
export type AlertRuleKind = 'keyword' | 'source' | 'news-volume';
export type TimelineConfidence = 'confirmed' | 'unverified' | 'disputed' | 'analyst';
export type SourceHealthState = 'online' | 'degraded' | 'offline' | 'missing' | 'disabled';

export interface OperationalAlert {
  id: string;
  fingerprint: string;
  title: string;
  detail: string;
  severity: OperationalSeverity;
  category: string;
  source: string;
  link?: string;
  location?: string;
  workspaceId: string;
  ruleId?: string;
  watchlistId?: string;
  detectedAt: number;
  sourceTime?: number;
  status: OperationalAlertStatus;
}

export interface AlertRule {
  id: string;
  name: string;
  kind: AlertRuleKind;
  query: string;
  threshold: number;
  severity: OperationalSeverity;
  enabled: boolean;
  createdAt: number;
}

export interface Watchlist {
  id: string;
  name: string;
  terms: string[];
  enabled: boolean;
  severity: OperationalSeverity;
  createdAt: number;
  matchCount: number;
  lastMatchAt?: number;
}

export interface PhoenixSentinel {
  id: string;
  name: string;
  terms: string[];
  enabled: boolean;
  minimumSeverity: OperationalSeverity;
  createdAt: number;
  matchCount: number;
  lastMatchAt?: number;
  lastTitle?: string;
  seenFingerprints: string[];
}

export interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  category: string;
  source: string;
  link?: string;
  occurredAt: number;
  addedAt: number;
  confidence: TimelineConfidence;
  alertId?: string;
  workspaceId: string;
}

export interface SourceHealthRecord {
  id: string;
  name: string;
  state: SourceHealthState;
  detail: string;
  lastCheckedAt: number;
  lastSuccessAt?: number;
  action?: 'settings' | 'retry';
}

export interface NotificationPreferences {
  enabled: boolean;
  desktop: boolean;
  sound: boolean;
  spoken: boolean;
  spokenMinimumSeverity: OperationalSeverity;
  minimumSeverity: OperationalSeverity;
  quietMode: boolean;
}

interface PersistedOperationsState {
  version: 1;
  alerts: OperationalAlert[];
  rules: AlertRule[];
  watchlists: Watchlist[];
  sentinels: PhoenixSentinel[];
  timeline: TimelineEvent[];
  notifications: NotificationPreferences;
}

const STORAGE_KEY = 'project-v-operations-center-v1';
const MAX_ALERTS = 500;
const MAX_TIMELINE = 1000;
const SCAN_INTERVAL_MS = 20_000;
const HEALTH_INTERVAL_MS = 60_000;
const NEW_ITEM_WINDOW_MS = 12 * 60 * 60 * 1000;
const EVENT_NAME = 'project-v-operations-change';

const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  enabled: true,
  desktop: false,
  sound: false,
  spoken: false,
  spokenMinimumSeverity: 'high',
  minimumSeverity: 'high',
  quietMode: false,
};

const SEVERITY_RANK: Record<OperationalSeverity, number> = {
  info: 0,
  watch: 1,
  elevated: 2,
  high: 3,
  critical: 4,
};

function cleanText(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}


function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function validSeverity(value: unknown): value is OperationalSeverity {
  return value === 'info' || value === 'watch' || value === 'elevated' || value === 'high' || value === 'critical';
}

function validAlertStatus(value: unknown): value is OperationalAlertStatus {
  return value === 'open' || value === 'acknowledged' || value === 'resolved';
}

const SENTINEL_STOP_WORDS = new Set([
  'alert', 'area', 'center', 'conflict', 'critical', 'current', 'event', 'high', 'incident',
  'intelligence', 'monitor', 'operation', 'operations', 'project', 'region', 'signal', 'the',
  'watch', 'watchtower', 'with', 'zone', 'eastern', 'western', 'northern', 'southern',
]);

function normalizeSentinelTerms(terms: string[]): string[] {
  return Array.from(new Set(terms
    .map((term) => cleanText(term, 80).toLowerCase())
    .filter((term) => term.length >= 3 && !SENTINEL_STOP_WORDS.has(term))))
    .slice(0, 24);
}

function deriveSentinelTerms(title: string, location = '', category = ''): string[] {
  const tokens = `${title} ${location} ${category}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const normalized = normalizeSentinelTerms(tokens);
  return normalized.length > 0 ? normalized : normalizeSentinelTerms([title]);
}

function sentinelFingerprintForNews(item: NewsItem): string {
  return fingerprint(`${item.title}|${item.source}|${item.link}`);
}

function parseState(): PersistedOperationsState {
  const empty: PersistedOperationsState = {
    version: 1,
    alerts: [],
    rules: [],
    watchlists: [],
    sentinels: [],
    timeline: [],
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedOperationsState>;
    if (parsed.version !== 1) return empty;
    const alerts = Array.isArray(parsed.alerts) ? parsed.alerts.filter((item): item is OperationalAlert => Boolean(
      item && typeof item.id === 'string' && typeof item.fingerprint === 'string' && typeof item.title === 'string'
      && validSeverity(item.severity) && validAlertStatus(item.status) && typeof item.detectedAt === 'number',
    )).slice(-MAX_ALERTS) : [];
    const rules = Array.isArray(parsed.rules) ? parsed.rules.filter((item): item is AlertRule => Boolean(
      item && typeof item.id === 'string' && typeof item.name === 'string'
      && (item.kind === 'keyword' || item.kind === 'source' || item.kind === 'news-volume')
      && validSeverity(item.severity),
    )) : [];
    const watchlists = Array.isArray(parsed.watchlists) ? parsed.watchlists.filter((item): item is Watchlist => Boolean(
      item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.terms)
      && validSeverity(item.severity),
    )) : [];
    const sentinels = Array.isArray(parsed.sentinels) ? parsed.sentinels.filter((item): item is PhoenixSentinel => Boolean(
      item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.terms)
      && validSeverity(item.minimumSeverity),
    )).map((item) => ({
      ...item,
      terms: item.terms.map((term) => cleanText(term, 80).toLowerCase()).filter(Boolean).slice(0, 24),
      seenFingerprints: Array.isArray(item.seenFingerprints)
        ? item.seenFingerprints.filter((value): value is string => typeof value === 'string').slice(-250)
        : [],
      matchCount: Number.isFinite(item.matchCount) ? Math.max(0, item.matchCount) : 0,
    })) : [];
    const timeline = Array.isArray(parsed.timeline) ? parsed.timeline.filter((item): item is TimelineEvent => Boolean(
      item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.occurredAt === 'number',
    )).slice(-MAX_TIMELINE) : [];
    const notifications = parsed.notifications && validSeverity(parsed.notifications.minimumSeverity)
      ? {
        ...DEFAULT_NOTIFICATIONS,
        ...parsed.notifications,
        spokenMinimumSeverity: validSeverity(parsed.notifications.spokenMinimumSeverity)
          ? parsed.notifications.spokenMinimumSeverity
          : DEFAULT_NOTIFICATIONS.spokenMinimumSeverity,
      }
      : { ...DEFAULT_NOTIFICATIONS };
    return { version: 1, alerts, rules, watchlists, sentinels, timeline, notifications };
  } catch {
    return empty;
  }
}

function newsTimestamp(item: NewsItem): number {
  const value = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
  return Number.isFinite(value) ? value : Date.now();
}

function severityFromNews(item: NewsItem): OperationalSeverity {
  const level = item.threat?.level;
  if (level === 'critical') return 'critical';
  if (level === 'high') return 'high';
  if (level === 'medium') return 'elevated';
  return item.isAlert ? 'high' : 'watch';
}

function currentWorkspaceId(): string {
  return document.body.dataset.activeDeck || 'watchtower';
}

export class ProjectVOperationsCenter {
  private readonly ctx: AppContext;
  private state = parseState();
  private health: SourceHealthRecord[] = [];
  private scanTimer: number | null = null;
  private healthTimer: number | null = null;
  private runtimeCleanup: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private initialized = false;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  start(): void {
    if (this.initialized) return;
    this.initialized = true;
    const breakingHandler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
      const headline = cleanText(detail.headline, 260) || 'Breaking intelligence alert';
      const source = cleanText(detail.source, 80) || 'Breaking News';
      const link = cleanText(detail.link, 600) || undefined;
      const level = detail.threatLevel === 'critical' ? 'critical' : 'high';
      this.addAlert({
        title: headline,
        detail: 'Raised by the Watchtower breaking-news classifier.',
        severity: level,
        category: 'BREAKING',
        source,
        link,
        sourceTime: detail.timestamp instanceof Date ? detail.timestamp.getTime() : Date.now(),
        fingerprint: `breaking:${fingerprint(`${headline}|${source}|${link ?? ''}`)}`,
      });
    };
    const dataUpdatedHandler = () => {
      this.scan();
      void this.refreshHealth();
    };
    document.addEventListener('wm:breaking-news', breakingHandler);
    window.addEventListener('project-v-data-updated', dataUpdatedHandler);
    this.runtimeCleanup = subscribeRuntimeConfig(() => void this.refreshHealth());
    this.scanTimer = window.setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    this.healthTimer = window.setInterval(() => void this.refreshHealth(), HEALTH_INTERVAL_MS);
    this.cleanupCallbacks.push(() => document.removeEventListener('wm:breaking-news', breakingHandler));
    this.cleanupCallbacks.push(() => window.removeEventListener('project-v-data-updated', dataUpdatedHandler));
    this.scan();
    void this.refreshHealth();
  }

  private cleanupCallbacks: Array<() => void> = [];

  destroy(): void {
    if (this.scanTimer !== null) window.clearInterval(this.scanTimer);
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.scanTimer = null;
    this.healthTimer = null;
    this.runtimeCleanup?.();
    this.runtimeCleanup = null;
    this.cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
    this.listeners.clear();
    this.initialized = false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAlerts(): OperationalAlert[] {
    return [...this.state.alerts].sort((a, b) => b.detectedAt - a.detectedAt);
  }

  getRules(): AlertRule[] {
    return [...this.state.rules].sort((a, b) => b.createdAt - a.createdAt);
  }

  getWatchlists(): Watchlist[] {
    return [...this.state.watchlists].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPhoenixSentinels(): PhoenixSentinel[] {
    return [...this.state.sentinels].sort((a, b) => b.createdAt - a.createdAt);
  }

  getTimeline(): TimelineEvent[] {
    return [...this.state.timeline].sort((a, b) => b.occurredAt - a.occurredAt);
  }

  getSourceHealth(): SourceHealthRecord[] {
    return [...this.health];
  }

  getNotificationPreferences(): NotificationPreferences {
    return { ...this.state.notifications };
  }

  addRule(input: Omit<AlertRule, 'id' | 'createdAt'>): AlertRule {
    const rule: AlertRule = {
      ...input,
      id: uniqueId('rule'),
      name: cleanText(input.name, 64) || 'UNTITLED RULE',
      query: cleanText(input.query, 200),
      threshold: Math.max(1, Math.min(1000, Math.round(input.threshold || 1))),
      createdAt: Date.now(),
    };
    this.state.rules.push(rule);
    this.commit();
    this.scan();
    return rule;
  }

  updateRule(id: string, patch: Partial<Pick<AlertRule, 'enabled' | 'name' | 'severity'>>): void {
    const rule = this.state.rules.find((item) => item.id === id);
    if (!rule) return;
    if (typeof patch.enabled === 'boolean') rule.enabled = patch.enabled;
    if (typeof patch.name === 'string') rule.name = cleanText(patch.name, 64) || rule.name;
    if (patch.severity && validSeverity(patch.severity)) rule.severity = patch.severity;
    this.commit();
  }

  deleteRule(id: string): void {
    this.state.rules = this.state.rules.filter((item) => item.id !== id);
    this.commit();
  }

  addWatchlist(name: string, terms: string[], severity: OperationalSeverity): Watchlist {
    const normalized = Array.from(new Set(terms.map((term) => cleanText(term, 80).toLowerCase()).filter(Boolean))).slice(0, 50);
    const watchlist: Watchlist = {
      id: uniqueId('watch'),
      name: cleanText(name, 64) || 'UNTITLED WATCHLIST',
      terms: normalized,
      severity,
      enabled: true,
      createdAt: Date.now(),
      matchCount: 0,
    };
    this.state.watchlists.push(watchlist);
    this.commit();
    this.scan();
    return watchlist;
  }

  toggleWatchlist(id: string, enabled: boolean): void {
    const item = this.state.watchlists.find((watchlist) => watchlist.id === id);
    if (!item) return;
    item.enabled = enabled;
    this.commit();
  }

  deleteWatchlist(id: string): void {
    this.state.watchlists = this.state.watchlists.filter((item) => item.id !== id);
    this.commit();
  }

  addPhoenixSentinel(
    name: string,
    terms: string[],
    minimumSeverity: OperationalSeverity = 'watch',
  ): PhoenixSentinel {
    const normalizedTerms = normalizeSentinelTerms(terms);
    if (normalizedTerms.length === 0) throw new Error('A Phoenix Sentinel needs at least one useful monitoring term.');
    const normalizedName = cleanText(name, 80) || 'UNTITLED SENTINEL';
    const existing = this.state.sentinels.find((item) =>
      item.name.toLowerCase() === normalizedName.toLowerCase()
      && item.terms.length === normalizedTerms.length
      && item.terms.every((term) => normalizedTerms.includes(term))
    );
    if (existing) {
      existing.enabled = true;
      this.commit();
      return existing;
    }
    const sentinel: PhoenixSentinel = {
      id: uniqueId('sentinel'),
      name: normalizedName,
      terms: normalizedTerms,
      enabled: true,
      minimumSeverity: validSeverity(minimumSeverity) ? minimumSeverity : 'watch',
      createdAt: Date.now(),
      matchCount: 0,
      seenFingerprints: [],
    };

    // Prime currently loaded matching headlines so arming a monitor does not flood Phoenix with old items.
    this.primePhoenixSentinel(sentinel);
    this.state.sentinels.push(sentinel);
    this.commit();

    void sendPhoenixIntelligenceAlert({
      id: `sentinel-armed:${sentinel.id}`,
      title: `Phoenix Sentinel armed: ${sentinel.name}`,
      severity: 'info',
      summary: `Watchtower will monitor newly loaded headlines for: ${sentinel.terms.join(', ')}. Minimum incoming severity: ${sentinel.minimumSeverity.toUpperCase()}+. Monitoring runs while Watchtower is open.`,
      source: 'Project V Watchtower · Phoenix Sentinel',
    });
    return sentinel;
  }

  addPhoenixSentinelFromAlert(alertId: string): PhoenixSentinel | null {
    const alert = this.state.alerts.find((item) => item.id === alertId);
    if (!alert) return null;
    return this.addPhoenixSentinel(
      alert.title,
      deriveSentinelTerms(alert.title, alert.location ?? '', alert.category),
      'watch',
    );
  }

  addPhoenixSentinelFromSignal(input: { title: string; location?: string; category?: string }): PhoenixSentinel {
    return this.addPhoenixSentinel(
      input.title,
      deriveSentinelTerms(input.title, input.location ?? '', input.category ?? ''),
      'watch',
    );
  }

  togglePhoenixSentinel(id: string, enabled: boolean): void {
    const sentinel = this.state.sentinels.find((item) => item.id === id);
    if (!sentinel) return;
    sentinel.enabled = enabled;
    if (enabled) this.primePhoenixSentinel(sentinel);
    this.commit();
  }

  updatePhoenixSentinelMinimumSeverity(id: string, minimumSeverity: OperationalSeverity): void {
    if (!validSeverity(minimumSeverity)) return;
    const sentinel = this.state.sentinels.find((item) => item.id === id);
    if (!sentinel) return;
    sentinel.minimumSeverity = minimumSeverity;
    this.primePhoenixSentinel(sentinel);
    this.commit();
  }

  deletePhoenixSentinel(id: string): void {
    this.state.sentinels = this.state.sentinels.filter((item) => item.id !== id);
    this.commit();
  }

  testPhoenixSentinel(id: string): boolean {
    const sentinel = this.state.sentinels.find((item) => item.id === id);
    if (!sentinel || !sentinel.enabled || sentinel.terms.length === 0) return false;

    // Deterministic diagnostic: inject one synthetic *new* headline through the
    // exact Sentinel matcher. Critical severity guarantees the item can satisfy
    // any configured Sentinel threshold from WATCH+ through CRITICAL+.
    const testTerm = sentinel.terms[0];
    const testItem: NewsItem = {
      source: 'Project V Watchtower Sentinel Test',
      title: `Sentinel test match · ${sentinel.name} · ${testTerm}`,
      link: `https://example.invalid/project-v-sentinel-test/${encodeURIComponent(sentinel.id)}/${Date.now()}`,
      pubDate: new Date(),
      isAlert: true,
      threat: ({ level: 'critical' } as NewsItem['threat']),
      locationName: 'Synthetic Sentinel test signal',
    };

    const before = sentinel.matchCount;
    this.processPhoenixSentinels(testItem);
    return sentinel.matchCount > before;
  }

  acknowledgeAlert(id: string): void {
    const alert = this.state.alerts.find((item) => item.id === id);
    if (!alert) return;
    alert.status = alert.status === 'open' ? 'acknowledged' : 'open';
    this.commit();
  }

  resolveAlert(id: string): void {
    const alert = this.state.alerts.find((item) => item.id === id);
    if (!alert) return;
    alert.status = 'resolved';
    this.commit();
  }

  clearResolvedAlerts(): void {
    this.state.alerts = this.state.alerts.filter((item) => item.status !== 'resolved');
    this.commit();
  }

  addExternalAlert(input: {
    title: string;
    detail: string;
    severity: OperationalSeverity;
    category: string;
    source: string;
    fingerprint: string;
    link?: string;
    location?: string;
    sourceTime?: number;
    ruleId?: string;
  }): boolean {
    return this.addAlert(input);
  }

  addAlertToTimeline(alertId: string): void {
    const alert = this.state.alerts.find((item) => item.id === alertId);
    if (!alert) return;
    if (this.state.timeline.some((item) => item.alertId === alertId)) return;
    this.addTimelineEvent({
      title: alert.title,
      detail: alert.detail,
      category: alert.category,
      source: alert.source,
      link: alert.link,
      occurredAt: alert.sourceTime ?? alert.detectedAt,
      confidence: alert.severity === 'critical' || alert.severity === 'high' ? 'unverified' : 'analyst',
      alertId,
    });
  }

  addTimelineEvent(input: Omit<TimelineEvent, 'id' | 'addedAt' | 'workspaceId'>): TimelineEvent {
    const event: TimelineEvent = {
      ...input,
      id: uniqueId('timeline'),
      title: cleanText(input.title, 220) || 'Untitled event',
      detail: cleanText(input.detail, 2000),
      category: cleanText(input.category, 60) || 'ANALYST',
      source: cleanText(input.source, 100) || 'Analyst',
      link: safeUrl(input.link),
      addedAt: Date.now(),
      workspaceId: currentWorkspaceId(),
    };
    this.state.timeline.push(event);
    this.state.timeline = this.state.timeline.slice(-MAX_TIMELINE);
    this.commit();
    return event;
  }

  deleteTimelineEvent(id: string): void {
    this.state.timeline = this.state.timeline.filter((item) => item.id !== id);
    this.commit();
  }

  clearTimeline(): void {
    this.state.timeline = [];
    this.commit();
  }

  exportTimelineMarkdown(): string {
    const lines = ['# Project V Watchtower — Event Timeline', '', `Exported: ${new Date().toISOString()}`, ''];
    for (const event of this.getTimeline().reverse()) {
      lines.push(`## ${new Date(event.occurredAt).toISOString()} — ${event.title}`);
      lines.push(`- Confidence: ${event.confidence}`);
      lines.push(`- Category: ${event.category}`);
      lines.push(`- Source: ${event.source}`);
      if (event.link) lines.push(`- Link: ${event.link}`);
      if (event.detail) lines.push('', event.detail);
      lines.push('');
    }
    return lines.join('\n');
  }

  async updateNotificationPreferences(patch: Partial<NotificationPreferences>): Promise<void> {
    this.state.notifications = { ...this.state.notifications, ...patch };
    if (patch.desktop === true && 'Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') this.state.notifications.desktop = false;
    }
    this.commit();
  }

  scan(): void {
    const cutoff = Date.now() - NEW_ITEM_WINDOW_MS;
    const items = this.ctx.allNews.filter((item) => newsTimestamp(item) >= cutoff).slice(0, 1000);
    this.processVolumeRules(items);
    for (const item of items) {
      if (item.isAlert) this.processBuiltInNewsAlert(item);
      this.processRules(item);
      this.processWatchlists(item);
      this.processPhoenixSentinels(item);
    }
  }

  async refreshHealth(): Promise<void> {
    const now = Date.now();
    const latestNews = this.ctx.allNews.reduce((latest, item) => Math.max(latest, newsTimestamp(item)), 0);
    const newsAge = latestNews > 0 ? now - latestNews : Number.POSITIVE_INFINITY;
    const records: SourceHealthRecord[] = [
      {
        id: 'network',
        name: 'Network connection',
        state: navigator.onLine ? 'online' : 'offline',
        detail: navigator.onLine ? 'Browser reports an active network connection.' : 'Browser is offline.',
        lastCheckedAt: now,
        lastSuccessAt: navigator.onLine ? now : undefined,
      },
      {
        id: 'news',
        name: 'World news ingestion',
        state: this.ctx.allNews.length === 0 ? 'degraded' : newsAge > 6 * 60 * 60 * 1000 ? 'degraded' : 'online',
        detail: this.ctx.allNews.length === 0
          ? 'No headlines have been loaded yet.'
          : `${this.ctx.allNews.length} headlines loaded; newest item ${Math.max(0, Math.round(newsAge / 60_000))} minutes old.`,
        lastCheckedAt: now,
        lastSuccessAt: latestNews || undefined,
        action: 'retry',
      },
    ];

    const ai = await inspectLocalAi().catch(() => null);
    records.push({
      id: 'ollama',
      name: 'Local AI / Ollama',
      state: !ai?.configured ? 'missing' : ai.connected ? 'online' : 'offline',
      detail: ai?.message ?? 'Unable to inspect local AI.',
      lastCheckedAt: now,
      lastSuccessAt: ai?.connected ? now : undefined,
      action: 'settings',
    });

    const selectedFeatureIds = new Set(['nasaFirms', 'economicFred', 'finnhubMarkets', 'openskyRelay', 'aisRelay', 'acledConflicts']);
    for (const feature of RUNTIME_FEATURES.filter((item) => selectedFeatureIds.has(item.id))) {
      const enabled = isFeatureEnabled(feature.id);
      const available = isFeatureAvailable(feature.id);
      records.push({
        id: `feature:${feature.id}`,
        name: feature.name,
        state: !enabled ? 'disabled' : available ? 'online' : 'missing',
        detail: !enabled ? 'Feature is disabled.' : available ? 'Required local configuration is available.' : feature.fallback,
        lastCheckedAt: now,
        lastSuccessAt: available ? now : undefined,
        action: available ? undefined : 'settings',
      });
    }
    this.health = records;
    this.notify();
  }

  private processBuiltInNewsAlert(item: NewsItem): void {
    const title = cleanText(item.title, 260);
    const source = cleanText(item.source, 100) || 'News';
    this.addAlert({
      title,
      detail: item.threat ? `Flagged by the ${item.threat.source} classifier with ${Math.round(item.threat.confidence * 100)}% confidence.` : 'Flagged by an existing Watchtower source or classifier.',
      severity: severityFromNews(item),
      category: item.threat?.category ? String(item.threat.category).toUpperCase() : 'NEWS',
      source,
      link: item.link,
      location: item.locationName,
      sourceTime: newsTimestamp(item),
      fingerprint: `news:${fingerprint(`${title}|${source}|${item.link}`)}`,
    });
  }

  private processRules(item: NewsItem): void {
    const title = item.title.toLowerCase();
    const source = item.source.toLowerCase();
    for (const rule of this.state.rules) {
      if (!rule.enabled) continue;
      let matched = false;
      if (rule.kind === 'keyword') {
        const terms = rule.query.toLowerCase().split(',').map((term) => term.trim()).filter(Boolean);
        matched = terms.some((term) => title.includes(term));
      } else if (rule.kind === 'source') {
        matched = source.includes(rule.query.toLowerCase());
      } else {
        continue;
      }
      if (!matched) continue;
      this.addAlert({
        title: item.title,
        detail: `Matched custom rule “${rule.name}”.`,
        severity: rule.severity,
        category: 'CUSTOM RULE',
        source: item.source,
        link: item.link,
        location: item.locationName,
        sourceTime: newsTimestamp(item),
        fingerprint: `rule:${rule.id}:${fingerprint(`${item.title}|${item.source}|${item.link}`)}`,
        ruleId: rule.id,
      });
    }
  }


  private processVolumeRules(currentItems: NewsItem[]): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    for (const rule of this.state.rules) {
      if (!rule.enabled || rule.kind !== 'news-volume') continue;
      const query = rule.query.toLowerCase();
      const matches = currentItems.filter((candidate) => newsTimestamp(candidate) >= oneHourAgo && (!query || candidate.title.toLowerCase().includes(query)));
      if (matches.length < rule.threshold) continue;
      const newest = matches.sort((a, b) => newsTimestamp(b) - newsTimestamp(a))[0];
      this.addAlert({
        title: `${matches.length} matching headlines detected in the last hour`,
        detail: `Volume threshold for “${rule.name}” is ${rule.threshold}. Filter: ${rule.query || 'all headlines'}.`,
        severity: rule.severity,
        category: 'VOLUME RULE',
        source: newest?.source || 'Watchtower',
        link: newest?.link,
        sourceTime: newest ? newsTimestamp(newest) : Date.now(),
        fingerprint: `volume:${rule.id}:${hourBucket}`,
        ruleId: rule.id,
      });
    }
  }

  private processWatchlists(item: NewsItem): void {
    const haystack = `${item.title} ${item.source} ${item.locationName ?? ''}`.toLowerCase();
    for (const watchlist of this.state.watchlists) {
      if (!watchlist.enabled || watchlist.terms.length === 0) continue;
      const matches = watchlist.terms.filter((term) => haystack.includes(term));
      if (matches.length === 0) continue;
      const wasNew = this.addAlert({
        title: item.title,
        detail: `Matched ${watchlist.name}: ${matches.join(', ')}`,
        severity: watchlist.severity,
        category: 'WATCHLIST',
        source: item.source,
        link: item.link,
        location: item.locationName,
        sourceTime: newsTimestamp(item),
        fingerprint: `watch:${watchlist.id}:${fingerprint(`${item.title}|${item.source}|${item.link}`)}`,
        watchlistId: watchlist.id,
      });
      if (wasNew) {
        watchlist.matchCount += 1;
        watchlist.lastMatchAt = Date.now();
        this.persist();
      }
    }
  }

  private newsMatchesSentinel(item: NewsItem, sentinel: PhoenixSentinel): boolean {
    const haystack = `${item.title} ${item.source} ${item.locationName ?? ''}`.toLowerCase();
    if (!sentinel.terms.some((term) => haystack.includes(term))) return false;
    return SEVERITY_RANK[severityFromNews(item)] >= SEVERITY_RANK[sentinel.minimumSeverity];
  }

  private primePhoenixSentinel(sentinel: PhoenixSentinel): void {
    const seen = new Set(sentinel.seenFingerprints);
    for (const item of this.ctx.allNews.slice(0, 1500)) {
      if (this.newsMatchesSentinel(item, sentinel)) seen.add(sentinelFingerprintForNews(item));
    }
    sentinel.seenFingerprints = Array.from(seen).slice(-250);
  }

  private processPhoenixSentinels(item: NewsItem): void {
    if (this.state.sentinels.length === 0) return;
    const newsFingerprint = sentinelFingerprintForNews(item);
    for (const sentinel of this.state.sentinels) {
      if (!sentinel.enabled || sentinel.seenFingerprints.includes(newsFingerprint)) continue;
      if (!this.newsMatchesSentinel(item, sentinel)) continue;

      const matches = sentinel.terms.filter((term) => `${item.title} ${item.source} ${item.locationName ?? ''}`.toLowerCase().includes(term));
      sentinel.seenFingerprints.push(newsFingerprint);
      sentinel.seenFingerprints = sentinel.seenFingerprints.slice(-250);
      sentinel.matchCount += 1;
      sentinel.lastMatchAt = Date.now();
      sentinel.lastTitle = cleanText(item.title, 220);

      const severity = severityFromNews(item);
      const alertFingerprint = `sentinel:${sentinel.id}:${newsFingerprint}`;
      const wasNew = this.addAlert({
        title: item.title,
        detail: `Phoenix Sentinel “${sentinel.name}” matched: ${matches.join(', ')}.`,
        severity,
        category: 'PHOENIX SENTINEL',
        source: item.source,
        link: item.link,
        location: item.locationName,
        sourceTime: newsTimestamp(item),
        fingerprint: alertFingerprint,
      }, { skipPhoenixAutoForward: true });

      if (wasNew) {
        const created = this.state.alerts.find((alert) => alert.fingerprint === alertFingerprint);
        if (created) void sendOperationalAlertToPhoenix(created, { manual: true });
      }
      this.persist();
      this.notify();
    }
  }

  private addAlert(
    input: Omit<OperationalAlert, 'id' | 'detectedAt' | 'status' | 'workspaceId'>,
    options: { skipPhoenixAutoForward?: boolean } = {},
  ): boolean {
    if (this.state.alerts.some((alert) => alert.fingerprint === input.fingerprint)) return false;
    const alert: OperationalAlert = {
      ...input,
      link: safeUrl(input.link),
      id: uniqueId('alert'),
      detectedAt: Date.now(),
      status: 'open',
      workspaceId: currentWorkspaceId(),
    };
    this.state.alerts.push(alert);
    this.state.alerts = this.state.alerts.slice(-MAX_ALERTS);
    this.persist();
    this.notify();
    void this.notifyUser(alert);
    // Phoenix is an optional local consumer. Delivery failure never blocks Watchtower's own alert lifecycle.
    if (!options.skipPhoenixAutoForward) void sendOperationalAlertToPhoenix(alert);
    return true;
  }

  private async notifyUser(alert: OperationalAlert): Promise<void> {
    const prefs = this.state.notifications;
    if (!prefs.enabled || prefs.quietMode) return;
    const meetsGeneralThreshold = SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[prefs.minimumSeverity];
    const meetsSpokenThreshold = SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[prefs.spokenMinimumSeverity];
    if (meetsGeneralThreshold && prefs.desktop && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(`Project V ${alert.severity.toUpperCase()}`, {
        body: alert.title,
        tag: alert.fingerprint,
      });
      if (alert.link) notification.onclick = () => window.open(alert.link, '_blank', 'noopener');
    }
    if (meetsGeneralThreshold && prefs.sound) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = alert.severity === 'critical' ? 880 : 660;
        gain.gain.value = 0.025;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
      } catch { /* sound is best effort */ }
    }
    if (prefs.spoken && meetsSpokenThreshold) {
      const location = alert.location ? ` Location: ${alert.location}.` : '';
      speakProjectVText(`Project V Watchtower ${alert.severity} alert. ${alert.title}.${location}`);
    }
  }

  private commit(): void {
    this.persist();
    this.notify();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* local operational state is best effort */ }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
}
