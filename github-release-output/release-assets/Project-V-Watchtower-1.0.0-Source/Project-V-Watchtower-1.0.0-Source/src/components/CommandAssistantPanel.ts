import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AppContext } from '@/app/app-context';
import { Panel } from './Panel';
import { collectCommandContext, type CommandContextScope, type CommandContextSource } from '@/services/command-context';
import { inspectLocalAi, streamLocalCommand, type CommandMessage } from '@/services/local-ai-command';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import { subscribeRuntimeConfig } from '@/services/runtime-config';
import { escapeHtml } from '@/utils/sanitize';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { requestLiveContextRefresh } from '@/services/live-context-refresh';
import { ProjectVSpeechRecognizer, cancelProjectVSpeech, loadVoicePreferences, saveVoicePreferences, speakProjectVText, type VoiceRecognitionUpdate } from '@/services/voice-control';

interface StoredAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: Array<Pick<CommandContextSource, 'id' | 'title' | 'kind' | 'url'>>;
}

const HISTORY_KEY = 'project-v-command-assistant-history-v1';
const SCOPE_KEY = 'project-v-command-assistant-scope-v1';
const MAX_HISTORY = 30;
const LIVE_REFRESH_KEY = 'project-v-command-assistant-live-refresh-v1';

const SYSTEM_PROMPT = `You are the local Project V Watchtower Command Assistant.
Your job is to help an analyst understand the current situational-intelligence workspace.

Rules:
- Treat supplied panel and news context as unverified operational inputs, not guaranteed truth.
- Distinguish confirmed facts, panel-generated analysis, and inference.
- Cite supplied context using [S1], [S2], and so on when making claims based on it.
- Never invent a source, URL, event, casualty number, or intelligence conclusion.
- Point out contradictions, stale data, missing corroboration, and uncertainty.
- Prefer compact analyst-style answers with a brief assessment, evidence, and what to verify next.
- Do not claim unrestricted internet access. When live refresh is enabled, you may use only the newly refreshed Watchtower feeds included in the supplied context.
- AI Insights is a generated summary layer. Use it as a lead, then compare it with underlying panels and news sources when available.
- Local research documents and analyst memories are user-supplied material. Cite them, but do not assume they are authentic or current without corroboration.`;

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

