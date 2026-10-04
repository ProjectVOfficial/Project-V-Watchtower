import { Panel } from './Panel';
import type { ProjectVPluginManifest, ProjectVPluginPermission } from '@/modules/plugin-types';
import { pluginDataStorageKey, pluginPanelId } from '@/modules/plugin-registry';
import { getEffectivePluginPermissions } from '@/services/plugin-permissions';

const MAX_PLUGIN_DATA_BYTES = 64 * 1024;

interface PluginRequest {
  channel?: unknown;
  pluginId?: unknown;
  requestId?: unknown;
  type?: unknown;
  key?: unknown;
  value?: unknown;
  message?: unknown;
  level?: unknown;
  url?: unknown;
}

interface PluginPanelOptions {
  manifest: ProjectVPluginManifest;
  getWorkspaceId: () => string;
}

function escapeTooltipText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toDataUrl(mimeType: string, value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function networkSources(manifest: ProjectVPluginManifest, permissions: Set<ProjectVPluginPermission>): string {
  if (!permissions.has('network')) return "'none'";
  const sources = (manifest.allowedNetworkOrigins ?? []).filter(Boolean);
  return sources.length > 0 ? sources.join(' ') : "'none'";
}

function getPluginData(pluginId: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(pluginDataStorageKey(pluginId)) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function savePluginData(pluginId: string, data: Record<string, unknown>): void {
  const serialized = JSON.stringify(data);
  if (new Blob([serialized]).size > MAX_PLUGIN_DATA_BYTES) {
    throw new Error('Plugin storage limit exceeded.');
  }
  localStorage.setItem(pluginDataStorageKey(pluginId), serialized);
}

function createToast(pluginName: string, message: string, level: string): void {
  const toast = document.createElement('div');
  toast.className = `v-plugin-toast v-plugin-toast-${level === 'warning' || level === 'error' ? level : 'info'}`;
  const title = document.createElement('strong');
  title.textContent = pluginName;
  const body = document.createElement('span');
  body.textContent = message;
  toast.append(title, body);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add('visible'), 10);
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 250);
  }, 3600);
}

export class PluginPanel extends Panel {
  private readonly manifest: ProjectVPluginManifest;
  private readonly getWorkspaceId: () => string;
  private readonly iframe: HTMLIFrameElement;
  private readonly permissions: Set<ProjectVPluginPermission>;
  private messageHandler: ((event: MessageEvent<unknown>) => void) | null = null;
  private refreshTimer: number | null = null;
  private lastNotificationAt = 0;

  constructor(options: PluginPanelOptions) {
    super({
      id: pluginPanelId(options.manifest.id),
      title: `${options.manifest.icon ? `${options.manifest.icon} ` : ''}${options.manifest.name}`,
      className: 'v-plugin-panel',
      trackActivity: false,
      infoTooltip: `${escapeTooltipText(options.manifest.description)}<br><br>Local plugin by ${escapeTooltipText(options.manifest.author)} · v${escapeTooltipText(options.manifest.version)}`,
    });
    this.manifest = options.manifest;
    this.getWorkspaceId = options.getWorkspaceId;
    this.permissions = getEffectivePluginPermissions(this.manifest);
    this.element.dataset.pluginId = this.manifest.id;
    this.element.dataset.moduleSource = 'plugin';
    this.element.dataset.moduleCategory = this.manifest.category;
    this.element.dataset.moduleVersion = this.manifest.version;
    this.element.dataset.moduleDefaultW = String(this.manifest.defaultSize.w);
    this.element.dataset.moduleDefaultH = String(this.manifest.defaultSize.h);
    this.element.dataset.moduleMinW = String(this.manifest.minSize?.w ?? 2);
    this.element.dataset.moduleMinH = String(this.manifest.minSize?.h ?? 2);
    this.element.dataset.modulePermissions = Array.from(this.permissions).join(',');

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'v-plugin-frame';
    this.iframe.title = `${this.manifest.name} plugin`;
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    this.iframe.setAttribute('referrerpolicy', 'no-referrer');
    this.iframe.srcdoc = this.buildSourceDocument();
    this.content.replaceChildren(this.iframe);
    this.setDataBadge('live', `PLUGIN v${this.manifest.version}`);
    this.setupBridge();
    this.setupRefresh();
  }

  public reload(): void {
    this.iframe.srcdoc = this.buildSourceDocument();
  }

  public override destroy(): void {
    if (this.messageHandler) window.removeEventListener('message', this.messageHandler);
    this.messageHandler = null;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    super.destroy();
  }

