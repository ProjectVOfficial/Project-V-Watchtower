import { hasTauriInvokeBridge, invokeTauri } from './tauri-bridge';

export type OsintQueryType = 'username' | 'email' | 'domain' | 'ip' | 'phone' | 'text';
export type OsintOpenMode = 'restricted-window' | 'default-browser' | 'browser-popup';

export interface OsintToolDefinition {
  id: string;
  name: string;
  description: string;
  queryTypes: OsintQueryType[];
  urlTemplate: string;
  builtIn?: boolean;
  copyQueryFirst?: boolean;
  category: 'search' | 'identity' | 'domain' | 'network' | 'custom';
}

export interface OsintSearchRecord {
  id: string;
  query: string;
  queryType: OsintQueryType;
  toolId: string;
  openedAt: number;
}

const TOOLS_KEY = 'project-v-osint-custom-tools-v1';
const HISTORY_KEY = 'project-v-osint-search-history-v1';

const BUILT_IN_TOOLS: OsintToolDefinition[] = [
  {
    id: 'duckduckgo-exact',
    name: 'DuckDuckGo Exact Search',
    description: 'Search public web pages for the exact identifier.',
    queryTypes: ['username', 'email', 'domain', 'ip', 'phone', 'text'],
    urlTemplate: 'https://duckduckgo.com/?q=%22{query}%22',
    builtIn: true,
    category: 'search',
  },
  {
    id: 'bing-exact',
    name: 'Bing Exact Search',
    description: 'Search indexed public pages for the exact identifier.',
    queryTypes: ['username', 'email', 'domain', 'ip', 'phone', 'text'],
    urlTemplate: 'https://www.bing.com/search?q=%22{query}%22',
    builtIn: true,
    category: 'search',
  },
  {
    id: 'github-profile',
    name: 'GitHub Profile',
    description: 'Open a public GitHub username profile.',
    queryTypes: ['username'],
    urlTemplate: 'https://github.com/{query}',
    builtIn: true,
    category: 'identity',
  },
  {
    id: 'reddit-profile',
    name: 'Reddit Profile',
    description: 'Open a public Reddit username profile.',
    queryTypes: ['username'],
    urlTemplate: 'https://www.reddit.com/user/{query}',
    builtIn: true,
    category: 'identity',
  },
  {
    id: 'keybase-profile',
    name: 'Keybase Profile',
    description: 'Open a public Keybase username profile.',
    queryTypes: ['username'],
    urlTemplate: 'https://keybase.io/{query}',
    builtIn: true,
    category: 'identity',
  },
  {
    id: 'hibp-home',
    name: 'Have I Been Pwned',
    description: 'Open the breach-check service and copy the email for manual entry.',
    queryTypes: ['email'],
    urlTemplate: 'https://haveibeenpwned.com/',
    copyQueryFirst: true,
    builtIn: true,
    category: 'identity',
  },
  {
    id: 'crtsh-domain',
    name: 'Certificate Search',
    description: 'Search public certificate-transparency records for a domain.',
    queryTypes: ['domain'],
    urlTemplate: 'https://crt.sh/?q={query}',
    builtIn: true,
    category: 'domain',
  },
  {
    id: 'urlscan-domain',
    name: 'URLScan Domain',
    description: 'Review public URLScan observations associated with a domain.',
    queryTypes: ['domain'],
    urlTemplate: 'https://urlscan.io/domain/{query}',
    builtIn: true,
    category: 'domain',
  },
  {
    id: 'virustotal-domain',
    name: 'VirusTotal Domain',
    description: 'Open the public reputation page for a domain.',
    queryTypes: ['domain'],
    urlTemplate: 'https://www.virustotal.com/gui/domain/{query}',
    builtIn: true,
    category: 'domain',
  },
  {
    id: 'virustotal-ip',
    name: 'VirusTotal IP',
    description: 'Open the public reputation page for an IP address.',
    queryTypes: ['ip'],
    urlTemplate: 'https://www.virustotal.com/gui/ip-address/{query}',
    builtIn: true,
    category: 'network',
  },
  {
    id: 'abuseipdb-ip',
    name: 'AbuseIPDB',
    description: 'Review public abuse reports for an IP address.',
    queryTypes: ['ip'],
    urlTemplate: 'https://www.abuseipdb.com/check/{query}',
    builtIn: true,
    category: 'network',
  },
  {
    id: 'shodan-ip',
    name: 'Shodan Host',
    description: 'Open the public Shodan host page for an IP address.',
    queryTypes: ['ip'],
    urlTemplate: 'https://www.shodan.io/host/{query}',
    builtIn: true,
    category: 'network',
  },
];

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function applyTemplateReplacements(template: string, replacements: Record<string, string>): string {
  let output = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    output = output.split(placeholder).join(value);
  }
  return output;
}

