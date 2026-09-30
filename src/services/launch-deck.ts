import { isDesktopRuntime } from './runtime';
import { hasTauriInvokeBridge, invokeTauri } from './tauri-bridge';

export type LaunchDeckCategory = 'browser' | 'research' | 'communications' | 'media' | 'utilities' | 'custom';

export interface LaunchDeckApplication {
  id: string;
  name: string;
  path: string;
  arguments: string[];
  workingDirectory?: string;
  category: LaunchDeckCategory;
  pinned: boolean;
  approved: boolean;
  allowUrlHandoff: boolean;
  allowFileHandoff: boolean;
  createdAt: number;
  updatedAt: number;
  lastLaunchedAt?: number;
  launchCount: number;
}

interface LaunchDeckStore {
  version: 1;
  applications: LaunchDeckApplication[];
}

export interface NativeLaunchResult {
  pid: number;
  executable: string;
}

const STORAGE_KEY = 'project-v-launch-deck-v1';
const EVENT_NAME = 'project-v-launch-deck-change';
const CHANNEL_NAME = 'project-v-launch-deck';
const MAX_APPS = 100;

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
} catch { /* cross-window sync is optional */ }

function id(): string {
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanText(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max) : '';
}

function cleanPath(value: unknown): string {
  return cleanText(value, 4096);
}

function validCategory(value: unknown): value is LaunchDeckCategory {
  return value === 'browser' || value === 'research' || value === 'communications' || value === 'media' || value === 'utilities' || value === 'custom';
}

function normalizeArguments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\u0000/g, '').trim())
    .filter(Boolean)
    .slice(0, 32)
    .map((item) => item.slice(0, 2048));
}

function normalizeApplication(value: unknown): LaunchDeckApplication | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<LaunchDeckApplication>;
  const path = cleanPath(source.path);
  const name = cleanText(source.name, 80);
  if (!path || !name) return null;
  const now = Date.now();
  return {
    id: cleanText(source.id, 100) || id(),
    name,
    path,
    arguments: normalizeArguments(source.arguments),
    workingDirectory: cleanPath(source.workingDirectory) || undefined,
    category: validCategory(source.category) ? source.category : 'custom',
    pinned: source.pinned !== false,
    approved: source.approved !== false,
    allowUrlHandoff: source.allowUrlHandoff === true,
    allowFileHandoff: source.allowFileHandoff === true,
    createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : now,
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : now,
    lastLaunchedAt: Number.isFinite(source.lastLaunchedAt) ? Number(source.lastLaunchedAt) : undefined,
    launchCount: Number.isFinite(source.launchCount) ? Math.max(0, Math.round(Number(source.launchCount))) : 0,
  };
}

function parseStore(): LaunchDeckStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, applications: [] };
    const parsed = JSON.parse(raw) as Partial<LaunchDeckStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.applications)) return { version: 1, applications: [] };
    const used = new Set<string>();
    const applications: LaunchDeckApplication[] = [];
    for (const candidate of parsed.applications) {
      const app = normalizeApplication(candidate);
      if (!app || used.has(app.id)) continue;
      used.add(app.id);
      applications.push(app);
      if (applications.length >= MAX_APPS) break;
    }
    return { version: 1, applications };
  } catch {
    return { version: 1, applications: [] };
  }
}

function persist(store: LaunchDeckStore, broadcast = true): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: store }));
  if (broadcast) channel?.postMessage({ type: 'change' });
}

export function listLaunchDeckApplications(): LaunchDeckApplication[] {
  return parseStore().applications.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const recent = (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0);
    return recent || a.name.localeCompare(b.name);
  });
}

export function getLaunchDeckApplication(applicationId: string): LaunchDeckApplication | null {
  return parseStore().applications.find((item) => item.id === applicationId) ?? null;
}

