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
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { ProjectVSpeechRecognizer, cancelProjectVSpeech, loadVoicePreferences, saveVoicePreferences, speakProjectVText, type VoiceRecognitionUpdate } from '@/services/voice-control';
import { consumeAssistantHandoff, subscribeAssistantHandoff, type AssistantHandoff } from '@/services/assistant-handoff';

applyStoredTheme();
installWorkspaceLockGuard();
void loadDesktopSecrets().catch(() => {});

interface StoredAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: Array<Pick<CommandContextSource, 'id' | 'title' | 'kind' | 'url'>>;
}

const HISTORY_KEY = 'project-v-command-assistant-history-v1';
const SCOPE_KEY = 'project-v-command-assistant-scope-v1';
const LIVE_REFRESH_KEY = 'project-v-command-assistant-live-refresh-v1';
const LEGACY_SPEAK_KEY = 'project-v-command-assistant-speak-v1';
const MAX_HISTORY = 30;

const SYSTEM_PROMPT = `You are the local Project V Watchtower Command Assistant.
Your job is to help an analyst understand the current situational-intelligence workspace.

Rules:
- Treat supplied panel, news, alert, map, and research context as unverified operational inputs, not guaranteed truth.
- Distinguish confirmed facts, panel-generated analysis, analyst notes, and inference.
- Cite supplied context using [S1], [S2], and so on when making claims based on it.
- Never invent a source, URL, event, casualty number, coordinate, or intelligence conclusion.
- Point out contradictions, stale data, missing corroboration, and uncertainty.
- Prefer compact analyst-style answers with a brief assessment, evidence, and what to verify next.
- Do not claim unrestricted internet access. When live refresh is enabled, use only the refreshed Watchtower feeds included in the supplied context.
- AI Insights is a generated summary layer. Use it as a lead, then compare it with underlying panels and news sources when available.
- Local research documents and analyst memories are user-supplied material. Cite them, but do not assume they are authentic or current without corroboration.`;

const mount = document.getElementById('assistantDeskApp');
if (!mount) throw new Error('Command Assistant mount point is missing.');

let history = loadHistory();
let scope = loadScope();
let liveRefresh = localStorage.getItem(LIVE_REFRESH_KEY) === 'true';
let speakReplies = loadVoicePreferences().speakAssistantReplies || localStorage.getItem(LEGACY_SPEAK_KEY) === 'true';
let requestController: AbortController | null = null;
let running = false;
let draftResponse = '';
let currentSources: CommandContextSource[] = [];
let modelLabel = 'LOCAL MODEL';
let statusText = 'CHECKING';
let statusClass = 'checking';
let voiceStatus = 'PUSH TO TALK';
let voiceTranscript = '';
const voiceRecognizer = new ProjectVSpeechRecognizer((update) => handleVoiceUpdate(update));
if (speakReplies !== loadVoicePreferences().speakAssistantReplies) saveVoicePreferences({ speakAssistantReplies: speakReplies });

function loadHistory(): StoredAssistantMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredAssistantMessage => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<StoredAssistantMessage>;
      return typeof candidate.id === 'string'
        && (candidate.role === 'user' || candidate.role === 'assistant')
        && typeof candidate.content === 'string'
        && typeof candidate.createdAt === 'number';
    }).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  window.dispatchEvent(new CustomEvent('project-v-assistant-history-change'));
}

