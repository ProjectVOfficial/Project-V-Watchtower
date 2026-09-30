import { getRuntimeConfigSnapshot, secretsReady } from './runtime-config';
import { fetchOllamaModels } from './ollama-models';

export type CommandRole = 'system' | 'user' | 'assistant';

export interface CommandMessage {
  role: CommandRole;
  content: string;
}

export interface LocalAiConfig {
  url: string;
  model: string;
}

export interface LocalAiStatus {
  configured: boolean;
  connected: boolean;
  url: string;
  model: string;
  availableModels: string[];
  message: string;
}

export interface StreamCommandOptions {
  messages: CommandMessage[];
  onToken: (token: string) => void;
  signal?: AbortSignal;
  temperature?: number;
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function getLocalAiConfig(): Promise<LocalAiConfig> {
  await secretsReady;
  const snapshot = getRuntimeConfigSnapshot();
  return {
    url: cleanBaseUrl(snapshot.secrets.OLLAMA_API_URL?.value ?? ''),
    model: snapshot.secrets.OLLAMA_MODEL?.value?.trim() ?? '',
  };
}

export async function inspectLocalAi(): Promise<LocalAiStatus> {
  const config = await getLocalAiConfig();
  if (!config.url || !config.model) {
    return {
      configured: false,
      connected: false,
      url: config.url,
      model: config.model,
      availableModels: [],
      message: 'Configure the Ollama server URL and model in API Keys.',
    };
  }

  const availableModels = await fetchOllamaModels(config.url);
  const connected = availableModels.length > 0;
  const exact = availableModels.some((model) => model === config.model || model.startsWith(`${config.model}:`));
  return {
    configured: true,
    connected,
    url: config.url,
    model: config.model,
    availableModels,
    message: connected
      ? exact || availableModels.includes(config.model)
        ? `Connected to ${config.model}`
        : `Connected; selected model ${config.model} was not listed by the server.`
      : 'The local AI server did not respond. Confirm Ollama is running and permits this app origin.',
  };
}

function endpoint(base: string, path: string): string {
  const url = new URL(base);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${normalizedPath}${path}`.replace(/\/+/g, '/');
  return url.toString();
}

async function errorMessage(response: Response): Promise<string> {
  const copy = response.clone();
  try {
    const data = await copy.json() as { error?: string | { message?: string }; message?: string };
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error.message === 'string') return data.error.message;
    if (typeof data.message === 'string') return data.message;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) return text.trim().slice(0, 500);
    } catch { /* ignore */ }
  }
  return `${response.status} ${response.statusText}`.trim();
}

async function streamOllamaNative(config: LocalAiConfig, options: StreamCommandOptions): Promise<void> {
  const nativeBase = config.url.replace(/\/v1\/?$/i, '');
  const response = await fetch(endpoint(nativeBase, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.2,
        num_ctx: 8192,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) throw new Error(await errorMessage(response));
  if (!response.body) throw new Error('The Ollama response did not include a stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const data = JSON.parse(trimmed) as { message?: { content?: string }; response?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const token = data.message?.content ?? data.response ?? '';
      if (token) options.onToken(token);
    }
  }
  if (buffer.trim()) {
    const data = JSON.parse(buffer) as { message?: { content?: string }; response?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const token = data.message?.content ?? data.response ?? '';
    if (token) options.onToken(token);
  }
}

async function streamOpenAiCompatible(config: LocalAiConfig, options: StreamCommandOptions): Promise<void> {
  const base = config.url.endsWith('/v1') ? config.url : `${config.url}/v1`;
  const response = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      stream: true,
      temperature: options.temperature ?? 0.2,
    }),
    signal: options.signal,
  });

  if (!response.ok) throw new Error(await errorMessage(response));
  if (!response.body) throw new Error('The OpenAI-compatible response did not include a stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; text?: string }>; error?: { message?: string } };
      if (data.error?.message) throw new Error(data.error.message);
      const token = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.text ?? '';
      if (token) options.onToken(token);
    }
  }
}

export async function streamLocalCommand(options: StreamCommandOptions): Promise<LocalAiConfig> {
  const config = await getLocalAiConfig();
  if (!config.url || !config.model) throw new Error('Ollama is not configured. Open API Keys and set OLLAMA_API_URL and OLLAMA_MODEL.');

  const prefersOpenAi = /\/v1\/?$/i.test(config.url);
  const attempts = prefersOpenAi
    ? [streamOpenAiCompatible, streamOllamaNative]
    : [streamOllamaNative, streamOpenAiCompatible];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    let emitted = 0;
    try {
      await attempt(config, {
        ...options,
        onToken: (token) => {
          emitted += token.length;
          options.onToken(token);
        },
      });
      return config;
    } catch (error) {
      if (options.signal?.aborted || emitted > 0) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Local AI request failed.');
}
