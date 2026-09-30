import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  createResearchMemory,
  deleteResearchDocument,
  deleteResearchExcerpt,
  exportResearchLibrary,
  importResearchFiles,
  importResearchLibrarySnapshot,
  listResearchDocuments,
  listResearchExcerpts,
  saveResearchExcerpt,
  searchResearchLibrary,
  updateResearchDocument,
  updateResearchExcerpt,
  type ResearchDocument,
  type ResearchExcerpt,
  type ResearchSearchResult,
} from '@/services/research-library';
import { sendToCaseDesk } from '@/services/case-handoff';

type ResearchView = 'library' | 'excerpts';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** power)).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function excerptText(value: string, max = 360): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max).trimEnd()}…` : compact;
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export class ResearchLibraryPanel extends Panel {
  private documents: ResearchDocument[] = [];
  private excerpts: ResearchExcerpt[] = [];
  private results: ResearchSearchResult[] = [];
  private selectedDocumentId: string | null = null;
  private view: ResearchView = 'library';
  private query = '';
  private status = 'LOCAL LIBRARY READY';
  private busy = false;
  private memoryEditorOpen = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly researchChangedHandler = () => void this.refreshData();

  constructor() {
    super({
      id: 'research-library',
      title: 'RESEARCH LIBRARY',
      showCount: false,
      className: 'panel-wide research-library-panel',
      infoTooltip: 'Local document intelligence for PDF, text, Markdown, HTML, CSV, JSON, saved excerpts, and analyst memory. Extracted text is stored in IndexedDB on this device and can be selectively supplied to the local Command Assistant.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '8';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '5';
    window.addEventListener('project-v-research-changed', this.researchChangedHandler);
    this.render();
    void this.refreshData();
  }

  private async refreshData(): Promise<void> {
    try {
      [this.documents, this.excerpts] = await Promise.all([listResearchDocuments(), listResearchExcerpts()]);
      if (this.selectedDocumentId && !this.documents.some((document) => document.id === this.selectedDocumentId)) {
        this.selectedDocumentId = null;
      }
      if (!this.selectedDocumentId && this.documents.length > 0) this.selectedDocumentId = this.documents[0]!.id;
      if (this.query.trim()) this.results = await searchResearchLibrary(this.query, 30);
      this.status = `${this.documents.length} DOCUMENTS · ${this.excerpts.length} EXCERPTS · LOCAL ONLY`;
    } catch (error) {
      this.status = error instanceof Error ? error.message : 'Unable to read the local research library.';
    }
    this.render();
  }

  private selectedDocument(): ResearchDocument | null {
    return this.documents.find((document) => document.id === this.selectedDocumentId) ?? null;
  }

  private render(): void {
    const enabledCount = this.documents.filter((document) => document.enabled).length;
    this.content.innerHTML = `
      <div class="research-shell ${this.busy ? 'is-busy' : ''} ${this.memoryEditorOpen ? 'has-memory-editor' : ''}">
        <div class="research-toolbar">
          <div class="research-tabs" role="tablist">
            <button type="button" data-view="library" class="${this.view === 'library' ? 'active' : ''}">LIBRARY <span>${this.documents.length}</span></button>
            <button type="button" data-view="excerpts" class="${this.view === 'excerpts' ? 'active' : ''}">EXCERPTS <span>${this.excerpts.length}</span></button>
          </div>
          <div class="research-actions">
            <button type="button" data-action="import">IMPORT FILES</button>
            <button type="button" data-action="new-memory">NEW MEMORY</button>
            <button type="button" data-action="backup">BACKUP</button>
            <button type="button" data-action="restore">RESTORE</button>
          </div>
          <input class="research-file-input" type="file" multiple accept=".pdf,.txt,.md,.markdown,.html,.htm,.csv,.json,text/*,application/pdf,application/json" hidden>
          <input class="research-backup-input" type="file" accept="application/json,.json" hidden>
        </div>
        <div class="research-search-row">
          <label><span>SEARCH LOCAL INTELLIGENCE</span><input type="search" value="${escapeHtml(this.query)}" placeholder="Names, places, claims, dates, phrases…"></label>
          <span class="research-context-count">${enabledCount} INCLUDED IN AI CONTEXT</span>
        </div>
        <div class="research-status"><span class="research-status-dot"></span>${escapeHtml(this.busy ? 'PROCESSING LOCAL FILES…' : this.status)}</div>
        ${this.memoryEditorOpen ? this.renderMemoryEditor() : ''}
        ${this.view === 'library' ? this.renderLibrary() : this.renderExcerpts()}
      </div>
    `;
    this.bindEvents();
  }

  private renderMemoryEditor(): string {
    return `
      <section class="research-memory-editor">
        <header><strong>NEW ANALYST MEMORY</strong><span>Persistent local context for future Assistant sessions</span></header>
        <input name="memory-title" maxlength="160" placeholder="Memory title">
        <input name="memory-tags" maxlength="240" placeholder="Tags separated by commas">
        <textarea name="memory-text" rows="7" maxlength="50000" placeholder="Write the fact, hypothesis, decision, source note, or background context you want Watchtower to remember…"></textarea>
        <div><button type="button" data-action="save-memory">SAVE MEMORY</button><button type="button" data-action="cancel-memory">CANCEL</button></div>
      </section>`;
  }

  private renderLibrary(): string {
    const selected = this.selectedDocument();
    const list = this.documents.length === 0
      ? `<div class="research-empty-list">No local documents yet.</div>`
      : this.documents.map((document) => `
          <button type="button" class="research-document-row ${document.id === this.selectedDocumentId ? 'active' : ''}" data-document-id="${escapeHtml(document.id)}">
            <span class="research-doc-kind">${document.kind === 'memory' ? 'MEM' : document.kind.toUpperCase()}</span>
            <span class="research-doc-copy"><strong>${escapeHtml(document.title)}</strong><small>${document.pageCount ? `${document.pageCount} pages · ` : ''}${formatBytes(document.size)} · ${formatDate(document.updatedAt)}</small></span>
            <span class="research-doc-context ${document.enabled ? 'enabled' : ''}" title="${document.enabled ? 'Included in Assistant research context' : 'Excluded from Assistant research context'}">${document.enabled ? 'AI' : 'OFF'}</span>
          </button>`).join('');

    return `
      <div class="research-workbench">
        <aside class="research-document-list">
          <div class="research-drop-zone" tabindex="0"><strong>DROP FILES HERE</strong><span>PDF · TXT · MD · HTML · CSV · JSON</span></div>
          <div class="research-list-scroll">${list}</div>
        </aside>
        <main class="research-main-view">
          ${this.query.trim() ? this.renderSearchResults() : selected ? this.renderDocument(selected) : this.renderEmptyLibrary()}
        </main>
      </div>`;
  }

  private renderEmptyLibrary(): string {
    return `<div class="research-empty-state"><div>V</div><strong>LOCAL ARCHIVE EMPTY</strong><p>Import reports and PDFs, or create an analyst memory. Files are processed locally and only extracted text is stored.</p></div>`;
  }

  private renderDocument(document: ResearchDocument): string {
    const tags = document.tags.join(', ');
    const isMemory = document.kind === 'memory';
    return `
      <article class="research-document-detail" data-selected-document="${escapeHtml(document.id)}">
        <header>
          <div><span>${isMemory ? 'ANALYST MEMORY' : `${document.kind.toUpperCase()} DOCUMENT`}</span><h3>${escapeHtml(document.title)}</h3><small>${document.pageCount ? `${document.pageCount} pages · ` : ''}${formatBytes(document.size)} · Added ${formatDate(document.addedAt)}</small></div>
          <label class="research-context-toggle"><input type="checkbox" data-action="toggle-context" ${document.enabled ? 'checked' : ''}><span>USE IN AI CONTEXT</span></label>
        </header>
        <div class="research-metadata-editor">
          <label>TITLE<input name="document-title" maxlength="160" value="${escapeHtml(document.title)}"></label>
          <label>TAGS<input name="document-tags" maxlength="240" value="${escapeHtml(tags)}" placeholder="investigation, iran, energy"></label>
          <button type="button" data-action="save-metadata">SAVE DETAILS</button>
          <button type="button" data-action="send-document-case">SEND TO CASE</button>
          <button type="button" data-action="delete-document" class="danger">DELETE</button>
        </div>
        <div class="research-document-tools">
          <span>Select text below, then save it as a cited excerpt.</span>
          <button type="button" data-action="save-selection">SAVE SELECTION</button>
          ${isMemory ? '<button type="button" data-action="edit-memory">EDIT MEMORY</button>' : ''}
        </div>
        ${isMemory ? `<textarea class="research-memory-body" name="memory-body" readonly>${escapeHtml(document.text)}</textarea>` : `<div class="research-document-preview" tabindex="0">${escapeHtml(document.text)}</div>`}
      </article>`;
  }

  private renderSearchResults(): string {
    if (this.results.length === 0) {
      return `<div class="research-empty-state"><strong>NO MATCHES</strong><p>No local document chunks matched “${escapeHtml(this.query)}”.</p></div>`;
    }
    return `<section class="research-results"><header><strong>${this.results.length} LOCAL MATCHES</strong><span>Results are ranked from extracted text and saved excerpts.</span></header>${this.results.map((result) => `
      <article class="research-result" data-result-id="${escapeHtml(result.id)}">
        <header><span>${result.kind.toUpperCase()}${result.page ? ` · PAGE ${result.page}` : ''}</span><strong>${escapeHtml(result.title)}</strong></header>
        <p>${escapeHtml(excerptText(result.text, 620))}</p>
        <footer><button type="button" data-action="open-result" data-document-id="${escapeHtml(result.documentId ?? '')}">OPEN SOURCE</button><button type="button" data-action="save-result-excerpt">SAVE EXCERPT</button><button type="button" data-action="send-result-case">SEND TO CASE</button></footer>
      </article>`).join('')}</section>`;
  }

  private renderExcerpts(): string {
    if (this.excerpts.length === 0) {
      return `<div class="research-empty-state standalone"><div>§</div><strong>NO SAVED EXCERPTS</strong><p>Search a document or select text in the document reader, then choose Save Excerpt.</p></div>`;
    }
    return `<div class="research-excerpts-grid">${this.excerpts.map((excerpt) => `
      <article class="research-excerpt-card" data-excerpt-id="${escapeHtml(excerpt.id)}">
        <header><label><input type="checkbox" data-action="toggle-excerpt" ${excerpt.enabled ? 'checked' : ''}><span>AI CONTEXT</span></label><div><button type="button" data-action="send-excerpt-case">CASE</button><button type="button" data-action="delete-excerpt">×</button></div></header>
        <span>${escapeHtml(excerpt.documentTitle)}${excerpt.page ? ` · Page ${excerpt.page}` : ''}</span>
        <h3>${escapeHtml(excerpt.title)}</h3>
        <p>${escapeHtml(excerpt.text)}</p>
        <small>${formatDate(excerpt.createdAt)}</small>
      </article>`).join('')}</div>`;
  }

  private bindEvents(): void {
    const shell = this.content.querySelector<HTMLElement>('.research-shell');
    if (!shell) return;
    shell.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      this.view = button.dataset.view as ResearchView;
      this.render();
    }));

    const fileInput = shell.querySelector<HTMLInputElement>('.research-file-input');
    const backupInput = shell.querySelector<HTMLInputElement>('.research-backup-input');
    shell.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => void this.handleFiles(Array.from(fileInput.files ?? [])));
    shell.querySelector<HTMLButtonElement>('[data-action="new-memory"]')?.addEventListener('click', () => {
      this.memoryEditorOpen = true;
      this.render();
      this.content.querySelector<HTMLInputElement>('[name="memory-title"]')?.focus();
    });
    shell.querySelector<HTMLButtonElement>('[data-action="cancel-memory"]')?.addEventListener('click', () => {
      this.memoryEditorOpen = false;
      this.render();
    });
    shell.querySelector<HTMLButtonElement>('[data-action="save-memory"]')?.addEventListener('click', () => void this.saveMemory());
    shell.querySelector<HTMLButtonElement>('[data-action="backup"]')?.addEventListener('click', () => void this.backup());
    shell.querySelector<HTMLButtonElement>('[data-action="restore"]')?.addEventListener('click', () => backupInput?.click());
    backupInput?.addEventListener('change', () => void this.restoreBackup(backupInput.files?.[0]));

    const searchInput = shell.querySelector<HTMLInputElement>('.research-search-row input');
    searchInput?.addEventListener('input', () => {
      this.query = searchInput.value;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.runSearch(), 220);
    });

    const dropZone = shell.querySelector<HTMLElement>('.research-drop-zone');
    ['dragenter', 'dragover'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    }));
    dropZone?.addEventListener('drop', (event) => void this.handleFiles(Array.from(event.dataTransfer?.files ?? [])));
    dropZone?.addEventListener('click', () => fileInput?.click());

    shell.querySelectorAll<HTMLButtonElement>('.research-document-row[data-document-id]').forEach((button) => button.addEventListener('click', () => {
      this.selectedDocumentId = button.dataset.documentId ?? null;
      this.query = '';
      this.results = [];
      this.render();
    }));
    shell.querySelector<HTMLInputElement>('[data-action="toggle-context"]')?.addEventListener('change', (event) => void this.toggleDocumentContext((event.currentTarget as HTMLInputElement).checked));
    shell.querySelector<HTMLButtonElement>('[data-action="save-metadata"]')?.addEventListener('click', () => void this.saveMetadata());
    shell.querySelector<HTMLButtonElement>('[data-action="send-document-case"]')?.addEventListener('click', () => void this.sendDocumentToCase());
    shell.querySelector<HTMLButtonElement>('[data-action="delete-document"]')?.addEventListener('click', () => void this.deleteDocument());
    shell.querySelector<HTMLButtonElement>('[data-action="save-selection"]')?.addEventListener('click', () => void this.saveSelection());
    shell.querySelector<HTMLButtonElement>('[data-action="edit-memory"]')?.addEventListener('click', () => this.editMemory());

    shell.querySelectorAll<HTMLButtonElement>('[data-action="open-result"]').forEach((button) => button.addEventListener('click', () => {
      const documentId = button.dataset.documentId;
      if (!documentId) return;
      this.selectedDocumentId = documentId;
      this.query = '';
      this.results = [];
      this.render();
    }));
    shell.querySelectorAll<HTMLButtonElement>('[data-action="save-result-excerpt"]').forEach((button) => button.addEventListener('click', () => void this.saveResultExcerpt(button)));
    shell.querySelectorAll<HTMLButtonElement>('[data-action="send-result-case"]').forEach((button) => button.addEventListener('click', () => void this.sendResultToCase(button)));
    shell.querySelectorAll<HTMLInputElement>('[data-action="toggle-excerpt"]').forEach((input) => input.addEventListener('change', () => void this.toggleExcerpt(input)));
    shell.querySelectorAll<HTMLButtonElement>('[data-action="send-excerpt-case"]').forEach((button) => button.addEventListener('click', () => void this.sendExcerptToCase(button)));
    shell.querySelectorAll<HTMLButtonElement>('[data-action="delete-excerpt"]').forEach((button) => button.addEventListener('click', () => void this.removeExcerpt(button)));
  }

  private async handleFiles(files: File[]): Promise<void> {
    if (files.length === 0 || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const imported = await importResearchFiles(files, (fileName, completed, total) => {
        this.status = `IMPORTING ${completed}/${total} · ${fileName}`;
        const status = this.content.querySelector<HTMLElement>('.research-status');
        if (status) status.textContent = this.status;
      });
      this.selectedDocumentId = imported.length > 0 ? imported[imported.length - 1]!.id : this.selectedDocumentId;
      this.status = `${imported.length} FILE${imported.length === 1 ? '' : 'S'} IMPORTED`;
    } catch (error) {
      this.status = error instanceof Error ? error.message : 'File import failed.';
      window.alert(this.status);
    } finally {
      this.busy = false;
      await this.refreshData();
    }
  }

  private async runSearch(): Promise<void> {
    this.results = this.query.trim() ? await searchResearchLibrary(this.query, 30) : [];
    this.render();
    this.content.querySelector<HTMLInputElement>('.research-search-row input')?.focus();
  }

  private async saveMemory(): Promise<void> {
    const title = this.content.querySelector<HTMLInputElement>('[name="memory-title"]')?.value ?? '';
    const tags = (this.content.querySelector<HTMLInputElement>('[name="memory-tags"]')?.value ?? '').split(',');
    const text = this.content.querySelector<HTMLTextAreaElement>('[name="memory-text"]')?.value ?? '';
    try {
      const memory = await createResearchMemory(title, text, tags);
      this.selectedDocumentId = memory.id;
      this.memoryEditorOpen = false;
      this.view = 'library';
      await this.refreshData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save memory.');
    }
  }

  private async toggleDocumentContext(enabled: boolean): Promise<void> {
    if (!this.selectedDocumentId) return;
    await updateResearchDocument(this.selectedDocumentId, { enabled });
  }

  private async saveMetadata(): Promise<void> {
    if (!this.selectedDocumentId) return;
    const title = this.content.querySelector<HTMLInputElement>('[name="document-title"]')?.value ?? '';
    const tags = (this.content.querySelector<HTMLInputElement>('[name="document-tags"]')?.value ?? '').split(',');
    await updateResearchDocument(this.selectedDocumentId, { title, tags });
  }

  private async deleteDocument(): Promise<void> {
    const document = this.selectedDocument();
    if (!document || !window.confirm(`Delete “${document.title}” and its saved excerpts from this device?`)) return;
    await deleteResearchDocument(document.id);
    this.selectedDocumentId = null;
  }

  private async saveSelection(): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;
    const preview = this.content.querySelector<HTMLElement>('.research-document-preview');
    const activeSelection = window.getSelection();
    const selection = activeSelection?.toString().trim() ?? '';
    const selectionInsidePreview = Boolean(
      preview
      && activeSelection
      && activeSelection.rangeCount > 0
      && preview.contains(activeSelection.getRangeAt(0).commonAncestorContainer),
    );
    if (!selection || !selectionInsidePreview) {
      window.alert('Select text inside the document reader first.');
      return;
    }
    await saveResearchExcerpt({ documentId: document.id, documentTitle: document.title, text: selection });
    this.status = 'SELECTION SAVED AS LOCAL EXCERPT';
  }

  private editMemory(): void {
    const document = this.selectedDocument();
    if (!document || document.kind !== 'memory') return;
    const textarea = this.content.querySelector<HTMLTextAreaElement>('.research-memory-body');
    const toolButton = this.content.querySelector<HTMLButtonElement>('[data-action="edit-memory"]');
    if (!textarea || !toolButton) return;
    if (textarea.readOnly) {
      textarea.readOnly = false;
      textarea.focus();
      toolButton.textContent = 'SAVE MEMORY';
      return;
    }
    void updateResearchDocument(document.id, { text: textarea.value }).then(() => {
      textarea.readOnly = true;
      toolButton.textContent = 'EDIT MEMORY';
    });
  }

  private async saveResultExcerpt(button: HTMLButtonElement): Promise<void> {
    const card = button.closest<HTMLElement>('.research-result');
    const result = this.results.find((item) => item.id === card?.dataset.resultId);
    if (!result) return;
    await saveResearchExcerpt({
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      title: result.title,
      text: result.text,
      page: result.page,
    });
    this.status = 'SEARCH RESULT SAVED AS EXCERPT';
  }


  private async sendDocumentToCase(): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;
    await sendToCaseDesk({
      type: 'source',
      title: document.title,
      detail: excerptText(document.text, 8_000),
      confidence: document.kind === 'memory' ? 'analyst' : 'unverified',
      source: `Research Library · ${document.kind.toUpperCase()}`,
      metadata: {
        'Research document ID': document.id,
        Kind: document.kind,
        Pages: String(document.pageCount ?? ''),
        Tags: document.tags.join(', '),
        'Added locally': new Date(document.addedAt).toISOString(),
      },
    });
  }

  private async sendResultToCase(button: HTMLButtonElement): Promise<void> {
    const card = button.closest<HTMLElement>('.research-result');
    const result = this.results.find((item) => item.id === card?.dataset.resultId);
    if (!result) return;
    await sendToCaseDesk({
      type: 'source',
      title: result.title,
      detail: result.text,
      confidence: 'unverified',
      source: `${result.documentTitle}${result.page ? ` · Page ${result.page}` : ''}`,
      metadata: {
        'Research result ID': result.id,
        'Research document ID': result.documentId ?? '',
        Page: String(result.page ?? ''),
      },
    });
  }

  private async sendExcerptToCase(button: HTMLButtonElement): Promise<void> {
    const card = button.closest<HTMLElement>('.research-excerpt-card');
    const excerpt = this.excerpts.find((item) => item.id === card?.dataset.excerptId);
    if (!excerpt) return;
    await sendToCaseDesk({
      type: 'source',
      title: excerpt.title,
      detail: excerpt.text,
      confidence: 'unverified',
      source: `${excerpt.documentTitle}${excerpt.page ? ` · Page ${excerpt.page}` : ''}`,
      metadata: {
        'Research excerpt ID': excerpt.id,
        'Research document ID': excerpt.documentId ?? '',
        Page: String(excerpt.page ?? ''),
      },
    });
  }

  private async toggleExcerpt(input: HTMLInputElement): Promise<void> {
    const card = input.closest<HTMLElement>('.research-excerpt-card');
    if (!card?.dataset.excerptId) return;
    await updateResearchExcerpt(card.dataset.excerptId, { enabled: input.checked });
  }

  private async removeExcerpt(button: HTMLButtonElement): Promise<void> {
    const card = button.closest<HTMLElement>('.research-excerpt-card');
    if (!card?.dataset.excerptId) return;
    if (!window.confirm('Delete this saved excerpt?')) return;
    await deleteResearchExcerpt(card.dataset.excerptId);
  }

  private async backup(): Promise<void> {
    const snapshot = await exportResearchLibrary();
    downloadJson(`project-v-research-${new Date().toISOString().slice(0, 10)}.json`, snapshot);
  }

  private async restoreBackup(file?: File): Promise<void> {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as unknown;
      const result = await importResearchLibrarySnapshot(value);
      this.status = `RESTORED ${result.documents} DOCUMENTS · ${result.excerpts} EXCERPTS`;
      await this.refreshData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to restore the research backup.');
    }
  }

  public override destroy(): void {
    window.removeEventListener('project-v-research-changed', this.researchChangedHandler);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    super.destroy();
  }
}