function loadScope(): CommandContextScope {
  const value = localStorage.getItem(SCOPE_KEY);
  return value === 'workspace' || value === 'visible' || value === 'insights' || value === 'research' || value === 'workspace-research' || value === 'none'
    ? value
    : 'workspace';
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function markdown(value: string): string {
  const rendered = marked.parse(value, { breaks: true, gfm: true }) as string;
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

function render(): void {
  mount!.innerHTML = `
    <div class="pv-window-shell pv-assistant-desk-shell">
      <header class="pv-window-header">
        <div class="pv-window-brand"><span class="pv-window-mark">V</span><div><strong>PROJECT V // COMMAND ASSISTANT</strong><small>LOCAL OLLAMA · LIVE WATCHTOWER CONTEXT · SOURCE-AWARE ANALYSIS</small></div></div>
        <div class="pv-window-header-actions">
          <span class="pv-assistant-window-status ${statusClass}" data-ai-status>${escapeHtml(statusText)} · ${escapeHtml(modelLabel)}</span>
          <button data-ai-action="voice" class="pv-assistant-voice-button">◉ <span data-ai-voice-status>${escapeHtml(voiceStatus)}</span></button>
          <button data-ai-action="test">TEST LOCAL AI</button>
          <button data-ai-action="analysis-room">ANALYSIS ROOM</button>
          <button data-ai-action="settings">API KEYS</button>
          <button data-ai-action="close">CLOSE</button>
        </div>
      </header>
      <section class="pv-assistant-desk-toolbar">
        <label>CONTEXT<select data-ai-scope>
          <option value="workspace" ${scope === 'workspace' ? 'selected' : ''}>CURRENT WORKSPACE</option>
          <option value="visible" ${scope === 'visible' ? 'selected' : ''}>VISIBLE PANELS</option>
          <option value="insights" ${scope === 'insights' ? 'selected' : ''}>AI INSIGHTS + RISK</option>
          <option value="research" ${scope === 'research' ? 'selected' : ''}>RESEARCH LIBRARY ONLY</option>
          <option value="workspace-research" ${scope === 'workspace-research' ? 'selected' : ''}>WORKSPACE + RESEARCH</option>
          <option value="none" ${scope === 'none' ? 'selected' : ''}>NO PANEL CONTEXT</option>
        </select></label>
        <label class="pv-assistant-toggle"><input type="checkbox" data-ai-live ${liveRefresh ? 'checked' : ''}> REFRESH LIVE SOURCES BEFORE ASKING</label>
        <label class="pv-assistant-toggle"><input type="checkbox" data-ai-speak ${speakReplies ? 'checked' : ''}> READ REPLIES ALOUD</label>
        <button data-ai-action="clear" class="danger">CLEAR CONVERSATION</button>
      </section>
      <section class="pv-assistant-voice-strip ${voiceRecognizer.getState() === 'listening' ? 'listening' : ''}" data-ai-voice-strip>
        <strong>VOICE TRANSCRIPT</strong><span data-ai-voice-transcript>${voiceTranscript ? escapeHtml(voiceTranscript) : 'Push to talk, then speak one question or command.'}</span><small>NO WAKE WORD · MICROPHONE AUDIO IS NOT STORED BY PROJECT V</small>
      </section>
      <main class="pv-assistant-desk-main">
        <aside class="pv-assistant-prompt-rail">
          <strong>QUICK COMMANDS</strong>
          <button data-ai-prompt="Create a concise situational briefing from the current desk. Separate confirmed signals, generated assessment, contradictions, and items requiring verification.">BRIEF DESK</button>
          <button data-ai-prompt="Compare AI Insights against the other supplied sources. Identify corroboration, contradictions, stale claims, and unsupported conclusions.">CHECK AI INSIGHTS</button>
          <button data-ai-prompt="Review open alerts, watchlists, source health, map geofences, and the incident timeline. Identify what requires immediate analyst attention.">OPERATIONS BRIEF</button>
          <button data-ai-prompt="List the five most important developments visible in the refreshed Watchtower context and explain why each matters.">TOP FIVE</button>
          <button data-ai-scope-prompt="research" data-ai-prompt="Search the local research library for material relevant to the question. Summarize the strongest evidence and cite every document-based claim.">RESEARCH BRIEF</button>
          <button data-ai-scope-prompt="workspace-research" data-ai-prompt="Cross-check current Watchtower signals against the local research library. Identify corroboration, conflicts, and unanswered questions.">CROSS-CHECK ARCHIVE</button>
          <div class="pv-assistant-context-list" data-ai-context-list></div>
        </aside>
        <section class="pv-assistant-conversation">
          <div class="pv-assistant-window-messages" data-ai-messages tabindex="0"></div>
          <button type="button" class="pv-assistant-latest-button" data-ai-action="latest" title="Scroll to the newest message">LATEST ↓</button>
          <form class="pv-assistant-window-composer" data-ai-form>
            <textarea rows="3" maxlength="5000" data-ai-input placeholder="Ask Watchtower about the current situation…"></textarea>
            <div><span>ENTER TO SEND · SHIFT+ENTER FOR NEW LINE · LIVE REFRESH USES CONFIGURED WATCHTOWER SOURCES ONLY</span><button type="button" data-ai-action="stop" ${running ? '' : 'hidden'}>STOP</button><button type="submit" ${running ? 'disabled' : ''}>SEND</button></div>
          </form>
        </section>
      </main>
    </div>
  `;
  bindEvents();
  renderMessages();
  renderContext();
}

function bindEvents(): void {
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="test"]')?.addEventListener('click', () => void refreshStatus(true));
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="analysis-room"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('analysis-room'));
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="settings"]')?.addEventListener('click', () => void openRuntimeSettings());
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="close"]')?.addEventListener('click', () => void closeWindow());
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="voice"]')?.addEventListener('click', () => {
    const state = voiceRecognizer.getState();
    if (state === 'listening' || state === 'starting') voiceRecognizer.stop();
    else {
      cancelProjectVSpeech();
      voiceTranscript = '';
      voiceStatus = 'STARTING';
      renderVoiceStrip();
      voiceRecognizer.start(loadVoicePreferences().language);
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="clear"]')?.addEventListener('click', () => {
    if (!window.confirm('Clear the local Command Assistant conversation?')) return;
    history = [];
    saveHistory();
    renderMessages();
  });
  mount!.querySelector<HTMLSelectElement>('[data-ai-scope]')?.addEventListener('change', (event) => {
    scope = (event.currentTarget as HTMLSelectElement).value as CommandContextScope;
    localStorage.setItem(SCOPE_KEY, scope);
    currentSources = [];
    renderContext();
  });
  mount!.querySelector<HTMLInputElement>('[data-ai-live]')?.addEventListener('change', (event) => {
    liveRefresh = (event.currentTarget as HTMLInputElement).checked;
    localStorage.setItem(LIVE_REFRESH_KEY, String(liveRefresh));
    appendNotice(liveRefresh ? 'Live refresh enabled.' : 'Live refresh disabled.');
  });
  mount!.querySelector<HTMLInputElement>('[data-ai-speak]')?.addEventListener('change', (event) => {
    speakReplies = (event.currentTarget as HTMLInputElement).checked;
    saveVoicePreferences({ speakAssistantReplies: speakReplies });
    if (!speakReplies) cancelProjectVSpeech();
    appendNotice(speakReplies ? 'Spoken replies enabled using the selected Project V system voice.' : 'Spoken replies disabled.');
  });
  mount!.querySelectorAll<HTMLButtonElement>('[data-ai-prompt]').forEach((button) => button.addEventListener('click', () => {
    const requestedScope = button.dataset.aiScopePrompt as CommandContextScope | undefined;
    if (requestedScope) {
      scope = requestedScope;
      localStorage.setItem(SCOPE_KEY, scope);
      const select = mount!.querySelector<HTMLSelectElement>('[data-ai-scope]');
      if (select) select.value = scope;
    }
    void submit(button.dataset.aiPrompt ?? '');
  }));
  const form = mount!.querySelector<HTMLFormElement>('[data-ai-form]');
  const input = mount!.querySelector<HTMLTextAreaElement>('[data-ai-input]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = input?.value.trim() ?? '';
    if (!prompt) return;
    if (input) input.value = '';
    void submit(prompt);
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="stop"]')?.addEventListener('click', () => requestController?.abort());
  mount!.querySelector<HTMLButtonElement>('[data-ai-action="latest"]')?.addEventListener('click', () => scrollMessagesToLatest(true));
  const messages = mount!.querySelector<HTMLElement>('[data-ai-messages]');
  messages?.addEventListener('scroll', updateLatestButton, { passive: true });
  messages?.addEventListener('wheel', (event) => {
    if (event.deltaY === 0) return;
    messages.scrollTop += event.deltaY;
  }, { passive: true });
}

