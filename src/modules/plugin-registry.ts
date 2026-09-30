import {
  PROJECT_V_PLUGIN_SCHEMA_VERSION,
  type InstalledProjectVPlugin,
  type ProjectVModuleCategory,
  type ProjectVModuleDefinition,
  type ProjectVModuleSize,
  type ProjectVPluginManifest,
  type ProjectVPluginPermission,
  type ProjectVPluginValidationResult,
} from './plugin-types';

const PLUGIN_STORE_KEY = 'project-v-plugin-registry-v1';
export const PROJECT_V_PLUGIN_DATA_PREFIX = 'project-v-plugin-data-v1:';
const PLUGIN_STORE_VERSION = 1;
const MAX_PLUGIN_COUNT = 64;
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const MAX_HTML_LENGTH = 180_000;
const MAX_CSS_LENGTH = 120_000;
const MAX_SCRIPT_LENGTH = 180_000;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+){1,7}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

const CATEGORIES: ReadonlySet<ProjectVModuleCategory> = new Set([
  'maps', 'intelligence', 'news', 'operations', 'markets', 'weather', 'ai', 'research', 'system',
]);

const PERMISSIONS: ReadonlySet<ProjectVPluginPermission> = new Set([
  'storage', 'network', 'notifications', 'clipboard-read', 'clipboard-write',
]);

interface PluginStore {
  version: 1;
  plugins: InstalledProjectVPlugin[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, maxLength)
    : '';
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSize(value: unknown, fallback: ProjectVModuleSize): ProjectVModuleSize {
  if (!isRecord(value)) return { ...fallback };
  return {
    w: clamp(finiteInteger(value.w, fallback.w), 2, 12),
    h: clamp(finiteInteger(value.h, fallback.h), 2, 14),
  };
}

function normalizeOrigins(value: unknown, warnings: string[]): string[] {
  if (!Array.isArray(value)) return [];
  const origins = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue;
    try {
      const url = new URL(item.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        warnings.push(`Ignored unsupported network origin: ${item}`);
        continue;
      }
      origins.add(url.origin);
    } catch {
      warnings.push(`Ignored invalid network origin: ${item}`);
    }
  }
  return Array.from(origins).slice(0, 16);
}

function normalizePermissions(value: unknown, errors: string[]): ProjectVPluginPermission[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<ProjectVPluginPermission>();
  for (const item of value) {
    if (typeof item !== 'string' || !PERMISSIONS.has(item as ProjectVPluginPermission)) {
      errors.push(`Unsupported permission: ${String(item)}`);
      continue;
    }
    result.add(item as ProjectVPluginPermission);
  }
  return Array.from(result);
}

function cloneManifest(manifest: ProjectVPluginManifest): ProjectVPluginManifest {
  return {
    ...manifest,
    defaultSize: { ...manifest.defaultSize },
    minSize: manifest.minSize ? { ...manifest.minSize } : undefined,
    permissions: [...(manifest.permissions ?? [])],
    allowedNetworkOrigins: [...(manifest.allowedNetworkOrigins ?? [])],
    requiredRuntimeFeatures: [...(manifest.requiredRuntimeFeatures ?? [])],
    entry: { ...manifest.entry },
  };
}

function cloneInstalled(plugin: InstalledProjectVPlugin): InstalledProjectVPlugin {
  return { ...plugin, manifest: cloneManifest(plugin.manifest) };
}

export function pluginDataStorageKey(pluginId: string): string {
  return `${PROJECT_V_PLUGIN_DATA_PREFIX}${pluginId}`;
}

function stableIdHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function pluginPanelId(pluginId: string): string {
  const normalized = pluginId.toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'module';
  return `plugin-${slug}-${stableIdHash(normalized)}`;
}

function inferCategory(panelId: string, label: string): ProjectVModuleCategory {
  const source = `${panelId} ${label}`.toLowerCase();
  if (/map|heatmap|exposure|displacement|ucdp/.test(source)) return 'maps';
  if (/assistant|ollama|language model| ai\b/.test(source)) return 'ai';
  if (/document|research|archive|citation|evidence|timeline|notes|source browser|browser handoff|case desk|data library|workbook|spreadsheet/.test(source)) return 'research';
  if (/news|politic|world|government|middle east|finance|tech|startup|layoff|positive/.test(source)) return 'news';
  if (/market|economic|commodit|crypto|polymarket|prediction|etf|stablecoin|trade|gulf|investment/.test(source)) return 'markets';
  if (/climate|weather|fire|renewable|species/.test(source)) return 'weather';
  if (/webcam|live|sirens|telegram|security|service|clock|monitor|counter|progress|communication|chat/.test(source)) return 'operations';
  if (/insight|risk|posture|intel|cii|cascade|deduction|macro|readiness|gdelt/.test(source)) return 'intelligence';
  return 'system';
}

