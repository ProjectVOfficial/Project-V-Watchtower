import { Panel } from './Panel';
import { getMapOperationsStats, subscribeMapOperations } from '@/services/map-operations';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { escapeHtml } from '@/utils/sanitize';

export class MapOperationsPanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'map-operations',
      title: 'MAP OPERATIONS',
      showCount: true,
      className: 'v-map-operations-panel',
      infoTooltip: 'Open the separate Project V Map Desk to draw areas of interest, routes, operational markers, measurements, and geofenced alert rules without crowding the command deck.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '3';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '2';
    element.dataset.moduleCategory = 'maps';
    this.cleanup = subscribeMapOperations(() => this.render());
    this.render();
  }

  private render(): void {
    try {
      const stats = getMapOperationsStats();
      this.setCount(stats.total);
      this.content.innerHTML = `
        <div class="v-desk-summary-grid">
          <div><strong>${stats.areas}</strong><span>AREAS OF INTEREST</span></div>
          <div><strong>${stats.routes + stats.markers}</strong><span>ROUTES / MARKERS</span></div>
          <div><strong>${stats.activeRules}</strong><span>ACTIVE GEOFENCES</span></div>
        </div>
        <div class="v-desk-recent">
          <span>RECENT MAP ITEM</span>
          <strong>${escapeHtml(stats.recentlyUpdated?.name ?? 'NO MAP ITEMS SAVED')}</strong>
          <small>${stats.recentlyUpdated ? new Date(stats.recentlyUpdated.updatedAt).toLocaleString() : 'Open Map Operations to draw an area, route, or marker.'}</small>
        </div>
        <div class="v-desk-actions">
          <button type="button" data-action="open">OPEN MAP DESK</button>
          <button type="button" data-action="new-area">NEW AREA</button>
        </div>
      `;
      this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('map-operations'));
      this.content.querySelector<HTMLButtonElement>('[data-action="new-area"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('map-operations', { mode: 'polygon' }));
    } catch (error) {
      this.content.innerHTML = `<div class="v-panel-error">${escapeHtml(error instanceof Error ? error.message : 'Unable to load Map Operations.')}</div>`;
    }
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
