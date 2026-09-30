export const LIVE_REFRESH_REQUEST_EVENT = 'project-v-live-refresh-request';
export const LIVE_REFRESH_COMPLETE_EVENT = 'project-v-live-refresh-complete';

export interface LiveRefreshRequestDetail {
  requestId: string;
}

export interface LiveRefreshCompleteDetail {
  requestId: string;
  refreshedAt: number;
  error?: string;
}

export async function requestLiveContextRefresh(timeoutMs = 45_000): Promise<LiveRefreshCompleteDetail> {
  const requestId = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return new Promise<LiveRefreshCompleteDetail>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener(LIVE_REFRESH_COMPLETE_EVENT, handler as EventListener);
      reject(new Error('Live-source refresh timed out. The assistant can still use the most recently loaded Watchtower data.'));
    }, timeoutMs);
    const handler = (event: CustomEvent<LiveRefreshCompleteDetail>) => {
      if (event.detail?.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener(LIVE_REFRESH_COMPLETE_EVENT, handler as EventListener);
      if (event.detail.error) reject(new Error(event.detail.error));
      else resolve(event.detail);
    };
    window.addEventListener(LIVE_REFRESH_COMPLETE_EVENT, handler as EventListener);
    window.dispatchEvent(new CustomEvent<LiveRefreshRequestDetail>(LIVE_REFRESH_REQUEST_EVENT, { detail: { requestId } }));
  });
}
