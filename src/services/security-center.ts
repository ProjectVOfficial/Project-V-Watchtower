import { exportResearchLibrary, importResearchLibrarySnapshot, type ResearchLibrarySnapshot } from './research-library';
import { exportCaseDesk, importCaseDesk, type CaseDeskSnapshot } from './case-desk';
import { exportDataDesk, importDataDeskSnapshot, type DataDeskSnapshot } from './data-desk';
import { hasTauriInvokeBridge } from './tauri-bridge';

export type ProjectVNetworkMode = 'normal' | 'restricted' | 'local-only' | 'disconnected';

export interface PinVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

export interface ProjectVSecuritySettings {
  version: 1;
  autoLockMinutes: number;
  lockOnWindowBlur: boolean;
  accessGateEnabled: boolean;
  pin?: PinVerifier;
  networkMode: ProjectVNetworkMode;
  allowedOrigins: string[];
  lastBackupAt?: number;
  safeModeNextStart: boolean;
}

export interface ProjectVBackup {
  schema: 'project-v-watchtower-backup';
  version: 1;
  createdAt: number;
  appVersion: string;
  kind: 'configuration' | 'full';
  localStorage: Record<string, string>;
  research?: ResearchLibrarySnapshot;
  cases?: CaseDeskSnapshot;
  dataDesk?: DataDeskSnapshot;
}

interface EncryptedBackup {
  schema: 'project-v-watchtower-encrypted-backup';
  version: 1;
  createdAt: number;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface NetworkAuditRecord {
  timestamp: number;
  url: string;
  type: 'fetch' | 'websocket';
  mode: ProjectVNetworkMode;
}

const SETTINGS_KEY = 'project-v-security-center-v1';
const LAST_GOOD_KEY = 'project-v-last-good-configuration-v1';
const SESSION_MARKER_KEY = 'project-v-session-marker-v1';
const SAFE_MODE_ACTIVE_KEY = 'project-v-safe-mode-active-v1';
const DEFAULT_SETTINGS: ProjectVSecuritySettings = {
  version: 1,
  autoLockMinutes: 15,
  lockOnWindowBlur: false,
  accessGateEnabled: false,
  networkMode: 'normal',
  allowedOrigins: [],
  safeModeNextStart: false,
};
const EXCLUDED_BACKUP_KEYS = new Set([
  'project-v-local-runtime-secrets-v1',
  LAST_GOOD_KEY,
  SESSION_MARKER_KEY,
  SAFE_MODE_ACTIVE_KEY,
]);
const PBKDF2_ITERATIONS = 210_000;
const NETWORK_AUDIT_LIMIT = 100;

let sessionInitialized = false;
let previousSessionUnclean = false;
let originalFetch: typeof window.fetch | null = null;
let originalWebSocket: typeof window.WebSocket | null = null;
const networkAudit: NetworkAuditRecord[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        origins.add(url.origin);
      }
    } catch {
      // Ignore malformed origins.
    }
  }
  return Array.from(origins).slice(0, 32);
}

function normalizeSettings(value: unknown): ProjectVSecuritySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const source = value as Partial<ProjectVSecuritySettings>;
  const mode: ProjectVNetworkMode = source.networkMode === 'restricted'
    || source.networkMode === 'local-only'
    || source.networkMode === 'disconnected'
    ? source.networkMode
    : 'normal';
  const pin = source.pin
    && typeof source.pin.salt === 'string'
    && typeof source.pin.hash === 'string'
    && typeof source.pin.iterations === 'number'
    ? {
      salt: source.pin.salt,
      hash: source.pin.hash,
      iterations: clamp(Math.round(source.pin.iterations), 100_000, 1_000_000),
    }
    : undefined;
  return {
    version: 1,
    autoLockMinutes: clamp(Number.isFinite(source.autoLockMinutes) ? Math.round(source.autoLockMinutes!) : 15, 0, 240),
    lockOnWindowBlur: source.lockOnWindowBlur === true,
    accessGateEnabled: source.accessGateEnabled === true && Boolean(pin),
    pin,
    networkMode: mode,
    allowedOrigins: normalizeOrigins(source.allowedOrigins),
    lastBackupAt: typeof source.lastBackupAt === 'number' && Number.isFinite(source.lastBackupAt) ? source.lastBackupAt : undefined,
    safeModeNextStart: source.safeModeNextStart === true,
  };
}

