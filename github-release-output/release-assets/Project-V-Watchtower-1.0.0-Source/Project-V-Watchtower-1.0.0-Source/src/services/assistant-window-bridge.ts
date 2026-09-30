import type { AppContext } from '@/app/app-context';
import { collectCommandContext, type CollectedCommandContext, type CommandContextScope } from './command-context';

export const ASSISTANT_BRIDGE_CHANNEL = 'project-v-assistant-bridge-v1';

export interface AssistantContextRequest {
  type: 'context-request';
  requestId: string;
  scope: CommandContextScope;
  query: string;
  refreshLive: boolean;
}

export interface AssistantContextResponse {
  type: 'context-response';
  requestId: string;
  context?: CollectedCommandContext;
  refreshedAt?: number;
  error?: string;
}

export class AssistantWindowBridge {
  private readonly ctx: AppContext;
  private readonly refreshLive: () => Promise<void>;
  private channel: BroadcastChannel | null = null;

  constructor(ctx: AppContext, refreshLive: () => Promise<void>) {
    this.ctx = ctx;
    this.refreshLive = refreshLive;
  }

  start(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(ASSISTANT_BRIDGE_CHANNEL);
    this.channel.addEventListener('message', this.onMessage);
  }

  destroy(): void {
    this.channel?.removeEventListener('message', this.onMessage);
    this.channel?.close();
    this.channel = null;
  }

  private onMessage = (event: MessageEvent<AssistantContextRequest>): void => {
    const request = event.data;
    if (!request || request.type !== 'context-request' || typeof request.requestId !== 'string') return;
    void this.respond(request);
  };

  private async respond(request: AssistantContextRequest): Promise<void> {
    const response: AssistantContextResponse = { type: 'context-response', requestId: request.requestId };
    try {
      if (request.refreshLive) {
        await this.refreshLive();
        response.refreshedAt = Date.now();
      }
      response.context = await collectCommandContext(this.ctx, request.scope, request.query);
    } catch (error) {
      response.error = error instanceof Error ? error.message : 'Unable to collect Watchtower context.';
    }
    this.channel?.postMessage(response);
  }
}

export async function requestAssistantWindowContext(
  scope: CommandContextScope,
  query: string,
  refreshLive: boolean,
  timeoutMs = 45_000,
): Promise<AssistantContextResponse> {
  if (typeof BroadcastChannel === 'undefined') throw new Error('Cross-window context is not supported by this runtime.');
  const channel = new BroadcastChannel(ASSISTANT_BRIDGE_CHANNEL);
  const requestId = `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return new Promise<AssistantContextResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      channel.close();
      reject(new Error('The primary Watchtower window did not answer the context request. Keep the command deck open and try again.'));
    }, timeoutMs);
    channel.addEventListener('message', (event: MessageEvent<AssistantContextResponse>) => {
      if (event.data?.type !== 'context-response' || event.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      channel.close();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    });
    channel.postMessage({ type: 'context-request', requestId, scope, query, refreshLive } satisfies AssistantContextRequest);
  });
}
