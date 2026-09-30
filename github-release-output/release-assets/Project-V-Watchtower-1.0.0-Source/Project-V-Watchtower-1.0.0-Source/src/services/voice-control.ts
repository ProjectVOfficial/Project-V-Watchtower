import type { CommandContextScope } from './command-context';
import type { ProjectVWorkspaceWindow } from './workspace-windows';
import { hasTauriInvokeBridge, invokeTauri } from './tauri-bridge';

export type VoiceRecognitionState = 'idle' | 'starting' | 'listening' | 'processing' | 'unsupported' | 'error';

export interface ProjectVVoicePreferences {
  version: 1;
  language: string;
  voiceUri: string;
  rate: number;
  pitch: number;
  volume: number;
  speakAssistantReplies: boolean;
  speakCommandConfirmations: boolean;
  autoSubmitDictation: boolean;
}

export interface VoiceRecognitionUpdate {
  state: VoiceRecognitionState;
  transcript: string;
  interimTranscript: string;
  final: boolean;
  error?: string;
}

export interface AssistantVoiceIntent {
  kind: 'assistant';
  prompt: string;
  scope?: CommandContextScope;
  speakReply?: boolean;
}

export type ProjectVVoiceIntent =
  | { kind: 'workspace'; workspaceId: string; label: string }
  | { kind: 'map-view'; view: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania'; label: string }
  | { kind: 'panel'; panelId: string; workspaceId?: string; label: string }
  | { kind: 'window'; windowType: ProjectVWorkspaceWindow; label: string }
  | { kind: 'settings'; label: string }
  | { kind: 'security'; label: string }
  | { kind: 'alerts'; label: string }
  | { kind: 'lock'; label: string; requiresConfirmation: true }
  | { kind: 'stop-speaking'; label: string }
  | { kind: 'read-last'; label: string }
  | { kind: 'unsupported-sensitive'; label: string; reason: string }
  | AssistantVoiceIntent
  | { kind: 'unknown'; label: string; transcript: string };

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const VOICE_SETTINGS_KEY = 'project-v-voice-control-v1';
const VOICE_SETTINGS_EVENT = 'project-v-voice-settings-change';

const DEFAULT_PREFERENCES: ProjectVVoicePreferences = {
  version: 1,
  language: 'en-US',
  voiceUri: '',
  rate: 0.96,
  pitch: 0.92,
  volume: 1,
  speakAssistantReplies: false,
  speakCommandConfirmations: true,
  autoSubmitDictation: true,
};

const WORKSPACE_ALIASES: Array<{ terms: string[]; workspaceId: string; label: string }> = [
  { terms: ['watchtower', 'command deck', 'command overview'], workspaceId: 'watchtower', label: 'WATCHTOWER' },
  { terms: ['global pulse', 'global news', 'world pulse'], workspaceId: 'global-pulse', label: 'GLOBAL PULSE' },
  { terms: ['live ops', 'live operations', 'operations'], workspaceId: 'live-ops', label: 'LIVE OPS' },
  { terms: ['intelligence', 'intel desk', 'analysis desk'], workspaceId: 'intelligence', label: 'INTELLIGENCE' },
  { terms: ['assistant', 'ai assistant', 'command assistant'], workspaceId: 'assistant', label: 'ASSISTANT' },
];

const MAP_ALIASES: Array<{ terms: string[]; view: ProjectVVoiceIntent & { kind: 'map-view' } }> = [
  { terms: ['global', 'world'], view: { kind: 'map-view', view: 'global', label: 'GLOBAL MAP' } },
  { terms: ['america', 'americas', 'north america'], view: { kind: 'map-view', view: 'america', label: 'AMERICAS MAP' } },
  { terms: ['middle east', 'mena'], view: { kind: 'map-view', view: 'mena', label: 'MIDDLE EAST MAP' } },
  { terms: ['europe', 'european'], view: { kind: 'map-view', view: 'eu', label: 'EUROPE MAP' } },
  { terms: ['asia', 'asian'], view: { kind: 'map-view', view: 'asia', label: 'ASIA MAP' } },
  { terms: ['latin america', 'latam', 'south america'], view: { kind: 'map-view', view: 'latam', label: 'LATIN AMERICA MAP' } },
  { terms: ['africa', 'african'], view: { kind: 'map-view', view: 'africa', label: 'AFRICA MAP' } },
  { terms: ['oceania', 'australia', 'pacific'], view: { kind: 'map-view', view: 'oceania', label: 'OCEANIA MAP' } },
];

const PANEL_ALIASES: Array<{ terms: string[]; panelId: string; workspaceId?: string; label: string }> = [
  { terms: ['alert center', 'critical alerts'], panelId: 'alert-center', workspaceId: 'live-ops', label: 'ALERT CENTER' },
  { terms: ['alert rules', 'notification rules'], panelId: 'alert-rules', workspaceId: 'live-ops', label: 'ALERT RULES' },
  { terms: ['watchlists', 'watch list'], panelId: 'watchlists', workspaceId: 'live-ops', label: 'WATCHLISTS' },
  { terms: ['event timeline', 'incident timeline', 'timeline'], panelId: 'event-timeline', workspaceId: 'live-ops', label: 'EVENT TIMELINE' },
  { terms: ['source health', 'data source health'], panelId: 'source-health', workspaceId: 'live-ops', label: 'SOURCE HEALTH' },
  { terms: ['communications wall', 'communications', 'google voice', 'discord'], panelId: 'communications-wall', workspaceId: 'live-ops', label: 'COMMUNICATIONS WALL' },
  { terms: ['live cameras', 'webcams'], panelId: 'live-webcams', workspaceId: 'live-ops', label: 'LIVE WEBCAMS' },
  { terms: ['camera wall panel', 'stream wall panel'], panelId: 'camera-wall', workspaceId: 'live-ops', label: 'CAMERA WALL' },
  { terms: ['ai insights', 'insights'], panelId: 'insights', workspaceId: 'intelligence', label: 'AI INSIGHTS' },
  { terms: ['strategic risk', 'risk overview'], panelId: 'strategic-risk', workspaceId: 'intelligence', label: 'STRATEGIC RISK' },
  { terms: ['strategic posture', 'ai posture'], panelId: 'strategic-posture', workspaceId: 'intelligence', label: 'STRATEGIC POSTURE' },
  { terms: ['research library', 'documents'], panelId: 'research-library', workspaceId: 'assistant', label: 'RESEARCH LIBRARY' },
  { terms: ['case desk panel', 'case status'], panelId: 'case-status', workspaceId: 'intelligence', label: 'CASE DESK PANEL' },
  { terms: ['data library', 'spreadsheet library'], panelId: 'data-library', workspaceId: 'intelligence', label: 'DATA LIBRARY' },
  { terms: ['map operations', 'geofences'], panelId: 'map-operations', workspaceId: 'live-ops', label: 'MAP OPERATIONS' },
  { terms: ['live news', 'news video'], panelId: 'live-news', workspaceId: 'watchtower', label: 'LIVE NEWS' },
  { terms: ['intel feed', 'intelligence feed'], panelId: 'intel', workspaceId: 'intelligence', label: 'INTEL FEED' },
  { terms: ['markets', 'market panel'], panelId: 'markets', workspaceId: 'global-pulse', label: 'MARKETS' },
  { terms: ['economic indicators', 'economy'], panelId: 'economic', workspaceId: 'global-pulse', label: 'ECONOMIC INDICATORS' },
  { terms: ['fires', 'wildfires', 'satellite fires'], panelId: 'satellite-fires', workspaceId: 'live-ops', label: 'SATELLITE FIRES' },
  { terms: ['command assistant', 'assistant panel'], panelId: 'command-assistant', workspaceId: 'assistant', label: 'COMMAND ASSISTANT' },
  { terms: ['research lab', 'multi agent research', 'analysis room panel'], panelId: 'multi-agent-research', workspaceId: 'assistant', label: 'AI RESEARCH LAB' },
  { terms: ['launch deck', 'applications panel', 'app launcher'], panelId: 'launch-deck', workspaceId: 'watchtower', label: 'LAUNCH DECK' },
];

const QUICK_ASSISTANT_COMMANDS: Array<{ terms: string[]; prompt: string; scope?: CommandContextScope; label: string }> = [
  {
    terms: ['brief the desk', 'brief desk', 'give me a briefing', 'situation briefing', 'situational briefing'],
    prompt: 'Create a concise situational briefing from the current desk. Separate confirmed signals, generated assessment, contradictions, and items requiring verification.',
    scope: 'workspace',
    label: 'DESK BRIEFING',
  },
  {
    terms: ['operations brief', 'operational briefing', 'brief live ops'],
    prompt: 'Review open alerts, watchlists, source health, geofences, and the event timeline. Identify what requires immediate analyst attention and cite supplied sources.',
    scope: 'workspace',
    label: 'OPERATIONS BRIEFING',
  },
  {
    terms: ['top five', 'five most important', 'top developments'],
    prompt: 'List the five most important developments visible in the current Watchtower context and explain why each matters. Cite supplied sources.',
    scope: 'workspace',
    label: 'TOP FIVE DEVELOPMENTS',
  },
  {
    terms: ['check ai insights', 'verify ai insights', 'cross check ai insights'],
    prompt: 'Compare AI Insights against the other supplied sources. Identify corroboration, contradictions, stale claims, and unsupported conclusions.',
    scope: 'insights',
    label: 'AI INSIGHTS REVIEW',
  },
  {
    terms: ['research brief', 'brief the research library'],
    prompt: 'Search the local research library for material relevant to the current situation. Summarize the strongest evidence, identify contradictions, and cite every document-based claim.',
    scope: 'research',
    label: 'RESEARCH BRIEFING',
  },
  {
    terms: ['cross check archive', 'compare with archive'],
    prompt: 'Cross-check current Watchtower signals against the local research library. Identify corroboration, conflicts, and unanswered questions.',
    scope: 'workspace-research',
    label: 'ARCHIVE CROSS-CHECK',
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePreferences(value: unknown): ProjectVVoicePreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES };
  const source = value as Partial<ProjectVVoicePreferences>;
  return {
    version: 1,
    language: typeof source.language === 'string' && source.language.trim() ? source.language.trim().slice(0, 24) : DEFAULT_PREFERENCES.language,
    voiceUri: typeof source.voiceUri === 'string' ? source.voiceUri.slice(0, 500) : '',
    rate: clamp(typeof source.rate === 'number' && Number.isFinite(source.rate) ? source.rate : DEFAULT_PREFERENCES.rate, 0.5, 1.8),
    pitch: clamp(typeof source.pitch === 'number' && Number.isFinite(source.pitch) ? source.pitch : DEFAULT_PREFERENCES.pitch, 0.5, 1.5),
    volume: clamp(typeof source.volume === 'number' && Number.isFinite(source.volume) ? source.volume : DEFAULT_PREFERENCES.volume, 0, 1),
    speakAssistantReplies: source.speakAssistantReplies === true,
    speakCommandConfirmations: source.speakCommandConfirmations !== false,
    autoSubmitDictation: source.autoSubmitDictation !== false,
  };
}

export function loadVoicePreferences(): ProjectVVoicePreferences {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveVoicePreferences(changes: Partial<ProjectVVoicePreferences>): ProjectVVoicePreferences {
  const next = normalizePreferences({ ...loadVoicePreferences(), ...changes, version: 1 });
  localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_EVENT, { detail: next }));
  return next;
}