function scrollMessagesToLatest(smooth = false): void {
  const container = mount!.querySelector<HTMLElement>('[data-ai-messages]');
  if (!container) return;
  container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  updateLatestButton();
}

function updateLatestButton(): void {
  const container = mount!.querySelector<HTMLElement>('[data-ai-messages]');
  const button = mount!.querySelector<HTMLButtonElement>('[data-ai-action="latest"]');
  if (!container || !button) return;
  const awayFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight > 80;
  button.classList.toggle('visible', awayFromBottom);
}


function renderMessages(): void {
  const container = mount!.querySelector<HTMLElement>('[data-ai-messages]');
  if (!container) return;
  if (history.length === 0 && !running) {
    container.innerHTML = `<div class="pv-assistant-window-empty"><span>V</span><strong>COMMAND CHANNEL READY</strong><p>Ask the local model to analyze current Watchtower panels, refreshed feeds, AI Insights, operations data, and your research library.</p><small>Generated analysis may be wrong. Verify high-impact claims against cited sources.</small></div>`;
    return;
  }
  const messages = history.map((message) => `
    <article class="pv-assistant-window-message ${message.role}">
      <header><strong>${message.role === 'user' ? 'ANALYST' : 'V // LOCAL AI'}</strong><time>${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
      <div>${message.role === 'assistant' ? markdown(message.content) : `<p>${DOMPurify.sanitize(message.content)}</p>`}</div>
      ${message.role === 'assistant' && message.sources?.length ? `<footer>${message.sources.slice(0, 12).map((source, index) => `<span title="${escapeHtml(source.title)}">S${index + 1} · ${escapeHtml(source.title)}</span>`).join('')}</footer>` : ''}
    </article>`).join('');
  const streaming = running ? `<article class="pv-assistant-window-message assistant streaming"><header><strong>V // LOCAL AI</strong><em>ANALYZING</em></header><div>${draftResponse ? markdown(draftResponse) : '<p>Refreshing and collecting Watchtower context…</p>'}</div></article>` : '';
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  container.innerHTML = DOMPurify.sanitize(messages + streaming);
  if (running || wasNearBottom) requestAnimationFrame(() => scrollMessagesToLatest(false));
  else requestAnimationFrame(updateLatestButton);
}

