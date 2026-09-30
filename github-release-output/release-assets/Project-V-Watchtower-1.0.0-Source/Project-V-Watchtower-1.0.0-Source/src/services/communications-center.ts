import { invokeTauri, tryInvokeTauri } from './tauri-bridge';
import { isDesktopRuntime } from './runtime';

export interface CommunicationEndpoint {
  id: string;
  name: string;
  url: string;
  description: string;
  builtIn: boolean;
  integrated: boolean;
}

export interface CommunicationDockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STORE_KEY = 'project-v-communications-wall-v1';
const APPROVED_INTEGRATED_HOSTS = new Set([
  'voice.google.com',
  'discord.com',
  'app.slack.com',
  'web.telegram.org',
  'messages.google.com',
  'meet.google.com',
  'mail.google.com',
  'teams.microsoft.com',
  'web.whatsapp.com',
]);

const BUILT_IN_ENDPOINTS: CommunicationEndpoint[] = [
  {
    id: 'google-voice',
    name: 'GOOGLE VOICE',
    url: 'https://voice.google.com/u/0/messages',
    description: 'Calls, voicemail, and text messages through your Google Voice account.',
    builtIn: true,
    integrated: true,
  },
  {
    id: 'discord',
    name: 'DISCORD',
    url: 'https://discord.com/channels/@me',
    description: 'Direct messages, servers, and voice channels through Discord Web.',
    builtIn: true,
    integrated: true,
  },
  {
    id: 'google-messages',
    name: 'GOOGLE MESSAGES',
    url: 'https://messages.google.com/web/',
    description: 'Browser access to paired Android messages.',
    builtIn: true,
    integrated: true,
  },
  {
    id: 'telegram-web',
    name: 'TELEGRAM WEB',
    url: 'https://web.telegram.org/',
    description: 'Telegram web client in a restricted communications dock.',
    builtIn: true,
    integrated: true,
  },
  {
    id: 'slack',
    name: 'SLACK',
    url: 'https://app.slack.com/client/',
    description: 'Workspace chat and direct messages through Slack Web.',
    builtIn: true,
    integrated: true,
  },
  {
    id: 'teams',
    name: 'MICROSOFT TEAMS',
    url: 'https://teams.microsoft.com/',
    description: 'Meetings and messages through Microsoft Teams Web.',
    builtIn: true,
    integrated: true,
  },
];

function normalizeEndpoint(value: unknown): CommunicationEndpoint | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<CommunicationEndpoint>;
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, 48) : '';
  const description = typeof item.description === 'string' ? item.description.trim().slice(0, 160) : '';
  try {
    const url = new URL(typeof item.url === 'string' ? item.url.trim() : '');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    if (!name) return null;
    const id = typeof item.id === 'string' && /^[a-z0-9-]{3,64}$/.test(item.id)
      ? item.id
      : `custom-${Date.now().toString(36)}`;
    return {
      id,
      name,
      url: url.href,
      description: description || 'Custom communications endpoint.',
      builtIn: false,
      integrated: APPROVED_INTEGRATED_HOSTS.has(url.hostname),
    };
  } catch {
    return null;
  }
}

function normalizeBounds(bounds: CommunicationDockBounds): CommunicationDockBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(240, Math.round(bounds.width)),
    height: Math.max(180, Math.round(bounds.height)),
  };
}

export function listCommunicationEndpoints(): CommunicationEndpoint[] {
  let custom: CommunicationEndpoint[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as unknown;
    if (Array.isArray(parsed)) custom = parsed.map(normalizeEndpoint).filter((item): item is CommunicationEndpoint => Boolean(item));
  } catch {
    custom = [];
  }
  return [...BUILT_IN_ENDPOINTS.map((item) => ({ ...item })), ...custom];
}

export function addCommunicationEndpoint(name: string, url: string, description = ''): CommunicationEndpoint {
  const endpoint = normalizeEndpoint({
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    url,
    description,
  });
  if (!endpoint) throw new Error('Enter a valid HTTPS communications URL and a name.');
  const custom = listCommunicationEndpoints().filter((item) => !item.builtIn);
  custom.push(endpoint);
  localStorage.setItem(STORE_KEY, JSON.stringify(custom.slice(-24)));
  window.dispatchEvent(new CustomEvent('project-v-communications-change'));
  return endpoint;
}

export function removeCommunicationEndpoint(id: string): void {
  const custom = listCommunicationEndpoints().filter((item) => !item.builtIn && item.id !== id);
  localStorage.setItem(STORE_KEY, JSON.stringify(custom));
  window.dispatchEvent(new CustomEvent('project-v-communications-change'));
}

export function canUseNativeCommunicationDock(): boolean {
  return isDesktopRuntime();
}

export async function openCommunicationEndpoint(endpoint: CommunicationEndpoint, integrated = true): Promise<void> {
  if (integrated && endpoint.integrated && isDesktopRuntime()) {
    await invokeTauri<void>('open_communications_window', {
      service: endpoint.id,
      url: endpoint.url,
      title: endpoint.name,
    });
    return;
  }
  window.open(endpoint.url, '_blank', 'noopener,noreferrer');
}

export async function openCommunicationDock(
  endpoint: CommunicationEndpoint,
  bounds: CommunicationDockBounds,
): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Native communications docking requires the Tauri desktop application.');
  if (!endpoint.integrated) throw new Error('This host is not approved for the native communications dock.');
  const safeBounds = normalizeBounds(bounds);
  await invokeTauri<void>('open_communications_dock', {
    service: endpoint.id,
    url: endpoint.url,
    ...safeBounds,
  });
}

export async function updateCommunicationDock(
  bounds: CommunicationDockBounds,
  visible = true,
): Promise<void> {
  if (!isDesktopRuntime()) return;
  const safeBounds = normalizeBounds(bounds);
  await tryInvokeTauri<void>('update_communications_dock', { ...safeBounds, visible });
}

export async function hideCommunicationDock(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await tryInvokeTauri<void>('hide_communications_dock');
}

export async function reloadCommunicationDock(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invokeTauri<void>('reload_communications_dock');
}

export async function closeCommunicationDock(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await tryInvokeTauri<void>('close_communications_dock');
}

export function isIntegratedCommunicationHost(url: string): boolean {
  try {
    return APPROVED_INTEGRATED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