export function saveLaunchDeckApplication(input: Partial<LaunchDeckApplication> & Pick<LaunchDeckApplication, 'name' | 'path'>): LaunchDeckApplication {
  const store = parseStore();
  const existing = input.id ? store.applications.find((item) => item.id === input.id) : undefined;
  const now = Date.now();
  const application = normalizeApplication({
    ...existing,
    ...input,
    id: existing?.id ?? input.id ?? id(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    launchCount: existing?.launchCount ?? 0,
    lastLaunchedAt: existing?.lastLaunchedAt,
  });
  if (!application) throw new Error('Application name and executable path are required.');
  store.applications = existing
    ? store.applications.map((item) => item.id === application.id ? application : item)
    : [...store.applications, application].slice(-MAX_APPS);
  persist(store);
  return application;
}

export function deleteLaunchDeckApplication(applicationId: string): void {
  const store = parseStore();
  store.applications = store.applications.filter((item) => item.id !== applicationId);
  persist(store);
}

export function setLaunchDeckPinned(applicationId: string, pinned: boolean): void {
  const store = parseStore();
  const app = store.applications.find((item) => item.id === applicationId);
  if (!app) return;
  app.pinned = pinned;
  app.updatedAt = Date.now();
  persist(store);
}

export function approveLaunchDeckApplication(applicationId: string, selectedPath: string): LaunchDeckApplication {
  const store = parseStore();
  const app = store.applications.find((item) => item.id === applicationId);
  if (!app) throw new Error('Application record was not found.');
  const path = cleanPath(selectedPath);
  if (!path) throw new Error('Choose an executable before approving this application.');
  app.path = path;
  app.approved = true;
  app.updatedAt = Date.now();
  persist(store);
  return app;
}

export function exportLaunchDeck(): string {
  const store = parseStore();
  return JSON.stringify({ ...store, exportedAt: new Date().toISOString() }, null, 2);
}

export function importLaunchDeck(value: unknown): number {
  if (!value || typeof value !== 'object') throw new Error('Launch Deck import must be a JSON object.');
  const source = value as Partial<LaunchDeckStore>;
  if (!Array.isArray(source.applications)) throw new Error('Launch Deck import does not contain an applications list.');
  const existing = parseStore();
  const byPath = new Map(existing.applications.map((app) => [app.path.toLowerCase(), app]));
  let imported = 0;
  for (const candidate of source.applications) {
    const app = normalizeApplication(candidate);
    if (!app) continue;
    const previous = byPath.get(app.path.toLowerCase());
    const merged = {
      ...app,
      id: previous?.id ?? app.id,
      createdAt: previous?.createdAt ?? app.createdAt,
      updatedAt: Date.now(),
      approved: false,
    };
    byPath.set(app.path.toLowerCase(), merged);
    imported += 1;
  }
  persist({ version: 1, applications: Array.from(byPath.values()).slice(0, MAX_APPS) });
  return imported;
}

export function subscribeLaunchDeck(listener: () => void): () => void {
  const local = () => listener();
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  const broadcast = () => listener();
  window.addEventListener(EVENT_NAME, local);
  window.addEventListener('storage', storage);
  channel?.addEventListener('message', broadcast);
  return () => {
    window.removeEventListener(EVENT_NAME, local);
    window.removeEventListener('storage', storage);
    channel?.removeEventListener('message', broadcast);
  };
}

export async function selectLaunchExecutable(): Promise<string | null> {
  if (!hasTauriInvokeBridge()) return null;
  return invokeTauri<string | null>('select_application_executable');
}

export async function selectLaunchHandoffFile(): Promise<string | null> {
  if (!hasTauriInvokeBridge()) return null;
  return invokeTauri<string | null>('select_launch_handoff_file');
}

export async function launchDeckApplication(
  application: LaunchDeckApplication,
  handoff?: { type: 'url' | 'file'; value: string },
): Promise<NativeLaunchResult> {
  if (!isDesktopRuntime()) {
    throw new Error('Application launching is available in desktop mode. Run npm run desktop:dev.');
  }
  if (!application.approved) {
    throw new Error('This imported application path must be approved in Launch Desk before it can run.');
  }
  if (handoff?.type === 'url' && !application.allowUrlHandoff) throw new Error('URL handoff is not enabled for this application.');
  if (handoff?.type === 'file' && !application.allowFileHandoff) throw new Error('File handoff is not enabled for this application.');
  const result = await invokeTauri<NativeLaunchResult>('launch_approved_application', {
    path: application.path,
    arguments: application.arguments,
    workingDirectory: application.workingDirectory ?? null,
    handoff: handoff?.value ?? null,
  });
  const store = parseStore();
  const stored = store.applications.find((item) => item.id === application.id);
  if (stored) {
    stored.lastLaunchedAt = Date.now();
    stored.launchCount += 1;
    stored.updatedAt = Date.now();
    persist(store);
  }
  return result;
}
