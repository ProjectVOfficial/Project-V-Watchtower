import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './styles/workspace-windows.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import { installWorkspaceLockGuard } from '@/services/workspace-lock-guard';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { inspectLocalAi, streamLocalCommand, type CommandMessage } from '@/services/local-ai-command';
import { requestAssistantWindowContext } from '@/services/assistant-window-bridge';
import type { CommandContextScope, CommandContextSource } from '@/services/command-context';
import { listCases, getCase, listCaseItems, listCaseLinks, createCase, createCaseItem, type ProjectVCase } from '@/services/case-desk';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import {
  RESEARCH_AGENT_DEFINITIONS,
  createResearchMission,
  deleteResearchMission,
  getResearchMission,
  listResearchMissions,
  researchMissionToMarkdown,
  setActiveResearchMission,
  subscribeResearchMissions,
  updateResearchMission,
  type ResearchAgentDefinition,
  type ResearchAgentId,
  type ResearchMission,
} from '@/services/multi-agent-research';

applyStoredTheme();
installWorkspaceLockGuard();
void loadDesktopSecrets().catch((error) => console.warn('[analysis-room] Unable to load desktop secrets', error));

const mount = document.getElementById('analysisRoomApp');
if (!mount) throw new Error('Analysis Room mount point is missing.');

const queryParams = new URLSearchParams(window.location.search);
let missionId = queryParams.get('mission') ?? '';
let currentMission: ResearchMission | null = missionId ? getResearchMission(missionId) : null;
let cases: ProjectVCase[] = [];
let running = false;
let requestController: AbortController | null = null;
let liveDraft = '';
let activeAgent: ResearchAgentId | null = null;
let statusText = 'CHECKING LOCAL AI';
let statusClass = 'checking';
let modelLabel = 'LOCAL MODEL';
let sourceSnapshot: CommandContextSource[] = [];
let contextPromptBlock = '';
let caseContextBlock = '';
let selectedMissionFromUi = false;
let sourceStatus = 'Sources appear after a mission begins.';
let sourceStatusError = false;

const MAX_AGENT_CONTEXT = 23000;
const MAX_PRIOR_OUTPUT = 5500;

function markdown(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { breaks: true, gfm: true }) as string, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

function missionTime(mission: ResearchMission): string {
  return new Date(mission.updatedAt).toLocaleString();
}

function agentDefinition(agentId: ResearchAgentId): ResearchAgentDefinition {
  const definition = RESEARCH_AGENT_DEFINITIONS.find((agent) => agent.id === agentId);
  if (!definition) throw new Error(`Unknown agent: ${agentId}`);
  return definition;
}

function activeMissionOrCreate(): ResearchMission {
  if (currentMission) return currentMission;
  currentMission = createResearchMission();
  missionId = currentMission.id;
  return currentMission;
}

async function loadCases(): Promise<void> {
  try {
    cases = (await listCases()).filter((record) => record.status !== 'closed');
  } catch {
    cases = [];
  }
}

function selectedAgentIdsFromUi(): ResearchAgentId[] {
  const selected = Array.from(mount!.querySelectorAll<HTMLInputElement>('[data-agent-toggle]:checked'))
    .map((input) => input.dataset.agentToggle)
    .filter((value): value is ResearchAgentId => RESEARCH_AGENT_DEFINITIONS.some((agent) => agent.id === value));
  if (!selected.includes('briefing')) selected.push('briefing');
  return selected;
}

