import { Panel } from './Panel';
import { createCase, getCaseStats, subscribeCaseDesk } from '@/services/case-desk';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { escapeHtml } from '@/utils/sanitize';

export class CaseStatusPanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'case-status',
      title: 'CASE DESK',
      showCount: true,
      className: 'v-case-status-panel',
      infoTooltip: 'A compact status panel for Project V investigations. Open the separate Case Desk window for evidence boards, claims, entities, relationships, timelines, and case reports.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '3';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '2';
    element.dataset.moduleCategory = 'research';
    this.cleanup = subscribeCaseDesk(() => void this.render());
    void this.render();
  }

  private async render(): Promise<void> {
    try {
      const stats = await getCaseStats();
      this.setCount(stats.active);
      this.content.innerHTML = `
        <div class="v-desk-summary-grid">
          <div><strong>${stats.active}</strong><span>ACTIVE CASES</span></div>
          <div><strong>${stats.critical}</strong><span>CRITICAL</span></div>
          <div><strong>${stats.unverified}</strong><span>UNVERIFIED / DISPUTED</span></div>
        </div>
        <div class="v-desk-recent">
          <span>RECENTLY UPDATED</span>
          <strong>${escapeHtml(stats.recentlyUpdated?.title ?? 'NO CASES CREATED')}</strong>
          <small>${stats.recentlyUpdated ? new Date(stats.recentlyUpdated.updatedAt).toLocaleString() : 'Create a case to begin an investigation.'}</small>
        </div>
        <div class="v-desk-actions">
          <button type="button" data-action="open">OPEN CASE DESK</button>
          <button type="button" data-action="new">NEW CASE</button>
        </div>
      `;
      this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('case-desk'));
      this.content.querySelector<HTMLButtonElement>('[data-action="new"]')?.addEventListener('click', () => void this.createNew());
    } catch (error) {
      this.content.innerHTML = `<div class="v-panel-error">${escapeHtml(error instanceof Error ? error.message : 'Unable to load Case Desk.')}</div>`;
    }
  }

  private async createNew(): Promise<void> {
    const title = window.prompt('Case title:', 'New Investigation')?.trim();
    if (!title) return;
    const record = await createCase({ title });
    await openProjectVWorkspaceWindow('case-desk', { case: record.id });
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