export function getSecuritySettings(): ProjectVSecuritySettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSecuritySettings(changes: Partial<ProjectVSecuritySettings>): ProjectVSecuritySettings {
  const next = normalizeSettings({ ...getSecuritySettings(), ...changes, version: 1 });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('project-v-security-settings-change', { detail: next }));
  return next;
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function deriveHash(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBufferBytes(salt),
    iterations,
  }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

export async function setProjectVPin(pin: string): Promise<void> {
  const normalized = pin.trim();
  if (!/^\d{4,12}$/.test(normalized)) throw new Error('Use a numeric PIN containing four to twelve digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(normalized, salt, PBKDF2_ITERATIONS);
  updateSecuritySettings({
    pin: {
      salt: bytesToBase64(salt),
      hash,
      iterations: PBKDF2_ITERATIONS,
    },
  });
}

export async function verifyProjectVPin(pin: string): Promise<boolean> {
  const verifier = getSecuritySettings().pin;
  if (!verifier) return true;
  const candidate = await deriveHash(pin.trim(), base64ToBytes(verifier.salt), verifier.iterations);
  if (candidate.length !== verifier.hash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    mismatch |= candidate.charCodeAt(index) ^ verifier.hash.charCodeAt(index);
  }
  return mismatch === 0;
}

export function clearProjectVPin(): void {
  const next: ProjectVSecuritySettings = { ...getSecuritySettings(), accessGateEnabled: false };
  delete next.pin;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('project-v-security-settings-change', { detail: next }));
}

export function shouldRequireStartupAccessGate(): boolean {
  const settings = getSecuritySettings();
  return settings.accessGateEnabled && Boolean(settings.pin);
}

export function initializeSecuritySession(): void {
  if (sessionInitialized) return;
  sessionInitialized = true;
  previousSessionUnclean = localStorage.getItem(SESSION_MARKER_KEY) === 'active';
  localStorage.setItem(SESSION_MARKER_KEY, 'active');

  const settings = getSecuritySettings();
  if (settings.safeModeNextStart) {
    sessionStorage.setItem(SAFE_MODE_ACTIVE_KEY, 'true');
    updateSecuritySettings({ safeModeNextStart: false });
  }

  const clean = () => localStorage.setItem(SESSION_MARKER_KEY, 'clean');
  window.addEventListener('pagehide', clean, { once: true });
  window.addEventListener('beforeunload', clean, { once: true });
  installNetworkGuard();
}

export function wasPreviousSessionUnclean(): boolean {
  return previousSessionUnclean;
}

export function isProjectVSafeModeActive(): boolean {
  return sessionStorage.getItem(SAFE_MODE_ACTIVE_KEY) === 'true';
}

export function requestProjectVSafeModeNextStart(enabled: boolean): void {
  updateSecuritySettings({ safeModeNextStart: enabled });
}

