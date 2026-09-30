import { hasTauriInvokeBridge, invokeTauri } from './tauri-bridge';
import type { OperationalAlert, OperationalSeverity } from './operations-center';

export type PhoenixBridgeMinimumSeverity = OperationalSeverity;

export interface PhoenixBridgeStore {
  version: 1;
  endpoint: string;
  paired: boolean;
  pairedAt?: number;
  autoForward: boolean;
  minimumSeverity: PhoenixBridgeMinimumSeverity;
}

export interface PhoenixBridgeRuntimeStatus {
  checking: boolean;
  online: boolean;
  paired: boolean;
  detail: string;
  checkedAt?: number;
}

export interface PhoenixBridgeSnapshot {
  config: PhoenixBridgeStore;
  runtime: PhoenixBridgeRuntimeStatus;
}

export interface PhoenixDeliveryResult {
  ok: boolean;
  skipped?: boolean;
  duplicate?: boolean;
  message: string;
}

export interface PhoenixIntelligenceAlert {
  id: string;
  title: string;
  severity: OperationalSeverity;
  summary: string;
  timestamp?: string;
  source?: string;
  location?: string;
}

const STORAGE_KEY = 'project-v-phoenix-ai-bridge-v1';
const EVENT_NAME = 'project-v-phoenix-ai-bridge-change';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:17871/api/watchtower/alert';

