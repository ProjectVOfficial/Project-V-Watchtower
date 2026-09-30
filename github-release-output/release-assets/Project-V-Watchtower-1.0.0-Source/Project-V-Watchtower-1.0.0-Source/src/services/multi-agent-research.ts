import type { CommandContextSource, CommandContextScope } from './command-context';

export type ResearchAgentId = 'collector' | 'verifier' | 'timeline' | 'contradiction' | 'geospatial' | 'briefing';
export type ResearchAgentStatus = 'queued' | 'running' | 'complete' | 'failed' | 'skipped';
export type ResearchMissionStatus = 'draft' | 'running' | 'complete' | 'stopped' | 'failed';

export interface ResearchAgentDefinition {
  id: ResearchAgentId;
  label: string;
  shortLabel: string;
  description: string;
  systemPrompt: string;
}

export interface ResearchAgentResult {
  agentId: ResearchAgentId;
  status: ResearchAgentStatus;
  content: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ResearchMission {
  id: string;
  title: string;
  query: string;
  scope: CommandContextScope;
  liveRefresh: boolean;
  caseId?: string;
  caseTitle?: string;
  selectedAgents: ResearchAgentId[];
  status: ResearchMissionStatus;
  createdAt: number;
  updatedAt: number;
  sources: CommandContextSource[];
  results: Partial<Record<ResearchAgentId, ResearchAgentResult>>;
  finalReport: string;
  error?: string;
}

interface ResearchMissionStore {
  version: 1;
  activeMissionId?: string;
  missions: ResearchMission[];
}

export const RESEARCH_AGENT_DEFINITIONS: ReadonlyArray<ResearchAgentDefinition> = [
  {
    id: 'collector',
    label: 'COLLECTOR',
    shortLabel: 'COLLECT',
    description: 'Extracts relevant signals and builds a source ledger without making unsupported judgments.',
    systemPrompt: `You are the Collector in a local Project V multi-agent research team.
Extract the most relevant signals from the supplied material. Build a compact evidence ledger using the provided [S#] source labels. Separate direct observations, generated panel analysis, analyst notes, and unknowns. Do not decide whether a claim is true. Do not invent sources, URLs, dates, locations, or numbers. End with the ten strongest items that should be passed to other agents.`,
  },
  {
    id: 'verifier',
    label: 'VERIFIER',
    shortLabel: 'VERIFY',
    description: 'Tests claims against the supplied sources and assigns transparent confidence judgments.',
    systemPrompt: `You are the Verifier in a local Project V multi-agent research team.
Evaluate important claims using only the supplied context and prior agent notes. For each material claim, identify corroborating and contradicting [S#] sources, source quality limitations, staleness, and a confidence rating of high, medium, low, or unresolved. Never treat repetition as independent confirmation. Never invent evidence. Clearly list what evidence would be needed next.`,
  },
  {
    id: 'timeline',
    label: 'TIMELINE ANALYST',
    shortLabel: 'TIMELINE',
    description: 'Builds a chronology and identifies temporal gaps, sequence problems, and stale reporting.',
    systemPrompt: `You are the Timeline Analyst in a local Project V multi-agent research team.
Build the clearest chronology supported by the supplied material. Use exact dates and times only when present. Mark relative or uncertain timing explicitly. Distinguish event time from publication time. Highlight sequence conflicts, missing intervals, stale items, and events that cannot be ordered. Cite [S#] labels for every substantive timeline entry.`,
  },
  {
    id: 'contradiction',
    label: 'CONTRADICTION ANALYST',
    shortLabel: 'CONFLICTS',
    description: 'Finds conflicting accounts, unsupported leaps, framing differences, and information gaps.',
    systemPrompt: `You are the Contradiction Analyst in a local Project V multi-agent research team.
Identify factual conflicts, incompatible timelines, inconsistent numbers, source circularity, framing differences, and unsupported conclusions. Separate genuine contradiction from different scope, time window, terminology, or uncertainty. Cite the relevant [S#] labels. Do not accuse a source of deception without direct evidence. End with prioritized questions that would resolve the most important conflicts.`,
  },
  {
    id: 'geospatial',
    label: 'GEOSPATIAL ANALYST',
    shortLabel: 'GEO',
    description: 'Reviews locations, routes, proximity, map signals, and geographic uncertainty.',
    systemPrompt: `You are the Geospatial Analyst in a local Project V multi-agent research team.
Analyze the locations, routes, regions, map layers, geofences, and proximity relationships explicitly present in the supplied material. Do not infer coordinates that were not supplied. Flag ambiguous place names, mismatched locations, scale problems, and geographic blind spots. Cite [S#] labels. Recommend map checks or geofences that would improve confidence.`,
  },
  {
    id: 'briefing',
    label: 'BRIEFING OFFICER',
    shortLabel: 'BRIEF',
    description: 'Synthesizes the specialist findings into a source-aware final assessment and action list.',
    systemPrompt: `You are the Briefing Officer for a local Project V multi-agent research team.
Synthesize the supplied context and specialist outputs into a disciplined final intelligence brief. Include: executive assessment, key judgments with confidence, supporting evidence, contradictions, timeline, geographic implications when relevant, intelligence gaps, and recommended next verification steps. Cite original [S#] sources rather than citing agents as evidence. Distinguish facts, generated analysis, and inference. Never invent a source or claim unrestricted internet access.`,
  },
] as const;

const STORAGE_KEY = 'project-v-multi-agent-research-v1';
const CHANNEL_NAME = 'project-v-multi-agent-research-events';
const MAX_MISSIONS = 30;
let channel: BroadcastChannel | null = null;

function id(prefix = 'mission'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clean(value: unknown, max = 12000): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max)
    : '';
}

