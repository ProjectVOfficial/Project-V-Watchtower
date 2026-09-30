import { Panel } from './Panel';
import {
  addCommunicationEndpoint,
  canUseNativeCommunicationDock,
  closeCommunicationDock,
  hideCommunicationDock,
  listCommunicationEndpoints,
  openCommunicationDock,
  openCommunicationEndpoint,
  reloadCommunicationDock,
  removeCommunicationEndpoint,
  updateCommunicationDock,
  type CommunicationDockBounds,
  type CommunicationEndpoint,
} from '@/services/communications-center';
import { escapeHtml } from '@/utils/sanitize';

interface DockSnapshot extends CommunicationDockBounds {
  visible: boolean;
}

export class CommunicationsWallPanel extends Panel {
  private changeHandler: (() => void) | null = null;
  private activeEndpointId: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private bodyClassObserver: MutationObserver | null = null;
  private syncRaf: number | null = null;
  private scrollHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private securityHandler: ((event: Event) => void) | null = null;
  private lastDockSnapshot: DockSnapshot | null = null;

  constructor() {
    super({
      id: 'communications-wall',
      title: 'COMMUNICATIONS WALL',
      showCount: true,
      className: 'panel-wide v-communications-panel',
      infoTooltip: 'Dock approved communication services inside the desktop command deck, open them in isolated Project V windows, or use your normal browser. Remote services never receive Watchtower API keys or IPC access.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '7';
    element.dataset.moduleMinW = '5';
    element.dataset.moduleMinH = '4';
    element.dataset.moduleCategory = 'operations';
    this.changeHandler = () => this.render();
    window.addEventListener('project-v-communications-change', this.changeHandler);
    this.render();
  }

  public override destroy(): void {
    if (this.changeHandler) window.removeEventListener('project-v-communications-change', this.changeHandler);
    this.changeHandler = null;
    this.teardownDockObservers();
    void closeCommunicationDock();
    super.destroy();
  }

  private render(): void {
    const endpoints = listCommunicationEndpoints();
    const activeEndpoint = endpoints.find((item) => item.id === this.activeEndpointId) ?? null;
    if (this.activeEndpointId && !activeEndpoint) this.activeEndpointId = null;
    this.setCount(endpoints.length);
    this.content.innerHTML = `
      <div class="v-communications-shell">
        <div class="v-communications-banner">
          <div><span>PROJECT V // RESTRICTED WEB DOCK</span><strong>COMMUNICATIONS WALL</strong></div>
          <p>Desktop mode can place an approved service directly inside this panel. Browser mode can only attempt an iframe, and many messaging providers block that for security.</p>
        </div>
        ${activeEndpoint ? this.renderDock(activeEndpoint) : this.renderDockIdle()}
        <div class="v-communications-grid">
          ${endpoints.map((endpoint) => this.renderEndpoint(endpoint)).join('')}
        </div>
        <form class="v-communications-form">
          <input name="name" maxlength="48" placeholder="CUSTOM SERVICE NAME" required>
          <input name="url" type="url" maxlength="500" placeholder="https://service.example/" required>
          <input name="description" maxlength="160" placeholder="OPTIONAL DESCRIPTION">
          <button type="submit">ADD ENDPOINT</button>
        </form>
        <div class="v-communications-status" data-status></div>
      </div>
    `;

    this.content.querySelectorAll<HTMLElement>('[data-endpoint-id]').forEach((card) => {
      const endpoint = endpoints.find((item) => item.id === card.dataset.endpointId);
      if (!endpoint) return;
      card.querySelector<HTMLButtonElement>('[data-action="dock"]')?.addEventListener('click', () => void this.activateDock(endpoint));
      card.querySelector<HTMLButtonElement>('[data-action="integrated"]')?.addEventListener('click', () => void this.open(endpoint, true));
      card.querySelector<HTMLButtonElement>('[data-action="external"]')?.addEventListener('click', () => void this.open(endpoint, false));
      card.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener('click', () => void this.copy(endpoint.url));
      card.querySelector<HTMLButtonElement>('[data-action="remove"]')?.addEventListener('click', () => {
        if (window.confirm(`Remove ${endpoint.name} from the Communications Wall?`)) removeCommunicationEndpoint(endpoint.id);
      });
    });

    this.content.querySelector<HTMLFormElement>('.v-communications-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      try {
        addCommunicationEndpoint(
          String(data.get('name') ?? ''),
          String(data.get('url') ?? ''),
          String(data.get('description') ?? ''),
        );
        form.reset();
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'Unable to add endpoint.', true);
      }
    });

