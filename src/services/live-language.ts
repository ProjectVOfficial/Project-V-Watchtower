export type LiveLanguageSource = 'system' | 'microphone';
export type LiveLanguageDisplayMode = 'captions' | 'transcript' | 'both';
export type LiveLanguageTarget = 'original' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ar' | 'ru' | 'uk' | 'zh' | 'ja' | 'ko';

export interface LiveLanguageSettings {
  source: LiveLanguageSource;
  target: LiveLanguageTarget;
  displayMode: LiveLanguageDisplayMode;
  saveTranscript: boolean;
}

export interface LiveLanguageEntry {
  id: string;
  createdAt: number;
  original: string;
  translated: string;
  target: LiveLanguageTarget;
  translating: boolean;
}

export interface LiveLanguageSnapshot {
  settings: LiveLanguageSettings;
  entries: LiveLanguageEntry[];
  running: boolean;
  loadingModel: boolean;
  modelReady: boolean;
  status: string;
  error: string;
}

type Listener = (snapshot: LiveLanguageSnapshot) => void;
type WhisperRunner = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>;

type LiveLanguageChannelMessage =
  | { type: 'snapshot'; snapshot: LiveLanguageSnapshot }
  | { type: 'request-snapshot' }
  | { type: 'open-panel' };

const SETTINGS_KEY = 'project-v-live-language-settings-v1';
const TRANSCRIPT_KEY = 'project-v-live-language-transcript-v1';
const CHANNEL_NAME = 'project-v-live-language';
const MODEL_ID = 'Xenova/whisper-tiny';
const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 7;
const MIN_CHUNK_SECONDS = 1.4;
const MAX_TRANSCRIPT_ENTRIES = 250;
const MAX_QUEUE = 3;

export const LIVE_LANGUAGE_TARGETS: ReadonlyArray<{ id: LiveLanguageTarget; label: string }> = [
  { id: 'original', label: 'Original language' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ar', label: 'Arabic' },
  { id: 'ru', label: 'Russian' },
  { id: 'uk', label: 'Ukrainian' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
];

const DEFAULT_SETTINGS: LiveLanguageSettings = {
  source: 'system',
  target: 'en',
  displayMode: 'both',
  saveTranscript: false,
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function cleanSettings(value: Partial<LiveLanguageSettings> | null | undefined): LiveLanguageSettings {
  const source: LiveLanguageSource = value?.source === 'microphone' ? 'microphone' : 'system';
  const requestedTarget = value?.target;
  const target: LiveLanguageTarget = requestedTarget && LIVE_LANGUAGE_TARGETS.some((item) => item.id === requestedTarget)
    ? requestedTarget
    : 'en';
  const displayMode: LiveLanguageDisplayMode = value?.displayMode === 'captions' || value?.displayMode === 'transcript'
    ? value.displayMode
    : 'both';
  return { source, target, displayMode, saveTranscript: value?.saveTranscript === true };
}

function loadSettings(): LiveLanguageSettings {
  return cleanSettings(safeParse<Partial<LiveLanguageSettings>>(localStorage.getItem(SETTINGS_KEY), DEFAULT_SETTINGS));
}

function loadTranscript(): LiveLanguageEntry[] {
  const value = safeParse<LiveLanguageEntry[]>(localStorage.getItem(TRANSCRIPT_KEY), []);
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item.original === 'string' && typeof item.createdAt === 'number').slice(-MAX_TRANSCRIPT_ENTRIES)
    : [];
}

function targetLabel(target: LiveLanguageTarget): string {
  return LIVE_LANGUAGE_TARGETS.find((item) => item.id === target)?.label ?? 'English';
}

function cloneSnapshot(snapshot: LiveLanguageSnapshot): LiveLanguageSnapshot {
  return {
    ...snapshot,
    settings: { ...snapshot.settings },
    entries: snapshot.entries.map((entry) => ({ ...entry })),
  };
}

let snapshot: LiveLanguageSnapshot = {
  settings: loadSettings(),
  entries: loadTranscript(),
  running: false,
  loadingModel: false,
  modelReady: false,
  status: 'LIVE LANGUAGE READY',
  error: '',
};

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let whisperRunnerPromise: Promise<WhisperRunner> | null = null;
let captureStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioSourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let silentGain: GainNode | null = null;
let audioParts: Float32Array[] = [];
let bufferedSamples = 0;
let audioQueue: Float32Array[] = [];
let processingQueue = false;
let stoppedByUser = false;

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (event: MessageEvent<LiveLanguageChannelMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'request-snapshot') {
      publishSnapshot();
      return;
    }
    if (message.type === 'snapshot') {
      const incoming = message.snapshot;
      if (!incoming || typeof incoming.status !== 'string') return;
      snapshot = cloneSnapshot(incoming);
      notify(false);
      return;
    }
    if (message.type === 'open-panel') {
      window.dispatchEvent(new CustomEvent('project-v-live-language-open'));
    }
  });
  channel.postMessage({ type: 'request-snapshot' } satisfies LiveLanguageChannelMessage);
  return channel;
}