export function clearProjectVSafeModeSession(): void {
  sessionStorage.removeItem(SAFE_MODE_ACTIVE_KEY);
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isRequestAllowed(rawUrl: string, mode: ProjectVNetworkMode, allowedOrigins: string[]): boolean {
  if (mode === 'normal') return true;
  let url: URL;
  try {
    url = new URL(rawUrl, location.href);
  } catch {
    return false;
  }

  const local = isLocalHost(url.hostname);
  const sameOrigin = url.origin === location.origin;
  if (mode === 'restricted') {
    return local || sameOrigin || allowedOrigins.includes(url.origin);
  }

  if (local) return true;
  if (!sameOrigin) return false;
  if (url.pathname.startsWith('/api/')) {
    return url.pathname.startsWith('/api/local-') || url.pathname === '/api/health';
  }
  return mode !== 'disconnected' || !url.pathname.startsWith('/api/');
}

function auditBlocked(url: string, type: NetworkAuditRecord['type'], mode: ProjectVNetworkMode): void {
  networkAudit.unshift({ timestamp: Date.now(), url: url.slice(0, 500), type, mode });
  networkAudit.splice(NETWORK_AUDIT_LIMIT);
  window.dispatchEvent(new CustomEvent('project-v-network-blocked', { detail: networkAudit[0] }));
}

export function getNetworkAudit(): NetworkAuditRecord[] {
  return networkAudit.map((item) => ({ ...item }));
}

export function installNetworkGuard(): void {
  if (typeof window === 'undefined') return;
  if (!originalFetch) {
    originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const settings = getSecuritySettings();
      if (!isRequestAllowed(rawUrl, settings.networkMode, settings.allowedOrigins)) {
        auditBlocked(rawUrl, 'fetch', settings.networkMode);
        throw new DOMException(`Project V network policy blocked ${rawUrl}`, 'SecurityError');
      }
      return originalFetch!(input, init);
    }) as typeof window.fetch;
  }

  if (!originalWebSocket) {
    originalWebSocket = window.WebSocket;
    const NativeWebSocket = originalWebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        const rawUrl = String(args[0] ?? '');
        const settings = getSecuritySettings();
        if (!isRequestAllowed(rawUrl, settings.networkMode, settings.allowedOrigins)) {
          auditBlocked(rawUrl, 'websocket', settings.networkMode);
          throw new DOMException(`Project V network policy blocked ${rawUrl}`, 'SecurityError');
        }
        return Reflect.construct(target, args, newTarget) as WebSocket;
      },
    }) as typeof WebSocket;
  }
}

export function setNetworkMode(mode: ProjectVNetworkMode): void {
  updateSecuritySettings({ networkMode: mode });
}

export function setAllowedNetworkOrigins(origins: string[]): void {
  updateSecuritySettings({ allowedOrigins: normalizeOrigins(origins) });
}

function shouldBackupKey(key: string): boolean {
  if (EXCLUDED_BACKUP_KEYS.has(key)) return false;
  return key.startsWith('project-v-')
    || key.startsWith('worldmonitor-')
    || key.startsWith('mobile-')
    || key === 'panel-order';
}

function collectLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !shouldBackupKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (key === SETTINGS_KEY) {
      try {
        const sanitized = normalizeSettings(JSON.parse(value));
        delete sanitized.pin;
        result[key] = JSON.stringify(sanitized);
      } catch {
        // Never export a malformed security record that may contain sensitive values.
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

export async function createProjectVBackup(kind: 'configuration' | 'full'): Promise<ProjectVBackup> {
  const backup: ProjectVBackup = {
    schema: 'project-v-watchtower-backup',
    version: 1,
    createdAt: Date.now(),
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
    kind,
    localStorage: collectLocalStorage(),
  };
  if (kind === 'full') {
    [backup.research, backup.cases, backup.dataDesk] = await Promise.all([
      exportResearchLibrary(),
      exportCaseDesk(),
      exportDataDesk(),
    ]);
  }
  updateSecuritySettings({ lastBackupAt: backup.createdAt });
  return backup;
}

export function saveLastGoodConfiguration(): void {
  const snapshot = {
    schema: 'project-v-last-good-configuration',
    version: 1,
    createdAt: Date.now(),
    localStorage: collectLocalStorage(),
  };
  try {
    localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(snapshot));
  } catch {
    // A restore point is helpful but must never prevent startup.
  }
}

export function hasLastGoodConfiguration(): boolean {
  return Boolean(localStorage.getItem(LAST_GOOD_KEY));
}

export function restoreLastGoodConfiguration(): void {
  const raw = localStorage.getItem(LAST_GOOD_KEY);
  if (!raw) throw new Error('No last-known-good configuration is available.');
  const parsed = JSON.parse(raw) as { schema?: string; localStorage?: Record<string, string> };
  if (parsed.schema !== 'project-v-last-good-configuration' || !parsed.localStorage) {
    throw new Error('The last-known-good configuration is invalid.');
  }
  restoreLocalStorage(parsed.localStorage);
}

function restoreLocalStorage(entries: Record<string, string>): void {
  const preservedSecrets = localStorage.getItem('project-v-local-runtime-secrets-v1');
  const preservedPin = getSecuritySettings().pin;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && shouldBackupKey(key)) localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(entries)) {
    if (!shouldBackupKey(key) || typeof value !== 'string') continue;
    if (key === SETTINGS_KEY) {
      try {
        const restored = normalizeSettings(JSON.parse(value));
        if (preservedPin) restored.pin = preservedPin;
        localStorage.setItem(key, JSON.stringify(restored));
      } catch {
        // Ignore malformed security settings while restoring the remaining archive.
      }
      continue;
    }
    localStorage.setItem(key, value);
  }
  if (preservedPin && !localStorage.getItem(SETTINGS_KEY)) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, pin: preservedPin }));
  }
  if (preservedSecrets !== null) localStorage.setItem('project-v-local-runtime-secrets-v1', preservedSecrets);
}

