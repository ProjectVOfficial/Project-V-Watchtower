import type { AppContext } from '@/app/app-context';
import { collectResearchContext } from '@/services/research-library';
import { describeMapOperation, getMapOperationsState } from '@/services/map-operations';

export type CommandContextScope = 'workspace' | 'visible' | 'insights' | 'research' | 'workspace-research' | 'none';

export interface CommandContextSource {
  id: string;
  title: string;
  kind: 'panel' | 'news' | 'map' | 'system' | 'document' | 'memory';
  text: string;
  url?: string;
}

export interface CollectedCommandContext {
  workspaceId: string;
  scope: CommandContextScope;
  sources: CommandContextSource[];
  promptBlock: string;
}

const MAX_PANEL_TEXT = 2200;
const MAX_NEWS_ITEMS = 18;
const MAX_TOTAL_CHARS = 26000;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function panelTitle(element: HTMLElement, fallback: string): string {
  return compact(element.querySelector<HTMLElement>('.panel-title')?.textContent ?? fallback);
}

function panelSource(element: HTMLElement): CommandContextSource | null {
  const id = element.dataset.panel;
  if (!id || id === 'command-assistant' || id === 'research-library') return null;
  if (element.classList.contains('hidden') || element.classList.contains('deck-hidden')) return null;
  const content = element.querySelector<HTMLElement>('.panel-content');
  const text = compact(content?.innerText ?? '').slice(0, MAX_PANEL_TEXT);
  if (!text) return null;
  return { id, title: panelTitle(element, id), kind: 'panel', text };
}

function collectVisiblePanels(scope: CommandContextScope): CommandContextSource[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>('#panelsGrid > [data-panel]'));
  const filtered = scope === 'insights'
    ? all.filter((element) => ['insights', 'strategic-risk', 'strategic-posture', 'cii'].includes(element.dataset.panel ?? ''))
    : all;
  return filtered.map(panelSource).filter((value): value is CommandContextSource => Boolean(value));
}

function collectNews(ctx: AppContext): CommandContextSource[] {
  return ctx.allNews.slice(0, MAX_NEWS_ITEMS).map((item, index) => ({
    id: `news-${index}`,
    title: item.source || 'News source',
    kind: 'news' as const,
    text: `${item.title}${item.locationName ? ` — ${item.locationName}` : ''}${item.isAlert ? ' [ALERT]' : ''}`,
    url: item.link,
  }));
}

function collectMap(ctx: AppContext): CommandContextSource {
  const enabledLayers = Object.entries(ctx.mapLayers)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .slice(0, 24);
  return {
    id: 'map-state',
    title: 'Map state',
    kind: 'map',
    text: `Theater: ${ctx.resolvedLocation}; time range: ${ctx.currentTimeRange}; enabled layers: ${enabledLayers.join(', ') || 'none'}.`,
  };
}

function collectMapOperations(): CommandContextSource | null {
  const state = getMapOperationsState();
  if (state.items.length === 0 && state.rules.length === 0) return null;
  const items = state.items.slice(0, 20).map((item) => `${item.name} [${item.type}] — ${describeMapOperation(item)}${item.tags.length ? ` — tags: ${item.tags.join(', ')}` : ''}`);
  const rules = state.rules.filter((rule) => rule.enabled).slice(0, 20).map((rule) => {
    const area = state.items.find((item) => item.id === rule.areaId);
    return `${rule.name} (${rule.severity}) watches ${area?.name ?? rule.areaId}${rule.keywords.length ? ` for keywords: ${rule.keywords.join(', ')}` : ' for all geolocated items'}`;
  });
  return {
    id: 'map-operations',
    title: 'Map Operations and Geofences',
    kind: 'map',
    text: [`Saved map items: ${state.items.length}. Active geofence rules: ${state.rules.filter((rule) => rule.enabled).length}.`, ...items, ...rules].join('\n').slice(0, MAX_PANEL_TEXT * 2),
  };
}

function dedupe(sources: CommandContextSource[]): CommandContextSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.title.toLowerCase()}|${source.text.toLowerCase().slice(0, 180)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimSources(sources: CommandContextSource[]): CommandContextSource[] {
  let used = 0;
  const result: CommandContextSource[] = [];
  for (const source of sources) {
    const remaining = MAX_TOTAL_CHARS - used;
    if (remaining <= 0) break;
    const text = source.text.slice(0, remaining);
    result.push({ ...source, text });
    used += text.length;
  }
  return result;
}

function isResearchScope(scope: CommandContextScope): boolean {
  return scope === 'research' || scope === 'workspace-research';
}

export async function collectCommandContext(ctx: AppContext, scope: CommandContextScope, query = ''): Promise<CollectedCommandContext> {
  const workspaceId = document.body.dataset.activeDeck ?? 'watchtower';
  if (scope === 'none') return { workspaceId, scope, sources: [], promptBlock: '' };

  const includesWorkspace = scope !== 'research';
  const panelScope: CommandContextScope = scope === 'workspace-research' ? 'workspace' : scope;
  const panelSources = includesWorkspace ? collectVisiblePanels(panelScope) : [];
  let researchUnavailable: CommandContextSource | null = null;
  let researchResults = [] as Awaited<ReturnType<typeof collectResearchContext>>;
  if (isResearchScope(scope)) {
    try {
      researchResults = await collectResearchContext(query, 10);
    } catch (error) {
      researchUnavailable = {
        id: 'research-unavailable',
        title: 'Research library status',
        kind: 'system',
        text: error instanceof Error
          ? `The local research library could not be read: ${error.message}`
          : 'The local research library could not be read.',
      };
    }
  }
  const researchSources: CommandContextSource[] = researchResults.map((result) => ({
    id: `research-${result.id}`,
    title: `${result.title}${result.page ? ` — page ${result.page}` : ''}`,
    kind: result.kind === 'memory' || result.kind === 'excerpt' ? 'memory' : 'document',
    text: result.text,
  }));

  const mapOperations = includesWorkspace ? collectMapOperations() : null;
  const sources = trimSources(dedupe([
    { id: 'workspace', title: 'Workspace', kind: 'system', text: `Active Project V desk: ${workspaceId}.` },
    ...(includesWorkspace ? [collectMap(ctx), ...(mapOperations ? [mapOperations] : []), ...panelSources] : []),
    ...(panelScope === 'workspace' ? collectNews(ctx) : []),
    ...researchSources,
    ...(researchUnavailable ? [researchUnavailable] : []),
  ]));

  const promptBlock = sources.map((source, index) => {
    const link = source.url ? `\nURL: ${source.url}` : '';
    return `[S${index + 1}] ${source.title} (${source.kind})\n${source.text}${link}`;
  }).join('\n\n');

  return { workspaceId, scope, sources, promptBlock };
}