function render(): void {
  const missions = listResearchMissions();
  if (!currentMission) {
    const firstMission = missions[0];
    if (firstMission) {
      currentMission = firstMission;
      missionId = firstMission.id;
    }
  }
  const mission = currentMission;
  mount!.innerHTML = `
    <div class="pv-window-shell pv-analysis-room-shell">
      <header class="pv-window-header">
        <div class="pv-window-brand"><span class="pv-window-mark">V</span><div><strong>PROJECT V // ANALYSIS ROOM</strong><small>LOCAL MULTI-AGENT RESEARCH · SOURCE-AWARE SPECIALIST WORKFLOW</small></div></div>
        <div class="pv-window-header-actions">
          <span class="pv-analysis-ai-status ${statusClass}">${escapeHtml(statusText)} · ${escapeHtml(modelLabel)}</span>
          <button type="button" data-action="new">NEW MISSION</button>
          <button type="button" data-action="test">TEST LOCAL AI</button>
          <button type="button" data-action="settings">API KEYS</button>
          <button type="button" data-action="export" ${mission ? '' : 'disabled'}>EXPORT</button>
          <button type="button" data-action="close">CLOSE</button>
        </div>
      </header>
      <main class="pv-analysis-room-main">
        <aside class="pv-analysis-mission-rail">
          <div class="pv-analysis-section-title"><strong>MISSION QUEUE</strong><span>${missions.length}</span></div>
          <div class="pv-analysis-mission-list">
            ${missions.map((item) => `
              <button type="button" class="pv-analysis-mission-card ${item.id === mission?.id ? 'active' : ''}" data-mission-id="${escapeHtml(item.id)}">
                <span class="status ${item.status}">${item.status.toUpperCase()}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.caseTitle ?? item.scope.replace(/-/g, ' ').toUpperCase())}</small>
                <time>${escapeHtml(missionTime(item))}</time>
              </button>
            `).join('') || '<div class="pv-analysis-empty-small">NO RESEARCH MISSIONS</div>'}
          </div>
          <div class="pv-analysis-rail-actions">
            <button type="button" data-action="new">NEW MISSION</button>
            <button type="button" data-action="delete" ${mission ? '' : 'disabled'}>DELETE</button>
          </div>
        </aside>
        <section class="pv-analysis-control-column">
          ${mission ? missionEditor(mission) : '<div class="pv-analysis-empty"><span>V</span><strong>ANALYSIS ROOM READY</strong><p>Create a mission to coordinate the local analyst team.</p></div>'}
        </section>
        <aside class="pv-analysis-source-rail">
          <div class="pv-analysis-section-title">
            <strong>SOURCE SNAPSHOT</strong>
            <div class="pv-analysis-source-actions"><span>${sourceSnapshot.length || mission?.sources.length || 0}</span><button type="button" data-action="capture-sources" ${!mission || running ? 'disabled' : ''}>CAPTURE</button></div>
          </div>
          <div class="pv-analysis-source-list">
            ${(sourceSnapshot.length ? sourceSnapshot : mission?.sources ?? []).map((source, index) => `
              <article><span>S${index + 1}</span><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.kind.toUpperCase())}${source.text ? ` · ${escapeHtml(source.text.slice(0, 120))}` : ''}</small></div></article>
            `).join('') || `<div class="pv-analysis-empty-small">${mission?.scope === 'none' ? 'NO CONTEXT SELECTED. CAPTURE will switch this mission to Workspace + Research and collect a source snapshot.' : escapeHtml(sourceStatus)}</div>`}
          </div>
          <div class="pv-analysis-source-status ${sourceStatusError ? 'error' : ''}">${escapeHtml(sourceStatus)}</div>
          <div class="pv-analysis-safety-note">
            <strong>ANALYST CONTROL</strong>
            <p>Agents share the same local model, but receive different instructions. Their agreement is not independent corroboration. Original sources remain the evidence.</p>
          </div>
        </aside>
      </main>
    </div>
  `;
  bindEvents();
  if (selectedMissionFromUi) {
    selectedMissionFromUi = false;
    mount!.querySelector<HTMLElement>('.pv-analysis-agent-output.running, .pv-analysis-agent-output.complete')?.scrollIntoView({ block: 'nearest' });
  }
}

