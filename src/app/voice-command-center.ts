import type { CommandContextScope } from '@/services/command-context';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import {
  ProjectVSpeechRecognizer,
  cancelProjectVSpeech,
  formatVoiceIntent,
  interpretProjectVVoiceCommand,
  isSpeechRecognitionSupported,
  listSpeechVoices,
  loadVoicePreferences,
  saveVoicePreferences,
  speakProjectVText,
  subscribeVoicePreferences,
  type ProjectVVoiceIntent,
  type VoiceRecognitionUpdate,
} from '@/services/voice-control';
import { openProjectVWorkspaceWindow, type ProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { escapeHtml } from '@/utils/sanitize';

interface VoiceCommandHistoryItem {
  id: string;
  transcript: string;
  action: string;
  outcome: string;
  createdAt: number;
  ok: boolean;
}

export interface VoiceCommandCenterOptions {
  activateWorkspace: (workspaceId: string) => void;
  setMapView: (view: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania') => void;
  showPanel: (panelId: string, workspaceId?: string) => void;
  openSecurityCenter: () => void;
  openAlerts: () => void;
  lockWatchtower: () => void;
  submitAssistant: (prompt: string, scope?: CommandContextScope, speakReply?: boolean) => void;
  readLastAssistantResponse: () => string | null;
}

const HISTORY_KEY = 'project-v-voice-command-history-v1';
const MAX_HISTORY = 18;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadHistory(): VoiceCommandHistoryItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VoiceCommandHistoryItem => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<VoiceCommandHistoryItem>;
      return typeof candidate.id === 'string'
        && typeof candidate.transcript === 'string'
        && typeof candidate.action === 'string'
        && typeof candidate.outcome === 'string'
        && typeof candidate.createdAt === 'number'
        && typeof candidate.ok === 'boolean';
    }).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(history: VoiceCommandHistoryItem[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class VoiceCommandCenterController {
  private readonly options: VoiceCommandCenterOptions;
  private readonly recognizer: ProjectVSpeechRecognizer;
  private history = loadHistory();
  private transcript = '';
  private interimTranscript = '';
  private status = isSpeechRecognitionSupported() ? 'READY' : 'TYPED COMMAND MODE';
  private statusClass = isSpeechRecognitionSupported() ? 'ready' : 'warn';
  private lastOutcome = 'Hold PUSH TO TALK or type a command below.';
  private pendingIntent: ProjectVVoiceIntent | null = null;
  private preferencesCleanup: (() => void) | null = null;
  private voiceChangedHandler: (() => void) | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(options: VoiceCommandCenterOptions) {
    this.options = options;
    this.recognizer = new ProjectVSpeechRecognizer((update) => this.handleRecognitionUpdate(update));
  }

  init(): void {
    document.getElementById('voiceControlBtn')?.addEventListener('click', () => this.open());
    document.getElementById('voiceControlClose')?.addEventListener('click', () => this.close());
    document.getElementById('voiceControlBackdrop')?.addEventListener('click', () => this.close());
    this.preferencesCleanup = subscribeVoicePreferences(() => this.render());
    if ('speechSynthesis' in window) {
      this.voiceChangedHandler = () => this.render();
      window.speechSynthesis.addEventListener('voiceschanged', this.voiceChangedHandler);
    }
    this.keydownHandler = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        this.open();
        this.startListening();
      }
      if (event.key === 'Escape' && document.body.classList.contains('v-voice-drawer-open')) {
        this.close();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
    this.render();
    this.updateHeaderButton();
  }

  destroy(): void {
    this.recognizer.destroy();
    this.preferencesCleanup?.();
    this.preferencesCleanup = null;
    if (this.voiceChangedHandler && 'speechSynthesis' in window) {
      window.speechSynthesis.removeEventListener('voiceschanged', this.voiceChangedHandler);
    }
    this.voiceChangedHandler = null;
    if (this.keydownHandler) window.removeEventListener('keydown', this.keydownHandler);
    this.keydownHandler = null;
  }

  open(): void {
    document.getElementById('voiceControlDrawer')?.classList.add('open');
    document.getElementById('voiceControlBackdrop')?.classList.add('open');
    document.body.classList.add('v-voice-drawer-open');
    this.render();
  }

  close(): void {
    this.recognizer.abort();
    document.getElementById('voiceControlDrawer')?.classList.remove('open');
    document.getElementById('voiceControlBackdrop')?.classList.remove('open');
    document.body.classList.remove('v-voice-drawer-open');
    this.updateHeaderButton();
  }

  private render(): void {
    const mount = document.getElementById('voiceControlContent');
    if (!mount) return;
    const settings = loadVoicePreferences();
    const voices = listSpeechVoices();
    const recognitionSupported = isSpeechRecognitionSupported();
    const displayedTranscript = this.transcript || this.interimTranscript;
    mount.innerHTML = `
      <section class="v-voice-console">
        <div class="v-voice-status-row">
          <div class="v-voice-status ${this.statusClass}"><span></span><strong>${escapeHtml(this.status)}</strong></div>
          <span class="v-voice-privacy">PUSH-TO-TALK · NO WAKE WORD · SENSITIVE ACTIONS REQUIRE VISIBLE CONFIRMATION</span>
        </div>
        <div class="v-voice-listen-zone ${this.recognizer.getState() === 'listening' ? 'listening' : ''}">
          <button type="button" class="v-voice-ptt" data-voice-action="listen" ${recognitionSupported ? '' : 'disabled'}>
            <span class="v-voice-mic">◉</span>
            <strong>${this.recognizer.getState() === 'listening' ? 'LISTENING — CLICK TO STOP' : 'PUSH TO TALK'}</strong>
            <small>CTRL + SHIFT + V</small>
          </button>
          <div class="v-voice-transcript" aria-live="polite">
            <span>LIVE TRANSCRIPT</span>
            <strong>${displayedTranscript ? escapeHtml(displayedTranscript) : 'AWAITING COMMAND'}</strong>
            ${this.interimTranscript && !this.transcript ? '<em>INTERIM</em>' : ''}
          </div>
        </div>
        <form class="v-voice-manual" data-voice-form>
          <label>TYPE OR CORRECT COMMAND
            <textarea rows="2" maxlength="1200" data-voice-input placeholder="Example: Open Live Ops · Brief the desk · Ask Watchtower what changed in the last six hours">${escapeHtml(this.transcript)}</textarea>
          </label>
          <div>
            <button type="submit" class="primary">RUN COMMAND</button>
            <button type="button" data-voice-action="assistant">SEND TEXT TO ASSISTANT</button>
            <button type="button" data-voice-action="clear">CLEAR</button>
          </div>
        </form>
        ${this.pendingIntent ? `
          <div class="v-voice-confirmation">
            <strong>CONFIRM VOICE ACTION</strong>
            <span>${escapeHtml(formatVoiceIntent(this.pendingIntent))}</span>
            <p>This action changes the active security state. Confirm using the visible button.</p>
            <div><button type="button" class="danger" data-voice-action="confirm">CONFIRM</button><button type="button" data-voice-action="cancel">CANCEL</button></div>
          </div>` : ''}
        <div class="v-voice-outcome ${this.statusClass}"><strong>COMMAND RESULT</strong><span>${escapeHtml(this.lastOutcome)}</span></div>
        <section class="v-voice-settings">
          <div class="v-voice-section-title"><span>VOICE OUTPUT</span><strong>SPOKEN BRIEFINGS</strong></div>
          <div class="v-voice-settings-grid">
            <label>LANGUAGE<input type="text" maxlength="24" data-voice-setting="language" value="${escapeHtml(settings.language)}" placeholder="en-US"></label>
            <label>SYSTEM VOICE<select data-voice-setting="voiceUri">
              <option value="">AUTOMATIC SYSTEM VOICE</option>
              ${voices.map((voice) => `<option value="${escapeHtml(voice.voiceURI)}" ${settings.voiceUri === voice.voiceURI ? 'selected' : ''}>${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}${voice.localService ? ' · LOCAL' : ''}</option>`).join('')}
            </select></label>
            <label>RATE <output>${settings.rate.toFixed(2)}</output><input type="range" min="0.5" max="1.8" step="0.05" data-voice-setting="rate" value="${settings.rate}"></label>
            <label>PITCH <output>${settings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" data-voice-setting="pitch" value="${settings.pitch}"></label>
            <label class="checkbox"><input type="checkbox" data-voice-setting="speakAssistantReplies" ${settings.speakAssistantReplies ? 'checked' : ''}> READ ASSISTANT REPLIES ALOUD</label>
            <label class="checkbox"><input type="checkbox" data-voice-setting="speakCommandConfirmations" ${settings.speakCommandConfirmations ? 'checked' : ''}> SPEAK COMMAND CONFIRMATIONS</label>
            <label class="checkbox"><input type="checkbox" data-voice-setting="autoSubmitDictation" ${settings.autoSubmitDictation ? 'checked' : ''}> AUTO-SUBMIT ASSISTANT DICTATION</label>
          </div>
          <div class="v-voice-settings-actions"><button type="button" data-voice-action="test-voice">TEST VOICE</button><button type="button" data-voice-action="read-last">READ LAST RESPONSE</button><button type="button" data-voice-action="stop-speaking">STOP SPEAKING</button></div>
        </section>
        <section class="v-voice-help">
          <div class="v-voice-section-title"><span>SUPPORTED PHRASES</span><strong>COMMAND EXAMPLES</strong></div>
          <div class="v-voice-example-grid">
            <article><strong>NAVIGATION</strong><span>Open Watchtower</span><span>Switch to Live Ops</span><span>Show the Europe map</span></article>
            <article><strong>TOOLS</strong><span>Open Case Desk</span><span>Open Data Desk</span><span>Show Alert Center</span></article>
            <article><strong>LOCAL AI</strong><span>Brief the desk</span><span>Check AI Insights</span><span>Ask Watchtower what changed</span></article>
            <article><strong>VOICE</strong><span>Read last response</span><span>Stop speaking</span><span>Lock Watchtower</span></article>
          </div>
          <p>${recognitionSupported
    ? 'Desktop mode prefers the browser/WebView speech provider when available and otherwise uses the local Windows speech recognizer. Project V does not save microphone audio. Browser speech providers may process audio outside the application.'
    : 'Speech recognition is unavailable in this runtime. Typed voice-console commands and spoken replies remain available.'}</p>
        </section>
        <section class="v-voice-history">
          <div class="v-voice-section-title"><span>LOCAL LOG</span><strong>RECENT COMMANDS</strong><button type="button" data-voice-action="clear-history">CLEAR LOG</button></div>
          <div class="v-voice-history-list">
            ${this.history.length ? this.history.slice().reverse().map((item) => `
              <article class="${item.ok ? 'ok' : 'failed'}"><time>${timeLabel(item.createdAt)}</time><strong>${escapeHtml(item.transcript)}</strong><span>${escapeHtml(item.action)} · ${escapeHtml(item.outcome)}</span></article>`).join('') : '<p>NO VOICE COMMANDS RECORDED THIS SESSION.</p>'}
          </div>
        </section>
      </section>
    `;
    this.bindEvents(mount);
    this.updateHeaderButton();
  }

  private bindEvents(mount: HTMLElement): void {
    mount.querySelector<HTMLButtonElement>('[data-voice-action="listen"]')?.addEventListener('click', () => {
      if (this.recognizer.getState() === 'listening' || this.recognizer.getState() === 'starting') this.recognizer.stop();
      else this.startListening();
    });
    mount.querySelector<HTMLFormElement>('[data-voice-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = mount.querySelector<HTMLTextAreaElement>('[data-voice-input]');
      const transcript = input?.value.trim() ?? '';
      if (transcript) void this.processTranscript(transcript);
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="assistant"]')?.addEventListener('click', () => {
      const transcript = mount.querySelector<HTMLTextAreaElement>('[data-voice-input]')?.value.trim() ?? '';
      if (!transcript) return;
      this.options.submitAssistant(transcript, 'workspace', true);
      this.record(transcript, 'SEND TO LOCAL AI', 'Assistant request submitted.', true);
      this.lastOutcome = 'Sent the typed request to the local Command Assistant.';
      this.status = 'ASSISTANT REQUESTED';
      this.statusClass = 'ready';
      this.confirmByVoice(this.lastOutcome);
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="clear"]')?.addEventListener('click', () => {
      this.transcript = '';
      this.interimTranscript = '';
      this.pendingIntent = null;
      this.lastOutcome = 'Transcript cleared.';
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="confirm"]')?.addEventListener('click', () => {
      const intent = this.pendingIntent;
      this.pendingIntent = null;
      if (intent) void this.executeIntent(intent, this.transcript || formatVoiceIntent(intent), true);
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="cancel"]')?.addEventListener('click', () => {
      this.pendingIntent = null;
      this.status = 'CANCELLED';
      this.statusClass = 'warn';
      this.lastOutcome = 'The pending voice action was cancelled.';
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="test-voice"]')?.addEventListener('click', () => {
      speakProjectVText('Project V Watchtower voice channel online. Spoken briefings are ready.');
      this.lastOutcome = 'Playing the selected system voice.';
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="read-last"]')?.addEventListener('click', () => this.readLastResponse());
    mount.querySelector<HTMLButtonElement>('[data-voice-action="stop-speaking"]')?.addEventListener('click', () => {
      cancelProjectVSpeech();
      this.lastOutcome = 'Speech output stopped.';
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-voice-action="clear-history"]')?.addEventListener('click', () => {
      this.history = [];
      saveHistory(this.history);
      this.render();
    });

    mount.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-voice-setting]').forEach((control) => {
      control.addEventListener('change', () => {
        const field = control.dataset.voiceSetting;
        if (!field) return;
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          saveVoicePreferences({ [field]: control.checked } as Partial<import('@/services/voice-control').ProjectVVoicePreferences>);
        } else if (control instanceof HTMLInputElement && control.type === 'range') {
          saveVoicePreferences({ [field]: Number(control.value) } as Partial<import('@/services/voice-control').ProjectVVoicePreferences>);
        } else {
          saveVoicePreferences({ [field]: control.value } as Partial<import('@/services/voice-control').ProjectVVoicePreferences>);
        }
      });
      if (control instanceof HTMLInputElement && control.type === 'range') {
        control.addEventListener('input', () => {
          const output = control.parentElement?.querySelector('output');
          if (output) output.textContent = Number(control.value).toFixed(2);
        });
      }
    });
  }

  private startListening(): void {
    cancelProjectVSpeech();
    this.pendingIntent = null;
    this.transcript = '';
    this.interimTranscript = '';
    this.lastOutcome = 'Listening for one command…';
    this.open();
    this.recognizer.start(loadVoicePreferences().language);
  }

  private handleRecognitionUpdate(update: VoiceRecognitionUpdate): void {
    this.transcript = update.transcript;
    this.interimTranscript = update.interimTranscript;
    switch (update.state) {
      case 'starting':
        this.status = 'STARTING MICROPHONE';
        this.statusClass = 'checking';
        break;
      case 'listening':
        this.status = 'LISTENING';
        this.statusClass = 'listening';
        break;
      case 'processing':
        this.status = 'PROCESSING';
        this.statusClass = 'checking';
        break;
      case 'unsupported':
        this.status = 'TYPED COMMAND MODE';
        this.statusClass = 'warn';
        this.lastOutcome = update.error ?? 'Speech recognition is unavailable.';
        break;
      case 'error':
        this.status = 'VOICE ERROR';
        this.statusClass = 'error';
        this.lastOutcome = update.error ?? 'Speech recognition failed.';
        break;
      default:
        if (this.status === 'LISTENING' || this.status === 'PROCESSING' || this.status === 'STARTING MICROPHONE') {
          this.status = 'READY';
          this.statusClass = 'ready';
        }
        break;
    }
    this.render();
    if (update.final && update.transcript.trim() && update.state === 'idle') {
      void this.processTranscript(update.transcript.trim());
    }
  }

  private async processTranscript(transcript: string): Promise<void> {
    this.transcript = transcript;
    this.interimTranscript = '';
    this.status = 'INTERPRETING';
    this.statusClass = 'checking';
    const intent = interpretProjectVVoiceCommand(transcript);
    if ('requiresConfirmation' in intent && intent.requiresConfirmation) {
      this.pendingIntent = intent;
      this.status = 'CONFIRMATION REQUIRED';
      this.statusClass = 'warn';
      this.lastOutcome = `${formatVoiceIntent(intent)} requires a visible confirmation.`;
      this.render();
      return;
    }
    await this.executeIntent(intent, transcript, false);
  }

  private async executeIntent(intent: ProjectVVoiceIntent, transcript: string, confirmed: boolean): Promise<void> {
    let outcome = '';
    let ok = true;
    try {
      switch (intent.kind) {
        case 'workspace':
          this.options.activateWorkspace(intent.workspaceId);
          outcome = `${intent.label} workspace opened.`;
          break;
        case 'map-view':
          this.options.setMapView(intent.view);
          outcome = `${intent.label} selected.`;
          break;
        case 'panel':
          this.options.showPanel(intent.panelId, intent.workspaceId);
          outcome = `${intent.label} restored and focused.`;
          break;
        case 'window':
          await openProjectVWorkspaceWindow(intent.windowType as ProjectVWorkspaceWindow);
          outcome = `${intent.label} opened in a separate Project V window.`;
          break;
        case 'settings':
          await openRuntimeSettings();
          outcome = 'API Keys and data-source settings opened.';
          break;
        case 'security':
          this.options.openSecurityCenter();
          outcome = 'Security Center opened.';
          break;
        case 'alerts':
          this.options.openAlerts();
          outcome = 'Live Ops Alert Center opened.';
          break;
        case 'lock':
          if (!confirmed) throw new Error('Visible confirmation is required.');
          this.options.lockWatchtower();
          outcome = 'Watchtower locked.';
          break;
        case 'assistant':
          this.options.submitAssistant(intent.prompt, intent.scope, intent.speakReply);
          outcome = 'Request submitted to the local Command Assistant.';
          break;
        case 'stop-speaking':
          cancelProjectVSpeech();
          outcome = 'Speech output stopped.';
          break;
        case 'read-last':
          outcome = this.readLastResponse();
          break;
        case 'unsupported-sensitive':
          ok = false;
          outcome = intent.reason;
          break;
        case 'unknown':
          ok = false;
          outcome = 'Command not recognized. Correct the transcript or choose SEND TEXT TO ASSISTANT.';
          break;
      }
    } catch (error) {
      ok = false;
      outcome = error instanceof Error ? error.message : 'Voice command failed.';
    }
    this.status = ok ? 'COMMAND COMPLETE' : 'COMMAND NOT EXECUTED';
    this.statusClass = ok ? 'ready' : 'warn';
    this.lastOutcome = outcome;
    this.record(transcript, formatVoiceIntent(intent), outcome, ok);
    if (ok) this.confirmByVoice(outcome);
    this.render();
  }

  private readLastResponse(): string {
    const response = this.options.readLastAssistantResponse();
    if (!response) {
      this.lastOutcome = 'No Assistant response is available to read.';
      return this.lastOutcome;
    }
    speakProjectVText(response);
    this.lastOutcome = 'Reading the latest local AI response.';
    return this.lastOutcome;
  }

  private confirmByVoice(message: string): void {
    if (!loadVoicePreferences().speakCommandConfirmations) return;
    speakProjectVText(message, { rate: 1.02, pitch: 0.9 });
  }

  private record(transcript: string, action: string, outcome: string, ok: boolean): void {
    this.history.push({ id: newId(), transcript, action, outcome, createdAt: Date.now(), ok });
    this.history = this.history.slice(-MAX_HISTORY);
    saveHistory(this.history);
  }

  private updateHeaderButton(): void {
    const button = document.getElementById('voiceControlBtn');
    if (!button) return;
    const state = this.recognizer.getState();
    button.classList.toggle('listening', state === 'listening' || state === 'starting');
    button.classList.toggle('unsupported', !isSpeechRecognitionSupported());
    const stateLabel = button.querySelector<HTMLElement>('[data-voice-header-state]');
    if (stateLabel) stateLabel.textContent = state === 'listening' ? 'LISTENING' : isSpeechRecognitionSupported() ? 'READY' : 'TYPE';
  }
}