const SEVERITY_RANK: Record<OperationalSeverity, number> = {
  info: 0,
  watch: 1,
  elevated: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_STORE: PhoenixBridgeStore = {
  version: 1,
  endpoint: DEFAULT_ENDPOINT,
  paired: false,
  autoForward: true,
  minimumSeverity: 'high',
};

let runtimeStatus: PhoenixBridgeRuntimeStatus = {
  checking: false,
  online: false,
  paired: false,
  detail: 'NOT CHECKED',
};

function isSeverity(value: unknown): value is OperationalSeverity {
  return value === 'info' || value === 'watch' || value === 'elevated' || value === 'high' || value === 'critical';
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function normalizeEndpoint(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return DEFAULT_ENDPOINT;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:') return DEFAULT_ENDPOINT;
    const host = url.hostname.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') return DEFAULT_ENDPOINT;
    if (url.username || url.password || url.search || url.hash) return DEFAULT_ENDPOINT;
    if (url.pathname !== '/api/watchtower/alert') return DEFAULT_ENDPOINT;
    const port = Number(url.port || 80);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return DEFAULT_ENDPOINT;
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

function readStore(): PhoenixBridgeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STORE };
    const parsed = JSON.parse(raw) as Partial<PhoenixBridgeStore>;
    return {
      version: 1,
      endpoint: normalizeEndpoint(parsed.endpoint),
      paired: parsed.paired === true,
      pairedAt: typeof parsed.pairedAt === 'number' ? parsed.pairedAt : undefined,
      autoForward: parsed.autoForward !== false,
      minimumSeverity: isSeverity(parsed.minimumSeverity) ? parsed.minimumSeverity : 'high',
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

function writeStore(store: PhoenixBridgeStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  notify();
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

function updateRuntime(patch: Partial<PhoenixBridgeRuntimeStatus>): void {
  runtimeStatus = { ...runtimeStatus, ...patch };
  notify();
}

function parsePairingPayload(raw: string): { endpoint: string; token: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error('Phoenix pairing must be the JSON copied by Phoenix → Watchtower → Copy receiver pairing.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Phoenix pairing JSON is invalid.');
  const record = parsed as Record<string, unknown>;
  const endpointRaw = typeof record.endpoint === 'string' ? record.endpoint.trim() : '';
  const endpoint = normalizeEndpoint(endpointRaw);
  if (!endpointRaw || endpoint === DEFAULT_ENDPOINT && endpointRaw !== DEFAULT_ENDPOINT) {
    throw new Error('Phoenix pairing endpoint must be a loopback /api/watchtower/alert endpoint on port 1024 or higher.');
  }
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  if (token.length < 48 || token.length > 128 || !/^[a-f0-9]+$/i.test(token)) {
    throw new Error('Phoenix pairing token is missing or invalid. Copy a fresh receiver pairing from Phoenix.');
  }
  return { endpoint, token };
}

export function getPhoenixBridgeSnapshot(): PhoenixBridgeSnapshot {
  const config = readStore();
  return {
    config,
    runtime: { ...runtimeStatus, paired: config.paired && runtimeStatus.paired },
  };
}

export function setPhoenixBridgeAutoForward(enabled: boolean): void {
  const store = readStore();
  store.autoForward = enabled;
  writeStore(store);
}

export function setPhoenixBridgeMinimumSeverity(severity: PhoenixBridgeMinimumSeverity): void {
  if (!isSeverity(severity)) return;
  const store = readStore();
  store.minimumSeverity = severity;
  writeStore(store);
}

export async function pairPhoenixBridge(pairingJson: string): Promise<PhoenixBridgeSnapshot> {
  if (!hasTauriInvokeBridge()) throw new Error('Phoenix pairing requires the Watchtower desktop runtime.');
  const pairing = parsePairingPayload(pairingJson);
  await invokeTauri('configure_phoenix_bridge', pairing);
  const store = readStore();
  store.endpoint = pairing.endpoint;
  store.paired = true;
  store.pairedAt = Date.now();
  writeStore(store);
  await refreshPhoenixBridgeHealth();
  return getPhoenixBridgeSnapshot();
}

export async function disconnectPhoenixBridge(): Promise<void> {
  if (hasTauriInvokeBridge()) await invokeTauri('disconnect_phoenix_bridge');
  const store = readStore();
  store.paired = false;
  delete store.pairedAt;
  writeStore(store);
  updateRuntime({ paired: false, online: false, detail: 'NOT PAIRED', checkedAt: Date.now() });
}

export async function refreshPhoenixBridgeHealth(): Promise<PhoenixBridgeSnapshot> {
  const store = readStore();
  if (!hasTauriInvokeBridge()) {
    updateRuntime({ checking: false, paired: store.paired, online: false, detail: 'DESKTOP RUNTIME REQUIRED', checkedAt: Date.now() });
    return getPhoenixBridgeSnapshot();
  }
  updateRuntime({ checking: true, paired: store.paired, detail: 'CHECKING…' });
  try {
    const result = await invokeTauri<{ paired?: boolean; online?: boolean; detail?: string }>('phoenix_bridge_health', { endpoint: store.endpoint });
    updateRuntime({
      checking: false,
      paired: result?.paired === true,
      online: result?.online === true,
      detail: cleanText(result?.detail, 180) || (result?.online ? 'PHOENIX ONLINE' : 'PHOENIX OFFLINE'),
      checkedAt: Date.now(),
    });
  } catch (error) {
    updateRuntime({
      checking: false,
      paired: store.paired,
      online: false,
      detail: error instanceof Error ? cleanText(error.message, 180) : 'PHOENIX OFFLINE',
      checkedAt: Date.now(),
    });
  }
  return getPhoenixBridgeSnapshot();
}

export async function sendPhoenixIntelligenceAlert(input: PhoenixIntelligenceAlert): Promise<PhoenixDeliveryResult> {
  const store = readStore();
  if (!store.paired) return { ok: false, skipped: true, message: 'Phoenix is not paired.' };
  if (!hasTauriInvokeBridge()) return { ok: false, skipped: true, message: 'Phoenix delivery requires the Watchtower desktop runtime.' };

  const alert = {
    id: cleanText(input.id, 240),
    title: cleanText(input.title, 260) || 'Watchtower intelligence alert',
    severity: input.severity,
    summary: cleanText(input.summary, 4000),
    timestamp: cleanText(input.timestamp, 80) || new Date().toISOString(),
    source: cleanText(input.source, 180) || 'Project V Watchtower',
    location: cleanText(input.location, 300) || undefined,
  };

  try {
    const result = await invokeTauri<{ ok?: boolean; duplicate?: boolean; status?: number; message?: string }>('send_phoenix_watchtower_alert', {
      endpoint: store.endpoint,
      alert,
    });
    const ok = result?.ok !== false;
    updateRuntime({ paired: true, online: ok, checking: false, detail: ok ? 'PHOENIX ONLINE · LAST SEND OK' : cleanText(result?.message, 180) || 'PHOENIX DELIVERY FAILED', checkedAt: Date.now() });
    return {
      ok,
      duplicate: result?.duplicate === true,
      message: cleanText(result?.message, 220) || (result?.duplicate ? 'Phoenix already received this alert.' : 'Sent to Phoenix.'),
    };
  } catch (error) {
    const message = error instanceof Error ? cleanText(error.message, 220) : 'Phoenix delivery failed.';
    updateRuntime({ paired: store.paired, online: false, checking: false, detail: message || 'PHOENIX OFFLINE', checkedAt: Date.now() });
    return { ok: false, message: message || 'Phoenix delivery failed.' };
  }
}

export async function sendOperationalAlertToPhoenix(
  alert: OperationalAlert,
  options: { manual?: boolean } = {},
): Promise<PhoenixDeliveryResult> {
  const store = readStore();
  if (!options.manual) {
    if (!store.autoForward) return { ok: false, skipped: true, message: 'Phoenix automatic forwarding is disabled.' };
    if (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[store.minimumSeverity]) {
      return { ok: false, skipped: true, message: `Below Phoenix ${store.minimumSeverity.toUpperCase()} forwarding threshold.` };
    }
  }

  const sourceUrl = alert.link ? ` Source URL: ${alert.link}` : '';
  return sendPhoenixIntelligenceAlert({
    id: `watchtower:${alert.id}`,
    title: alert.title,
    severity: alert.severity,
    summary: `${alert.detail}${sourceUrl}`.trim(),
    timestamp: new Date(alert.sourceTime ?? alert.detectedAt).toISOString(),
    source: `Project V Watchtower · ${alert.category} · ${alert.source}`,
    location: alert.location,
  });
}

export async function sendPhoenixBridgeTestAlert(): Promise<PhoenixDeliveryResult> {
  return sendPhoenixIntelligenceAlert({
    id: `watchtower-test-${Date.now().toString(36)}`,
    title: 'Watchtower ↔ Phoenix bridge test',
    severity: 'high',
    summary: 'Project V Watchtower successfully reached the paired Phoenix 0.9.8 local alert receiver.',
    timestamp: new Date().toISOString(),
    source: 'Project V Watchtower · Phoenix AI Bridge',
  });
}

export function subscribePhoenixBridge(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(EVENT_NAME, handler);
  const storage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storage);
  };
}