function isAgentId(value: unknown): value is ResearchAgentId {
  return RESEARCH_AGENT_DEFINITIONS.some((agent) => agent.id === value);
}

function normalizeMission(value: unknown): ResearchMission | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ResearchMission>;
  if (typeof candidate.id !== 'string' || typeof candidate.createdAt !== 'number') return null;
  const selectedAgents: ResearchAgentId[] = Array.isArray(candidate.selectedAgents)
    ? candidate.selectedAgents.filter(isAgentId)
    : ['collector', 'verifier', 'contradiction', 'briefing'];
  if (!selectedAgents.includes('briefing')) selectedAgents.push('briefing');
  const validStatus: ResearchMissionStatus[] = ['draft', 'running', 'complete', 'stopped', 'failed'];
  const results: Partial<Record<ResearchAgentId, ResearchAgentResult>> = {};
  if (candidate.results && typeof candidate.results === 'object') {
    for (const [key, result] of Object.entries(candidate.results)) {
      if (!isAgentId(key) || !result || typeof result !== 'object') continue;
      const item = result as Partial<ResearchAgentResult>;
      const statuses: ResearchAgentStatus[] = ['queued', 'running', 'complete', 'failed', 'skipped'];
      results[key] = {
        agentId: key,
        status: statuses.includes(item.status as ResearchAgentStatus) ? item.status as ResearchAgentStatus : 'queued',
        content: clean(item.content, 30000),
        error: clean(item.error, 1000) || undefined,
        startedAt: typeof item.startedAt === 'number' ? item.startedAt : undefined,
        completedAt: typeof item.completedAt === 'number' ? item.completedAt : undefined,
      };
    }
  }
  const scope = candidate.scope === 'visible' || candidate.scope === 'insights' || candidate.scope === 'research'
    || candidate.scope === 'workspace-research' || candidate.scope === 'none' || candidate.scope === 'workspace'
    ? candidate.scope
    : 'workspace-research';
  return {
    id: candidate.id,
    title: clean(candidate.title, 160) || 'Untitled Research Mission',
    query: clean(candidate.query, 6000),
    scope,
    liveRefresh: candidate.liveRefresh !== false,
    caseId: clean(candidate.caseId, 160) || undefined,
    caseTitle: clean(candidate.caseTitle, 240) || undefined,
    selectedAgents: Array.from(new Set(selectedAgents)),
    status: validStatus.includes(candidate.status as ResearchMissionStatus) ? candidate.status as ResearchMissionStatus : 'draft',
    createdAt: candidate.createdAt,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : candidate.createdAt,
    sources: Array.isArray(candidate.sources) ? candidate.sources.slice(0, 80).map((source) => ({
      id: clean(source?.id, 180),
      title: clean(source?.title, 500),
      kind: source?.kind === 'panel' || source?.kind === 'news' || source?.kind === 'map' || source?.kind === 'system' || source?.kind === 'document' || source?.kind === 'memory' ? source.kind : 'system',
      text: clean(source?.text, 5000),
      url: clean(source?.url, 2000) || undefined,
    })).filter((source) => source.id && source.title) : [],
    results,
    finalReport: clean(candidate.finalReport, 50000),
    error: clean(candidate.error, 2000) || undefined,
  };
}