function persist(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot.settings));
  if (snapshot.settings.saveTranscript) localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(snapshot.entries.slice(-MAX_TRANSCRIPT_ENTRIES)));
  else localStorage.removeItem(TRANSCRIPT_KEY);
}

function publishSnapshot(): void {
  ensureChannel()?.postMessage({ type: 'snapshot', snapshot: cloneSnapshot(snapshot) } satisfies LiveLanguageChannelMessage);
}

function notify(shouldBroadcast = true): void {
  persist();
  const current = cloneSnapshot(snapshot);
  listeners.forEach((listener) => listener(current));
  window.dispatchEvent(new CustomEvent('project-v-live-language-change', { detail: current }));
  if (shouldBroadcast) publishSnapshot();
}

export function getLiveLanguageSnapshot(): LiveLanguageSnapshot {
  ensureChannel();
  return cloneSnapshot(snapshot);
}

export function subscribeLiveLanguage(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  listener(cloneSnapshot(snapshot));
  return () => listeners.delete(listener);
}

export function updateLiveLanguageSettings(patch: Partial<LiveLanguageSettings>): LiveLanguageSnapshot {
  snapshot.settings = cleanSettings({ ...snapshot.settings, ...patch });
  notify();
  return cloneSnapshot(snapshot);
}

export function clearLiveLanguageTranscript(): void {
  snapshot.entries = [];
  localStorage.removeItem(TRANSCRIPT_KEY);
  notify();
}

export function requestLiveLanguagePanel(): void {
  window.dispatchEvent(new CustomEvent('project-v-live-language-open'));
  ensureChannel()?.postMessage({ type: 'open-panel' } satisfies LiveLanguageChannelMessage);
}