function missionEditor(mission: ResearchMission): string {
  const caseOptions = [`<option value="">NO CASE ATTACHED</option>`, ...cases.map((record) => `<option value="${escapeHtml(record.id)}" ${mission.caseId === record.id ? 'selected' : ''}>${escapeHtml(record.title)}</option>`)].join('');
  return `
    <section class="pv-analysis-mission-config">
      <div class="pv-analysis-config-grid">
        <label>TITLE<input data-field="title" value="${escapeHtml(mission.title)}" maxlength="160"></label>
        <label>CONTEXT<select data-field="scope">
          <option value="workspace-research" ${mission.scope === 'workspace-research' ? 'selected' : ''}>WORKSPACE + RESEARCH</option>
          <option value="workspace" ${mission.scope === 'workspace' ? 'selected' : ''}>CURRENT WORKSPACE</option>
          <option value="visible" ${mission.scope === 'visible' ? 'selected' : ''}>VISIBLE PANELS</option>
          <option value="insights" ${mission.scope === 'insights' ? 'selected' : ''}>AI INSIGHTS + RISK</option>
          <option value="research" ${mission.scope === 'research' ? 'selected' : ''}>RESEARCH LIBRARY</option>
          <option value="none" ${mission.scope === 'none' ? 'selected' : ''}>NO WATCHTOWER CONTEXT</option>
        </select></label>
        <label>CASE DESK<select data-field="caseId">${caseOptions}</select></label>
        <label class="pv-analysis-check"><input type="checkbox" data-field="liveRefresh" ${mission.liveRefresh ? 'checked' : ''}> REFRESH LIVE SOURCES BEFORE RUN</label>
      </div>
      <label class="pv-analysis-question">MISSION QUESTION<textarea data-field="query" rows="4" maxlength="6000" placeholder="What should the analyst team investigate?">${escapeHtml(mission.query)}</textarea></label>
      <div class="pv-analysis-agent-selector">
        ${RESEARCH_AGENT_DEFINITIONS.map((agent) => `
          <label title="${escapeHtml(agent.description)}" class="${agent.id === 'briefing' ? 'required' : ''}">
            <input type="checkbox" data-agent-toggle="${agent.id}" ${mission.selectedAgents.includes(agent.id) ? 'checked' : ''} ${agent.id === 'briefing' ? 'disabled' : ''}>
            <span>${escapeHtml(agent.shortLabel)}</span><small>${escapeHtml(agent.description)}</small>
          </label>
        `).join('')}
      </div>
      <div class="pv-analysis-run-actions">
        <button type="button" data-action="save">SAVE MISSION</button>
        <button type="button" class="primary" data-action="run" ${running ? 'disabled' : ''}>${mission.status === 'complete' ? 'RUN AGAIN' : 'RUN ANALYST TEAM'}</button>
        <button type="button" class="danger" data-action="stop" ${running ? '' : 'disabled'}>STOP</button>
        <button type="button" data-action="export-report" ${mission.finalReport ? '' : 'disabled'}>EXPORT REPORT</button>
        <button type="button" data-action="send-case" ${!mission.finalReport ? 'disabled' : ''}>${mission.caseId ? 'SEND REPORT TO CASE' : 'CREATE CASE + SEND REPORT'}</button>
        <span class="pv-analysis-run-state ${mission.status}">${mission.status.toUpperCase()}${activeAgent ? ` · ${agentDefinition(activeAgent).label}` : ''}</span>
      </div>
      ${mission.error ? `<div class="pv-analysis-error">${escapeHtml(mission.error)}</div>` : ''}
    </section>
    <section class="pv-analysis-agent-grid">
      ${mission.selectedAgents.map((agentId) => agentCard(mission, agentId)).join('')}
    </section>
  `;
}