export function loadResearchMissionStore(): ResearchMissionStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ResearchMissionStore>;
    const missions = Array.isArray(parsed.missions)
      ? parsed.missions.map(normalizeMission).filter((mission): mission is ResearchMission => Boolean(mission)).slice(0, MAX_MISSIONS)
      : [];
    return {
      version: 1,
      activeMissionId: typeof parsed.activeMissionId === 'string' && missions.some((mission) => mission.id === parsed.activeMissionId)
        ? parsed.activeMissionId
        : missions[0]?.id,
      missions,
    };
  } catch {
    return { version: 1, missions: [] };
  }
}

function saveStore(store: ResearchMissionStore): void {
  const normalized: ResearchMissionStore = {
    version: 1,
    activeMissionId: store.activeMissionId,
    missions: [...store.missions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_MISSIONS),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('project-v-multi-agent-research-change'));
  try {
    channel ??= typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.postMessage({ type: 'changed', at: Date.now() });
  } catch { /* best effort */ }
}

export function subscribeResearchMissions(listener: () => void): () => void {
  const onCustom = () => listener();
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener('project-v-multi-agent-research-change', onCustom);
  window.addEventListener('storage', onStorage);
  let localChannel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    localChannel = new BroadcastChannel(CHANNEL_NAME);
    localChannel.addEventListener('message', listener);
  }
  return () => {
    window.removeEventListener('project-v-multi-agent-research-change', onCustom);
    window.removeEventListener('storage', onStorage);
    localChannel?.close();
  };
}

export function listResearchMissions(): ResearchMission[] {
  return loadResearchMissionStore().missions;
}

export function getResearchMission(missionId: string): ResearchMission | null {
  return loadResearchMissionStore().missions.find((mission) => mission.id === missionId) ?? null;
}

export function getActiveResearchMission(): ResearchMission | null {
  const store = loadResearchMissionStore();
  return store.missions.find((mission) => mission.id === store.activeMissionId) ?? store.missions[0] ?? null;
}

export function setActiveResearchMission(missionId: string): void {
  const store = loadResearchMissionStore();
  if (!store.missions.some((mission) => mission.id === missionId)) return;
  store.activeMissionId = missionId;
  saveStore(store);
}