function validateTool(tool: Partial<OsintToolDefinition>): OsintToolDefinition | null {
  const name = typeof tool.name === 'string' ? tool.name.trim().slice(0, 80) : '';
  const description = typeof tool.description === 'string' ? tool.description.trim().slice(0, 240) : '';
  const urlTemplate = typeof tool.urlTemplate === 'string' ? tool.urlTemplate.trim() : '';
  if (!name || !urlTemplate) return null;
  let url: URL;
  try {
    url = new URL(applyTemplateReplacements(urlTemplate, {
      '{query}': 'test',
      '{username}': 'test',
      '{email}': 'test@example.com',
      '{domain}': 'example.com',
      '{ip}': '1.1.1.1',
      '{phone}': '15555550123',
    }));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const allowedTypes: OsintQueryType[] = ['username', 'email', 'domain', 'ip', 'phone', 'text'];
  const queryTypes = Array.isArray(tool.queryTypes) ? tool.queryTypes.filter((item): item is OsintQueryType => allowedTypes.includes(item as OsintQueryType)) : [];
  if (queryTypes.length === 0) return null;
  return {
    id: typeof tool.id === 'string' && tool.id.trim() ? tool.id.trim().slice(0, 80) : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    description: description || 'Custom public-source lookup launcher.',
    queryTypes,
    urlTemplate,
    copyQueryFirst: Boolean(tool.copyQueryFirst),
    category: 'custom',
  };
}

export function getOsintTools(): OsintToolDefinition[] {
  const custom = safeParse<Partial<OsintToolDefinition>[]>(localStorage.getItem(TOOLS_KEY), [])
    .map(validateTool)
    .filter((item): item is OsintToolDefinition => Boolean(item));
  return [...BUILT_IN_TOOLS, ...custom];
}

export function saveCustomOsintTool(input: Partial<OsintToolDefinition>): OsintToolDefinition {
  const tool = validateTool(input);
  if (!tool) throw new Error('Enter a valid HTTPS URL template and at least one query type.');
  const custom = getOsintTools().filter((item) => !item.builtIn && item.id !== tool.id);
  custom.push(tool);
  localStorage.setItem(TOOLS_KEY, JSON.stringify(custom));
  return tool;
}

export function deleteCustomOsintTool(id: string): void {
  const custom = getOsintTools().filter((item) => !item.builtIn && item.id !== id);
  localStorage.setItem(TOOLS_KEY, JSON.stringify(custom));
}

export function exportOsintTools(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tools: getOsintTools().filter((item) => !item.builtIn) }, null, 2);
}

export function importOsintTools(value: string): number {
  const parsed = JSON.parse(value) as { tools?: Partial<OsintToolDefinition>[] } | Partial<OsintToolDefinition>[];
  const list = Array.isArray(parsed) ? parsed : parsed.tools;
  if (!Array.isArray(list)) throw new Error('The selected file does not contain an OSINT tool list.');
  let count = 0;
  for (const item of list) {
    if (validateTool(item)) {
      saveCustomOsintTool(item);
      count += 1;
    }
  }
  return count;
}

export function compileOsintUrl(tool: OsintToolDefinition, query: string, type: OsintQueryType): URL {
  const normalized = query.trim();
  if (!normalized) throw new Error('Enter a search value first.');
  const encoded = encodeURIComponent(normalized);
  const replacements: Record<string, string> = {
    '{query}': encoded,
    '{username}': encoded,
    '{email}': encoded,
    '{domain}': encoded,
    '{ip}': encoded,
    '{phone}': encoded,
  };
  const output = applyTemplateReplacements(tool.urlTemplate, replacements);
  const url = new URL(output);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS OSINT services are allowed.');
  if (!tool.queryTypes.includes(type)) throw new Error(`${tool.name} does not support ${type} searches.`);
  return url;
}

export function loadOsintHistory(): OsintSearchRecord[] {
  const history = safeParse<OsintSearchRecord[]>(localStorage.getItem(HISTORY_KEY), []);
  return history.filter((item) => item && typeof item.query === 'string' && typeof item.openedAt === 'number').slice(0, 50);
}

function recordHistory(tool: OsintToolDefinition, query: string, queryType: OsintQueryType): void {
  const next: OsintSearchRecord = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    query: query.trim(),
    queryType,
    toolId: tool.id,
    openedAt: Date.now(),
  };
  const history = [next, ...loadOsintHistory().filter((item) => !(item.query === next.query && item.toolId === next.toolId))].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearOsintHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export async function openOsintTool(
  tool: OsintToolDefinition,
  query: string,
  queryType: OsintQueryType,
  preference: 'restricted' | 'external' = 'restricted',
): Promise<OsintOpenMode> {
  const url = compileOsintUrl(tool, query, queryType);
  if (tool.copyQueryFirst) await navigator.clipboard.writeText(query.trim()).catch(() => {});

  // Secondary Tauri windows can be served from the Vite development origin, so
  // the invoke bridge is a more reliable runtime signal than URL inspection.
  if (hasTauriInvokeBridge()) {
    if (preference === 'restricted') {
      try {
        await invokeTauri<void>('open_source_browser_window', {
          url: url.href,
          title: `${tool.name} // ${query.trim().slice(0, 80)}`,
        });
        recordHistory(tool, query, queryType);
        return 'restricted-window';
      } catch (restrictedError) {
        console.warn('[osint-tools] Restricted Source Browser failed; falling back to the registered system browser.', restrictedError);
      }
    }

    try {
      await invokeTauri<void>('open_url', { url: url.href });
      recordHistory(tool, query, queryType);
      return 'default-browser';
    } catch (externalError) {
      throw new Error(externalError instanceof Error
        ? `Unable to open the OSINT service: ${externalError.message}`
        : 'Unable to open the OSINT service in Project V or the default browser.');
    }
  }

  const popup = window.open(url.href, '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('The browser blocked the OSINT result window. Allow popups for Watchtower and try again.');
  recordHistory(tool, query, queryType);
  return 'browser-popup';
}
