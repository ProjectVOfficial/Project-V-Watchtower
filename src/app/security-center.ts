import type { AppContext } from './app-context';
import type { DeckWorkspaceManager } from './deck-workspaces';
import type { ProjectVModuleRegistry } from '@/modules/plugin-registry';
import type { ProjectVPluginPermission } from '@/modules/plugin-types';
import {
  clearProjectVPin,
  clearProjectVSafeModeSession,
  createProjectVBackup,
  desktopSecretVaultAvailable,
  getNetworkAudit,
  getSecuritySettings,
  hasLastGoodConfiguration,
  isProjectVSafeModeActive,
  parseBackup,
  requestProjectVSafeModeNextStart,
  restoreLastGoodConfiguration,
  restoreProjectVBackup,
  saveLastGoodConfiguration,
  serializeBackup,
  shouldRequireStartupAccessGate,
  setAllowedNetworkOrigins,
  setNetworkMode,
  setProjectVPin,
  updateSecuritySettings,
  verifyProjectVPin,
  wasPreviousSessionUnclean,
  type ProjectVNetworkMode,
} from '@/services/security-center';
import {
  getPluginPermissionGrant,
  resetPluginPermissionGrants,
  setPluginPermissionGrant,
} from '@/services/plugin-permissions';
import { listResearchDocuments, listResearchExcerpts } from '@/services/research-library';
import { escapeHtml } from '@/utils/sanitize';
import { tryInvokeTauri } from '@/services/tauri-bridge';

interface SecurityCenterOptions {
  ctx: AppContext;
  workspaces: DeckWorkspaceManager;
  registry: ProjectVModuleRegistry;
}

type SecurityTab = 'overview' | 'lock' | 'backup' | 'network' | 'plugins' | 'diagnostics' | 'communications';

const PERMISSION_LABELS: Record<ProjectVPluginPermission, string> = {
  storage: 'LOCAL STORAGE',
  network: 'NETWORK ACCESS',
  notifications: 'NOTIFICATIONS',
  'clipboard-read': 'CLIPBOARD READ',
  'clipboard-write': 'CLIPBOARD WRITE',
};