export function subscribeVoicePreferences(listener: (settings: ProjectVVoicePreferences) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ProjectVVoicePreferences>).detail ?? loadVoicePreferences());
  window.addEventListener(VOICE_SETTINGS_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    if (event.key === VOICE_SETTINGS_KEY) listener(loadVoicePreferences());
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(VOICE_SETTINGS_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition || hasTauriInvokeBridge());
}

export function listSpeechVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().slice().sort((a, b) => {
    const localOrder = Number(b.localService) - Number(a.localService);
    return localOrder || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
  });
}

export function stripTextForSpeech(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    .replace(/https?:\/\/\S+/g, ' source link omitted ')
    .replace(/\[S\d+\]/g, '')
    .replace(/[#*_>`~\[\]()|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000);
}

export function cancelProjectVSpeech(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function speakProjectVText(value: string, override: Partial<ProjectVVoicePreferences> = {}): SpeechSynthesisUtterance | null {
  if (!('speechSynthesis' in window)) return null;
  const text = stripTextForSpeech(value);
  if (!text) return null;
  const settings = { ...loadVoicePreferences(), ...override };
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.language;
  utterance.rate = settings.rate;
  utterance.pitch = settings.pitch;
  utterance.volume = settings.volume;
  const voice = listSpeechVoices().find((candidate) => candidate.voiceURI === settings.voiceUri)
    ?? listSpeechVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(settings.language.toLowerCase().split('-')[0] ?? 'en'));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export class ProjectVSpeechRecognizer {
  private readonly onUpdate: (update: VoiceRecognitionUpdate) => void;
  private recognition: SpeechRecognitionLike | null = null;
  private state: VoiceRecognitionState = 'idle';
  private finalTranscript = '';
  private interimTranscript = '';
  private manuallyStopped = false;
  private nativeRequestId = 0;

  constructor(onUpdate: (update: VoiceRecognitionUpdate) => void) {
    this.onUpdate = onUpdate;
  }

  getState(): VoiceRecognitionState {
    return this.state;
  }

  start(language = loadVoicePreferences().language): void {
    if (this.state === 'listening' || this.state === 'starting') return;
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      if (hasTauriInvokeBridge()) {
        void this.startNativeWindowsRecognition(language);
        return;
      }
      this.update({ state: 'unsupported', error: 'Speech recognition is not available in this WebView or browser. You can still type a command into the Voice Console.' });
      return;
    }
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.manuallyStopped = false;
    this.recognition = new Constructor();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = language;
    this.recognition.onstart = () => this.update({ state: 'listening' });
    this.recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const transcript = result[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (result.isFinal) this.finalTranscript = `${this.finalTranscript} ${transcript}`.trim();
        else interim = `${interim} ${transcript}`.trim();
      }
      this.interimTranscript = interim;
      this.update({
        state: this.finalTranscript ? 'processing' : 'listening',
        transcript: this.finalTranscript,
        interimTranscript: this.interimTranscript,
        final: Boolean(this.finalTranscript),
      });
    };
    this.recognition.onerror = (event) => {
      const code = event.error || event.message || 'unknown';
      if (code === 'aborted' && this.manuallyStopped) {
        this.update({ state: 'idle' });
        return;
      }
      const message = code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Microphone permission was denied. Allow microphone access for Project V Watchtower, then try again.'
        : code === 'no-speech'
          ? 'No speech was detected. Hold the button, speak clearly, and try again.'
          : `Speech recognition failed: ${code}.`;
      this.update({ state: 'error', error: message });
    };
    this.recognition.onend = () => {
      const transcript = this.finalTranscript.trim();
      if (transcript) {
        this.update({ state: 'idle', transcript, interimTranscript: '', final: true });
      } else if (this.state !== 'error' && this.state !== 'unsupported') {
        this.update({ state: 'idle' });
      }
      this.recognition = null;
    };
    this.update({ state: 'starting' });
    try {
      this.recognition.start();
    } catch (error) {
      this.recognition = null;
      this.update({ state: 'error', error: error instanceof Error ? error.message : 'Unable to start speech recognition.' });
    }
  }

  stop(): void {
    this.manuallyStopped = true;
    this.nativeRequestId += 1;
    try { this.recognition?.stop(); } catch { /* best effort */ }
    if (!this.recognition) this.update({ state: 'idle' });
  }

  abort(): void {
    this.manuallyStopped = true;
    this.nativeRequestId += 1;
    try { this.recognition?.abort(); } catch { /* best effort */ }
    this.recognition = null;
    this.update({ state: 'idle' });
  }

  destroy(): void {
    this.abort();
  }

  private async startNativeWindowsRecognition(language: string): Promise<void> {
    const requestId = ++this.nativeRequestId;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.manuallyStopped = false;
    this.update({ state: 'starting' });
    await Promise.resolve();
    if (requestId !== this.nativeRequestId) return;
    this.update({ state: 'listening' });
    try {
      const transcript = (await invokeTauri<string>('recognize_windows_speech', { language })).trim();
      if (requestId !== this.nativeRequestId || this.manuallyStopped) return;
      if (!transcript) {
        this.update({ state: 'error', error: 'No speech was detected by the Windows speech recognizer.' });
        return;
      }
      this.finalTranscript = transcript;
      this.interimTranscript = '';
      this.update({ state: 'idle', transcript, interimTranscript: '', final: true });
    } catch (error) {
      if (requestId !== this.nativeRequestId || this.manuallyStopped) return;
      this.update({
        state: 'error',
        error: error instanceof Error
          ? error.message
          : 'Windows speech recognition is unavailable. Install a matching Windows speech language or use typed command mode.',
      });
    }
  }

  private update(partial: Partial<VoiceRecognitionUpdate> & Pick<VoiceRecognitionUpdate, 'state'>): void {
    this.state = partial.state;
    this.onUpdate({
      state: partial.state,
      transcript: partial.transcript ?? this.finalTranscript,
      interimTranscript: partial.interimTranscript ?? this.interimTranscript,
      final: partial.final ?? false,
      error: partial.error,
    });
  }
}

function normalizeTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9\s'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(term));
}