export async function restoreProjectVBackup(value: unknown): Promise<{ researchDocuments: number; researchExcerpts: number; cases: number; workbooks: number }> {
  if (!value || typeof value !== 'object') throw new Error('This is not a Project V backup.');
  const backup = value as Partial<ProjectVBackup>;
  if (backup.schema !== 'project-v-watchtower-backup' || backup.version !== 1 || !backup.localStorage) {
    throw new Error('This backup format is not supported.');
  }
  saveLastGoodConfiguration();
  restoreLocalStorage(backup.localStorage);
  let researchDocuments = 0;
  let researchExcerpts = 0;
  if (backup.research) {
    const result = await importResearchLibrarySnapshot(backup.research);
    researchDocuments = result.documents;
    researchExcerpts = result.excerpts;
  }
  if (backup.cases) await importCaseDesk(backup.cases);
  const workbooks = backup.dataDesk ? await importDataDeskSnapshot(backup.dataDesk) : 0;
  return { researchDocuments, researchExcerpts, cases: backup.cases?.cases.length ?? 0, workbooks };
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBufferBytes(salt),
    iterations,
  }, material, {
    name: 'AES-GCM',
    length: 256,
  }, false, ['encrypt', 'decrypt']);
}

export async function serializeBackup(backup: ProjectVBackup, passphrase?: string): Promise<string> {
  const json = JSON.stringify(backup, null, passphrase ? 0 : 2);
  if (!passphrase) return json;
  if (passphrase.length < 8) throw new Error('Protected backups require a passphrase of at least eight characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  const encrypted: EncryptedBackup = {
    schema: 'project-v-watchtower-encrypted-backup',
    version: 1,
    createdAt: Date.now(),
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(encrypted, null, 2);
}

export async function parseBackup(serialized: string, passphrase?: string): Promise<ProjectVBackup> {
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  if (parsed.schema === 'project-v-watchtower-backup') return parsed as unknown as ProjectVBackup;
  if (parsed.schema !== 'project-v-watchtower-encrypted-backup') throw new Error('This is not a Project V backup.');
  if (!passphrase) throw new Error('This backup is encrypted and requires its passphrase.');
  const salt = base64ToBytes(String(parsed.salt ?? ''));
  const iv = base64ToBytes(String(parsed.iv ?? ''));
  const ciphertext = base64ToBytes(String(parsed.ciphertext ?? ''));
  const key = await deriveEncryptionKey(passphrase, salt, Number(parsed.iterations) || PBKDF2_ITERATIONS);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBufferBytes(iv) },
      key,
      toArrayBufferBytes(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as ProjectVBackup;
  } catch {
    throw new Error('The backup passphrase is incorrect or the file is damaged.');
  }
}

export function desktopSecretVaultAvailable(): boolean {
  return hasTauriInvokeBridge();
}