function saveHistory(history: StoredAssistantMessage[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    window.dispatchEvent(new CustomEvent('project-v-assistant-history-change'));
  } catch { /* local history is best-effort */ }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadScope(): CommandContextScope {
  const value = localStorage.getItem(SCOPE_KEY);
  return value === 'workspace' || value === 'visible' || value === 'insights' || value === 'research' || value === 'workspace-research' || value === 'none'
    ? value
    : 'workspace';
}

function markdown(value: string): string {
  const rendered = marked.parse(value, { breaks: true, gfm: true }) as string;
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class CommandAssistantPanel extends Panel {
  private readonly ctx: AppContext;
  private history: StoredAssistantMessage[] = loadHistory();
  private scope: CommandContextScope = loadScope();
  private requestController: AbortController | null = null;
  private runtimeCleanup: (() => void) | null = null;
  private statusText = 'CHECKING';
  private statusClass = 'checking';
  private modelLabel = 'LOCAL MODEL';
  private currentSources: CommandContextSource[] = [];
  private draftResponse = '';
  private isRunning = false;
  private liveRefresh = localStorage.getItem(LIVE_REFRESH_KEY) === 'true';
  private readonly voiceRecognizer = new ProjectVSpeechRecognizer((update) => this.handleVoiceUpdate(update));
  private voiceStatus = 'PUSH TO TALK';
  private forceSpeakCurrentRequest = false;
  private readonly handleAssistantSubmit = (event: Event): void => {
    const detail = (event as CustomEvent<{ prompt?: string; scope?: CommandContextScope; speakReply?: boolean }>).detail;
    if (!detail?.prompt?.trim()) return;
    if (detail.scope) {
      this.scope = detail.scope;
      localStorage.setItem(SCOPE_KEY, this.scope);
      const select = this.content.querySelector<HTMLSelectElement>('.v-assistant-context-select');
      if (select) select.value = this.scope;
    }
    void this.submit(detail.prompt.trim(), detail.speakReply === true);
  };
  private readonly handleHistorySync = (event: Event): void => {
    if (event instanceof StorageEvent && event.key !== HISTORY_KEY) return;
    if (this.isRunning) return;
    this.history = loadHistory();
    this.renderMessages();
  };

  constructor(ctx: AppContext) {
    super({
      id: 'command-assistant',
      title: 'V // COMMAND ASSISTANT',
      showCount: false,
      className: 'panel-wide command-assistant-panel',
      infoTooltip: 'Local Ollama-powered analyst chat. It can use visible Watchtower panels and AI Insights as context, but it treats generated insights as unverified leads rather than confirmed facts.',
    });
    this.ctx = ctx;
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '7';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '4';
    this.render();
    this.runtimeCleanup = subscribeRuntimeConfig(() => void this.refreshStatus());
    window.addEventListener('storage', this.handleHistorySync);
    window.addEventListener('project-v-assistant-history-change', this.handleHistorySync);
    window.addEventListener('project-v-assistant-submit', this.handleAssistantSubmit);
    void this.refreshStatus();
  }

  private render(): void {
    this.content.innerHTML = `
      <div class="v-assistant-shell">
        <div class="v-assistant-toolbar">
          <div class="v-assistant-status ${this.statusClass}">
            <span class="v-assistant-status-dot"></span>
            <span>${this.statusText}</span>
            <small>${this.modelLabel}</small>
          </div>
          <label class="v-assistant-context-label">
            CONTEXT
            <select class="v-assistant-context-select" aria-label="Assistant context scope">
              <option value="workspace" ${this.scope === 'workspace' ? 'selected' : ''}>CURRENT WORKSPACE</option>
              <option value="visible" ${this.scope === 'visible' ? 'selected' : ''}>VISIBLE PANELS</option>
              <option value="insights" ${this.scope === 'insights' ? 'selected' : ''}>AI INSIGHTS + RISK</option>
              <option value="research" ${this.scope === 'research' ? 'selected' : ''}>RESEARCH LIBRARY ONLY</option>
              <option value="workspace-research" ${this.scope === 'workspace-research' ? 'selected' : ''}>WORKSPACE + RESEARCH</option>
              <option value="none" ${this.scope === 'none' ? 'selected' : ''}>NO PANEL CONTEXT</option>
            </select>
          </label>
          <label class="v-assistant-live-toggle" title="Refresh configured Watchtower feeds before collecting context for each question.">
            <input type="checkbox" data-action="live-refresh" ${this.liveRefresh ? 'checked' : ''}> LIVE REFRESH
          </label>
          <button type="button" class="v-assistant-tool-btn v-assistant-mic-btn" data-action="voice" title="Push to talk">◉ <span data-voice-status>${this.voiceStatus}</span></button>
          <label class="v-assistant-live-toggle" title="Speak completed local AI replies using the selected system voice.">
            <input type="checkbox" data-action="speak-replies" ${loadVoicePreferences().speakAssistantReplies ? 'checked' : ''}> SPEAK REPLIES
          </label>
          <button type="button" class="v-assistant-tool-btn" data-action="window">OPEN WINDOW</button>
          <button type="button" class="v-assistant-tool-btn" data-action="analysis-room">ANALYSIS ROOM</button>
          <button type="button" class="v-assistant-tool-btn" data-action="refresh">TEST LOCAL AI</button>
          <button type="button" class="v-assistant-tool-btn" data-action="settings">API KEYS</button>
          <button type="button" class="v-assistant-tool-btn danger" data-action="clear">CLEAR</button>
        </div>
        <div class="v-assistant-quick-actions" aria-label="Quick analyst prompts">
          <button type="button" data-prompt="Create a concise situational briefing from the current desk. Separate confirmed signals, AI-generated assessment, contradictions, and items requiring verification.">BRIEF DESK</button>
          <button type="button" data-prompt="Review the current risk signals. What appears to be escalating, what evidence supports it, and what could be noise or stale data?">RISK REVIEW</button>
          <button type="button" data-prompt="Compare the AI Insights panel with the other visible panels and news sources. Identify corroboration, contradictions, and unsupported claims.">CHECK AI INSIGHTS</button>
          <button type="button" data-prompt="List the five most important developments visible in this workspace and explain why each matters. Cite the supplied sources.">TOP FIVE</button>
          <button type="button" data-scope="research" data-prompt="Search the local research library for material relevant to the current situation. Summarize the strongest evidence, identify contradictions, and cite every document-based claim.">RESEARCH BRIEF</button>
          <button type="button" data-scope="workspace-research" data-prompt="Compare the current workspace signals against the local research library and analyst memories. What is corroborated, what conflicts, and what remains unknown?">CROSS-CHECK ARCHIVE</button>
          <button type="button" data-scope="workspace" data-prompt="Prepare an operational briefing from the Alert Center, watchlists, source health, event timeline, and other visible modules. Separate open high-priority alerts, acknowledged items, source failures, and recommended analyst follow-up. Cite supplied sources.">OPERATIONS BRIEF</button>
          <button type="button" data-scope="workspace" data-prompt="Review the current event timeline for sequence, evidence gaps, contradictions, and unverified claims. Do not convert analyst notes or alerts into confirmed facts.">TIMELINE REVIEW</button>
        </div>
        <div class="v-assistant-context-strip" aria-live="polite"></div>
        <div class="v-assistant-messages" role="log" aria-live="polite"></div>
        <form class="v-assistant-composer">
          <textarea rows="2" maxlength="4000" placeholder="Ask Watchtower about the current desk… (Enter to send, Shift+Enter for a new line)"></textarea>
          <div class="v-assistant-composer-actions">
            <span class="v-assistant-privacy">LOCAL OLLAMA · CONTEXT IS SENT ONLY TO YOUR CONFIGURED ENDPOINT</span>
            <button type="button" class="v-assistant-stop" ${this.isRunning ? '' : 'hidden'}>STOP</button>
            <button type="submit" class="v-assistant-send" ${this.isRunning ? 'disabled' : ''}>SEND</button>
          </div>
        </form>
      </div>
    `;
    this.bindEvents();
    this.renderMessages();
    this.renderContextStrip();
  }

  private bindEvents(): void {
    const shell = this.content.querySelector<HTMLElement>('.v-assistant-shell');
    if (!shell) return;

    shell.querySelector<HTMLSelectElement>('.v-assistant-context-select')?.addEventListener('change', (event) => {
      this.scope = (event.currentTarget as HTMLSelectElement).value as CommandContextScope;
      localStorage.setItem(SCOPE_KEY, this.scope);
      this.currentSources = [];
      this.renderContextStrip();
    });

    shell.querySelector<HTMLInputElement>('[data-action="live-refresh"]')?.addEventListener('change', (event) => {
      this.liveRefresh = (event.currentTarget as HTMLInputElement).checked;
      localStorage.setItem(LIVE_REFRESH_KEY, String(this.liveRefresh));
      this.appendSystemNotice(this.liveRefresh ? 'Live refresh enabled. Configured Watchtower sources will refresh before each question.' : 'Live refresh disabled. The assistant will use the most recently loaded data.');
    });
    shell.querySelector<HTMLButtonElement>('[data-action="voice"]')?.addEventListener('click', () => {
      const state = this.voiceRecognizer.getState();
      if (state === 'listening' || state === 'starting') this.voiceRecognizer.stop();
      else {
        cancelProjectVSpeech();
        this.voiceStatus = 'STARTING';
        this.renderVoiceStatus();
        this.voiceRecognizer.start(loadVoicePreferences().language);
      }
    });
    shell.querySelector<HTMLInputElement>('[data-action="speak-replies"]')?.addEventListener('change', (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      saveVoicePreferences({ speakAssistantReplies: enabled });
      if (!enabled) cancelProjectVSpeech();
      this.appendSystemNotice(enabled ? 'Spoken replies enabled.' : 'Spoken replies disabled.');
    });
    shell.querySelector<HTMLButtonElement>('[data-action="window"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('assistant-desk'));
    shell.querySelector<HTMLButtonElement>('[data-action="analysis-room"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('analysis-room'));
    shell.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => void this.refreshStatus(true));
    shell.querySelector<HTMLButtonElement>('[data-action="settings"]')?.addEventListener('click', () => void openRuntimeSettings());
    shell.querySelector<HTMLButtonElement>('[data-action="clear"]')?.addEventListener('click', () => {
      if (!window.confirm('Clear the local Command Assistant conversation?')) return;
      this.history = [];
      saveHistory(this.history);
      this.renderMessages();
    });

    shell.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        const requestedScope = button.dataset.scope as CommandContextScope | undefined;
        if (requestedScope) {
          this.scope = requestedScope;
          localStorage.setItem(SCOPE_KEY, this.scope);
          const select = shell.querySelector<HTMLSelectElement>('.v-assistant-context-select');
          if (select) select.value = this.scope;
          this.currentSources = [];
          this.renderContextStrip();
        }
        void this.submit(button.dataset.prompt ?? '');
      });
    });

    const form = shell.querySelector<HTMLFormElement>('.v-assistant-composer');
    const textarea = shell.querySelector<HTMLTextAreaElement>('textarea');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const prompt = textarea?.value.trim() ?? '';
      if (!prompt) return;
      if (textarea) textarea.value = '';
      void this.submit(prompt);
    });
    textarea?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });
    shell.querySelector<HTMLButtonElement>('.v-assistant-stop')?.addEventListener('click', () => this.stop());
  }

  private async refreshStatus(showResult = false): Promise<void> {
    this.statusText = 'CHECKING';
    this.statusClass = 'checking';
    this.renderStatusOnly();
    const status = await inspectLocalAi();
    this.modelLabel = status.model || 'MODEL NOT SET';
    if (!status.configured) {
      this.statusText = 'NOT CONFIGURED';
      this.statusClass = 'offline';
    } else if (!status.connected) {
      this.statusText = 'OFFLINE';
      this.statusClass = 'offline';
    } else {
      this.statusText = 'LOCAL AI READY';
      this.statusClass = 'ready';
    }
    this.renderStatusOnly();
    if (showResult) {
      this.appendSystemNotice(status.message);
    }
  }

  private renderStatusOnly(): void {
    const status = this.content.querySelector<HTMLElement>('.v-assistant-status');
    if (!status) return;
    status.className = `v-assistant-status ${this.statusClass}`;
    const spans = status.querySelectorAll('span');
    if (spans[1]) spans[1].textContent = this.statusText;
    const small = status.querySelector('small');
    if (small) small.textContent = this.modelLabel;
  }

  private appendSystemNotice(message: string): void {
    const container = this.content.querySelector<HTMLElement>('.v-assistant-messages');
    if (!container) return;
    const notice = document.createElement('div');
    notice.className = 'v-assistant-system-notice';
    notice.textContent = message;
    container.appendChild(notice);
    container.scrollTop = container.scrollHeight;
  }

  private renderMessages(): void {
    const container = this.content.querySelector<HTMLElement>('.v-assistant-messages');
    if (!container) return;
    if (this.history.length === 0 && !this.isRunning) {
      container.innerHTML = `
        <div class="v-assistant-empty">
          <div class="v-assistant-v-mark">V</div>
          <strong>COMMAND CHANNEL READY</strong>
          <p>Ask questions about the current workspace, create a briefing, or compare the existing AI Insights against underlying panels.</p>
          <p class="v-assistant-warning">Generated analysis may be wrong. Verify high-impact claims against the cited panel sources.</p>
        </div>`;
      return;
    }

    const messages = this.history.map((message) => {
      const sourceBadges = message.role === 'assistant' && message.sources?.length
        ? `<div class="v-assistant-message-sources">${message.sources.slice(0, 10).map((source, index) => `<span title="${escapeHtml(source.title)}">S${index + 1} · ${escapeHtml(source.title)}</span>`).join('')}</div>`
        : '';
      return `<article class="v-assistant-message ${message.role}" data-message-id="${message.id}">
        <header><strong>${message.role === 'user' ? 'ANALYST' : 'V // LOCAL AI'}</strong><time>${timeLabel(message.createdAt)}</time></header>
        <div class="v-assistant-message-body">${message.role === 'assistant' ? markdown(message.content) : `<p>${DOMPurify.sanitize(message.content)}</p>`}</div>
        ${sourceBadges}
      </article>`;
    }).join('');

    const streaming = this.isRunning
      ? `<article class="v-assistant-message assistant streaming"><header><strong>V // LOCAL AI</strong><span class="v-assistant-thinking">ANALYZING</span></header><div class="v-assistant-message-body">${this.draftResponse ? markdown(this.draftResponse) : '<p>Reading current workspace context…</p>'}</div></article>`
      : '';
    container.innerHTML = messages + streaming;
    container.scrollTop = container.scrollHeight;
  }

  private renderContextStrip(): void {
    const strip = this.content.querySelector<HTMLElement>('.v-assistant-context-strip');
    if (!strip) return;
    const labels: Record<CommandContextScope, string> = {
      workspace: 'Current workspace + visible panels + latest headlines',
      visible: 'Visible panel text only',
      insights: 'AI Insights, Strategic Risk, Posture, and Country Instability',
      research: 'Relevant enabled documents, excerpts, and analyst memories',
      'workspace-research': 'Current workspace plus relevant local research',
      none: 'Conversation only — no panel context',
    };
    if (this.currentSources.length === 0) {
      strip.innerHTML = `<strong>CONTEXT MODE</strong><span>${labels[this.scope]}</span>`;
      return;
    }
    strip.innerHTML = `<strong>${this.currentSources.length} CONTEXT SOURCES</strong>${this.currentSources.slice(0, 12).map((source, index) => `<span title="${escapeHtml(source.title)}">S${index + 1} ${escapeHtml(source.title)}</span>`).join('')}`;
  }

  private setRunning(running: boolean): void {
    this.isRunning = running;
    const send = this.content.querySelector<HTMLButtonElement>('.v-assistant-send');
    const stop = this.content.querySelector<HTMLButtonElement>('.v-assistant-stop');
    if (send) send.disabled = running;
    if (stop) stop.hidden = !running;
    this.renderMessages();
  }

  private buildMessages(prompt: string, contextBlock: string): CommandMessage[] {
    const recent = this.history.slice(-10).map<CommandMessage>((message) => ({ role: message.role, content: message.content }));
    const contextualPrompt = contextBlock
      ? `${prompt}\n\nCURRENT WATCHTOWER CONTEXT:\n${contextBlock}`
      : prompt;
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recent,
      { role: 'user', content: contextualPrompt },
    ];
  }

  private async submit(prompt: string, speakReply = false): Promise<void> {
    if (!prompt.trim() || this.isRunning) return;
    this.forceSpeakCurrentRequest = speakReply;
    if (this.liveRefresh && this.scope !== 'none' && this.scope !== 'research') {
      this.appendSystemNotice('Refreshing configured live sources before analysis…');
      try {
        const result = await requestLiveContextRefresh();
        this.appendSystemNotice(`Live sources refreshed at ${new Date(result.refreshedAt).toLocaleTimeString()}.`);
      } catch (error) {
        this.appendSystemNotice(`${error instanceof Error ? error.message : 'Live refresh failed.'} Using the most recently loaded context.`);
      }
    }
    const context = await collectCommandContext(this.ctx, this.scope, prompt.trim());
    this.currentSources = context.sources;
    this.renderContextStrip();

    const commandMessages = this.buildMessages(prompt.trim(), context.promptBlock);
    this.history.push({ id: newId(), role: 'user', content: prompt.trim(), createdAt: Date.now() });
    this.history = this.history.slice(-MAX_HISTORY);
    saveHistory(this.history);
    this.draftResponse = '';
    this.requestController = new AbortController();
    this.setRunning(true);

    try {
      const config = await streamLocalCommand({
        messages: commandMessages,
        signal: this.requestController.signal,
        onToken: (token) => {
          this.draftResponse += token;
          this.renderMessages();
        },
      });
      const response = this.draftResponse.trim() || 'The local model returned an empty response.';
      this.modelLabel = config.model;
      this.statusText = 'LOCAL AI READY';
      this.statusClass = 'ready';
      this.history.push({
        id: newId(),
        role: 'assistant',
        content: response,
        createdAt: Date.now(),
        sources: context.sources.map(({ id, title, kind, url }) => ({ id, title, kind, url })),
      });
      this.history = this.history.slice(-MAX_HISTORY);
      saveHistory(this.history);
      if (this.forceSpeakCurrentRequest || loadVoicePreferences().speakAssistantReplies) speakProjectVText(response);
    } catch (error) {
      if (this.requestController?.signal.aborted) {
        if (this.draftResponse.trim()) {
          this.history.push({ id: newId(), role: 'assistant', content: `${this.draftResponse.trim()}\n\n_Response stopped by analyst._`, createdAt: Date.now() });
          saveHistory(this.history);
        }
      } else {
        const message = error instanceof Error ? error.message : 'Local AI request failed.';
        this.statusText = 'OFFLINE';
        this.statusClass = 'offline';
        this.history.push({
          id: newId(),
          role: 'assistant',
          content: `**Local AI connection failed.**\n\n${message}\n\nOpen **API Keys** and verify that Ollama is running, the endpoint is correct, and the selected model is installed.`,
          createdAt: Date.now(),
        });
        saveHistory(this.history);
      }
    } finally {
      this.requestController = null;
      this.draftResponse = '';
      this.forceSpeakCurrentRequest = false;
      this.setRunning(false);
      this.renderStatusOnly();
    }
  }

  private handleVoiceUpdate(update: VoiceRecognitionUpdate): void {
    if (update.state === 'listening') this.voiceStatus = 'LISTENING';
    else if (update.state === 'starting') this.voiceStatus = 'STARTING';
    else if (update.state === 'processing') this.voiceStatus = 'PROCESSING';
    else if (update.state === 'unsupported') {
      this.voiceStatus = 'UNAVAILABLE';
      this.appendSystemNotice(update.error ?? 'Speech recognition is unavailable in this runtime.');
    } else if (update.state === 'error') {
      this.voiceStatus = 'VOICE ERROR';
      this.appendSystemNotice(update.error ?? 'Speech recognition failed.');
    } else this.voiceStatus = 'PUSH TO TALK';
    this.renderVoiceStatus();
    if (update.final && update.state === 'idle' && update.transcript.trim()) {
      const textarea = this.content.querySelector<HTMLTextAreaElement>('.v-assistant-composer textarea');
      if (textarea) textarea.value = update.transcript.trim();
      if (loadVoicePreferences().autoSubmitDictation) {
        if (textarea) textarea.value = '';
        void this.submit(update.transcript.trim(), true);
      }
    }
  }

  private renderVoiceStatus(): void {
    const button = this.content.querySelector<HTMLButtonElement>('[data-action="voice"]');
    if (!button) return;
    button.classList.toggle('listening', this.voiceRecognizer.getState() === 'listening');
    const status = button.querySelector<HTMLElement>('[data-voice-status]');
    if (status) status.textContent = this.voiceStatus;
  }

  private stop(): void {
    this.requestController?.abort();
  }

  public override destroy(): void {
    this.stop();
    this.runtimeCleanup?.();
    this.runtimeCleanup = null;
    window.removeEventListener('storage', this.handleHistorySync);
    window.removeEventListener('project-v-assistant-history-change', this.handleHistorySync);
    window.removeEventListener('project-v-assistant-submit', this.handleAssistantSubmit);
    this.voiceRecognizer.destroy();
    super.destroy();
  }
}
