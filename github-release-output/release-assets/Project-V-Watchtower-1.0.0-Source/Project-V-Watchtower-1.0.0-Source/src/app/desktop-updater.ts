import type { AppContext, AppModule } from '@/app/app-context';
import { invokeTauri } from '@/services/tauri-bridge';
import { trackUpdateShown, trackUpdateClicked, trackUpdateDismissed } from '@/services/analytics';
import { escapeHtml } from '@/utils/sanitize';

interface DesktopRuntimeInfo {
  os: string;
  arch: string;
  distribution_mode?: 'installed' | 'portable' | 'development';
}

interface NativeUpdateInfo {
  version: string;
  current_version: string;
  notes?: string | null;
  published_at?: string | null;
}

interface ProjectVReleaseManifest {
  version: string;
  notes?: string;
  releasePage?: string;
  portable?: {
    url: string;
    sha256?: string;
    size?: number;
  };
}

type UpdaterOutcome = 'disabled' | 'no_update' | 'update_available' | 'open_failed' | 'fetch_failed' | 'install_failed';

const UPDATER_ENABLED = import.meta.env.VITE_PROJECT_V_UPDATER_ENABLED === '1';
const RELEASE_MANIFEST_URL = String(import.meta.env.VITE_PROJECT_V_RELEASE_MANIFEST_URL || '').trim();
const RELEASE_PAGE_URL = String(import.meta.env.VITE_PROJECT_V_RELEASE_PAGE_URL || '').trim();

export class DesktopUpdater implements AppModule {
  private ctx: AppContext;
  private updateCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  init(): void {
    this.setupUpdateChecks();
  }

  destroy(): void {
    if (this.updateCheckIntervalId) {
      clearInterval(this.updateCheckIntervalId);
      this.updateCheckIntervalId = null;
    }
  }

  private setupUpdateChecks(): void {
    if (!this.ctx.isDesktopApp || this.ctx.isDestroyed) return;
    if (!UPDATER_ENABLED && !RELEASE_MANIFEST_URL) {
      this.logUpdaterOutcome('disabled', { reason: 'release build configuration not supplied' });
      return;
    }

    setTimeout(() => {
      if (!this.ctx.isDestroyed) void this.checkForUpdate();
    }, 5000);

    this.updateCheckIntervalId = setInterval(() => {
      if (!this.ctx.isDestroyed) void this.checkForUpdate();
    }, this.UPDATE_CHECK_INTERVAL_MS);
  }

  private logUpdaterOutcome(outcome: UpdaterOutcome, context: Record<string, unknown> = {}): void {
    const logger = outcome === 'fetch_failed' || outcome === 'open_failed' || outcome === 'install_failed'
      ? console.warn
      : console.info;
    logger('[project-v-updater]', outcome, context);
  }

  private isNewerVersion(remote: string, current: string): boolean {
    const normalize = (value: string): number[] => value.replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
    const r = normalize(remote);
    const c = normalize(current);
    for (let i = 0; i < Math.max(r.length, c.length); i++) {
      if ((r[i] ?? 0) > (c[i] ?? 0)) return true;
      if ((r[i] ?? 0) < (c[i] ?? 0)) return false;
    }
    return false;
  }

  private async checkForUpdate(): Promise<void> {
    try {
      const runtime = await invokeTauri<DesktopRuntimeInfo>('get_desktop_runtime_info');
      if (runtime.distribution_mode === 'portable') {
        await this.checkPortableUpdate();
        return;
      }
      if (!UPDATER_ENABLED) {
        this.logUpdaterOutcome('disabled', { distribution: runtime.distribution_mode });
        return;
      }
      const update = await invokeTauri<NativeUpdateInfo | null>('check_project_v_update');
      if (!update || !this.isNewerVersion(update.version, __APP_VERSION__)) {
        this.logUpdaterOutcome('no_update', { current: __APP_VERSION__, remote: update?.version });
        return;
      }
      await this.offerInstalledUpdate(update);
    } catch (error) {
      this.logUpdaterOutcome('fetch_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async checkPortableUpdate(): Promise<void> {
    if (!RELEASE_MANIFEST_URL) {
      this.logUpdaterOutcome('disabled', { reason: 'portable release manifest not configured' });
      return;
    }
    const response = await fetch(RELEASE_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
    const manifest = await response.json() as ProjectVReleaseManifest;
    if (!manifest.version || !manifest.portable?.url || !this.isNewerVersion(manifest.version, __APP_VERSION__)) {
      this.logUpdaterOutcome('no_update', { current: __APP_VERSION__, remote: manifest.version });
      return;
    }
    await this.showUpdateToast({
      version: manifest.version,
      notes: manifest.notes || 'A newer portable archive is available.',
      actionLabel: 'DOWNLOAD PORTABLE',
      onAction: async () => {
        const url = manifest.portable?.url || manifest.releasePage || RELEASE_PAGE_URL;
        if (!url) throw new Error('Portable download URL is missing');
        await invokeTauri<void>('open_url', { url });
      },
    });
  }

  private async offerInstalledUpdate(update: NativeUpdateInfo): Promise<void> {
    await this.showUpdateToast({
      version: update.version,
      notes: update.notes || 'A signed Project V Watchtower update is available.',
      actionLabel: 'DOWNLOAD & RESTART',
      onAction: async (button) => {
        button.disabled = true;
        button.textContent = 'INSTALLING…';
        await invokeTauri<void>('install_project_v_update');
      },
    });
  }

  private async showUpdateToast(options: {
    version: string;
    notes: string;
    actionLabel: string;
    onAction: (button: HTMLButtonElement) => Promise<void>;
  }): Promise<void> {
    const dismissKey = `project-v-update-dismissed-${options.version}`;
    if (localStorage.getItem(dismissKey)) return;

    const existing = document.querySelector<HTMLElement>('.update-toast');
    if (existing?.dataset.version === options.version) return;
    existing?.remove();

    this.logUpdaterOutcome('update_available', { current: __APP_VERSION__, remote: options.version });
    trackUpdateShown(__APP_VERSION__, options.version);

    const toast = document.createElement('div');
    toast.className = 'update-toast project-v-update-toast';
    toast.dataset.version = options.version;
    toast.title = options.notes;
    toast.innerHTML = `
      <div class="update-toast-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <div class="update-toast-body">
        <div class="update-toast-title">Project V Update Available</div>
        <div class="update-toast-detail">v${escapeHtml(__APP_VERSION__)} → v${escapeHtml(options.version)}</div>
      </div>
      <button class="update-toast-action" data-action="download">${escapeHtml(options.actionLabel)}</button>
      <button class="update-toast-dismiss" data-action="dismiss" aria-label="Dismiss">×</button>
    `;

    toast.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'download') {
        const button = target.closest<HTMLButtonElement>('button');
        if (!button || button.disabled) return;
        trackUpdateClicked(options.version);
        void options.onAction(button).catch(error => {
          button.disabled = false;
          button.textContent = options.actionLabel;
          this.logUpdaterOutcome('install_failed', { error: error instanceof Error ? error.message : String(error) });
          button.title = `Update failed: ${error instanceof Error ? error.message : String(error)}`;
        });
      } else if (action === 'dismiss') {
        trackUpdateDismissed(options.version);
        localStorage.setItem(dismissKey, '1');
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }
    });

    document.body.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
  }
}