export function createResearchMission(input: Partial<Pick<ResearchMission, 'title' | 'query' | 'scope' | 'liveRefresh' | 'caseId' | 'caseTitle' | 'selectedAgents'>> = {}): ResearchMission {
  const now = Date.now();
  const selectedAgents: ResearchAgentId[] = Array.isArray(input.selectedAgents) && input.selectedAgents.length
    ? input.selectedAgents.filter(isAgentId)
    : ['collector', 'verifier', 'timeline', 'contradiction', 'geospatial', 'briefing'];
  if (!selectedAgents.includes('briefing')) selectedAgents.push('briefing');
  const mission: ResearchMission = {
    id: id(),
    title: clean(input.title, 160) || 'New Research Mission',
    query: clean(input.query, 6000),
    scope: input.scope ?? 'workspace-research',
    liveRefresh: input.liveRefresh !== false,
    caseId: clean(input.caseId, 160) || undefined,
    caseTitle: clean(input.caseTitle, 240) || undefined,
    selectedAgents: Array.from(new Set(selectedAgents)),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    sources: [],
    results: Object.fromEntries(selectedAgents.map((agentId) => [agentId, { agentId, status: 'queued', content: '' }])) as Partial<Record<ResearchAgentId, ResearchAgentResult>>,
    finalReport: '',
  };
  const store = loadResearchMissionStore();
  store.missions.unshift(mission);
  store.activeMissionId = mission.id;
  saveStore(store);
  return mission;
}

export function updateResearchMission(missionId: string, changes: Partial<Omit<ResearchMission, 'id' | 'createdAt'>>): ResearchMission | null {
  const store = loadResearchMissionStore();
  const index = store.missions.findIndex((mission) => mission.id === missionId);
  if (index < 0) return null;
  const current = store.missions[index];
  if (!current) return null;
  const selectedAgents: ResearchAgentId[] = Array.isArray(changes.selectedAgents)
    ? changes.selectedAgents.filter(isAgentId)
    : [...current.selectedAgents];
  if (!selectedAgents.includes('briefing')) selectedAgents.push('briefing');
  const next: ResearchMission = {
    ...current,
    ...changes,
    title: changes.title !== undefined ? clean(changes.title, 160) || current.title : current.title,
    query: changes.query !== undefined ? clean(changes.query, 6000) : current.query,
    caseId: changes.caseId !== undefined ? clean(changes.caseId, 160) || undefined : current.caseId,
    caseTitle: changes.caseTitle !== undefined ? clean(changes.caseTitle, 240) || undefined : current.caseTitle,
    selectedAgents: Array.from(new Set(selectedAgents)),
    updatedAt: Date.now(),
  };
  store.missions[index] = next;
  store.activeMissionId = next.id;
  saveStore(store);
  return next;
}

export function deleteResearchMission(missionId: string): void {
  const store = loadResearchMissionStore();
  store.missions = store.missions.filter((mission) => mission.id !== missionId);
  if (store.activeMissionId === missionId) store.activeMissionId = store.missions[0]?.id;
  saveStore(store);
}

export function researchMissionToMarkdown(mission: ResearchMission): string {
  const sourceList = mission.sources.length
    ? mission.sources.map((source, index) => `### [S${index + 1}] ${source.title}\n\n${source.text || '_No excerpt saved._'}${source.url ? `\n\nURL: ${source.url}` : ''}`).join('\n\n')
    : '- No source snapshot was saved.';
  const agentSections = mission.selectedAgents.map((agentId) => {
    const definition = RESEARCH_AGENT_DEFINITIONS.find((agent) => agent.id === agentId);
    const result = mission.results[agentId];
    return `## ${definition?.label ?? agentId}\n\n${result?.content || result?.error || '_No output._'}`;
  }).join('\n\n');
  return `# ${mission.title}\n\n- Status: ${mission.status}\n- Created: ${new Date(mission.createdAt).toISOString()}\n- Updated: ${new Date(mission.updatedAt).toISOString()}\n- Scope: ${mission.scope}\n- Case: ${mission.caseTitle ?? 'None'}\n\n## Mission Question\n\n${mission.query || '_No mission question._'}\n\n## Source Snapshot\n\n${sourceList}\n\n${agentSections}\n\n## Final Assessment\n\n${mission.finalReport || '_No final report._'}\n`;
}