function sourceCitationWarning(content: string, sourceCount: number): string {
  if (!content) return '';
  const refs = Array.from(content.matchAll(/\[\s*S#?(\d+)\s*\]/gi))
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (refs.length === 0) return '';
  if (sourceCount === 0 || refs.some((ref) => ref < 1 || ref > sourceCount)) {
    return '<div class="pv-analysis-citation-warning">UNSUPPORTED SOURCE LABELS DETECTED — the model cited labels that are not present in the saved source snapshot. Treat those citations as unverified.</div>';
  }
  return '';
}

function agentCard(mission: ResearchMission, agentId: ResearchAgentId): string {
  const definition = agentDefinition(agentId);
  const result = mission.results[agentId];
  const status = activeAgent === agentId && running ? 'running' : result?.status ?? 'queued';
  const content = activeAgent === agentId && running ? liveDraft : result?.content ?? '';
  const error = result?.error;
  const citationWarning = sourceCitationWarning(content, mission.sources.length);
  return `
    <article class="pv-analysis-agent-card agent-${agentId} ${agentId === 'briefing' ? 'briefing' : ''}" data-agent-id="${agentId}">
      <header><div><span>${escapeHtml(definition.shortLabel)}</span><strong>${escapeHtml(definition.label)}</strong></div><em class="${status}">${status.toUpperCase()}</em></header>
      <p>${escapeHtml(definition.description)}</p>
      ${citationWarning}
      <div class="pv-analysis-agent-output ${status}">${content ? markdown(content) : error ? `<div class="pv-analysis-error">${escapeHtml(error)}</div>` : '<span class="placeholder">WAITING FOR MISSION</span>'}</div>
    </article>
  `;
}

function bindEvents(): void {
  mount!.querySelectorAll<HTMLButtonElement>('[data-mission-id]').forEach((button) => button.addEventListener('click', () => {
    const next = getResearchMission(button.dataset.missionId ?? '');
    if (!next || running) return;
    currentMission = next;
    missionId = next.id;
    sourceSnapshot = [];
    setActiveResearchMission(next.id);
    selectedMissionFromUi = true;
    render();
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-action="new"]').forEach((button) => button.addEventListener('click', () => {
    if (running) return;
    currentMission = createResearchMission({ title: 'New Intelligence Research Mission' });
    missionId = currentMission.id;
    sourceSnapshot = [];
    render();
  }));
  mount!.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => {
    if (!currentMission || running || !window.confirm(`Delete research mission “${currentMission.title}”?`)) return;
    deleteResearchMission(currentMission.id);
    currentMission = listResearchMissions()[0] ?? null;
    missionId = currentMission?.id ?? '';
    sourceSnapshot = [];
    render();
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener('click', saveMissionFromUi);
  mount!.querySelector<HTMLButtonElement>('[data-action="run"]')?.addEventListener('click', () => void runMission());
  mount!.querySelector<HTMLButtonElement>('[data-action="stop"]')?.addEventListener('click', () => requestController?.abort());
  mount!.querySelector<HTMLButtonElement>('[data-action="test"]')?.addEventListener('click', () => void refreshStatus(true));
  mount!.querySelector<HTMLButtonElement>('[data-action="settings"]')?.addEventListener('click', () => void openRuntimeSettings());
  mount!.querySelectorAll<HTMLButtonElement>('[data-action="export"], [data-action="export-report"]').forEach((button) => button.addEventListener('click', exportMission));
  mount!.querySelector<HTMLButtonElement>('[data-action="send-case"]')?.addEventListener('click', () => void sendReportToCase());
  mount!.querySelector<HTMLButtonElement>('[data-action="capture-sources"]')?.addEventListener('click', () => void captureSourcesFromUi());
  mount!.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', () => void closeWindow());
}

function saveMissionFromUi(): ResearchMission | null {
  const mission = activeMissionOrCreate();
  const title = mount!.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim() || mission.title;
  const query = mount!.querySelector<HTMLTextAreaElement>('[data-field="query"]')?.value.trim() ?? mission.query;
  const scope = (mount!.querySelector<HTMLSelectElement>('[data-field="scope"]')?.value ?? mission.scope) as CommandContextScope;
  const caseId = mount!.querySelector<HTMLSelectElement>('[data-field="caseId"]')?.value || undefined;
  const caseTitle = cases.find((record) => record.id === caseId)?.title;
  const liveRefresh = mount!.querySelector<HTMLInputElement>('[data-field="liveRefresh"]')?.checked ?? mission.liveRefresh;
  const selectedAgents = selectedAgentIdsFromUi();
  currentMission = updateResearchMission(mission.id, { title, query, scope, caseId, caseTitle, liveRefresh, selectedAgents }) ?? mission;
  return currentMission;
}

async function buildCaseContext(caseId: string | undefined, startIndex: number): Promise<{ block: string; sources: CommandContextSource[] }> {
  if (!caseId) return { block: '', sources: [] };
  const record = await getCase(caseId);
  if (!record) return { block: '', sources: [] };
  const [items, links] = await Promise.all([listCaseItems(caseId), listCaseLinks(caseId)]);
  const sources: CommandContextSource[] = items.slice(0, 40).map((item) => ({
    id: `case-${item.id}`,
    title: `${record.title} — ${item.title}`,
    kind: 'memory',
    text: `${item.type.toUpperCase()} · confidence ${item.confidence}. ${item.detail}${item.source ? ` Source: ${item.source}.` : ''}${item.occurredAt ? ` Occurred: ${new Date(item.occurredAt).toISOString()}.` : ''}`,
    url: item.sourceUrl,
  }));
  if (sources.length === 0) {
    sources.push({ id: `case-${record.id}`, title: record.title, kind: 'memory', text: record.description || 'Case has no evidence items yet.' });
  }
  const header = `ATTACHED CASE: ${record.title}\nStatus: ${record.status}; priority: ${record.priority}; tags: ${record.tags.join(', ') || 'none'}.\nRelationships recorded: ${links.length}.`;
  const body = sources.map((source, index) => `[S${startIndex + index + 1}] ${source.title} (${source.kind})\n${source.text}${source.url ? `\nURL: ${source.url}` : ''}`).join('\n\n');
  return { block: `${header}\n\n${body}`, sources };
}

async function captureMissionSources(mission: ResearchMission, useDefaultWhenNone: boolean): Promise<ResearchMission> {
  let workingMission = mission;
  let scope = mission.scope;
  if (scope === 'none' && useDefaultWhenNone) {
    scope = 'workspace-research';
    workingMission = updateResearchMission(mission.id, { scope }) ?? mission;
    currentMission = workingMission;
    sourceStatus = 'NO CONTEXT was selected, so Watchtower used WORKSPACE + RESEARCH for this source capture.';
  } else {
    sourceStatus = mission.liveRefresh ? 'Refreshing connected Watchtower sources and capturing context…' : 'Capturing the current Watchtower context…';
  }
  sourceStatusError = false;
  render();

  contextPromptBlock = '';
  caseContextBlock = '';
  sourceSnapshot = [];
  if (scope !== 'none') {
    const response = await requestAssistantWindowContext(scope, workingMission.query, workingMission.liveRefresh, 60_000);
    contextPromptBlock = response.context?.promptBlock ?? '';
    sourceSnapshot = response.context?.sources ?? [];
  }
  const caseContext = await buildCaseContext(workingMission.caseId, sourceSnapshot.length);
  caseContextBlock = caseContext.block;
  sourceSnapshot = [...sourceSnapshot, ...caseContext.sources];
  workingMission = updateResearchMission(workingMission.id, { sources: sourceSnapshot.map((source) => ({ ...source })) }) ?? workingMission;
  currentMission = workingMission;
  sourceStatus = sourceSnapshot.length
    ? `${sourceSnapshot.length} source item(s) saved with this mission.`
    : scope === 'none'
      ? 'No source context was requested. Agent output cannot verify the claim from evidence.'
      : 'The selected context returned no usable source items.';
  sourceStatusError = sourceSnapshot.length === 0;
  return workingMission;
}

async function captureSourcesFromUi(): Promise<void> {
  if (running) return;
  const mission = saveMissionFromUi();
  if (!mission) return;
  try {
    await captureMissionSources(mission, true);
  } catch (error) {
    sourceStatus = error instanceof Error ? error.message : 'Unable to capture Watchtower sources.';
    sourceStatusError = true;
  }
  render();
}

function priorAgentBlock(mission: ResearchMission, currentAgentId: ResearchAgentId): string {
  return mission.selectedAgents
    .filter((agentId) => agentId !== currentAgentId)
    .map((agentId) => {
      const result = mission.results[agentId];
      if (!result?.content || result.status !== 'complete') return '';
      return `### ${agentDefinition(agentId).label}\n${result.content.slice(0, MAX_PRIOR_OUTPUT)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildAgentMessages(mission: ResearchMission, agent: ResearchAgentDefinition): CommandMessage[] {
  const prior = priorAgentBlock(mission, agent.id);
  const context = [contextPromptBlock, caseContextBlock].filter(Boolean).join('\n\n').slice(0, MAX_AGENT_CONTEXT);
  const sourceGuard = mission.sources.length
    ? `SOURCE AVAILABILITY: ${mission.sources.length} original source item(s) are available. Cite only labels S1 through S${mission.sources.length}.`
    : 'SOURCE AVAILABILITY: No original sources were supplied. Do not invent publications, URLs, dates, quotations, or [S#] labels. State clearly that verification is unresolved from the supplied evidence.';
  const assignment = `MISSION: ${mission.title}\nQUESTION: ${mission.query}\n\n${sourceGuard}\n\nORIGINAL SOURCE CONTEXT:\n${context || 'No Watchtower source context was requested.'}${prior ? `\n\nPRIOR SPECIALIST OUTPUTS (analysis only; not original evidence):\n${prior}` : ''}\n\nProduce the ${agent.label} output now.`;
  return [{ role: 'system', content: agent.systemPrompt }, { role: 'user', content: assignment }];
}

async function runMission(): Promise<void> {
  if (running) return;
  const mission = saveMissionFromUi();
  if (!mission) return;
  if (!mission.query.trim()) {
    window.alert('Enter a mission question before running the analyst team.');
    return;
  }
  running = true;
  requestController = new AbortController();
  activeAgent = null;
  liveDraft = '';
  sourceSnapshot = [];
  contextPromptBlock = '';
  caseContextBlock = '';
  currentMission = updateResearchMission(mission.id, {
    status: 'running', error: undefined, finalReport: '', sources: [],
    results: Object.fromEntries(mission.selectedAgents.map((agentId) => [agentId, { agentId, status: 'queued', content: '' }])),
  });
  render();

  try {
    // A checked live-refresh box with NO WATCHTOWER CONTEXT previously produced
    // an empty snapshot while still encouraging the model to invent citations.
    // Treat that combination as an explicit request for Workspace + Research.
    currentMission = await captureMissionSources(currentMission ?? mission, mission.scope === 'none' && mission.liveRefresh);
    render();

    for (const agentId of mission.selectedAgents) {
      if (requestController.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const agent = agentDefinition(agentId);
      activeAgent = agentId;
      liveDraft = '';
      const startedAt = Date.now();
      currentMission = updateResearchMission(mission.id, {
        results: { ...(currentMission?.results ?? {}), [agentId]: { agentId, status: 'running', content: '', startedAt } },
      });
      render();
      try {
        const config = await streamLocalCommand({
          messages: buildAgentMessages(currentMission ?? mission, agent),
          signal: requestController.signal,
          temperature: agentId === 'briefing' ? 0.15 : 0.2,
          onToken: (token) => {
            liveDraft += token;
            const output = mount!.querySelector<HTMLElement>(`.pv-analysis-agent-card[data-agent-id="${agentId}"] .pv-analysis-agent-output.running`);
            if (output) output.innerHTML = markdown(liveDraft);
          },
        });
        modelLabel = config.model;
        statusText = 'LOCAL AI READY';
        statusClass = 'ready';
        const content = liveDraft.trim() || 'The local model returned an empty response.';
        const results = { ...(currentMission?.results ?? {}), [agentId]: { agentId, status: 'complete' as const, content, startedAt, completedAt: Date.now() } };
        currentMission = updateResearchMission(mission.id, {
          results,
          finalReport: agentId === 'briefing' ? content : currentMission?.finalReport ?? '',
        });
      } catch (error) {
        if (requestController.signal.aborted) throw error;
        const message = error instanceof Error ? error.message : 'Agent request failed.';
        const results = { ...(currentMission?.results ?? {}), [agentId]: { agentId, status: 'failed' as const, content: liveDraft.trim(), error: message, startedAt, completedAt: Date.now() } };
        currentMission = updateResearchMission(mission.id, { results });
      }
      activeAgent = null;
      liveDraft = '';
      render();
    }
    const finalReady = currentMission?.results.briefing?.status === 'complete' && Boolean(currentMission.finalReport.trim());
    currentMission = updateResearchMission(mission.id, {
      status: finalReady ? 'complete' : 'failed',
      error: finalReady ? undefined : 'The specialist workflow finished, but the Briefing Officer did not produce a final assessment.',
    });
  } catch (error) {
    const stopped = requestController.signal.aborted;
    currentMission = updateResearchMission(mission.id, {
      status: stopped ? 'stopped' : 'failed',
      error: stopped ? 'Mission stopped by analyst.' : error instanceof Error ? error.message : 'Research mission failed.',
    });
  } finally {
    running = false;
    requestController = null;
    activeAgent = null;
    liveDraft = '';
    render();
  }
}

function exportMission(): void {
  if (!currentMission) return;
  const markdownText = researchMissionToMarkdown(currentMission);
  const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${currentMission.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'analysis-room'}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function sendReportToCase(): Promise<void> {
  let mission = saveMissionFromUi() ?? currentMission;
  if (!mission?.finalReport) return;

  let targetCaseId = mission.caseId;
  let targetCaseTitle = mission.caseTitle;
  if (!targetCaseId) {
    const title = window.prompt('No Case Desk investigation is attached. Enter a title to create one:', mission.title)?.trim();
    if (!title) return;
    const created = await createCase({
      title,
      description: `Created from Analysis Room mission: ${mission.title}`,
      priority: 'normal',
      status: 'open',
      tags: ['analysis-room'],
    });
    cases = [created, ...cases.filter((record) => record.id !== created.id)];
    targetCaseId = created.id;
    targetCaseTitle = created.title;
    mission = updateResearchMission(mission.id, { caseId: created.id, caseTitle: created.title }) ?? mission;
    currentMission = mission;
  }

  if (!targetCaseId) return;
  await createCaseItem(targetCaseId, {
    type: 'note',
    title: `Multi-Agent Report: ${mission.title}`,
    detail: mission.finalReport,
    confidence: 'analyst',
    source: 'Project V Analysis Room',
    metadata: { missionId: mission.id, agents: mission.selectedAgents.join(',') },
  });
  window.alert(`The final multi-agent report was added to “${targetCaseTitle ?? 'Case Desk'}” as an analyst note.`);
  render();
}

async function refreshStatus(showAlert = false): Promise<void> {
  statusText = 'CHECKING';
  statusClass = 'checking';
  render();
  try {
    const result = await inspectLocalAi();
    modelLabel = result.model || 'MODEL NOT SET';
    statusText = !result.configured ? 'NOT CONFIGURED' : result.connected ? 'LOCAL AI READY' : 'OFFLINE';
    statusClass = result.connected ? 'ready' : 'offline';
    render();
    if (showAlert) window.alert(result.message);
  } catch (error) {
    statusText = 'OFFLINE';
    statusClass = 'offline';
    render();
    if (showAlert) window.alert(error instanceof Error ? error.message : 'Unable to inspect local AI.');
  }
}

async function closeWindow(): Promise<void> {
  requestController?.abort();
  if (isDesktopRuntime()) {
    await tryInvokeTauri<void>('close_analysis_room_window');
    return;
  }
  window.close();
}

const cleanup = subscribeResearchMissions(() => {
  if (running || !currentMission) return;
  currentMission = getResearchMission(currentMission.id) ?? listResearchMissions()[0] ?? null;
  render();
});
window.addEventListener('beforeunload', () => { cleanup(); requestController?.abort(); });

async function initializeAnalysisRoom(): Promise<void> {
  await loadCases();
  if (!currentMission && queryParams.get('new') === '1') currentMission = createResearchMission();
  render();
}

void initializeAnalysisRoom().catch((error: unknown) => {
  console.error('[analysis-room] Initialization failed:', error);
  render();
});
void refreshStatus();
