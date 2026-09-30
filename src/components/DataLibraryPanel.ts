import { Panel } from './Panel';
import { getDataDeskStats, importWorkbook, subscribeDataDesk } from '@/services/data-desk';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { escapeHtml } from '@/utils/sanitize';

export class DataLibraryPanel extends Panel {
  private cleanup: (() => void) | null = null;
  private fileInput: HTMLInputElement;

  constructor() {
    super({
      id: 'data-library',
      title: 'DATA LIBRARY',
      showCount: true,
      className: 'v-data-library-panel',
      infoTooltip: 'Import .xlsx and .csv files into a local working copy. Use the separate Data Desk window to view, edit, export, snapshot, analyze, and send rows into a Case Desk investigation.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '3';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '2';
    element.dataset.moduleCategory = 'research';
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.importSelected());
    this.getElement().appendChild(this.fileInput);
    this.cleanup = subscribeDataDesk(() => void this.render());
    void this.render();
  }

  private async render(): Promise<void> {
    try {
      const stats = await getDataDeskStats();
      this.setCount(stats.total);
      this.content.innerHTML = `
        <div class="v-desk-summary-grid">
          <div><strong>${stats.total}</strong><span>WORKBOOKS</span></div>
          <div><strong>${stats.sheetCount}</strong><span>WORKSHEETS</span></div>
          <div><strong>LOCAL</strong><span>WORKING COPIES</span></div>
        </div>
        <div class="v-desk-recent">
          <span>RECENT WORKBOOK</span>
          <strong>${escapeHtml(stats.recentlyUpdated?.title ?? 'NO WORKBOOKS IMPORTED')}</strong>
          <small>${stats.recentlyUpdated ? new Date(stats.recentlyUpdated.updatedAt).toLocaleString() : 'Import an XLSX or CSV file to begin.'}</small>
        </div>
        <div class="v-desk-actions">
          <button type="button" data-action="open">OPEN DATA DESK</button>
          <button type="button" data-action="import">IMPORT FILE</button>
        </div>
      `;
      this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('data-desk'));
      this.content.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => this.fileInput.click());
    } catch (error) {
      this.content.innerHTML = `<div class="v-panel-error">${escapeHtml(error instanceof Error ? error.message : 'Unable to load Data Desk.')}</div>`;
    }
  }

  private async importSelected(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const workbook = await importWorkbook(file);
      await openProjectVWorkspaceWindow('data-desk', { workbook: workbook.id });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to import workbook.');
    }
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
