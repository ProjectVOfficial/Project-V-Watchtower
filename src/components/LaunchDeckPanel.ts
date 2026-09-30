import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  launchDeckApplication,
  listLaunchDeckApplications,
  subscribeLaunchDeck,
  type LaunchDeckApplication,
} from '@/services/launch-deck';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';

export class LaunchDeckPanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'launch-deck',
      title: 'LAUNCH DECK',
      showCount: true,
      className: 'v-launch-deck-panel',
      infoTooltip: 'Launch approved desktop applications such as Project V, Tor Browser, Excel, VLC, or other tools. Applications are selected and approved by the analyst and run outside Watchtower.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '3';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '2';
    element.dataset.moduleCategory = 'system';
    this.cleanup = subscribeLaunchDeck(() => this.render());
    this.render();
  }

  private render(): void {
    const applications = listLaunchDeckApplications();
    const approved = applications.filter((app) => app.approved);
    const pinned = approved.filter((app) => app.pinned).slice(0, 8);
    this.setCount(applications.length);
    this.content.innerHTML = `
      <div class="v-launch-deck-summary">
        <div><strong>${approved.length}</strong><span>APPROVED TOOLS</span></div>
        <div><strong>${pinned.length}</strong><span>PINNED</span></div>
      </div>
      <div class="v-launch-deck-buttons">
        ${pinned.length === 0
          ? '<div class="v-launch-deck-empty">NO APPLICATIONS CONFIGURED<br><small>Add Project V, Tor Browser, Excel, VLC, or another trusted executable.</small></div>'
          : pinned.map((app) => `<button type="button" data-launch-id="${escapeHtml(app.id)}" title="${escapeHtml(app.path)}"><span>${escapeHtml(this.iconFor(app))}</span><strong>${escapeHtml(app.name)}</strong></button>`).join('')}
      </div>
      <div class="v-desk-actions">
        <button type="button" data-action="open">OPEN LAUNCH DESK</button>
        <button type="button" data-action="add">ADD APPLICATION</button>
      </div>
      <div class="v-launch-deck-status" data-launch-status>DESKTOP MODE REQUIRED TO START LOCAL PROGRAMS</div>
    `;

    this.content.querySelectorAll<HTMLButtonElement>('[data-launch-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const app = applications.find((candidate) => candidate.id === button.dataset.launchId);
        if (app) void this.launch(app);
      });
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('launch-desk'));
    this.content.querySelector<HTMLButtonElement>('[data-action="add"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('launch-desk', { mode: 'new' }));
  }

  private async launch(application: LaunchDeckApplication): Promise<void> {
    const status = this.content.querySelector<HTMLElement>('[data-launch-status]');
    try {
      if (status) status.textContent = `STARTING ${application.name.toUpperCase()}…`;
      const result = await launchDeckApplication(application);
      if (status) status.textContent = `${application.name.toUpperCase()} STARTED · PID ${result.pid}`;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message.toUpperCase() : 'APPLICATION LAUNCH FAILED';
    }
  }

  private iconFor(application: LaunchDeckApplication): string {
    switch (application.category) {
      case 'browser': return '◉';
      case 'research': return '▦';
      case 'communications': return '✦';
      case 'media': return '▶';
      case 'utilities': return '⚙';
      default: return 'V';
    }
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