function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDate(timestamp?: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : 'NEVER';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const PROJECT_V_LOCK_STATE_KEY = 'project-v-command-lock-v1';
const PROJECT_V_SECURITY_CHANNEL = 'project-v-security-events';

function broadcastProjectVLockState(locked: boolean): void {
  const record = { locked, at: Date.now() };
  try { localStorage.setItem(PROJECT_V_LOCK_STATE_KEY, JSON.stringify(record)); } catch { /* optional */ }
  try {
    const channel = new BroadcastChannel(PROJECT_V_SECURITY_CHANNEL);
    channel.postMessage(record);
    channel.close();
  } catch { /* optional */ }
}

export class SecurityCenterController {
  private readonly ctx: AppContext;
  private readonly workspaces: DeckWorkspaceManager;
  private readonly registry: ProjectVModuleRegistry;
  private activeTab: SecurityTab = 'overview';
  private activityTimer: number | null = null;
  private lastActivityAt = Date.now();
  private locked = false;
  private failedUnlocks = 0;
  private activityHandler: (() => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private settingsHandler: (() => void) | null = null;
  private trustedWindowHandler: ((event: Event) => void) | null = null;
  private suppressBlurLockUntil = 0;

  constructor(options: SecurityCenterOptions) {
    this.ctx = options.ctx;
    this.workspaces = options.workspaces;
    this.registry = options.registry;
  }

  init(): void {
    document.getElementById('securityCenterBtn')?.addEventListener('click', () => this.open());
    document.getElementById('securityCenterClose')?.addEventListener('click', () => this.close());
    document.getElementById('securityCenterBackdrop')?.addEventListener('click', () => this.close());
    this.render();
    this.ensureLockOverlayPortal();
    const startupGateRequired = shouldRequireStartupAccessGate();
    // The primary window normally starts as the authority for an unlocked deck.
    // When the optional startup access gate is armed, keep trusted desks locked
    // until the local Watchtower PIN is successfully verified.
    if (!startupGateRequired) broadcastProjectVLockState(false);
    this.setupAutoLock();
    if (startupGateRequired) {
      this.lock('startup');
      document.body.classList.remove('project-v-startup-gated');
    }
    window.setTimeout(() => saveLastGoodConfiguration(), 12_000);
  }

  public lockNow(): void {
    this.lock();
  }

  destroy(): void {
    if (this.activityTimer !== null) window.clearInterval(this.activityTimer);
    if (this.activityHandler) {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((eventName) =>
        window.removeEventListener(eventName, this.activityHandler!, true)
      );
    }
    if (this.blurHandler) window.removeEventListener('blur', this.blurHandler);
    if (this.settingsHandler) window.removeEventListener('project-v-security-settings-change', this.settingsHandler);
    if (this.trustedWindowHandler) window.removeEventListener('project-v-trusted-window-opening', this.trustedWindowHandler);
  }

  private open(): void {
    document.getElementById('securityCenterDrawer')?.classList.add('open');
    document.getElementById('securityCenterBackdrop')?.classList.add('open');
    document.body.classList.add('v-security-drawer-open');
    this.render();
  }

  private close(): void {
    document.getElementById('securityCenterDrawer')?.classList.remove('open');
    document.getElementById('securityCenterBackdrop')?.classList.remove('open');
    document.body.classList.remove('v-security-drawer-open');
  }

  private render(): void {
    const mount = document.getElementById('securityCenterContent');
    if (!mount) return;
    mount.innerHTML = `
      <nav class="v-security-tabs" aria-label="Security center sections">
        ${([
          ['overview', 'OVERVIEW'], ['lock', 'PROJECT LOCK'], ['backup', 'BACKUPS'],
          ['network', 'NETWORK'], ['plugins', 'PLUGIN ACCESS'], ['diagnostics', 'DIAGNOSTICS'],
          ['communications', 'WEB DOCK'],
        ] as Array<[SecurityTab, string]>).map(([id, label]) => `<button type="button" data-security-tab="${id}" class="${this.activeTab === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav>
      <section class="v-security-tab-body">${this.renderTab()}</section>
    `;
    mount.querySelectorAll<HTMLButtonElement>('[data-security-tab]').forEach((button) => button.addEventListener('click', () => {
      this.activeTab = button.dataset.securityTab as SecurityTab;
      this.render();
    }));
    this.bindActiveTab(mount);
    this.updateSecurityButton();
  }

  private renderTab(): string {
    switch (this.activeTab) {
      case 'lock': return this.renderLock();
      case 'backup': return this.renderBackup();
      case 'network': return this.renderNetwork();
      case 'plugins': return this.renderPlugins();
      case 'diagnostics': return this.renderDiagnostics();
      case 'communications': return this.renderCommunications();
      default: return this.renderOverview();
    }
  }

  private renderOverview(): string {
    const settings = getSecuritySettings();
    const safeMode = isProjectVSafeModeActive();
    const plugins = this.registry.getInstalledPlugins();
    return `
      <div class="v-security-status-grid">
        <article><span>SECRET VAULT</span><strong class="${desktopSecretVaultAvailable() ? 'good' : 'warn'}">${desktopSecretVaultAvailable() ? 'DESKTOP KEYRING' : 'DEV LOCAL MODE'}</strong><p>Desktop API credentials use the operating-system credential vault. Browser development values remain local to localhost.</p></article>
        <article><span>PROJECT LOCK</span><strong class="${settings.pin ? 'good' : 'warn'}">${settings.accessGateEnabled && settings.pin ? 'STARTUP GATE ARMED' : settings.pin ? 'PIN ARMED' : 'NO PIN'}</strong><p>${settings.accessGateEnabled && settings.pin ? 'Watchtower requires local authorization at startup.' : 'Manual lock is available now.'} Auto-lock is ${settings.autoLockMinutes > 0 ? `${settings.autoLockMinutes} minutes` : 'disabled'}.</p></article>
        <article><span>NETWORK POLICY</span><strong class="${settings.networkMode === 'normal' ? 'warn' : 'good'}">${settings.networkMode.toUpperCase()}</strong><p>Controls new fetch and WebSocket connections created by Watchtower modules.</p></article>
        <article><span>RECOVERY</span><strong class="${wasPreviousSessionUnclean() ? 'warn' : 'good'}">${wasPreviousSessionUnclean() ? 'REVIEW ADVISED' : 'NORMAL'}</strong><p>${wasPreviousSessionUnclean() ? 'The previous session may not have closed cleanly.' : 'No unclean previous-session marker was detected.'}</p></article>
        <article><span>PLUGINS</span><strong>${plugins.length} INSTALLED</strong><p>${plugins.filter((plugin) => plugin.enabled).length} enabled. Permission grants can be revoked individually.</p></article>
        <article><span>SAFE MODE</span><strong class="${safeMode ? 'warn' : 'good'}">${safeMode ? 'ACTIVE' : 'OFF'}</strong><p>Safe Mode starts Watchtower without loading local plugin panels.</p></article>
      </div>
      <div class="v-security-actions">
        <button type="button" data-action="lock-now" class="primary">LOCK WATCHTOWER</button>
        <button type="button" data-action="save-restore">CREATE RESTORE POINT</button>
        <button type="button" data-action="safe-restart">${safeMode ? 'EXIT SAFE MODE & RELOAD' : 'RESTART IN SAFE MODE'}</button>
      </div>
      <div class="v-security-note"><strong>BOUNDARY</strong><span>Project Lock and the optional startup Access Gate protect local entry to Watchtower. They do not encrypt Watchtower storage and do not replace Windows sign-in, BitLocker/full-disk encryption, or endpoint security.</span></div>
    `;
  }

  private renderLock(): string {
    const settings = getSecuritySettings();
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // ACCESS CONTROL</span><strong>PROJECT LOCK</strong></div>
        <p>Control local access to the Watchtower command deck. Project Lock protects an open session; the optional Access Gate requires the same local PIN each time the primary Watchtower deck starts.</p>
        <div class="v-access-gate-control ${settings.accessGateEnabled && settings.pin ? 'armed' : ''}">
          <div><span>STARTUP ACCESS GATE</span><strong>${settings.accessGateEnabled && settings.pin ? 'ARMED' : settings.pin ? 'READY TO ARM' : 'PIN REQUIRED'}</strong><p>${settings.pin ? 'Require local Watchtower authorization before the command deck is revealed after startup.' : 'Create a Project Lock PIN first, then enable the startup gate.'}</p></div>
          <label class="checkbox"><input type="checkbox" data-field="startup-gate" ${settings.accessGateEnabled && settings.pin ? 'checked' : ''} ${settings.pin ? '' : 'disabled'}> REQUIRE PIN WHEN WATCHTOWER STARTS</label>
        </div>
        <div class="v-security-form-grid">
          <label>AUTO-LOCK
            <select data-field="auto-lock">
              ${[0, 5, 10, 15, 30, 60, 120].map((minutes) => `<option value="${minutes}" ${settings.autoLockMinutes === minutes ? 'selected' : ''}>${minutes === 0 ? 'DISABLED' : `${minutes} MINUTES`}</option>`).join('')}
            </select>
          </label>
          <label class="checkbox"><input type="checkbox" data-field="blur-lock" ${settings.lockOnWindowBlur ? 'checked' : ''}> LOCK WHEN WINDOW LOSES FOCUS</label>
        </div>
        <div class="v-pin-control">
          <div><strong>${settings.pin ? 'PIN CONFIGURED' : 'NO PIN CONFIGURED'}</strong><span>${settings.pin ? 'Changing the PIN replaces the existing verifier used by Project Lock and the startup Access Gate.' : 'Without a PIN, Project Lock can be dismissed with one button and the startup Access Gate cannot be armed.'}</span></div>
          <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" data-field="pin" placeholder="4–12 DIGIT PIN">
          <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" data-field="pin-confirm" placeholder="CONFIRM PIN">
          <button type="button" data-action="set-pin">${settings.pin ? 'CHANGE PIN' : 'SET PIN'}</button>
          ${settings.pin ? '<button type="button" data-action="clear-pin" class="danger">REMOVE PIN</button>' : ''}
        </div>
        <button type="button" data-action="lock-now" class="primary wide">LOCK TO ACCESS SCREEN NOW</button>
        <div class="v-security-status" data-security-status></div>
      </div>
    `;
  }

  private renderBackup(): string {
    const settings = getSecuritySettings();
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // RECOVERY</span><strong>BACKUP CENTER</strong></div>
        <p>Configuration backups include layouts, settings, plugins, rules, timelines, watchlists, chat history, and local module data. Full archives also include the Research Library.</p>
        <div class="v-backup-grid">
          <article><strong>CONFIGURATION</strong><span>Smaller backup without imported research documents.</span><button type="button" data-action="backup-config">EXPORT CONFIG</button></article>
          <article><strong>FULL ARCHIVE</strong><span>Includes Research Library documents and excerpts.</span><button type="button" data-action="backup-full">EXPORT FULL</button></article>
          <article><strong>PROTECTED ARCHIVE</strong><span>AES-GCM encrypted full archive. API keys are excluded.</span><button type="button" data-action="backup-protected">EXPORT PROTECTED</button></article>
        </div>
        <div class="v-backup-restore-row">
          <button type="button" data-action="restore">RESTORE BACKUP</button>
          <button type="button" data-action="restore-last" ${hasLastGoodConfiguration() ? '' : 'disabled'}>RESTORE LAST GOOD</button>
          <input type="file" accept="application/json,.json,.pvbackup" data-backup-input hidden>
        </div>
        <div class="v-security-note"><strong>API KEYS EXCLUDED</strong><span>Desktop keys remain in the operating-system credential vault and are never placed in exported backups.</span></div>
        <p class="v-security-meta">LAST BACKUP: ${formatDate(settings.lastBackupAt)}</p>
        <div class="v-security-status" data-security-status></div>
      </div>
    `;
  }

  private renderNetwork(): string {
    const settings = getSecuritySettings();
    const audit = getNetworkAudit().slice(0, 12);
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // CONNECTION POLICY</span><strong>NETWORK CONTROL</strong></div>
        <div class="v-network-modes">
          ${([
            ['normal', 'NORMAL', 'Allow configured Watchtower data sources.'],
            ['restricted', 'RESTRICTED', 'Allow same-origin, local services, and listed external origins.'],
            ['local-only', 'LOCAL AI ONLY', 'Block external requests while keeping localhost and local assets.'],
            ['disconnected', 'EMERGENCY DISCONNECT', 'Block new external fetches and WebSocket connections.'],
          ] as Array<[ProjectVNetworkMode, string, string]>).map(([mode, label, detail]) => `
            <label class="${settings.networkMode === mode ? 'active' : ''}"><input type="radio" name="network-mode" value="${mode}" ${settings.networkMode === mode ? 'checked' : ''}><strong>${label}</strong><span>${detail}</span></label>
          `).join('')}
        </div>
        <label class="v-origin-list">RESTRICTED-MODE ALLOWLIST
          <textarea data-field="origins" rows="5" placeholder="https://example.org">${escapeHtml(settings.allowedOrigins.join('\n'))}</textarea>
        </label>
        <button type="button" data-action="save-network">APPLY NETWORK POLICY</button>
        <div class="v-security-note"><strong>IMPORTANT</strong><span>The guard applies to new frontend fetch and WebSocket connections. Existing media streams or operating-system processes may need to be closed separately.</span></div>
        <div class="v-network-audit"><strong>RECENT BLOCKS</strong>${audit.length === 0 ? '<span>NO REQUESTS BLOCKED THIS SESSION</span>' : audit.map((item) => `<div><time>${new Date(item.timestamp).toLocaleTimeString()}</time><span>${item.type.toUpperCase()}</span><code>${escapeHtml(item.url)}</code></div>`).join('')}</div>
        <div class="v-security-status" data-security-status></div>
      </div>
    `;
  }

  private renderPlugins(): string {
    const plugins = this.registry.getInstalledPlugins();
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // EXTENSION SANDBOX</span><strong>PLUGIN PERMISSIONS</strong></div>
        <p>Requested permissions remain inside the Phase Six sandbox and can now be revoked without uninstalling the plugin.</p>
        <div class="v-plugin-permission-list">
          ${plugins.length === 0 ? '<div class="v-security-empty">NO PLUGINS INSTALLED</div>' : plugins.map((plugin) => {
            const requested = plugin.manifest.permissions ?? [];
            return `<article data-plugin-id="${escapeHtml(plugin.manifest.id)}"><div><strong>${escapeHtml(plugin.manifest.name)}</strong><span>${escapeHtml(plugin.manifest.author)} · v${escapeHtml(plugin.manifest.version)}</span></div><div class="v-plugin-permission-grid">${requested.length === 0 ? '<span>NO PRIVILEGED PERMISSIONS REQUESTED</span>' : requested.map((permission) => `<label><input type="checkbox" data-permission="${permission}" ${getPluginPermissionGrant(plugin.manifest.id, permission, true) ? 'checked' : ''}> ${PERMISSION_LABELS[permission]}</label>`).join('')}</div><button type="button" data-action="reset-plugin">RESET GRANTS</button></article>`;
          }).join('')}
        </div>
        <div class="v-security-note"><strong>DENY BY REVOCATION</strong><span>A revoked permission causes the plugin bridge request to fail. Reloaded plugin panels immediately receive the reduced permission set.</span></div>
      </div>
    `;
  }

  private renderDiagnostics(): string {
    const settings = getSecuritySettings();
    const estimateAvailable = Boolean(navigator.storage?.estimate);
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // SYSTEM HEALTH</span><strong>DIAGNOSTICS & RECOVERY</strong></div>
        <div class="v-diagnostics-grid">
          <div><span>VERSION</span><strong>${escapeHtml(String(__APP_VERSION__))}</strong></div>
          <div><span>RUNTIME</span><strong>${this.ctx.isDesktopApp ? 'TAURI DESKTOP' : 'BROWSER DEV'}</strong></div>
          <div><span>WORKSPACE</span><strong>${escapeHtml(this.workspaces.getActiveWorkspace().label)}</strong></div>
          <div><span>PANELS</span><strong>${Object.keys(this.ctx.panels).length}</strong></div>
          <div><span>PLUGINS</span><strong>${this.registry.getInstalledPlugins().length}</strong></div>
          <div><span>NETWORK</span><strong>${settings.networkMode.toUpperCase()}</strong></div>
          <div><span>ONLINE FLAG</span><strong>${navigator.onLine ? 'ONLINE' : 'OFFLINE'}</strong></div>
          <div><span>STORAGE ESTIMATE</span><strong>${estimateAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</strong></div>
        </div>
        <div class="v-security-actions">
          <button type="button" data-action="refresh-diagnostics">REFRESH REPORT</button>
          <button type="button" data-action="export-diagnostics">EXPORT REDACTED REPORT</button>
          <button type="button" data-action="save-restore">CREATE RESTORE POINT</button>
          <button type="button" data-action="safe-restart">RESTART IN SAFE MODE</button>
        </div>
        <pre class="v-diagnostic-output" data-diagnostic-output>SELECT REFRESH REPORT</pre>
      </div>
    `;
  }

  private renderCommunications(): string {
    return `
      <div class="v-security-section">
        <div class="v-security-section-title"><span>PROJECT V // LIMITED WEB INTEGRATION</span><strong>COMMUNICATIONS & SOURCE DOCK</strong></div>
        <p>Phase Ten deliberately does not merge the full Project V Browser. It adds two restricted modules instead: a Communications Wall and a Source Browser handoff panel.</p>
        <div class="v-communications-explainer">
          <article><strong>COMMUNICATIONS WALL</strong><span>Launch Google Voice, Discord, Google Messages, Telegram Web, Slack, or Teams in isolated desktop webview windows. Watchtower does not read message content or share API keys with those pages.</span><button type="button" data-action="open-communications">OPEN MODULE</button></article>
          <article><strong>SOURCE BROWSER</strong><span>Open a reviewed URL, copy it, save it as a Research Library source note, or place it on an Event Timeline. Sites that block framing are opened in a dedicated window or normal browser tab.</span><button type="button" data-action="open-source-browser">OPEN MODULE</button></article>
        </div>
        <div class="v-security-note"><strong>AUTHENTICATION</strong><span>Google, Discord, and other providers control whether login works inside WebView2. When a provider rejects embedded sign-in, use the EXTERNAL option.</span></div>
      </div>
    `;
  }

  private bindActiveTab(mount: HTMLElement): void {
    mount.querySelectorAll<HTMLButtonElement>('[data-action="lock-now"]').forEach((button) => button.addEventListener('click', () => this.lock()));
    mount.querySelectorAll<HTMLButtonElement>('[data-action="save-restore"]').forEach((button) => button.addEventListener('click', () => {
      saveLastGoodConfiguration();
      this.setStatus(mount, 'RESTORE POINT SAVED');
    }));
    mount.querySelectorAll<HTMLButtonElement>('[data-action="safe-restart"]').forEach((button) => button.addEventListener('click', () => {
      if (isProjectVSafeModeActive()) {
        clearProjectVSafeModeSession();
        requestProjectVSafeModeNextStart(false);
      } else {
        requestProjectVSafeModeNextStart(true);
      }
      location.reload();
    }));

    if (this.activeTab === 'lock') this.bindLock(mount);
    if (this.activeTab === 'backup') this.bindBackup(mount);
    if (this.activeTab === 'network') this.bindNetwork(mount);
    if (this.activeTab === 'plugins') this.bindPlugins(mount);
    if (this.activeTab === 'diagnostics') this.bindDiagnostics(mount);
    if (this.activeTab === 'communications') this.bindCommunications(mount);
  }

  private bindLock(mount: HTMLElement): void {
    mount.querySelector<HTMLSelectElement>('[data-field="auto-lock"]')?.addEventListener('change', (event) => {
      updateSecuritySettings({ autoLockMinutes: Number((event.currentTarget as HTMLSelectElement).value) });
      this.setupAutoLock();
    });
    mount.querySelector<HTMLInputElement>('[data-field="blur-lock"]')?.addEventListener('change', (event) => {
      updateSecuritySettings({ lockOnWindowBlur: (event.currentTarget as HTMLInputElement).checked });
    });
    mount.querySelector<HTMLInputElement>('[data-field="startup-gate"]')?.addEventListener('change', (event) => {
      const checkbox = event.currentTarget as HTMLInputElement;
      if (checkbox.checked && !getSecuritySettings().pin) {
        checkbox.checked = false;
        this.setStatus(mount, 'SET A PROJECT LOCK PIN BEFORE ARMING THE STARTUP ACCESS GATE', true);
        return;
      }
      updateSecuritySettings({ accessGateEnabled: checkbox.checked });
      this.render();
    });
    mount.querySelector<HTMLButtonElement>('[data-action="set-pin"]')?.addEventListener('click', async () => {
      const pin = mount.querySelector<HTMLInputElement>('[data-field="pin"]')?.value ?? '';
      const confirmation = mount.querySelector<HTMLInputElement>('[data-field="pin-confirm"]')?.value ?? '';
      if (pin !== confirmation) {
        this.setStatus(mount, 'PIN VALUES DO NOT MATCH', true);
        return;
      }
      try {
        await setProjectVPin(pin);
        this.setStatus(mount, 'PIN VERIFIER SAVED');
        this.render();
      } catch (error) {
        this.setStatus(mount, error instanceof Error ? error.message : 'Unable to set PIN.', true);
      }
    });
    mount.querySelector<HTMLButtonElement>('[data-action="clear-pin"]')?.addEventListener('click', () => {
      if (!window.confirm('Remove the Project Lock PIN?')) return;
      clearProjectVPin();
      this.render();
    });
  }

  private bindBackup(mount: HTMLElement): void {
    const exportBackup = async (kind: 'configuration' | 'full', protectedBackup: boolean) => {
      try {
        const passphrase = protectedBackup ? window.prompt('Create a backup passphrase (minimum eight characters):') : undefined;
        if (protectedBackup && passphrase === null) return;
        const backup = await createProjectVBackup(kind);
        const serialized = await serializeBackup(backup, passphrase || undefined);
        const suffix = protectedBackup ? 'protected' : kind;
        downloadText(`project-v-watchtower-${suffix}-${new Date().toISOString().slice(0, 10)}.pvbackup`, serialized);
        this.setStatus(mount, `${suffix.toUpperCase()} BACKUP EXPORTED`);
      } catch (error) {
        this.setStatus(mount, error instanceof Error ? error.message : 'Backup failed.', true);
      }
    };
    mount.querySelector<HTMLButtonElement>('[data-action="backup-config"]')?.addEventListener('click', () => void exportBackup('configuration', false));
    mount.querySelector<HTMLButtonElement>('[data-action="backup-full"]')?.addEventListener('click', () => void exportBackup('full', false));
    mount.querySelector<HTMLButtonElement>('[data-action="backup-protected"]')?.addEventListener('click', () => void exportBackup('full', true));
    const input = mount.querySelector<HTMLInputElement>('[data-backup-input]');
    mount.querySelector<HTMLButtonElement>('[data-action="restore"]')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const serialized = await file.text();
        let passphrase: string | undefined;
        if (serialized.includes('project-v-watchtower-encrypted-backup')) {
          const entered = window.prompt('Enter the protected-backup passphrase:');
          if (entered === null) return;
          passphrase = entered;
        }
        const backup = await parseBackup(serialized, passphrase);
        if (!window.confirm(`Restore this ${backup.kind} backup and reload Watchtower? A last-known-good restore point will be created first.`)) return;
        await restoreProjectVBackup(backup);
        location.reload();
      } catch (error) {
        this.setStatus(mount, error instanceof Error ? error.message : 'Restore failed.', true);
      } finally {
        input.value = '';
      }
    });
    mount.querySelector<HTMLButtonElement>('[data-action="restore-last"]')?.addEventListener('click', () => {
      if (!window.confirm('Restore the last-known-good configuration and reload?')) return;
      try {
        restoreLastGoodConfiguration();
        location.reload();
      } catch (error) {
        this.setStatus(mount, error instanceof Error ? error.message : 'Restore failed.', true);
      }
    });
  }

  private bindNetwork(mount: HTMLElement): void {
    mount.querySelector<HTMLButtonElement>('[data-action="save-network"]')?.addEventListener('click', () => {
      const mode = mount.querySelector<HTMLInputElement>('input[name="network-mode"]:checked')?.value as ProjectVNetworkMode | undefined;
      const origins = (mount.querySelector<HTMLTextAreaElement>('[data-field="origins"]')?.value ?? '').split(/\r?\n|,/);
      if (mode) setNetworkMode(mode);
      setAllowedNetworkOrigins(origins);
      this.setStatus(mount, `NETWORK POLICY SET TO ${(mode ?? getSecuritySettings().networkMode).toUpperCase()}`);
      this.render();
    });
  }

  private bindPlugins(mount: HTMLElement): void {
    mount.querySelectorAll<HTMLElement>('[data-plugin-id]').forEach((card) => {
      const pluginId = card.dataset.pluginId;
      if (!pluginId) return;
      card.querySelectorAll<HTMLInputElement>('[data-permission]').forEach((input) => input.addEventListener('change', () => {
        setPluginPermissionGrant(pluginId, input.dataset.permission as ProjectVPluginPermission, input.checked);
      }));
      card.querySelector<HTMLButtonElement>('[data-action="reset-plugin"]')?.addEventListener('click', () => {
        resetPluginPermissionGrants(pluginId);
        this.render();
      });
    });
  }

  private bindDiagnostics(mount: HTMLElement): void {
    const refresh = async () => {
      const output = mount.querySelector<HTMLElement>('[data-diagnostic-output]');
      if (!output) return;
      output.textContent = 'COLLECTING…';
      const [documents, excerpts, estimate] = await Promise.all([
        listResearchDocuments().catch(() => []),
        listResearchExcerpts().catch(() => []),
        navigator.storage?.estimate?.().catch(() => undefined),
      ]);
      const report = {
        generatedAt: new Date().toISOString(),
        appVersion: String(__APP_VERSION__),
        runtime: this.ctx.isDesktopApp ? 'tauri-desktop' : 'browser-development',
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        workspace: this.workspaces.getActiveWorkspace().label,
        panelCount: Object.keys(this.ctx.panels).length,
        installedPlugins: this.registry.getInstalledPlugins().map((plugin) => ({
          id: plugin.manifest.id,
          version: plugin.manifest.version,
          enabled: plugin.enabled,
          requestedPermissions: plugin.manifest.permissions ?? [],
        })),
        research: { documents: documents.length, excerpts: excerpts.length },
        storage: estimate ? { usage: formatBytes(estimate.usage ?? 0), quota: formatBytes(estimate.quota ?? 0) } : 'unavailable',
        security: {
          networkMode: getSecuritySettings().networkMode,
          pinConfigured: Boolean(getSecuritySettings().pin),
          safeMode: isProjectVSafeModeActive(),
          previousSessionUnclean: wasPreviousSessionUnclean(),
          secretVault: desktopSecretVaultAvailable() ? 'operating-system-keyring' : 'localhost-development-storage',
        },
        recentNetworkBlocks: getNetworkAudit().slice(0, 20),
      };
      output.textContent = JSON.stringify(report, null, 2);
    };
    mount.querySelector<HTMLButtonElement>('[data-action="refresh-diagnostics"]')?.addEventListener('click', () => void refresh());
    mount.querySelector<HTMLButtonElement>('[data-action="export-diagnostics"]')?.addEventListener('click', async () => {
      await refresh();
      const output = mount.querySelector<HTMLElement>('[data-diagnostic-output]')?.textContent ?? '{}';
      downloadText(`project-v-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, output);
    });
  }

  private bindCommunications(mount: HTMLElement): void {
    const revealPanel = (panelId: string, workspaceId: string) => {
      this.workspaces.activate(workspaceId);
      this.workspaces.setPanelHidden(panelId, false);
      this.close();
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-panel="${panelId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    };
    mount.querySelector<HTMLButtonElement>('[data-action="open-communications"]')?.addEventListener('click', () => revealPanel('communications-wall', 'live-ops'));
    mount.querySelector<HTMLButtonElement>('[data-action="open-source-browser"]')?.addEventListener('click', () => revealPanel('source-browser', 'assistant'));
  }

  private setupAutoLock(): void {
    if (this.activityTimer !== null) window.clearInterval(this.activityTimer);
    if (!this.activityHandler) {
      this.activityHandler = () => {
        if (!this.locked) this.lastActivityAt = Date.now();
      };
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((eventName) =>
        window.addEventListener(eventName, this.activityHandler!, true)
      );
    }
    if (!this.trustedWindowHandler) {
      this.trustedWindowHandler = () => {
        // Native child windows are opened asynchronously. A short grace period
        // covers the focus transfer without weakening normal external blur lock.
        this.suppressBlurLockUntil = Date.now() + 3_000;
      };
      window.addEventListener('project-v-trusted-window-opening', this.trustedWindowHandler);
    }
    if (!this.blurHandler) {
      this.blurHandler = () => {
        if (!getSecuritySettings().lockOnWindowBlur) return;
        if (Date.now() < this.suppressBlurLockUntil) return;
        // Delay slightly so a trusted-window announcement dispatched in the same
        // interaction can be observed before deciding to lock the command deck.
        window.setTimeout(() => {
          if (this.locked || document.hasFocus()) return;
          if (Date.now() < this.suppressBlurLockUntil) return;
          if (getSecuritySettings().lockOnWindowBlur) this.lock();
        }, 150);
      };
      window.addEventListener('blur', this.blurHandler);
    }
    if (!this.settingsHandler) {
      this.settingsHandler = () => this.updateSecurityButton();
      window.addEventListener('project-v-security-settings-change', this.settingsHandler);
    }
    this.activityTimer = window.setInterval(() => {
      const minutes = getSecuritySettings().autoLockMinutes;
      if (!this.locked && minutes > 0 && Date.now() - this.lastActivityAt >= minutes * 60_000) this.lock();
    }, 15_000);
  }

  private ensureLockOverlayPortal(): HTMLElement {
    let overlay = document.getElementById('projectVLockOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'projectVLockOverlay';
      overlay.className = 'v-project-lock-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Project V Watchtower locked');
    }
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    return overlay;
  }

  private lock(reason: 'manual' | 'startup' = 'manual'): void {
    this.close();
    const overlay = this.ensureLockOverlayPortal();
    this.locked = true;
    this.failedUnlocks = 0;
    void tryInvokeTauri<void>('hide_communications_dock');
    window.dispatchEvent(new CustomEvent('project-v-security-lock-change', { detail: { locked: true } }));
    broadcastProjectVLockState(true);
    document.body.classList.add('project-v-locked');
    const settings = getSecuritySettings();
    const accessGateMode = reason === 'startup' || (settings.accessGateEnabled && Boolean(settings.pin));
    overlay.dataset.lockMode = accessGateMode ? 'access-gate' : 'project-lock';
    overlay.classList.add('active');
    overlay.innerHTML = `
      <div class="v-lock-card ${accessGateMode ? 'v-access-gate-card' : ''}">
        <div class="v-lock-mark">V</div>
        <span>PROJECT V // WATCHTOWER</span>
        <h1>${accessGateMode ? 'WATCHTOWER ACCESS GATE' : 'COMMAND DECK LOCKED'}</h1>
        <p>${settings.pin ? (accessGateMode ? 'OPERATOR AUTHORIZATION REQUIRED' : 'AUTHORIZATION REQUIRED') : 'SESSION PAUSED'}</p>
        ${settings.pin ? '<form class="v-unlock-form"><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off" placeholder="ENTER WATCHTOWER PIN" aria-label="Watchtower access PIN"><button type="submit">AUTHORIZE</button></form>' : '<button type="button" data-action="unlock">RETURN TO DECK</button>'}
        <small data-lock-status>${accessGateMode ? 'LOCAL ACCESS CONTROL · WATCHTOWER DATA REMAINS LOCAL' : 'LOCAL SESSION · EXTERNAL PANELS HIDDEN'}</small>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>('[data-action="unlock"]')?.addEventListener('click', () => this.unlock());
    const form = overlay.querySelector<HTMLFormElement>('.v-unlock-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input');
      const status = overlay.querySelector<HTMLElement>('[data-lock-status]');
      const valid = await verifyProjectVPin(input?.value ?? '');
      if (valid) {
        this.unlock();
        return;
      }
      this.failedUnlocks += 1;
      if (input) input.value = '';
      if (status) status.textContent = this.failedUnlocks >= 5 ? 'ACCESS DENIED · WAIT BEFORE RETRYING' : 'ACCESS DENIED';
      if (this.failedUnlocks >= 5) {
        if (input) input.disabled = true;
        window.setTimeout(() => {
          this.failedUnlocks = 0;
          if (input) input.disabled = false;
          if (status) status.textContent = 'LOCAL SESSION · AUTHORIZATION REQUIRED';
        }, 15_000);
      }
    });
    window.setTimeout(() => form?.querySelector<HTMLInputElement>('input')?.focus(), 50);
  }

  private unlock(): void {
    this.locked = false;
    this.lastActivityAt = Date.now();
    document.body.classList.remove('project-v-locked', 'project-v-startup-gated');
    const overlay = this.ensureLockOverlayPortal();
    overlay.classList.remove('active');
    delete overlay.dataset.lockMode;
    overlay.innerHTML = '';
    window.dispatchEvent(new CustomEvent('project-v-security-lock-change', { detail: { locked: false } }));
    broadcastProjectVLockState(false);
  }

  private updateSecurityButton(): void {
    const button = document.getElementById('securityCenterBtn');
    if (!button) return;
    const settings = getSecuritySettings();
    button.classList.toggle('restricted', settings.networkMode !== 'normal');
    button.classList.toggle('armed', Boolean(settings.pin));
    button.classList.toggle('gated', settings.accessGateEnabled && Boolean(settings.pin));
    const state = button.querySelector<HTMLElement>('span');
    if (state) state.textContent = settings.networkMode === 'normal'
      ? (settings.accessGateEnabled && settings.pin ? 'GATED' : settings.pin ? 'ARMED' : 'OPEN')
      : settings.networkMode.toUpperCase();
  }

  private setStatus(mount: HTMLElement, message: string, error = false): void {
    const status = mount.querySelector<HTMLElement>('[data-security-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }
}