function fallbackSize(panelId: string, panel: HTMLElement): ProjectVModuleSize {
  if (panelId === 'map') return { w: 8, h: 7 };
  if (/live-news|live-webcams/.test(panelId)) return { w: 6, h: 4 };
  if (/insights|strategic-risk|strategic-posture|intel/.test(panelId)) return { w: 4, h: 3 };
  const wide = panel.classList.contains('panel-wide');
  return { w: wide ? 6 : 4, h: 3 };
}

export function validateProjectVPluginManifest(input: unknown): ProjectVPluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['Plugin manifest must be a JSON object.'], warnings };

  const schemaVersion = finiteInteger(input.schemaVersion, 0);
  if (schemaVersion !== PROJECT_V_PLUGIN_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion. Expected ${PROJECT_V_PLUGIN_SCHEMA_VERSION}.`);
  }

  const id = cleanText(input.id, 80).toLowerCase();
  if (!ID_PATTERN.test(id)) errors.push('Plugin id must use reverse-domain style lowercase characters, for example projectv.tools.notes.');

  const name = cleanText(input.name, 48);
  if (!name) errors.push('Plugin name is required.');

  const version = cleanText(input.version, 32);
  if (!VERSION_PATTERN.test(version)) errors.push('Plugin version is invalid.');

  const description = cleanText(input.description, 240);
  if (!description) errors.push('Plugin description is required.');

  const author = cleanText(input.author, 64);
  if (!author) errors.push('Plugin author is required.');

  const categoryRaw = cleanText(input.category, 24) as ProjectVModuleCategory;
  const category = CATEGORIES.has(categoryRaw) ? categoryRaw : 'system';
  if (!CATEGORIES.has(categoryRaw)) errors.push(`Unsupported module category: ${categoryRaw || '(missing)'}.`);

  const defaultSize = normalizeSize(input.defaultSize, { w: 4, h: 3 });
  const minSize = normalizeSize(input.minSize, { w: 2, h: 2 });
  if (minSize.w > defaultSize.w || minSize.h > defaultSize.h) {
    warnings.push('Minimum size exceeded default size and was clamped to the default.');
    minSize.w = Math.min(minSize.w, defaultSize.w);
    minSize.h = Math.min(minSize.h, defaultSize.h);
  }

  const permissions = normalizePermissions(input.permissions, errors);
  const allowedNetworkOrigins = normalizeOrigins(input.allowedNetworkOrigins, warnings);
  if (allowedNetworkOrigins.length > 0 && !permissions.includes('network')) {
    warnings.push('Network origins were supplied without the network permission; they will remain blocked.');
  }
  if (permissions.includes('network') && allowedNetworkOrigins.length === 0) {
    warnings.push('The network permission was requested without any allowed origins; outbound network access will remain blocked.');
  }

  const requiredRuntimeFeatures = Array.isArray(input.requiredRuntimeFeatures)
    ? input.requiredRuntimeFeatures
      .filter((value): value is string => typeof value === 'string')
      .map((value) => cleanText(value, 64))
      .filter(Boolean)
      .slice(0, 16)
    : [];

  if (!isRecord(input.entry) || input.entry.type !== 'sandbox-html') {
    errors.push('entry.type must be "sandbox-html".');
  }
  const entryRecord = isRecord(input.entry) ? input.entry : {};
  const html = typeof entryRecord.html === 'string' ? entryRecord.html : '';
  const css = typeof entryRecord.css === 'string' ? entryRecord.css : undefined;
  const script = typeof entryRecord.script === 'string' ? entryRecord.script : undefined;
  if (!html.trim()) errors.push('Plugin entry.html is required.');
  if (html.length > MAX_HTML_LENGTH) errors.push(`Plugin HTML exceeds ${MAX_HTML_LENGTH.toLocaleString()} characters.`);
  if ((css?.length ?? 0) > MAX_CSS_LENGTH) errors.push(`Plugin CSS exceeds ${MAX_CSS_LENGTH.toLocaleString()} characters.`);
  if ((script?.length ?? 0) > MAX_SCRIPT_LENGTH) errors.push(`Plugin script exceeds ${MAX_SCRIPT_LENGTH.toLocaleString()} characters.`);

  const refreshIntervalSeconds = input.refreshIntervalSeconds === undefined
    ? undefined
    : clamp(finiteInteger(input.refreshIntervalSeconds, 0), 0, 86_400);
  if (refreshIntervalSeconds !== undefined && refreshIntervalSeconds > 0 && refreshIntervalSeconds < 5) {
    warnings.push('Refresh intervals below five seconds are ignored.');
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  const manifest: ProjectVPluginManifest = {
    schemaVersion: PROJECT_V_PLUGIN_SCHEMA_VERSION,
    id,
    name,
    version,
    description,
    author,
    category,
    icon: cleanText(input.icon, 8) || undefined,
    defaultSize,
    minSize,
    refreshIntervalSeconds: refreshIntervalSeconds && refreshIntervalSeconds >= 5 ? refreshIntervalSeconds : undefined,
    permissions,
    allowedNetworkOrigins,
    requiredRuntimeFeatures,
    entry: { type: 'sandbox-html', html, css, script },
  };
  return { valid: true, manifest, errors, warnings };
}

export class ProjectVModuleRegistry {
  private readonly definitions = new Map<string, ProjectVModuleDefinition>();
  private store: PluginStore;

  constructor() {
    this.store = this.loadStore();
  }

  registerBuiltInPanels(grid: HTMLElement): void {
    for (const child of Array.from(grid.children)) {
      const panel = child as HTMLElement;
      const panelId = panel.dataset.panel;
      if (!panelId || panelId.startsWith('plugin-')) continue;
      const title = panel.querySelector<HTMLElement>('.panel-title')?.textContent?.trim()
        ?.replace(/\s*\/\/\s*ACTIVE THEATER$/i, '')
        || panelId.replace(/-/g, ' ').toUpperCase();
      const size = fallbackSize(panelId, panel);
      const definition: ProjectVModuleDefinition = {
        panelId,
        name: title,
        description: `Core Watchtower module: ${title}.`,
        category: inferCategory(panelId, title),
        source: 'core',
        version: 'core',
        defaultSize: size,
        minSize: { w: panelId === 'map' ? 6 : 2, h: panelId === 'map' ? 4 : 2 },
        permissions: [],
        requiredRuntimeFeatures: [],
      };
      this.registerDefinition(definition, panel);
    }
  }

  registerPluginPanel(panel: HTMLElement, manifest: ProjectVPluginManifest): ProjectVModuleDefinition {
    const panelId = pluginPanelId(manifest.id);
    const definition: ProjectVModuleDefinition = {
      panelId,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      source: 'plugin',
      version: manifest.version,
      author: manifest.author,
      icon: manifest.icon,
      defaultSize: { ...manifest.defaultSize },
      minSize: { ...(manifest.minSize ?? { w: 2, h: 2 }) },
      refreshIntervalSeconds: manifest.refreshIntervalSeconds,
      permissions: [...(manifest.permissions ?? [])],
      requiredRuntimeFeatures: [...(manifest.requiredRuntimeFeatures ?? [])],
      pluginId: manifest.id,
    };
    this.registerDefinition(definition, panel);
    return definition;
  }

  unregisterPanel(panelId: string): void {
    this.definitions.delete(panelId);
  }

  getDefinition(panelId: string): ProjectVModuleDefinition | undefined {
    const definition = this.definitions.get(panelId);
    return definition ? { ...definition, defaultSize: { ...definition.defaultSize }, minSize: { ...definition.minSize }, permissions: [...definition.permissions], requiredRuntimeFeatures: [...definition.requiredRuntimeFeatures] } : undefined;
  }

  getDefinitions(): ProjectVModuleDefinition[] {
    return Array.from(this.definitions.values()).map((definition) => this.getDefinition(definition.panelId)!);
  }

  getInstalledPlugins(): InstalledProjectVPlugin[] {
    return this.store.plugins.map(cloneInstalled).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  getEnabledPlugins(): InstalledProjectVPlugin[] {
    return this.getInstalledPlugins().filter((plugin) => plugin.enabled);
  }

  getPlugin(pluginId: string): InstalledProjectVPlugin | undefined {
    const plugin = this.store.plugins.find((item) => item.manifest.id === pluginId);
    return plugin ? cloneInstalled(plugin) : undefined;
  }

  getPluginByPanelId(panelId: string): InstalledProjectVPlugin | undefined {
    const plugin = this.store.plugins.find((item) => pluginPanelId(item.manifest.id) === panelId);
    return plugin ? cloneInstalled(plugin) : undefined;
  }

  install(input: unknown): ProjectVPluginValidationResult {
    const result = validateProjectVPluginManifest(input);
    if (!result.valid || !result.manifest) return result;
    const now = Date.now();
    const existingIndex = this.store.plugins.findIndex((item) => item.manifest.id === result.manifest!.id);
    if (existingIndex === -1 && this.store.plugins.length >= MAX_PLUGIN_COUNT) {
      return { valid: false, errors: [`A maximum of ${MAX_PLUGIN_COUNT} local plugins can be installed.`], warnings: result.warnings };
    }
    const existing = existingIndex >= 0 ? this.store.plugins[existingIndex] : undefined;
    const installed: InstalledProjectVPlugin = {
      manifest: cloneManifest(result.manifest),
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };
    const nextPlugins = this.store.plugins.map(cloneInstalled);
    if (existingIndex >= 0) nextPlugins[existingIndex] = installed;
    else nextPlugins.push(installed);
    const serialized = JSON.stringify({ version: PLUGIN_STORE_VERSION, plugins: nextPlugins });
    if (new Blob([serialized]).size > MAX_REGISTRY_BYTES) {
      return {
        valid: false,
        errors: [`The local plugin registry would exceed ${Math.round(MAX_REGISTRY_BYTES / 1024 / 1024)} MB.`],
        warnings: result.warnings,
      };
    }
    const previous = this.store.plugins;
    this.store.plugins = nextPlugins;
    if (!this.persistStore()) {
      this.store.plugins = previous;
      return { valid: false, errors: ['Unable to save the plugin registry in local storage.'], warnings: result.warnings };
    }
    this.dispatchChange('installed', result.manifest.id);
    return result;
  }

  setEnabled(pluginId: string, enabled: boolean): boolean {
    const plugin = this.store.plugins.find((item) => item.manifest.id === pluginId);
    if (!plugin || plugin.enabled === enabled) return Boolean(plugin);
    const previousEnabled = plugin.enabled;
    const previousUpdatedAt = plugin.updatedAt;
    plugin.enabled = enabled;
    plugin.updatedAt = Date.now();
    if (!this.persistStore()) {
      plugin.enabled = previousEnabled;
      plugin.updatedAt = previousUpdatedAt;
      return false;
    }
    this.dispatchChange(enabled ? 'enabled' : 'disabled', pluginId);
    return true;
  }

  uninstall(pluginId: string): boolean {
    const previous = this.store.plugins;
    const next = previous.filter((item) => item.manifest.id !== pluginId);
    if (next.length === previous.length) return false;
    this.store.plugins = next;
    if (!this.persistStore()) {
      this.store.plugins = previous;
      return false;
    }
    this.dispatchChange('uninstalled', pluginId);
    return true;
  }

  exportPlugin(pluginId: string): string | null {
    const plugin = this.store.plugins.find((item) => item.manifest.id === pluginId);
    return plugin ? JSON.stringify(plugin.manifest, null, 2) : null;
  }

  exportRegistry(): string {
    return JSON.stringify({
      schema: 'project-v-plugin-registry',
      version: PLUGIN_STORE_VERSION,
      exportedAt: new Date().toISOString(),
      plugins: this.store.plugins.map((plugin) => plugin.manifest),
    }, null, 2);
  }

  installStarterPack(): ProjectVPluginValidationResult[] {
    return PROJECT_V_STARTER_PLUGINS.map((manifest) => this.install(manifest));
  }

  private registerDefinition(definition: ProjectVModuleDefinition, panel?: HTMLElement): void {
    this.definitions.set(definition.panelId, definition);
    if (!panel) return;
    panel.dataset.moduleCategory = definition.category;
    panel.dataset.moduleSource = definition.source;
    panel.dataset.moduleDescription = definition.description;
    panel.dataset.moduleVersion = definition.version;
    panel.dataset.moduleDefaultW = String(definition.defaultSize.w);
    panel.dataset.moduleDefaultH = String(definition.defaultSize.h);
    panel.dataset.moduleMinW = String(definition.minSize.w);
    panel.dataset.moduleMinH = String(definition.minSize.h);
    panel.dataset.modulePermissions = definition.permissions.join(',');
    panel.dataset.moduleRequiredFeatures = definition.requiredRuntimeFeatures.join(',');
    if (definition.pluginId) panel.dataset.pluginId = definition.pluginId;
  }

  private loadStore(): PluginStore {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUGIN_STORE_KEY) ?? 'null') as unknown;
      if (!isRecord(parsed) || parsed.version !== PLUGIN_STORE_VERSION || !Array.isArray(parsed.plugins)) {
        return { version: PLUGIN_STORE_VERSION, plugins: [] };
      }
      const plugins: InstalledProjectVPlugin[] = [];
      for (const candidate of parsed.plugins.slice(0, MAX_PLUGIN_COUNT)) {
        if (!isRecord(candidate)) continue;
        const result = validateProjectVPluginManifest(candidate.manifest);
        if (!result.valid || !result.manifest) continue;
        plugins.push({
          manifest: result.manifest,
          enabled: candidate.enabled !== false,
          installedAt: finiteInteger(candidate.installedAt, Date.now()),
          updatedAt: finiteInteger(candidate.updatedAt, Date.now()),
        });
      }
      return { version: PLUGIN_STORE_VERSION, plugins };
    } catch {
      return { version: PLUGIN_STORE_VERSION, plugins: [] };
    }
  }

  private persistStore(): boolean {
    try {
      localStorage.setItem(PLUGIN_STORE_KEY, JSON.stringify(this.store));
      return true;
    } catch (error) {
      console.warn('[Project V Plugins] Unable to persist plugin registry:', error);
      return false;
    }
  }

  private dispatchChange(action: string, pluginId: string): void {
    window.dispatchEvent(new CustomEvent('project-v-plugin-registry-change', { detail: { action, pluginId } }));
  }
}

const STARTER_BASE_CSS = `
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#090909;color:#e7dfd4}
*{box-sizing:border-box}body{margin:0;padding:12px;background:radial-gradient(circle at top right,rgba(139,0,0,.12),transparent 48%),#090909;color:#e7dfd4}
button,input,textarea{font:inherit}button{border:1px solid #5f1717;background:#170909;color:#f0e5d7;padding:7px 10px;cursor:pointer}button:hover{border-color:#bd3434;background:#260d0d}
.pv-card{border:1px solid #292929;background:rgba(14,14,14,.94);padding:12px;min-height:100%}.pv-kicker{font-size:10px;letter-spacing:.18em;color:#b54a4a}.pv-title{font-size:16px;margin:4px 0 12px}.pv-muted{font-size:11px;color:#908984}.pv-row{display:flex;gap:8px;align-items:center}.pv-grid{display:grid;gap:8px}.pv-badge{font-size:9px;letter-spacing:.12em;border:1px solid #512020;padding:3px 5px;color:#d89a9a}
`;

export const PROJECT_V_STARTER_PLUGINS: ProjectVPluginManifest[] = [
  {
    schemaVersion: 1,
    id: 'projectv.tools.field-notes',
    name: 'Field Notes',
    version: '1.0.0',
    description: 'A private per-device scratchpad using the Project V plugin storage bridge.',
    author: 'Project V',
    category: 'research',
    icon: '✎',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    permissions: ['storage'],
    entry: {
      type: 'sandbox-html',
      css: `${STARTER_BASE_CSS}textarea{width:100%;min-height:170px;resize:none;background:#070707;color:#eee2d3;border:1px solid #333;padding:10px;outline:none}textarea:focus{border-color:#7f2525}.pv-status{margin-left:auto;font-size:9px;color:#a7897b}`,
      html: `<div class="pv-card"><div class="pv-kicker">PROJECT V // LOCAL</div><div class="pv-row"><div class="pv-title">FIELD NOTES</div><span class="pv-status" id="status">READY</span></div><textarea id="notes" placeholder="Write operational notes here..."></textarea><div class="pv-row" style="margin-top:8px"><button id="clear">CLEAR</button><span class="pv-muted">Stored locally for this plugin only.</span></div></div>`,
      script: `const notes=document.getElementById('notes');const status=document.getElementById('status');let timer;ProjectV.storage.get('notes').then(v=>{notes.value=typeof v==='string'?v:''});notes.addEventListener('input',()=>{status.textContent='UNSAVED';clearTimeout(timer);timer=setTimeout(async()=>{await ProjectV.storage.set('notes',notes.value);status.textContent='SAVED'},350)});document.getElementById('clear').addEventListener('click',async()=>{notes.value='';await ProjectV.storage.remove('notes');status.textContent='CLEARED'});`,
    },
  },
  {
    schemaVersion: 1,
    id: 'projectv.tools.quick-links',
    name: 'Quick Launch',
    version: '1.0.0',
    description: 'A compact launch board for frequently used public intelligence resources.',
    author: 'Project V',
    category: 'system',
    icon: '⌁',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    permissions: ['network'],
    allowedNetworkOrigins: ['https://www.reuters.com', 'https://apnews.com', 'https://firms.modaps.eosdis.nasa.gov', 'https://www.openstreetmap.org'],
    entry: {
      type: 'sandbox-html',
      css: `${STARTER_BASE_CSS}.links{grid-template-columns:repeat(2,minmax(0,1fr))}.link{display:block;text-align:left;border:1px solid #302828;background:#101010;color:#e7dfd4;padding:12px}.link:hover{border-color:#8d2c2c;background:#180c0c}.link strong{display:block;font-size:11px}.link span{display:block;font-size:9px;color:#8e8580;margin-top:4px}`,
      html: `<div class="pv-card"><div class="pv-kicker">PROJECT V // OPEN SOURCES</div><div class="pv-title">QUICK LAUNCH</div><div class="pv-grid links"><button class="link" data-url="https://www.reuters.com/world/"><strong>REUTERS WORLD</strong><span>Global reporting</span></button><button class="link" data-url="https://apnews.com/hub/world-news"><strong>AP WORLD</strong><span>World news</span></button><button class="link" data-url="https://firms.modaps.eosdis.nasa.gov/map/"><strong>NASA FIRMS</strong><span>Fire map</span></button><button class="link" data-url="https://www.openstreetmap.org/"><strong>OPENSTREETMAP</strong><span>Map reference</span></button></div></div>`,
      script: `document.querySelectorAll('[data-url]').forEach(button=>button.addEventListener('click',()=>ProjectV.openExternal(button.dataset.url).catch(error=>console.error(error))));`,
    },
  },
  {
    schemaVersion: 1,
    id: 'projectv.tools.system-pulse',
    name: 'System Pulse',
    version: '1.0.0',
    description: 'A lightweight local clock and session-status module for the command deck.',
    author: 'Project V',
    category: 'system',
    icon: '◉',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    permissions: [],
    refreshIntervalSeconds: 1,
    entry: {
      type: 'sandbox-html',
      css: `${STARTER_BASE_CSS}.clock{font-size:34px;letter-spacing:.08em;margin:8px 0}.date{font-size:11px;color:#a59a91}.line{height:1px;background:linear-gradient(90deg,#7e2020,transparent);margin:14px 0}.signal{display:flex;align-items:center;gap:7px;font-size:10px}.dot{width:7px;height:7px;border-radius:50%;background:#6ca36b;box-shadow:0 0 8px rgba(108,163,107,.7)}`,
      html: `<div class="pv-card"><div class="pv-kicker">PROJECT V // WATCHTOWER</div><div class="clock" id="clock">--:--:--</div><div class="date" id="date"></div><div class="line"></div><div class="signal"><span class="dot"></span><span>LOCAL MODULE BUS ACTIVE</span></div></div>`,
      script: `function tick(){const d=new Date();document.getElementById('clock').textContent=d.toLocaleTimeString([], {hour12:false});document.getElementById('date').textContent=d.toLocaleDateString([], {weekday:'long',year:'numeric',month:'long',day:'numeric'}).toUpperCase()}tick();setInterval(tick,1000);`,
    },
  },
];
