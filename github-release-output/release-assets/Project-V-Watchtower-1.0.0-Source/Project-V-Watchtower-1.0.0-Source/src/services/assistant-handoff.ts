import type { CommandContextScope } from './command-context';
import { openProjectVWorkspaceWindow } from './workspace-windows';

export interface AssistantHandoff {
  id: string;
  prompt: string;
  scope: CommandContextScope;
  speakReply: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'project-v-assistant-pending-handoff-v1';
const CHANNEL_NAME = 'project-v-assistant-handoff';

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
} catch { /* optional */ }

function cleanPrompt(value: string): string {
  return value.replace(/\u0000/g, '').trim().slice(0, 8000);
}

export async function sendPromptToAssistant(
  prompt: string,
  scope: CommandContextScope = 'workspace',
  speakReply = false,
): Promise<void> {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return;
  const handoff: AssistantHandoff = {
    id: `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    prompt: cleaned,
    scope,
    speakReply,
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  channel?.postMessage(handoff);
  await openProjectVWorkspaceWindow('assistant-desk');
}

export function consumeAssistantHandoff(): AssistantHandoff | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<AssistantHandoff>;
    if (!parsed.id || typeof parsed.prompt !== 'string' || typeof parsed.createdAt !== 'number') return null;
    if (Date.now() - parsed.createdAt > 5 * 60_000) return null;
    return {
      id: parsed.id,
      prompt: cleanPrompt(parsed.prompt),
      scope: parsed.scope ?? 'workspace',
      speakReply: parsed.speakReply === true,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function subscribeAssistantHandoff(listener: (handoff: AssistantHandoff) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    const value = event.data as AssistantHandoff | null;
    if (!value?.id || !value.prompt) return;
    listener(value);
  };
  channel?.addEventListener('message', onMessage);
  return () => channel?.removeEventListener('message', onMessage);
}