    this.bindDockControls(activeEndpoint);
  }

  private renderDockIdle(): string {
    return `
      <section class="v-communications-dock v-communications-dock-idle">
        <div class="v-communications-dock-idle-mark">V</div>
        <div><strong>NO COMMUNICATIONS SESSION DOCKED</strong><span>Select DOCK on Google Voice, Discord, Messages, Telegram, Slack, Teams, or an approved custom endpoint.</span></div>
      </section>
    `;
  }

  private renderDock(endpoint: CommunicationEndpoint): string {
    const native = canUseNativeCommunicationDock();
    const safeUrl = escapeHtml(endpoint.url);
    return `
      <section class="v-communications-dock active" data-dock-root>
        <div class="v-communications-dock-toolbar">
          <div><span class="v-communication-signal"></span><strong>${escapeHtml(endpoint.name)}</strong><small>${native ? 'NATIVE WEBVIEW2 DOCK' : 'IFRAME COMPATIBILITY MODE'}</small></div>
          <div class="v-communication-actions">
            ${native ? '<button type="button" data-dock-action="reload">RELOAD</button>' : ''}
            <button type="button" data-dock-action="window">POP OUT</button>
            <button type="button" data-dock-action="external">EXTERNAL</button>
            <button type="button" data-dock-action="close" class="danger">CLOSE DOCK</button>
          </div>
        </div>
        <div class="v-communications-dock-stage" data-dock-stage>
          ${native
            ? '<div class="v-native-dock-placeholder"><span>PROJECT V SECURE VIEW</span><strong>REMOTE COMMUNICATIONS SESSION</strong><small>The native service view is positioned over this protected viewport. It has no Watchtower IPC permissions.</small></div>'
            : `<iframe src="${safeUrl}" title="${escapeHtml(endpoint.name)} communications" referrerpolicy="no-referrer" allow="microphone; camera; autoplay; clipboard-read; clipboard-write" sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-downloads"></iframe><div class="v-iframe-warning">If this remains blank or sign-in fails, the provider blocks framing or embedded login. Use POP OUT.</div>`}
        </div>
      </section>
    `;
  }

  private renderEndpoint(endpoint: CommunicationEndpoint): string {
    const native = canUseNativeCommunicationDock();
    const dockLabel = native ? 'DOCK' : 'TRY IFRAME';
    const canDock = endpoint.integrated || !native;
    return `
      <article class="v-communication-card${endpoint.id === this.activeEndpointId ? ' active' : ''}" data-endpoint-id="${escapeHtml(endpoint.id)}">
        <div class="v-communication-card-head"><span class="v-communication-signal"></span><strong>${escapeHtml(endpoint.name)}</strong>${endpoint.builtIn ? '<small>BUILT-IN</small>' : '<small>CUSTOM</small>'}</div>
        <p>${escapeHtml(endpoint.description)}</p>
        <code>${escapeHtml(new URL(endpoint.url).host)}</code>
        <div class="v-communication-actions">
          ${canDock ? `<button type="button" data-action="dock">${dockLabel}</button>` : ''}
          ${endpoint.integrated ? '<button type="button" data-action="integrated">OPEN WINDOW</button>' : ''}
          <button type="button" data-action="external">EXTERNAL</button>
          <button type="button" data-action="copy">COPY</button>
          ${endpoint.builtIn ? '' : '<button type="button" data-action="remove" class="danger">REMOVE</button>'}
        </div>
      </article>
    `;
  }

  private bindDockControls(endpoint: CommunicationEndpoint | null): void {
    this.teardownDockObservers();
    if (!endpoint) return;
    this.content.querySelector<HTMLButtonElement>('[data-dock-action="reload"]')?.addEventListener('click', () => void this.reloadDock());
    this.content.querySelector<HTMLButtonElement>('[data-dock-action="window"]')?.addEventListener('click', () => void this.open(endpoint, true));
    this.content.querySelector<HTMLButtonElement>('[data-dock-action="external"]')?.addEventListener('click', () => void this.open(endpoint, false));
    this.content.querySelector<HTMLButtonElement>('[data-dock-action="close"]')?.addEventListener('click', () => void this.deactivateDock());
    if (canUseNativeCommunicationDock()) this.setupDockObservers();
  }

  private async activateDock(endpoint: CommunicationEndpoint): Promise<void> {
    this.activeEndpointId = endpoint.id;
    this.render();
    if (!canUseNativeCommunicationDock()) {
      this.setStatus(`${endpoint.name} LOADED IN IFRAME COMPATIBILITY MODE. PROVIDER RESTRICTIONS MAY BLOCK IT.`);
      return;
    }
    const bounds = this.readDockBounds();
    if (!bounds) {
      this.setStatus('The communications viewport is not visible yet.', true);
      return;
    }
    try {
      await openCommunicationDock(endpoint, bounds);
      this.lastDockSnapshot = { ...bounds, visible: true };
      this.setStatus(`${endpoint.name} DOCKED INSIDE PROJECT V`);
      this.scheduleDockSync();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to dock communications endpoint.', true);
    }
  }

  private async deactivateDock(): Promise<void> {
    this.teardownDockObservers();
    await closeCommunicationDock();
    this.activeEndpointId = null;
    this.lastDockSnapshot = null;
    this.render();
    this.setStatus('COMMUNICATIONS DOCK CLOSED');
  }

  private async reloadDock(): Promise<void> {
    try {
      await reloadCommunicationDock();
      this.setStatus('COMMUNICATIONS DOCK RELOADED');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to reload communications dock.', true);
    }
  }

  private setupDockObservers(): void {
    const stage = this.content.querySelector<HTMLElement>('[data-dock-stage]');
    if (!stage) return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleDockSync());
    this.resizeObserver.observe(stage);
    this.intersectionObserver = new IntersectionObserver(() => this.scheduleDockSync(), { threshold: [0, 0.05, 0.5, 1] });
    this.intersectionObserver.observe(stage);
    this.scrollHandler = () => this.scheduleDockSync();
    window.addEventListener('scroll', this.scrollHandler, true);
    window.addEventListener('resize', this.scrollHandler);
    window.addEventListener('project-v-workspace-activated', this.scrollHandler);
    window.addEventListener('project-v-dock-layout-applied', this.scrollHandler);
    window.addEventListener('project-v-module-state-change', this.scrollHandler);
    window.addEventListener('project-v-layout-change', this.scrollHandler);
    this.visibilityHandler = () => this.scheduleDockSync();
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.securityHandler = () => this.scheduleDockSync();
    window.addEventListener('project-v-security-lock-change', this.securityHandler);
    this.bodyClassObserver = new MutationObserver(() => this.scheduleDockSync());
    this.bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.scheduleDockSync();
  }

  private teardownDockObservers(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.bodyClassObserver?.disconnect();
    this.bodyClassObserver = null;
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler, true);
      window.removeEventListener('resize', this.scrollHandler);
      window.removeEventListener('project-v-workspace-activated', this.scrollHandler);
      window.removeEventListener('project-v-dock-layout-applied', this.scrollHandler);
      window.removeEventListener('project-v-module-state-change', this.scrollHandler);
      window.removeEventListener('project-v-layout-change', this.scrollHandler);
    }
    this.scrollHandler = null;
    if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
    if (this.securityHandler) window.removeEventListener('project-v-security-lock-change', this.securityHandler);
    this.securityHandler = null;
    if (this.syncRaf !== null) window.cancelAnimationFrame(this.syncRaf);
    this.syncRaf = null;
  }

  private scheduleDockSync(): void {
    if (this.syncRaf !== null) return;
    this.syncRaf = window.requestAnimationFrame(() => {
      this.syncRaf = null;
      void this.syncNativeDock();
    });
  }

  private async syncNativeDock(): Promise<void> {
    if (!this.activeEndpointId || !canUseNativeCommunicationDock()) return;
    const bounds = this.readDockBounds();
    const visible = Boolean(bounds)
      && !document.hidden
      && !document.body.classList.contains('project-v-locked')
      && !document.body.classList.contains('deck-edit-mode');
    const safeBounds = bounds ?? this.lastDockSnapshot ?? { x: 0, y: 0, width: 240, height: 180, visible: false };
    const next: DockSnapshot = { x: safeBounds.x, y: safeBounds.y, width: safeBounds.width, height: safeBounds.height, visible };
    if (this.sameDockSnapshot(next, this.lastDockSnapshot)) return;
    this.lastDockSnapshot = next;
    if (!visible) {
      await hideCommunicationDock();
      return;
    }
    await updateCommunicationDock(next, true);
  }

  private readDockBounds(): CommunicationDockBounds | null {
    const stage = this.content.querySelector<HTMLElement>('[data-dock-stage]');
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const panelRect = this.getElement().getBoundingClientRect();
    const left = Math.max(rect.left, panelRect.left, 0);
    const top = Math.max(rect.top, panelRect.top, 0);
    const right = Math.min(rect.right, panelRect.right, window.innerWidth);
    const bottom = Math.min(rect.bottom, panelRect.bottom, window.innerHeight);
    const width = right - left;
    const height = bottom - top;
    if (width < 240 || height < 180 || rect.width <= 0 || rect.height <= 0) return null;
    return { x: left, y: top, width, height };
  }

  private sameDockSnapshot(a: DockSnapshot, b: DockSnapshot | null): boolean {
    if (!b) return false;
    return a.visible === b.visible
      && Math.abs(a.x - b.x) < 2
      && Math.abs(a.y - b.y) < 2
      && Math.abs(a.width - b.width) < 2
      && Math.abs(a.height - b.height) < 2;
  }

  private async open(endpoint: CommunicationEndpoint, integrated: boolean): Promise<void> {
    try {
      await openCommunicationEndpoint(endpoint, integrated);
      this.setStatus(`${endpoint.name} OPENED ${integrated && endpoint.integrated ? 'IN A PROJECT V WINDOW' : 'EXTERNALLY'}`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to open communications endpoint.', true);
    }
  }

  private async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.setStatus('LINK COPIED');
    } catch {
      this.setStatus('CLIPBOARD ACCESS WAS DENIED', true);
    }
  }

  private setStatus(message: string, error = false): void {
    const status = this.content.querySelector<HTMLElement>('[data-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }
}
