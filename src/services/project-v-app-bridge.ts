import {
  getLaunchDeckApplication,
  launchDeckApplication,
  listLaunchDeckApplications,
  saveLaunchDeckApplication,
  selectLaunchExecutable,
  subscribeLaunchDeck,
  type LaunchDeckApplication,
  type LaunchDeckCategory,
  type NativeLaunchResult,
} from './launch-deck';

export type ProjectVBridgeAppId = 'project-v-browser' | 'project-v-chat' | 'shadow-gallery';

export interface ProjectVBridgeAppDefinition {
  id: ProjectVBridgeAppId;
  label: string;
  shortLabel: string;
  description: string;
  category: LaunchDeckCategory;
  allowUrlHandoff: boolean;
  allowFileHandoff: boolean;
  aliases: readonly string[];
}

export interface ProjectVBridgeAppStatus {
  definition: ProjectVBridgeAppDefinition;
  application: LaunchDeckApplication | null;
  connection: 'bound' | 'detected' | 'none';
  ready: boolean;
}

interface ProjectVBridgeStore {
  version: 1;
  bindings: Partial<Record<ProjectVBridgeAppId, string>>;
}

const STORAGE_KEY = 'project-v-application-bridge-v1';
const EVENT_NAME = 'project-v-application-bridge-change';
const CHANNEL_NAME = 'project-v-application-bridge';

export const PROJECT_V_BRIDGE_APPS: readonly ProjectVBridgeAppDefinition[] = [
  {
    id: 'project-v-browser',
    label: 'Project V Browser',
    shortLabel: 'BROWSER',
    description: 'Privacy browser launch and future URL handoff',
    category: 'browser',
    allowUrlHandoff: true,
    allowFileHandoff: false,
    aliases: ['project v browser', 'project-v browser', 'projectv browser', 'project-v-browser'],
  },
  {
    id: 'project-v-chat',
    label: 'Project V Chat',
    shortLabel: 'CHAT',
    description: 'Secure communications launch bridge',
    category: 'communications',
    allowUrlHandoff: false,
    allowFileHandoff: false,
    aliases: ['project v chat', 'project-v chat', 'shadowchat', 'shadow chat', 'mask chat'],
  },
  {
    id: 'shadow-gallery',
    label: 'Shadow Gallery',
    shortLabel: 'GALLERY',
    description: 'Private file vault launch and future file handoff',
    category: 'utilities',
    allowUrlHandoff: false,
    allowFileHandoff: true,
    aliases: ['shadow gallery', 'shadow vault', 'project v gallery', 'project-v gallery'],
  },
] as const;

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
} catch {
  // Cross-window synchronization is optional.
}

function emptyStore(): ProjectVBridgeStore {
  return { version: 1, bindings: {} };
}

function isBridgeAppId(value: string): value is ProjectVBridgeAppId {
  return PROJECT_V_BRIDGE_APPS.some((app) => app.id === value);
}

function parseStore(): ProjectVBridgeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ProjectVBridgeStore>;
    if (parsed.version !== 1 || !parsed.bindings || typeof parsed.bindings !== 'object') return emptyStore();
    const bindings: Partial<Record<ProjectVBridgeAppId, string>> = {};
    for (const [key, value] of Object.entries(parsed.bindings)) {
      if (isBridgeAppId(key) && typeof value === 'string' && value.trim()) bindings[key] = value.trim();
    }
    return { version: 1, bindings };
  } catch {
    return emptyStore();
  }
}

function persist(store: ProjectVBridgeStore, broadcast = true): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: store }));
  if (broadcast) channel?.postMessage({ type: 'change' });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function definition(appId: ProjectVBridgeAppId): ProjectVBridgeAppDefinition {
  const result = PROJECT_V_BRIDGE_APPS.find((app) => app.id === appId);
  if (!result) throw new Error(`Unknown Project V bridge application: ${appId}`);
  return result;
}

