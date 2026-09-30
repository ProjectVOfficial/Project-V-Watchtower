import type { OperationalAlert } from '@/services/operations-center';
import { hasTauriInvokeBridge, invokeTauri } from '@/services/tauri-bridge';

const CONFIG_KEY = 'project-v-phoenix-bridge-v1';
const QUEUE_KEY = 'project-v-phoenix-bridge-queue-v1';
const TOKEN_SECRET_KEY = 'PHOENIX_WATCHTOWER_TOKEN';
const MAX_QUEUE = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 15_000;

interface PhoenixBridgeConfig {
  version: 1;
  enabled: boolean;
  endpoint: string;
  pairedAt: number;
  lastSuccessAt?: number;
  lastError?: string;
  lastHealthAt?: number;
}

export interface PhoenixBridgePublicState {
  configured: boolean;
  enabled: boolean;
  endpoint: string;
  pairedAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  pending: number;
  desktopRuntime: boolean;
}

interface PhoenixPairingPayload {
  contractVersion?: number;
  endpoint?: string;
  token?: string;
}

interface PhoenixAlertPayload {
  id: string;
  title: string;
  severity: string;
  summary: string;
  timestamp: string;
  source: string;
  location?: string;
}

interface QueuedPhoenixAlert {
  payload: PhoenixAlertPayload;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

let retryTimer: number | null = null;
let tokenCache: string | null = null;
let drainInFlight: Promise<void> | null = null;

function loadConfig(): PhoenixBridgeConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PhoenixBridgeConfig>;
    if (parsed.version !== 1 || typeof parsed.endpoint !== 'string') return null;
    return {
      version: 1,
      enabled: parsed.enabled !== false,
      endpoint: parsed.endpoint,
      pairedAt: Number(parsed.pairedAt || Date.now()),
      lastSuccessAt: Number(parsed.lastSuccessAt || 0) || undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      lastHealthAt: Number(parsed.lastHealthAt || 0) || undefined,
    };
  } catch {
    return null;
  }
}

function saveConfig(config: PhoenixBridgeConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* local bridge metadata is best effort */ }
}

function loadQueue(): QueuedPhoenixAlert[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((item): item is QueuedPhoenixAlert => Boolean(
      item && typeof item === 'object'
      && (item as QueuedPhoenixAlert).payload
      && typeof (item as QueuedPhoenixAlert).payload.id === 'string'
      && typeof (item as QueuedPhoenixAlert).createdAt === 'number'
      && (item as QueuedPhoenixAlert).createdAt >= cutoff,
    )).slice(-MAX_QUEUE);
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedPhoenixAlert[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch { /* retry queue is best effort */ }
}

function validateEndpoint(value: unknown): string {
  const endpoint = String(value || '').trim();
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error('Phoenix receiver endpoint is not a valid URL.'); }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (parsed.protocol !== 'http:' || !loopback) throw new Error('Phoenix receiver must use loopback HTTP only.');
  if (parsed.pathname.replace(/\/+$/, '') !== '/api/watchtower/alert') throw new Error('Phoenix pairing endpoint must end with /api/watchtower/alert.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Phoenix receiver endpoint must not include credentials, query parameters, or fragments.');
  return parsed.toString();
}

function validateToken(value: unknown): string {
  const token = String(value || '').trim();
  if (token.length < 32 || token.length > 512 || /[\s\x00-\x1f]/.test(token)) throw new Error('Phoenix pairing token is invalid.');
  return token;
}

async function getToken(): Promise<string> {
  if (tokenCache) return tokenCache;
  if (!hasTauriInvokeBridge()) throw new Error('Phoenix bridge delivery requires the Watchtower desktop runtime.');
  const token = await invokeTauri<string | null>('get_secret', { key: TOKEN_SECRET_KEY });
  if (!token) throw new Error('Phoenix pairing token is missing. Pair Watchtower with Phoenix again.');
  tokenCache = token;
  return token;
}

function updateStatus(patch: Partial<PhoenixBridgeConfig>): void {
  const current = loadConfig();
  if (!current) return;
  saveConfig({ ...current, ...patch });
  window.dispatchEvent(new CustomEvent('project-v-phoenix-bridge-change'));
}

async function sendPayload(payload: PhoenixAlertPayload): Promise<void> {
  const config = loadConfig();
  if (!config?.enabled || !config.endpoint) return;
  if (!hasTauriInvokeBridge()) throw new Error('Phoenix bridge delivery requires the Watchtower desktop runtime.');
  const token = await getToken();
  const response = await invokeTauri<{ ok?: boolean; duplicate?: boolean; status?: number; error?: string }>('push_phoenix_alert', {
    endpoint: config.endpoint,
    token,
    alert: payload,
  });
  if (!response?.ok && !response?.duplicate) throw new Error(response?.error || `Phoenix receiver rejected the alert${response?.status ? ` (HTTP ${response.status})` : ''}.`);
  updateStatus({ lastSuccessAt: Date.now(), lastError: '' });
}

function retryDelay(attempts: number): number {
  const seconds = [5, 15, 30, 60, 120, 300][Math.min(Math.max(0, attempts), 5)] ?? 300;
  return seconds * 1000;
}

function enqueue(payload: PhoenixAlertPayload, error: unknown): void {
  const queue = loadQueue();
  const existing = queue.find((item) => item.payload.id === payload.id);
  const message = error instanceof Error ? error.message : String(error || 'Phoenix delivery failed.');
  if (existing) {
    existing.attempts += 1;
    existing.nextAttemptAt = Date.now() + retryDelay(existing.attempts);
  } else {
    queue.push({ payload, createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now() + retryDelay(0) });
  }
  saveQueue(queue);
  updateStatus({ lastError: message });
}