export function interpretProjectVVoiceCommand(rawTranscript: string): ProjectVVoiceIntent {
  const transcript = rawTranscript.trim();
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { kind: 'unknown', label: 'NO COMMAND', transcript };

  if (containsAny(normalized, ['stop speaking', 'be quiet', 'silence voice', 'cancel speech'])) {
    return { kind: 'stop-speaking', label: 'STOP SPEAKING' };
  }
  if (containsAny(normalized, ['read last response', 'read the last response', 'repeat the last answer', 'read last answer'])) {
    return { kind: 'read-last', label: 'READ LAST RESPONSE' };
  }

  if (containsAny(normalized, [
    'delete case', 'delete workspace', 'reset workspace', 'clear all data', 'erase research',
    'send message', 'send a message', 'post message', 'post a message',
    'make a call', 'place a call', 'call someone',
  ])) {
    return {
      kind: 'unsupported-sensitive',
      label: 'SENSITIVE ACTION BLOCKED',
      reason: 'Voice control does not delete data, reset workspaces, send communications, place calls, or execute destructive actions. Use the visible controls and confirm manually.',
    };
  }

  if (containsAny(normalized, ['lock watchtower', 'lock command deck', 'lock the deck', 'project lock'])) {
    return { kind: 'lock', label: 'LOCK WATCHTOWER', requiresConfirmation: true };
  }

  for (const command of QUICK_ASSISTANT_COMMANDS) {
    if (containsAny(normalized, command.terms)) {
      return { kind: 'assistant', prompt: command.prompt, scope: command.scope, speakReply: true };
    }
  }

  const askPrefixes = [
    'ask watchtower ', 'ask the assistant ', 'ask assistant ', 'ask v ', 'tell me ', 'analyze ', 'investigate ', 'explain ',
  ];
  for (const prefix of askPrefixes) {
    if (normalized.startsWith(prefix)) {
      const originalOffset = rawTranscript.toLowerCase().indexOf(prefix.trim());
      const prompt = originalOffset >= 0
        ? rawTranscript.slice(originalOffset + prefix.trim().length).replace(/^[\s,:-]+/, '').trim()
        : transcript;
      if (prompt) return { kind: 'assistant', prompt, scope: 'workspace', speakReply: true };
    }
  }

  if (containsAny(normalized, ['open api keys', 'api settings', 'open data settings'])) {
    return { kind: 'settings', label: 'API KEYS' };
  }
  if (containsAny(normalized, ['open security center', 'security center', 'open security'])) {
    return { kind: 'security', label: 'SECURITY CENTER' };
  }
  if (containsAny(normalized, ['show alerts', 'open alerts', 'critical alerts'])) {
    return { kind: 'alerts', label: 'ALERT CENTER' };
  }

  if (containsAny(normalized, ['open case desk', 'show case desk', 'launch case desk'])) {
    return { kind: 'window', windowType: 'case-desk', label: 'CASE DESK' };
  }
  if (containsAny(normalized, ['open data desk', 'show data desk', 'launch data desk', 'open spreadsheet'])) {
    return { kind: 'window', windowType: 'data-desk', label: 'DATA DESK' };
  }
  if (containsAny(normalized, ['open map desk', 'show map desk', 'launch map operations'])) {
    return { kind: 'window', windowType: 'map-operations', label: 'MAP DESK' };
  }
  if (containsAny(normalized, ['open assistant window', 'pop out assistant', 'launch assistant window'])) {
    return { kind: 'window', windowType: 'assistant-desk', label: 'ASSISTANT WINDOW' };
  }
  if (containsAny(normalized, ['open analysis room', 'open research room', 'launch analysis room', 'multi agent research'])) {
    return { kind: 'window', windowType: 'analysis-room', label: 'ANALYSIS ROOM' };
  }
  if (containsAny(normalized, ['open launch deck', 'show launch deck', 'open applications', 'launch applications'])) {
    return { kind: 'window', windowType: 'launch-desk', label: 'LAUNCH DECK' };
  }
  if (containsAny(normalized, ['open camera wall', 'show camera wall', 'launch camera wall', 'open stream wall'])) {
    return { kind: 'window', windowType: 'camera-desk', label: 'CAMERA WALL' };
  }
  if (containsAny(normalized, ['open osint desk', 'open osint tools', 'show osint tools', 'launch osint desk'])) {
    return { kind: 'window', windowType: 'osint-desk', label: 'OSINT DESK' };
  }

  if (containsAny(normalized, ['open', 'switch to', 'go to', 'show'])) {
    for (const workspace of WORKSPACE_ALIASES) {
      if (containsAny(normalized, workspace.terms)) {
        return { kind: 'workspace', workspaceId: workspace.workspaceId, label: workspace.label };
      }
    }
  }

  if (containsAny(normalized, ['map', 'theater', 'region', 'zoom'])) {
    for (const map of MAP_ALIASES) {
      if (containsAny(normalized, map.terms)) return map.view;
    }
  }

  for (const panel of PANEL_ALIASES) {
    if (containsAny(normalized, panel.terms) && containsAny(normalized, ['open', 'show', 'jump', 'go to', 'display'])) {
      return { kind: 'panel', panelId: panel.panelId, workspaceId: panel.workspaceId, label: panel.label };
    }
  }

  return { kind: 'unknown', label: 'COMMAND NOT RECOGNIZED', transcript };
}

export function formatVoiceIntent(intent: ProjectVVoiceIntent): string {
  switch (intent.kind) {
    case 'assistant': return 'SEND TO LOCAL AI';
    case 'workspace': return `OPEN ${intent.label}`;
    case 'map-view': return `SHOW ${intent.label}`;
    case 'panel': return `SHOW ${intent.label}`;
    case 'window': return `OPEN ${intent.label}`;
    case 'settings':
    case 'security':
    case 'alerts':
    case 'lock':
    case 'stop-speaking':
    case 'read-last': return intent.label;
    case 'unsupported-sensitive': return intent.label;
    default: return intent.label;
  }
}