function renderContext(): void {
  const list = mount!.querySelector<HTMLElement>('[data-ai-context-list]');
  if (!list) return;
  if (currentSources.length === 0) {
    list.innerHTML = '<strong>CONTEXT SOURCES</strong><p>Sources used for the next answer will appear here.</p>';
    return;
  }
  list.innerHTML = DOMPurify.sanitize(`<strong>${currentSources.length} CONTEXT SOURCES</strong>${currentSources.slice(0, 20).map((source, index) => `<span title="${escapeHtml(source.title)}">S${index + 1} · ${escapeHtml(source.title)}</span>`).join('')}`);
}

function appendNotice(message: string): void {
  const container = mount!.querySelector<HTMLElement>('[data-ai-messages]');
  if (!container) return;
  const notice = document.createElement('div');
  notice.className = 'pv-assistant-window-notice';
  notice.textContent = message;
  container.appendChild(notice);
  container.scrollTop = container.scrollHeight;
}

function buildMessages(prompt: string, contextBlock: string): CommandMessage[] {
  const recent = history.slice(-10).map<CommandMessage>((message) => ({ role: message.role, content: message.content }));
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recent,
    { role: 'user', content: contextBlock ? `${prompt}\n\nCURRENT WATCHTOWER CONTEXT:\n${contextBlock}` : prompt },
  ];
}

async function submit(prompt: string): Promise<void> {
  if (!prompt.trim() || running) return;
  running = true;
  draftResponse = '';
  requestController = new AbortController();
  history.push({ id: id(), role: 'user', content: prompt.trim(), createdAt: Date.now() });
  history = history.slice(-MAX_HISTORY);
  saveHistory();
  render();

  let contextBlock = '';
  let contextSources: CommandContextSource[] = [];
  try {
    if (scope !== 'none') {
      appendNotice(liveRefresh ? 'Requesting a live Watchtower refresh and context snapshot…' : 'Requesting the current Watchtower context…');
      const response = await requestAssistantWindowContext(scope, prompt.trim(), liveRefresh);
      contextBlock = response.context?.promptBlock ?? '';
      contextSources = response.context?.sources ?? [];
      currentSources = contextSources;
      renderContext();
      if (response.refreshedAt) appendNotice(`Live sources refreshed at ${new Date(response.refreshedAt).toLocaleTimeString()}.`);
    }

    const config = await streamLocalCommand({
      messages: buildMessages(prompt.trim(), contextBlock),
      signal: requestController.signal,
      onToken: (token) => {
        draftResponse += token;
        renderMessages();
      },
    });
    const response = draftResponse.trim() || 'The local model returned an empty response.';
    modelLabel = config.model;
    statusText = 'LOCAL AI READY';
    statusClass = 'ready';
    history.push({
      id: id(),
      role: 'assistant',
      content: response,
      createdAt: Date.now(),
      sources: contextSources.map(({ id: sourceId, title, kind, url }) => ({ id: sourceId, title, kind, url })),
    });
    history = history.slice(-MAX_HISTORY);
    saveHistory();
    if (speakReplies) speakProjectVText(response);
  } catch (error) {
    if (requestController.signal.aborted) {
      if (draftResponse.trim()) history.push({ id: id(), role: 'assistant', content: `${draftResponse.trim()}\n\n_Response stopped by analyst._`, createdAt: Date.now() });
    } else {
      const message = error instanceof Error ? error.message : 'Local AI request failed.';
      statusText = 'OFFLINE';
      statusClass = 'offline';
      history.push({ id: id(), role: 'assistant', content: `**Assistant request failed.**\n\n${message}\n\nKeep the primary Watchtower window open for workspace context, and verify Ollama under **API Keys**.`, createdAt: Date.now() });
    }
    saveHistory();
  } finally {
    running = false;
    requestController = null;
    draftResponse = '';
    render();
  }
}