  private buildSourceDocument(): string {
    const network = networkSources(this.manifest, this.permissions);
    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "script-src data:",
      "style-src 'unsafe-inline' data:",
      `connect-src ${network}`,
      `img-src data: blob: ${network}`,
      `media-src ${network}`,
      "font-src data:",
    ].join('; ');
    const bridgeUrl = toDataUrl('text/javascript;charset=utf-8', this.bridgeScript());
    const userScriptUrl = toDataUrl('text/javascript;charset=utf-8', this.manifest.entry.script ?? '');
    const styleUrl = toDataUrl('text/css;charset=utf-8', this.manifest.entry.css ?? '');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{width:100%;min-height:100%;margin:0}</style><link rel="stylesheet" href="${styleUrl}"><script src="${bridgeUrl}"></script></head><body>${this.manifest.entry.html}<script src="${userScriptUrl}"></script></body></html>`;
  }

  private bridgeScript(): string {
    return `(()=>{const channel='project-v-plugin-v1';const pluginId=${JSON.stringify(this.manifest.id)};let seq=0;const pending=new Map();const request=(type,payload={})=>new Promise((resolve,reject)=>{const requestId=String(++seq);pending.set(requestId,{resolve,reject});parent.postMessage({channel,pluginId,requestId,type,...payload},'*');setTimeout(()=>{const item=pending.get(requestId);if(item){pending.delete(requestId);item.reject(new Error('Project V bridge request timed out.'))}},5000)});addEventListener('message',event=>{const data=event.data;if(!data||data.channel!==channel||data.pluginId!==pluginId)return;if(data.type==='response'){const item=pending.get(String(data.requestId));if(!item)return;pending.delete(String(data.requestId));data.ok?item.resolve(data.value):item.reject(new Error(data.error||'Bridge request failed.'))}if(data.type==='context'){window.dispatchEvent(new CustomEvent('projectv:context',{detail:data.value}))}});window.ProjectV=Object.freeze({pluginId,storage:Object.freeze({get:key=>request('storage:get',{key}),set:(key,value)=>request('storage:set',{key,value}),remove:key=>request('storage:remove',{key})}),clipboard:Object.freeze({read:()=>request('clipboard:read'),write:text=>request('clipboard:write',{value:String(text)})}),notify:(message,level='info')=>request('notify',{message:String(message),level}),openExternal:url=>request('external:open',{url:String(url)}),getContext:()=>request('context:get')});parent.postMessage({channel,pluginId,type:'ready'},'*')})();`;
  }

  private setupBridge(): void {
    this.messageHandler = (event: MessageEvent<unknown>) => {
      if (event.source !== this.iframe.contentWindow || !event.data || typeof event.data !== 'object') return;
      const request = event.data as PluginRequest;
      if (request.channel !== 'project-v-plugin-v1' || request.pluginId !== this.manifest.id) return;
      if (request.type === 'ready') {
        this.sendContext();
        return;
      }
      const requestId = typeof request.requestId === 'string' ? request.requestId : '';
      if (!requestId || typeof request.type !== 'string') return;
      void this.handleRequest(request).then(
        (value) => this.respond(requestId, true, value),
        (error: unknown) => this.respond(requestId, false, undefined, error instanceof Error ? error.message : 'Plugin request failed.'),
      );
    };
    window.addEventListener('message', this.messageHandler);
  }

  private setupRefresh(): void {
    const seconds = this.manifest.refreshIntervalSeconds;
    if (!seconds || seconds < 5) return;
    this.refreshTimer = window.setInterval(() => this.reload(), seconds * 1000);
  }

  private async handleRequest(request: PluginRequest): Promise<unknown> {
    switch (request.type) {
      case 'storage:get': {
        this.requirePermission('storage');
        const key = this.validKey(request.key);
        return getPluginData(this.manifest.id)[key] ?? null;
      }
      case 'storage:set': {
        this.requirePermission('storage');
        const key = this.validKey(request.key);
        const data = getPluginData(this.manifest.id);
        data[key] = request.value;
        savePluginData(this.manifest.id, data);
        return true;
      }
      case 'storage:remove': {
        this.requirePermission('storage');
        const key = this.validKey(request.key);
        const data = getPluginData(this.manifest.id);
        delete data[key];
        savePluginData(this.manifest.id, data);
        return true;
      }
      case 'clipboard:read': {
        this.requirePermission('clipboard-read');
        if (!navigator.clipboard?.readText) throw new Error('Clipboard reading is unavailable.');
        return navigator.clipboard.readText();
      }
      case 'clipboard:write': {
        this.requirePermission('clipboard-write');
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard writing is unavailable.');
        await navigator.clipboard.writeText(typeof request.value === 'string' ? request.value : String(request.value ?? ''));
        return true;
      }
      case 'notify': {
        this.requirePermission('notifications');
        const message = typeof request.message === 'string' ? request.message.trim().slice(0, 240) : '';
        if (!message) throw new Error('Notification message is empty.');
        const now = Date.now();
        if (now - this.lastNotificationAt < 750) throw new Error('Plugin notifications are being sent too quickly.');
        this.lastNotificationAt = now;
        createToast(this.manifest.name, message, typeof request.level === 'string' ? request.level : 'info');
        return true;
      }
      case 'external:open': {
        this.requirePermission('network');
        const rawUrl = typeof request.url === 'string' ? request.url : '';
        const url = new URL(rawUrl);
        const allowed = new Set(this.manifest.allowedNetworkOrigins ?? []);
        if (!allowed.has(url.origin)) throw new Error(`The plugin is not allowed to open ${url.origin}.`);
        window.open(url.href, '_blank', 'noopener,noreferrer');
        return true;
      }
      case 'context:get':
        return this.contextValue();
      default:
        throw new Error(`Unsupported bridge request: ${request.type}`);
    }
  }

  private validKey(value: unknown): string {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) throw new Error('Plugin storage key is invalid.');
    return key;
  }

  private requirePermission(permission: ProjectVPluginPermission): void {
    if (!this.permissions.has(permission)) throw new Error(`Plugin permission denied: ${permission}.`);
  }

  private respond(requestId: string, ok: boolean, value?: unknown, error?: string): void {
    this.iframe.contentWindow?.postMessage({
      channel: 'project-v-plugin-v1',
      pluginId: this.manifest.id,
      requestId,
      type: 'response',
      ok,
      value,
      error,
    }, '*');
  }

  private sendContext(): void {
    this.iframe.contentWindow?.postMessage({
      channel: 'project-v-plugin-v1',
      pluginId: this.manifest.id,
      type: 'context',
      value: this.contextValue(),
    }, '*');
  }

  private contextValue(): Record<string, unknown> {
    return {
      workspaceId: this.getWorkspaceId(),
      theme: document.documentElement.dataset.theme ?? 'dark',
      locale: document.documentElement.lang || navigator.language,
      pluginId: this.manifest.id,
      version: this.manifest.version,
      permissions: Array.from(this.permissions),
    };
  }
}