export function exportLiveLanguageTranscript(): void {
  const header = `PROJECT V // WATCHTOWER — LIVE LANGUAGE TRANSCRIPT\nExported: ${new Date().toISOString()}\nTarget: ${targetLabel(snapshot.settings.target)}\n\n`;
  const lines = snapshot.entries.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleTimeString();
    const translation = entry.translated && entry.translated !== entry.original ? `\n  → ${entry.translated}` : '';
    return `[${time}] ${entry.original}${translation}`;
  });
  const blob = new Blob([header, lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `project-v-live-language-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}


function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ll-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as { text?: unknown };
  return typeof record.text === 'string' ? record.text.trim() : '';
}

async function getWhisperRunner(): Promise<WhisperRunner> {
  if (whisperRunnerPromise) return whisperRunnerPromise;
  snapshot.loadingModel = true;
  snapshot.status = 'LOADING LOCAL WHISPER MODEL…';
  snapshot.error = '';
  notify();

  whisperRunnerPromise = (async () => {
    const transformers = await import('@huggingface/transformers');

    // Live Language uses the maintained @huggingface/transformers runtime. The older
    // @xenova/transformers 2.x loader can mis-handle model JSON with modern bundlers
    // and surface an HTML fallback as JSON ("Unexpected token '<'"). Keep Live
    // Language on remote Hub models with browser caching; the legacy Watchtower ML
    // worker remains untouched for now.
    const runtimeEnv = (transformers as unknown as {
      env?: {
        allowLocalModels?: boolean;
        allowRemoteModels?: boolean;
        useBrowserCache?: boolean;
      };
    }).env;
    if (runtimeEnv) {
      runtimeEnv.allowLocalModels = false;
      runtimeEnv.allowRemoteModels = true;
      runtimeEnv.useBrowserCache = true;
    }

    const pipelineFactory = transformers.pipeline as unknown as (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<WhisperRunner>;
    const runner = await pipelineFactory('automatic-speech-recognition', MODEL_ID, { dtype: 'q8' });
    snapshot.loadingModel = false;
    snapshot.modelReady = true;
    snapshot.status = snapshot.running ? 'LISTENING · LOCAL WHISPER READY' : 'LOCAL WHISPER READY';
    snapshot.error = '';
    notify();
    return runner;
  })().catch((error: unknown) => {
    whisperRunnerPromise = null;
    snapshot.loadingModel = false;
    snapshot.modelReady = false;
    snapshot.error = error instanceof Error ? error.message : 'Unable to load the local Whisper model.';
    snapshot.status = 'WHISPER MODEL ERROR';
    notify();
    throw error;
  });

  return whisperRunnerPromise;
}

function downsample(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let index = start; index < Math.max(start + 1, end); index += 1) {
      sum += input[Math.min(index, input.length - 1)] ?? 0;
      count += 1;
    }
    output[i] = count ? sum / count : 0;
  }
  return output;
}

function rms(audio: Float32Array): number {
  if (!audio.length) return 0;
  let total = 0;
  for (let i = 0; i < audio.length; i += 1) total += audio[i]! * audio[i]!;
  return Math.sqrt(total / audio.length);
}

function mergeParts(parts: Float32Array[], total: number): Float32Array {
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function flushAudioBuffer(force = false): void {
  const minimum = Math.round(MIN_CHUNK_SECONDS * TARGET_SAMPLE_RATE);
  if (bufferedSamples < minimum || (!force && bufferedSamples < CHUNK_SECONDS * TARGET_SAMPLE_RATE)) return;
  const chunk = mergeParts(audioParts, bufferedSamples);
  audioParts = [];
  bufferedSamples = 0;
  if (rms(chunk) < 0.004) return;
  audioQueue.push(chunk);
  if (audioQueue.length > MAX_QUEUE) audioQueue = audioQueue.slice(-MAX_QUEUE);
  void drainAudioQueue();
}

function addTranscript(original: string): LiveLanguageEntry | null {
  const cleaned = original.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const last = snapshot.entries.length ? snapshot.entries[snapshot.entries.length - 1] : undefined;
  if (last && last.original.toLocaleLowerCase() === cleaned.toLocaleLowerCase() && Date.now() - last.createdAt < 15_000) return null;
  const entry: LiveLanguageEntry = {
    id: makeId(),
    createdAt: Date.now(),
    original: cleaned,
    translated: snapshot.settings.target === 'original' ? cleaned : '',
    target: snapshot.settings.target,
    translating: snapshot.settings.target !== 'original',
  };
  snapshot.entries = [...snapshot.entries, entry].slice(-MAX_TRANSCRIPT_ENTRIES);
  snapshot.status = 'TRANSCRIBING · LIVE';
  snapshot.error = '';
  notify();
  if (entry.translating) void translateEntry(entry.id, cleaned, entry.target);
  return entry;
}

async function translateEntry(id: string, text: string, target: LiveLanguageTarget): Promise<void> {
  let translated = '';
  try {
    const { streamLocalCommand } = await import('./local-ai-command');
    await streamLocalCommand({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are Project V Live Language. Translate the user's transcript into ${targetLabel(target)}. Return only the translated text. Preserve names, numbers, URLs, acronyms, uncertainty, and meaning. Do not add commentary.`,
        },
        { role: 'user', content: text },
      ],
      onToken: (token) => { translated += token; },
    });
  } catch {
    translated = '';
  }
  const index = snapshot.entries.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const next = [...snapshot.entries];
  const current = next[index]!;
  next[index] = {
    ...current,
    translated: translated.trim() || current.original,
    translating: false,
  };
  snapshot.entries = next;
  notify();
}

async function drainAudioQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;
  try {
    while (audioQueue.length) {
      const audio = audioQueue.shift();
      if (!audio) continue;
      try {
        const runner = await getWhisperRunner();
        const result = await runner(audio, {
          chunk_length_s: 20,
          stride_length_s: 2,
          return_timestamps: false,
        });
        addTranscript(normalizeText(result));
      } catch (error) {
        snapshot.error = error instanceof Error ? error.message : 'Local transcription failed.';
        snapshot.status = 'TRANSCRIPTION ERROR';
        notify();
      }
    }
  } finally {
    processingQueue = false;
    if (snapshot.running && !snapshot.error) {
      snapshot.status = snapshot.modelReady ? 'LISTENING · LOCAL WHISPER READY' : 'LISTENING';
      notify();
    }
  }
}