function handleVoiceUpdate(update: VoiceRecognitionUpdate): void {
  voiceTranscript = update.transcript || update.interimTranscript;
  if (update.state === 'listening') voiceStatus = 'LISTENING';
  else if (update.state === 'starting') voiceStatus = 'STARTING';
  else if (update.state === 'processing') voiceStatus = 'PROCESSING';
  else if (update.state === 'unsupported') {
    voiceStatus = 'UNAVAILABLE';
    appendNotice(update.error ?? 'Speech recognition is unavailable in this runtime.');
  } else if (update.state === 'error') {
    voiceStatus = 'VOICE ERROR';
    appendNotice(update.error ?? 'Speech recognition failed.');
  } else voiceStatus = 'PUSH TO TALK';
  renderVoiceStrip();
  if (update.final && update.state === 'idle' && update.transcript.trim()) {
    const input = mount!.querySelector<HTMLTextAreaElement>('[data-ai-input]');
    if (input) input.value = update.transcript.trim();
    if (loadVoicePreferences().autoSubmitDictation) {
      if (input) input.value = '';
      void submit(update.transcript.trim());
    }
  }
}

function renderVoiceStrip(): void {
  const button = mount!.querySelector<HTMLButtonElement>('[data-ai-action="voice"]');
  button?.classList.toggle('listening', voiceRecognizer.getState() === 'listening');
  const status = mount!.querySelector<HTMLElement>('[data-ai-voice-status]');
  if (status) status.textContent = voiceStatus;
  const strip = mount!.querySelector<HTMLElement>('[data-ai-voice-strip]');
  strip?.classList.toggle('listening', voiceRecognizer.getState() === 'listening');
  const transcript = mount!.querySelector<HTMLElement>('[data-ai-voice-transcript]');
  if (transcript) transcript.textContent = voiceTranscript || 'Push to talk, then speak one question or command.';
}

async function refreshStatus(showNotice = false): Promise<void> {
  statusText = 'CHECKING';
  statusClass = 'checking';
  render();
  try {
    const result = await inspectLocalAi();
    modelLabel = result.model || 'MODEL NOT SET';
    statusText = !result.configured ? 'NOT CONFIGURED' : result.connected ? 'LOCAL AI READY' : 'OFFLINE';
    statusClass = result.connected ? 'ready' : 'offline';
    render();
    if (showNotice) appendNotice(result.message);
  } catch (error) {
    statusText = 'OFFLINE';
    statusClass = 'offline';
    render();
    if (showNotice) appendNotice(error instanceof Error ? error.message : 'Unable to inspect local AI.');
  }
}

function handleAssistantHandoff(handoff: AssistantHandoff): void {
  if (!handoff.prompt.trim()) return;
  localStorage.removeItem('project-v-assistant-pending-handoff-v1');
  scope = handoff.scope;
  localStorage.setItem(SCOPE_KEY, scope);
  if (handoff.speakReply) {
    speakReplies = true;
    saveVoicePreferences({ speakAssistantReplies: true });
  }
  const input = mount!.querySelector<HTMLTextAreaElement>('[data-ai-input]');
  if (input) input.value = handoff.prompt;
  if (!running) void submit(handoff.prompt);
}

async function closeWindow(): Promise<void> {
  cancelProjectVSpeech();
  if (isDesktopRuntime()) {
    await tryInvokeTauri<void>('close_assistant_desk_window');
    return;
  }
  window.close();
}

window.addEventListener('storage', (event) => {
  if (event.key !== HISTORY_KEY) return;
  history = loadHistory();
  if (!running) renderMessages();
});
window.addEventListener('project-v-assistant-history-change', () => {
  history = loadHistory();
  if (!running) renderMessages();
});
const assistantHandoffCleanup = subscribeAssistantHandoff(handleAssistantHandoff);
window.addEventListener('beforeunload', () => { assistantHandoffCleanup(); voiceRecognizer.destroy(); cancelProjectVSpeech(); });

render();
void refreshStatus();
const pendingAssistantHandoff = consumeAssistantHandoff();
if (pendingAssistantHandoff) window.setTimeout(() => handleAssistantHandoff(pendingAssistantHandoff), 250);

window.addEventListener('resize', () => requestAnimationFrame(updateLatestButton));