function detectApplication(appDefinition: ProjectVBridgeAppDefinition): LaunchDeckApplication | null {
  const candidates = listLaunchDeckApplications();
  const aliases = appDefinition.aliases.map(normalize);
  const exact = candidates.find((application) => aliases.includes(normalize(application.name)));
  if (exact) return exact;

  return candidates.find((application) => {
    const name = normalize(application.name);
    const path = normalize(application.path.split(/[\\/]/).pop() ?? application.path);
    return aliases.some((alias) => name.includes(alias) || path.includes(alias));
  }) ?? null;
}

function resolveApplication(appId: ProjectVBridgeAppId): { application: LaunchDeckApplication | null; connection: ProjectVBridgeAppStatus['connection'] } {
  const store = parseStore();
  const boundId = store.bindings[appId];
  if (boundId) {
    const bound = getLaunchDeckApplication(boundId);
    if (bound) return { application: bound, connection: 'bound' };
  }

  const detected = detectApplication(definition(appId));
  return detected
    ? { application: detected, connection: 'detected' }
    : { application: null, connection: 'none' };
}

export function getProjectVBridgeStatus(appId: ProjectVBridgeAppId): ProjectVBridgeAppStatus {
  const appDefinition = definition(appId);
  const { application, connection } = resolveApplication(appId);
  return {
    definition: appDefinition,
    application,
    connection,
    ready: Boolean(application?.approved),
  };
}

export function listProjectVBridgeStatuses(): ProjectVBridgeAppStatus[] {
  return PROJECT_V_BRIDGE_APPS.map((app) => getProjectVBridgeStatus(app.id));
}

export function bindProjectVBridgeApp(appId: ProjectVBridgeAppId, applicationId: string): void {
  const application = getLaunchDeckApplication(applicationId);
  if (!application) throw new Error('The selected Launch Deck application no longer exists.');
  const store = parseStore();
  store.bindings[appId] = application.id;
  persist(store);
}

export function disconnectProjectVBridgeApp(appId: ProjectVBridgeAppId): void {
  const store = parseStore();
  delete store.bindings[appId];
  persist(store);
}

export async function configureProjectVBridgeApp(appId: ProjectVBridgeAppId): Promise<ProjectVBridgeAppStatus | null> {
  const appDefinition = definition(appId);
  const selectedPath = await selectLaunchExecutable();
  if (!selectedPath) return null;

  const current = resolveApplication(appId).application;
  const saved = saveLaunchDeckApplication({
    id: current?.id,
    name: appDefinition.label,
    path: selectedPath,
    arguments: current?.arguments ?? [],
    workingDirectory: current?.workingDirectory,
    category: appDefinition.category,
    pinned: true,
    approved: true,
    allowUrlHandoff: appDefinition.allowUrlHandoff,
    allowFileHandoff: appDefinition.allowFileHandoff,
  });
  bindProjectVBridgeApp(appId, saved.id);
  return getProjectVBridgeStatus(appId);
}

export async function launchProjectVBridgeApp(
  appId: ProjectVBridgeAppId,
  handoff?: { type: 'url' | 'file'; value: string },
): Promise<NativeLaunchResult> {
  const status = getProjectVBridgeStatus(appId);
  if (!status.application) {
    throw new Error(`${status.definition.label} is not connected. Open V → Project V Bridge and choose CONNECT.`);
  }
  if (!status.application.approved) {
    throw new Error(`${status.definition.label} needs approval. Reconnect it from V → Project V Bridge.`);
  }

  if (status.connection === 'detected') bindProjectVBridgeApp(appId, status.application.id);
  return launchDeckApplication(status.application, handoff);
}

export function subscribeProjectVBridge(listener: () => void): () => void {
  const local = () => listener();
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  const broadcast = () => listener();
  const launchDeckCleanup = subscribeLaunchDeck(listener);

  window.addEventListener(EVENT_NAME, local);
  window.addEventListener('storage', storage);
  channel?.addEventListener('message', broadcast);

  return () => {
    launchDeckCleanup();
    window.removeEventListener(EVENT_NAME, local);
    window.removeEventListener('storage', storage);
    channel?.removeEventListener('message', broadcast);
  };
}