async function drainQueueInternal(): Promise<void> {
  const config = loadConfig();
  if (!config?.enabled || !config.endpoint || !hasTauriInvokeBridge()) return;
  let queue = loadQueue();
  const now = Date.now();
  const due = queue.filter((item) => item.nextAttemptAt <= now).slice(0, 5);
  for (const item of due) {
    try {
      await sendPayload(item.payload);
      queue = queue.filter((candidate) => candidate.payload.id !== item.payload.id);
      saveQueue(queue);
    } catch (error) {
      const current = queue.find((candidate) => candidate.payload.id === item.payload.id);
      if (current) {
        current.attempts += 1;
        current.nextAttemptAt = Date.now() + retryDelay(current.attempts);
        saveQueue(queue);
      }
      updateStatus({ lastError: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
}

export async function drainPhoenixBridgeQueue(): Promise<void> {
  if (drainInFlight) return drainInFlight;
  drainInFlight = drainQueueInternal().finally(() => { drainInFlight = null; });
  return drainInFlight;
}

export function getPhoenixBridgePublicState(): PhoenixBridgePublicState {
  const config = loadConfig();
  return {
    configured: Boolean(config?.endpoint && config.enabled),
    enabled: Boolean(config?.enabled),
    endpoint: config?.endpoint || '',
    pairedAt: config?.pairedAt,
    lastSuccessAt: config?.lastSuccessAt,
    lastError: config?.lastError || '',
    pending: loadQueue().length,
    desktopRuntime: hasTauriInvokeBridge(),
  };
}

export async function pairPhoenixBridge(rawPairing: string): Promise<PhoenixBridgePublicState> {
  if (!hasTauriInvokeBridge()) throw new Error('Pairing requires the Watchtower desktop runtime.');
  let parsed: PhoenixPairingPayload;
  try { parsed = JSON.parse(rawPairing) as PhoenixPairingPayload; } catch { throw new Error('Paste the JSON copied from Phoenix → Watchtower → Copy receiver pairing.'); }
  const endpoint = validateEndpoint(parsed.endpoint);
  const token = validateToken(parsed.token);
  if (parsed.contractVersion && Number(parsed.contractVersion) < 2) throw new Error('This Phoenix pairing contract is too old. Phoenix 0.9.8 or newer is required.');
  await invokeTauri<void>('set_secret', { key: TOKEN_SECRET_KEY, value: token });
  tokenCache = token;
  saveConfig({ version: 1, enabled: true, endpoint, pairedAt: Date.now(), lastError: '' });
  window.dispatchEvent(new CustomEvent('project-v-phoenix-bridge-change'));
  try {
    await checkPhoenixBridge();
  } catch (error) {
    updateStatus({ lastError: error instanceof Error ? error.message : String(error) });
  }
  void drainPhoenixBridgeQueue();
  return getPhoenixBridgePublicState();
}

export async function disconnectPhoenixBridge(): Promise<void> {
  tokenCache = null;
  if (hasTauriInvokeBridge()) await invokeTauri<void>('delete_secret', { key: TOKEN_SECRET_KEY });
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(QUEUE_KEY);
  window.dispatchEvent(new CustomEvent('project-v-phoenix-bridge-change'));
}

export async function checkPhoenixBridge(): Promise<boolean> {
  const config = loadConfig();
  if (!config?.endpoint) return false;
  if (!hasTauriInvokeBridge()) throw new Error('Phoenix bridge health checks require the Watchtower desktop runtime.');
  const result = await invokeTauri<{ ok?: boolean; error?: string }>('check_phoenix_receiver', { endpoint: config.endpoint });
  const ok = result?.ok === true;
  updateStatus({ lastHealthAt: Date.now(), lastError: ok ? '' : (result?.error || 'Phoenix receiver is not reachable.') });
  return ok;
}

export async function sendPhoenixBridgeTestAlert(): Promise<void> {
  const payload: PhoenixAlertPayload = {
    id: `watchtower-bridge-test-${Date.now()}`,
    title: 'Watchtower bridge test',
    severity: 'warning',
    summary: 'Project V Watchtower successfully sent this test alert to Phoenix.',
    timestamp: new Date().toISOString(),
    source: 'Project V Watchtower',
  };
  try {
    await sendPayload(payload);
  } catch (error) {
    updateStatus({ lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function pushOperationalAlertToPhoenix(alert: OperationalAlert): Promise<void> {
  const config = loadConfig();
  if (!config?.enabled || !config.endpoint) return;
  const payload: PhoenixAlertPayload = {
    id: `watchtower-${alert.id}`,
    title: alert.title,
    severity: alert.severity,
    summary: alert.detail,
    timestamp: new Date(alert.sourceTime ?? alert.detectedAt).toISOString(),
    source: alert.source || alert.category || 'Project V Watchtower',
    location: alert.location,
  };
  try {
    await sendPayload(payload);
  } catch (error) {
    enqueue(payload, error);
  }
}

export function startPhoenixBridgeSender(): void {
  if (retryTimer !== null) return;
  window.setTimeout(() => void drainPhoenixBridgeQueue(), 2_000);
  retryTimer = window.setInterval(() => void drainPhoenixBridgeQueue(), RETRY_INTERVAL_MS);
}

export function stopPhoenixBridgeSender(): void {
  if (retryTimer !== null) window.clearInterval(retryTimer);
  retryTimer = null;
}