async function obtainCaptureStream(source: LiveLanguageSource): Promise<MediaStream> {
  if (!navigator.mediaDevices) throw new Error('Media capture is unavailable in this Watchtower runtime.');
  if (source === 'microphone') {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  }
  if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    throw new Error('Shared/system audio capture is unavailable. Switch Live Language SOURCE to MICROPHONE.');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('No shared audio track was provided. Re-open capture and enable “Share audio” for the Watchtower, Camera Wall, or communications window.');
  }
  return stream;
}

function cleanupCaptureNodes(): void {
  processorNode?.disconnect();
  audioSourceNode?.disconnect();
  silentGain?.disconnect();
  processorNode = null;
  audioSourceNode = null;
  silentGain = null;
  if (audioContext) void audioContext.close().catch(() => undefined);
  audioContext = null;
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
}

export async function startLiveLanguageCapture(): Promise<void> {
  if (snapshot.running) return;
  stoppedByUser = false;
  audioParts = [];
  bufferedSamples = 0;
  snapshot.error = '';
  snapshot.status = snapshot.settings.source === 'system' ? 'SELECT A WINDOW AND ENABLE SHARE AUDIO…' : 'REQUESTING MICROPHONE…';
  notify();

  try {
    const stream = await obtainCaptureStream(snapshot.settings.source);
    captureStream = stream;
    const ContextCtor = window.AudioContext;
    audioContext = new ContextCtor();
    audioSourceNode = audioContext.createMediaStreamSource(stream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!snapshot.running || !audioContext) return;
      const input = event.inputBuffer.getChannelData(0);
      const part = downsample(new Float32Array(input), audioContext.sampleRate);
      audioParts.push(part);
      bufferedSamples += part.length;
      flushAudioBuffer(false);
    };

    audioSourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (!stoppedByUser && snapshot.running) stopLiveLanguageCapture('CAPTURE ENDED');
      }, { once: true });
    });

    snapshot.running = true;
    snapshot.status = 'LISTENING · PREPARING LOCAL WHISPER';
    snapshot.error = '';
    notify();
    void getWhisperRunner();
  } catch (error) {
    cleanupCaptureNodes();
    snapshot.running = false;
    snapshot.loadingModel = false;
    snapshot.status = 'CAPTURE NOT STARTED';
    snapshot.error = error instanceof Error ? error.message : 'Unable to start Live Language capture.';
    notify();
    throw error;
  }
}

export function stopLiveLanguageCapture(status = 'LIVE LANGUAGE PAUSED'): void {
  stoppedByUser = true;
  flushAudioBuffer(true);
  audioParts = [];
  bufferedSamples = 0;
  cleanupCaptureNodes();
  snapshot.running = false;
  snapshot.status = status;
  notify();
}

export function mountLiveLanguageOverlay(root: HTMLElement = document.body): () => void {
  ensureChannel();
  const existing = root.querySelector<HTMLElement>('[data-live-language-overlay]');
  if (existing) existing.remove();
  const overlay = document.createElement('section');
  overlay.className = 'v-live-language-overlay';
  overlay.dataset.liveLanguageOverlay = '1';
  overlay.setAttribute('aria-live', 'polite');
  root.appendChild(overlay);

  const render = (state: LiveLanguageSnapshot) => {
    const visible = state.settings.displayMode === 'captions' || state.settings.displayMode === 'both';
    const entry = state.entries.length ? state.entries[state.entries.length - 1] : undefined;
    overlay.classList.toggle('visible', Boolean(visible && state.running && entry));
    if (!visible || !entry) {
      overlay.innerHTML = '';
      return;
    }
    const translation = entry.translating ? 'TRANSLATING…' : entry.translated;
    overlay.innerHTML = `<div class="v-live-language-overlay-tag">LIVE LANGUAGE · ${targetLabel(entry.target).toUpperCase()}</div><div class="v-live-language-overlay-original"></div>${translation && translation !== entry.original ? '<div class="v-live-language-overlay-translation"></div>' : ''}`;
    overlay.querySelector<HTMLElement>('.v-live-language-overlay-original')!.textContent = entry.original;
    const translationEl = overlay.querySelector<HTMLElement>('.v-live-language-overlay-translation');
    if (translationEl) translationEl.textContent = translation;
  };

  const cleanup = subscribeLiveLanguage(render);
  return () => {
    cleanup();
    overlay.remove();
  };
}

export function installLiveLanguageOpenBridge(onOpen: () => void): () => void {
  ensureChannel();
  const handler = () => onOpen();
  window.addEventListener('project-v-live-language-open', handler);
  return () => window.removeEventListener('project-v-live-language-open', handler);
}
