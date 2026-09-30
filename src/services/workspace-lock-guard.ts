const LOCK_KEY = 'project-v-command-lock-v1';
const CHANNEL_NAME = 'project-v-security-events';

interface LockRecord { locked: boolean; at: number }

function readLock(): boolean {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCK_KEY) ?? 'null') as LockRecord | null;
    return Boolean(parsed?.locked);
  } catch {
    return false;
  }
}

function renderOverlay(locked: boolean): void {
  let overlay = document.getElementById('projectVWorkspaceLock');
  if (!locked) {
    overlay?.remove();
    document.body.classList.remove('project-v-workspace-locked');
    return;
  }
  document.body.classList.add('project-v-workspace-locked');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'projectVWorkspaceLock';
    overlay.className = 'workspace-lock-overlay';
    overlay.innerHTML = `
      <div class="workspace-lock-card">
        <div class="workspace-lock-mark">V</div>
        <span>PROJECT V // WATCHTOWER</span>
        <h1>COMMAND DECK LOCKED</h1>
        <p>UNLOCK FROM THE PRIMARY WATCHTOWER WINDOW</p>
      </div>`;
    document.body.appendChild(overlay);
  }
}

export function installWorkspaceLockGuard(): () => void {
  renderOverlay(readLock());
  const storageHandler = (event: StorageEvent) => {
    if (event.key === LOCK_KEY) renderOverlay(readLock());
  };
  window.addEventListener('storage', storageHandler);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => renderOverlay(Boolean((event.data as LockRecord | undefined)?.locked)));
  } catch { /* optional */ }
  return () => {
    window.removeEventListener('storage', storageHandler);
    channel?.close();
  };
}
