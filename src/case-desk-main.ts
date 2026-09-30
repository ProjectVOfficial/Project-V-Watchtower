import { installWorkspaceLockGuard } from './services/workspace-lock-guard';
import './styles/workspace-windows.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import {
  caseToMarkdown,
  createCase,
  createCaseItem,
  createCaseLink,
  deleteCase,
  deleteCaseItem,
  deleteCaseLink,
  exportCaseDesk,
  getCase,
  importCaseDesk,
  listCaseItems,
  listCaseLinks,
  listCases,
  subscribeCaseDesk,
  updateCase,
  updateCaseItem,
  type CaseConfidence,
  type CaseItem,
  type CaseItemType,
  type CaseLink,
  type ProjectVCase,
} from '@/services/case-desk';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { streamLocalCommand } from '@/services/local-ai-command';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';

applyStoredTheme();
// Each native workspace window has its own JavaScript context. Initialize the
// desktop credential vault here so Ollama settings become available.
void loadDesktopSecrets().catch((error) => console.warn('[case-desk] Unable to load desktop secrets', error));

const appElement = document.getElementById('caseDeskApp');
if (!appElement) throw new Error('Case Desk mount point is missing.');
const app: HTMLElement = appElement;

let cases: ProjectVCase[] = [];
let activeCase: ProjectVCase | null = null;
let items: CaseItem[] = [];
let links: CaseLink[] = [];
let selectedItemId: string | null = null;
let activeTab: 'board' | 'timeline' | 'report' = 'board';
let linkingFromId: string | null = null;
let search = '';
let aiAbort: AbortController | null = null;
let dragState: { id: string; offsetX: number; offsetY: number } | null = null;
let savePositionTimer: ReturnType<typeof setTimeout> | null = null;

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cleanFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'case';
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) await tryInvokeTauri<void>('close_case_desk_window');
  else window.close();
}

function renderShell(): void {
  app.innerHTML = `
    <div class="pv-workspace-shell">
      <header class="pv-workspace-header">
        <div class="pv-workspace-brand"><span>PROJECT V // INVESTIGATIONS</span><strong>CASE DESK</strong></div>
        <div class="pv-workspace-header-actions">
          <button data-global="new-case">NEW CASE</button>
          <button data-global="data-desk">OPEN DATA DESK</button>
          <button data-global="import">IMPORT</button>
          <button data-global="export-all">EXPORT ALL</button>
          <button data-global="close" class="secondary">CLOSE</button>
          <input type="file" data-import-input accept="application/json,.json" hidden>
        </div>
      </header>
      <div class="pv-case-layout">
        <aside class="pv-case-sidebar">
          <div class="pv-sidebar-search"><input type="search" placeholder="SEARCH CASES" data-case-search></div>
          <div class="pv-case-list" data-case-list></div>
        </aside>
        <main class="pv-case-main" data-case-main></main>
        <aside class="pv-case-inspector" data-case-inspector></aside>
      </div>
      <div class="pv-window-status" data-window-status>LOCAL CASE DATABASE READY</div>
    </div>
  `;
  app.querySelector<HTMLButtonElement>('[data-global="new-case"]')?.addEventListener('click', () => void createNewCase());
  app.querySelector<HTMLButtonElement>('[data-global="data-desk"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('data-desk'));
  app.querySelector<HTMLButtonElement>('[data-global="import"]')?.addEventListener('click', () => app.querySelector<HTMLInputElement>('[data-import-input]')?.click());
  app.querySelector<HTMLButtonElement>('[data-global="export-all"]')?.addEventListener('click', () => void exportAll());
  app.querySelector<HTMLButtonElement>('[data-global="close"]')?.addEventListener('click', () => void closeWindow());
  app.querySelector<HTMLInputElement>('[data-case-search]')?.addEventListener('input', (event) => { search = (event.target as HTMLInputElement).value.toLowerCase(); renderCaseList(); });
  app.querySelector<HTMLInputElement>('[data-import-input]')?.addEventListener('change', (event) => void importArchive(event));
}

function status(message: string, error = false): void {
  const element = app.querySelector<HTMLElement>('[data-window-status]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

async function refresh(preferredCaseId?: string): Promise<void> {
  cases = await listCases();
  const requested = preferredCaseId || activeCase?.id || new URLSearchParams(location.search).get('case') || undefined;
  activeCase = (requested ? cases.find((record) => record.id === requested) : null) ?? cases[0] ?? null;
  if (activeCase) {
    [items, links] = await Promise.all([listCaseItems(activeCase.id), listCaseLinks(activeCase.id)]);
    const requestedItem = new URLSearchParams(location.search).get('item');
    if (requestedItem && items.some((item) => item.id === requestedItem)) selectedItemId = requestedItem;
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) selectedItemId = null;
  } else {
    items = [];
    links = [];
    selectedItemId = null;
  }
  renderCaseList();
  renderMain();
  renderInspector();
}

function renderCaseList(): void {
  const list = app.querySelector<HTMLElement>('[data-case-list]');
  if (!list) return;
  const filtered = cases.filter((record) => `${record.title} ${record.description} ${record.tags.join(' ')}`.toLowerCase().includes(search));
  list.innerHTML = filtered.length ? filtered.map((record) => `
    <button class="pv-case-list-item ${record.id === activeCase?.id ? 'active' : ''}" data-case-id="${record.id}">
      <span class="priority ${record.priority}">${record.priority}</span>
      <strong>${escapeHtml(record.title)}</strong>
      <small>${escapeHtml(record.status.toUpperCase())} · ${new Date(record.updatedAt).toLocaleDateString()}</small>
    </button>
  `).join('') : '<div class="pv-empty-state">NO CASES MATCH</div>';
  list.querySelectorAll<HTMLButtonElement>('[data-case-id]').forEach((button) => button.addEventListener('click', () => void selectCase(button.dataset.caseId!)));
}

async function selectCase(caseId: string): Promise<void> {
  activeCase = cases.find((record) => record.id === caseId) ?? await getCase(caseId);
  selectedItemId = null;
  activeTab = 'board';
  await refresh(caseId);
}

function caseHeader(record: ProjectVCase): string {
  return `
    <section class="pv-case-header-card">
      <div class="pv-case-title-block">
        <input class="pv-case-title-input" data-case-field="title" value="${escapeHtml(record.title)}" maxlength="160">
        <textarea data-case-field="description" rows="2" maxlength="20000" placeholder="CASE DESCRIPTION">${escapeHtml(record.description)}</textarea>
      </div>
      <div class="pv-case-meta-controls">
        <label>STATUS<select data-case-field="status"><option value="open" ${record.status === 'open' ? 'selected' : ''}>OPEN</option><option value="on-hold" ${record.status === 'on-hold' ? 'selected' : ''}>ON HOLD</option><option value="closed" ${record.status === 'closed' ? 'selected' : ''}>CLOSED</option></select></label>
        <label>PRIORITY<select data-case-field="priority"><option value="low" ${record.priority === 'low' ? 'selected' : ''}>LOW</option><option value="normal" ${record.priority === 'normal' ? 'selected' : ''}>NORMAL</option><option value="high" ${record.priority === 'high' ? 'selected' : ''}>HIGH</option><option value="critical" ${record.priority === 'critical' ? 'selected' : ''}>CRITICAL</option></select></label>
        <label>TAGS<input data-case-field="tags" value="${escapeHtml(record.tags.join(', '))}" placeholder="tag, tag"></label>
      </div>
      <div class="pv-case-header-actions">
        <button data-case-action="save">SAVE CASE</button>
        <button data-case-action="export">EXPORT</button>
        <button data-case-action="delete" class="danger">DELETE</button>
      </div>
    </section>
  `;
}

function renderMain(): void {
  const main = app.querySelector<HTMLElement>('[data-case-main]');
  if (!main) return;
  if (!activeCase) {
    main.innerHTML = '<div class="pv-welcome"><strong>NO ACTIVE CASE</strong><span>Create a case to begin collecting entities, claims, sources, events, notes, and structured data.</span><button data-welcome-new>CREATE FIRST CASE</button></div>';
    main.querySelector<HTMLButtonElement>('[data-welcome-new]')?.addEventListener('click', () => void createNewCase());
    return;
  }
  main.innerHTML = `
    ${caseHeader(activeCase)}
    <nav class="pv-case-tabs">
      <button data-tab="board" class="${activeTab === 'board' ? 'active' : ''}">EVIDENCE BOARD</button>
      <button data-tab="timeline" class="${activeTab === 'timeline' ? 'active' : ''}">TIMELINE</button>
      <button data-tab="report" class="${activeTab === 'report' ? 'active' : ''}">REPORT / AI</button>
    </nav>
    <section class="pv-case-tab-content" data-case-tab-content></section>
  `;
  main.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => { activeTab = button.dataset.tab as typeof activeTab; renderMain(); renderInspector(); }));
  main.querySelector<HTMLButtonElement>('[data-case-action="save"]')?.addEventListener('click', () => void saveCaseHeader());
  main.querySelector<HTMLButtonElement>('[data-case-action="export"]')?.addEventListener('click', () => void exportCurrent());
  main.querySelector<HTMLButtonElement>('[data-case-action="delete"]')?.addEventListener('click', () => void removeCurrentCase());
  renderActiveTab();
}

function renderActiveTab(): void {
  if (activeTab === 'board') renderBoard();
  else if (activeTab === 'timeline') renderTimeline();
  else renderReport();
}

function itemColor(type: CaseItemType): string {
  return ({ entity: '#9f7aea', claim: '#d63a3a', source: '#2f9e88', event: '#d9902f', note: '#708090', dataset: '#3b82b6' } as Record<CaseItemType, string>)[type];
}

function renderBoard(): void {
  const container = app.querySelector<HTMLElement>('[data-case-tab-content]');
  if (!container || !activeCase) return;
  container.innerHTML = `
    <div class="pv-board-toolbar">
      ${(['entity', 'claim', 'source', 'event', 'note', 'dataset'] as CaseItemType[]).map((type) => `<button data-new-item="${type}">+ ${type.toUpperCase()}</button>`).join('')}
      <span class="pv-link-mode ${linkingFromId ? 'active' : ''}">${linkingFromId ? 'SELECT A SECOND CARD TO CONNECT' : 'SELECT A CARD, THEN LINK'}</span>
      <button data-board-action="cancel-link" ${linkingFromId ? '' : 'disabled'}>CANCEL LINK</button>
    </div>
    <div class="pv-evidence-board" data-board>
      <svg class="pv-board-links" data-board-links></svg>
      <div class="pv-board-cards" data-board-cards></div>
    </div>
  `;
  container.querySelectorAll<HTMLButtonElement>('[data-new-item]').forEach((button) => button.addEventListener('click', () => void addItem(button.dataset.newItem as CaseItemType)));
  container.querySelector<HTMLButtonElement>('[data-board-action="cancel-link"]')?.addEventListener('click', () => { linkingFromId = null; renderBoard(); });
  const cards = container.querySelector<HTMLElement>('[data-board-cards]')!;
  cards.innerHTML = items.map((item) => `
    <article class="pv-evidence-card ${selectedItemId === item.id ? 'selected' : ''} ${linkingFromId === item.id ? 'link-origin' : ''}" data-item-id="${item.id}" style="left:${item.x}px;top:${item.y}px;--item-color:${itemColor(item.type)}">
      <header><span>${item.type.toUpperCase()}</span><button data-link-item="${item.id}" title="Connect this item">⌁</button></header>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.detail.slice(0, 180) || 'No detail added.')}</p>
      <footer><span class="confidence ${item.confidence}">${item.confidence}</span>${item.source ? `<small>${escapeHtml(item.source)}</small>` : ''}</footer>
    </article>
  `).join('');
  cards.querySelectorAll<HTMLElement>('[data-item-id]').forEach((card) => {
    card.addEventListener('pointerdown', (event) => startDrag(event, card));
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-link-item]')) return;
      selectedItemId = card.dataset.itemId!;
      renderInspector();
      cards.querySelectorAll('.pv-evidence-card').forEach((element) => element.classList.toggle('selected', (element as HTMLElement).dataset.itemId === selectedItemId));
    });
  });
  cards.querySelectorAll<HTMLButtonElement>('[data-link-item]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); void linkItem(button.dataset.linkItem!); }));
  drawLinks();
}

function drawLinks(): void {
  const svg = app.querySelector<SVGSVGElement>('[data-board-links]');
  if (!svg) return;
  const itemMap = new Map(items.map((item) => [item.id, item]));
  svg.innerHTML = links.map((link) => {
    const from = itemMap.get(link.fromId); const to = itemMap.get(link.toId);
    if (!from || !to) return '';
    const x1 = from.x + 110; const y1 = from.y + 70; const x2 = to.x + 110; const y2 = to.y + 70;
    const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
    return `<g data-link-id="${link.id}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text x="${mx}" y="${my - 5}">${escapeHtml(link.label)}</text></g>`;
  }).join('');
  svg.querySelectorAll<SVGGElement>('[data-link-id]').forEach((group) => group.addEventListener('dblclick', () => void removeLink(group.dataset.linkId!)));
}

function startDrag(event: PointerEvent, card: HTMLElement): void {
  if ((event.target as HTMLElement).closest('button')) return;
  const item = items.find((candidate) => candidate.id === card.dataset.itemId);
  if (!item) return;
  const board = card.closest<HTMLElement>('[data-board]');
  if (!board) return;
  const bounds = board.getBoundingClientRect();
  dragState = { id: item.id, offsetX: event.clientX - bounds.left - item.x, offsetY: event.clientY - bounds.top - item.y };
  card.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function dragMove(event: PointerEvent): void {
  if (!dragState) return;
  const board = app.querySelector<HTMLElement>('[data-board]');
  const card = app.querySelector<HTMLElement>(`[data-item-id="${dragState.id}"]`);
  const item = items.find((candidate) => candidate.id === dragState!.id);
  if (!board || !card || !item) return;
  const bounds = board.getBoundingClientRect();
  item.x = Math.max(0, Math.round(event.clientX - bounds.left - dragState.offsetX));
  item.y = Math.max(0, Math.round(event.clientY - bounds.top - dragState.offsetY));
  card.style.left = `${item.x}px`; card.style.top = `${item.y}px`;
  drawLinks();
  event.preventDefault();
}

function endDrag(): void {
  if (!dragState) return;
  const item = items.find((candidate) => candidate.id === dragState!.id);
  dragState = null;
  if (!item) return;
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => void updateCaseItem(item.id, { x: item.x, y: item.y }), 120);
}

async function linkItem(itemId: string): Promise<void> {
  if (!linkingFromId) { linkingFromId = itemId; renderBoard(); return; }
  if (linkingFromId === itemId) { linkingFromId = null; renderBoard(); return; }
  const label = window.prompt('Relationship label:', 'RELATED TO')?.trim() || 'RELATED TO';
  await createCaseLink(activeCase!.id, linkingFromId, itemId, label);
  linkingFromId = null;
  await refresh(activeCase!.id);
}

async function removeLink(linkId: string): Promise<void> {
  if (!window.confirm('Remove this relationship?')) return;
  await deleteCaseLink(linkId);
  await refresh(activeCase!.id);
}

function renderTimeline(): void {
  const container = app.querySelector<HTMLElement>('[data-case-tab-content]');
  if (!container) return;
  const timeline = items.filter((item) => item.type === 'event' || item.occurredAt).sort((a, b) => (a.occurredAt ?? a.createdAt) - (b.occurredAt ?? b.createdAt));
  container.innerHTML = `<div class="pv-timeline-view">${timeline.length ? timeline.map((item) => `
    <article data-timeline-item="${item.id}"><time>${new Date(item.occurredAt ?? item.createdAt).toLocaleString()}</time><div><span>${item.confidence}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>
  `).join('') : '<div class="pv-empty-state">NO TIMELINE EVENTS. ADD AN EVENT CARD OR GIVE AN ITEM AN OCCURRENCE DATE.</div>'}</div>`;
  container.querySelectorAll<HTMLElement>('[data-timeline-item]').forEach((element) => element.addEventListener('click', () => { selectedItemId = element.dataset.timelineItem!; renderInspector(); }));
}

function renderReport(): void {
  const container = app.querySelector<HTMLElement>('[data-case-tab-content]');
  if (!container || !activeCase) return;
  const report = caseToMarkdown(activeCase, items, links);
  container.innerHTML = `
    <div class="pv-report-layout">
      <section><header><strong>CASE REPORT</strong><button data-report-action="copy">COPY MARKDOWN</button></header><pre>${escapeHtml(report)}</pre></section>
      <section class="pv-ai-analysis"><header><strong>LOCAL AI CASE ANALYST</strong><button data-report-action="analyze">ANALYZE CASE</button><button data-report-action="settings">API KEYS</button><button data-report-action="stop" disabled>STOP</button></header><div data-ai-output>Use the configured Ollama model to identify supporting evidence, contradictions, uncertainty, and unanswered questions. AI output is analysis—not evidence.</div></section>
    </div>
  `;
  container.querySelector<HTMLButtonElement>('[data-report-action="copy"]')?.addEventListener('click', () => void navigator.clipboard.writeText(report));
  container.querySelector<HTMLButtonElement>('[data-report-action="analyze"]')?.addEventListener('click', () => void analyzeCase());
  container.querySelector<HTMLButtonElement>('[data-report-action="settings"]')?.addEventListener('click', () => void openRuntimeSettings());
  container.querySelector<HTMLButtonElement>('[data-report-action="stop"]')?.addEventListener('click', () => aiAbort?.abort());
}

function renderInspector(): void {
  const inspector = app.querySelector<HTMLElement>('[data-case-inspector]');
  if (!inspector) return;
  const item = items.find((candidate) => candidate.id === selectedItemId);
  if (!item) {
    inspector.innerHTML = `<div class="pv-inspector-empty"><strong>ITEM INSPECTOR</strong><span>Select an evidence card or timeline entry to edit it.</span><small>Double-click a relationship line to remove it.</small></div>`;
    return;
  }
  inspector.innerHTML = `
    <div class="pv-inspector-head"><span>${item.type.toUpperCase()}</span><strong>ITEM INSPECTOR</strong></div>
    <label>TITLE<input data-item-field="title" value="${escapeHtml(item.title)}" maxlength="180"></label>
    <label>TYPE<select data-item-field="type">${(['entity', 'claim', 'source', 'event', 'note', 'dataset'] as CaseItemType[]).map((type) => `<option value="${type}" ${item.type === type ? 'selected' : ''}>${type.toUpperCase()}</option>`).join('')}</select></label>
    <label>CONFIDENCE<select data-item-field="confidence">${(['confirmed', 'probable', 'unverified', 'disputed', 'disproven', 'analyst'] as CaseConfidence[]).map((confidence) => `<option value="${confidence}" ${item.confidence === confidence ? 'selected' : ''}>${confidence.toUpperCase()}</option>`).join('')}</select></label>
    <label>DETAIL<textarea data-item-field="detail" rows="10" maxlength="40000">${escapeHtml(item.detail)}</textarea></label>
    <label>SOURCE<input data-item-field="source" value="${escapeHtml(item.source ?? '')}" maxlength="300"></label>
    <label>SOURCE URL<input data-item-field="sourceUrl" value="${escapeHtml(item.sourceUrl ?? '')}" maxlength="2000"></label>
    <label>OCCURRED<input data-item-field="occurredAt" type="datetime-local" value="${item.occurredAt ? new Date(item.occurredAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></label>
    ${item.metadata ? `<div class="pv-metadata"><strong>STRUCTURED DATA</strong>${Object.entries(item.metadata).slice(0, 40).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><code>${escapeHtml(value)}</code></div>`).join('')}</div>` : ''}
    <div class="pv-inspector-actions"><button data-item-action="save">SAVE ITEM</button><button data-item-action="link">LINK</button><button data-item-action="delete" class="danger">DELETE</button></div>
  `;
  inspector.querySelector<HTMLButtonElement>('[data-item-action="save"]')?.addEventListener('click', () => void saveSelectedItem());
  inspector.querySelector<HTMLButtonElement>('[data-item-action="link"]')?.addEventListener('click', () => { linkingFromId = item.id; activeTab = 'board'; renderMain(); });
  inspector.querySelector<HTMLButtonElement>('[data-item-action="delete"]')?.addEventListener('click', () => void removeSelectedItem());
}

async function saveCaseHeader(): Promise<void> {
  if (!activeCase) return;
  const main = app.querySelector<HTMLElement>('[data-case-main]')!;
  const title = main.querySelector<HTMLInputElement>('[data-case-field="title"]')?.value ?? activeCase.title;
  const description = main.querySelector<HTMLTextAreaElement>('[data-case-field="description"]')?.value ?? '';
  const statusValue = main.querySelector<HTMLSelectElement>('[data-case-field="status"]')?.value as ProjectVCase['status'];
  const priority = main.querySelector<HTMLSelectElement>('[data-case-field="priority"]')?.value as ProjectVCase['priority'];
  const tags = (main.querySelector<HTMLInputElement>('[data-case-field="tags"]')?.value ?? '').split(',');
  activeCase = await updateCase(activeCase.id, { title, description, status: statusValue, priority, tags });
  status('CASE SAVED');
  await refresh(activeCase.id);
}

async function saveSelectedItem(): Promise<void> {
  const item = items.find((candidate) => candidate.id === selectedItemId);
  const inspector = app.querySelector<HTMLElement>('[data-case-inspector]');
  if (!item || !inspector) return;
  const occurredRaw = inspector.querySelector<HTMLInputElement>('[data-item-field="occurredAt"]')?.value;
  await updateCaseItem(item.id, {
    title: inspector.querySelector<HTMLInputElement>('[data-item-field="title"]')?.value ?? item.title,
    type: inspector.querySelector<HTMLSelectElement>('[data-item-field="type"]')?.value as CaseItemType,
    confidence: inspector.querySelector<HTMLSelectElement>('[data-item-field="confidence"]')?.value as CaseConfidence,
    detail: inspector.querySelector<HTMLTextAreaElement>('[data-item-field="detail"]')?.value ?? '',
    source: inspector.querySelector<HTMLInputElement>('[data-item-field="source"]')?.value,
    sourceUrl: inspector.querySelector<HTMLInputElement>('[data-item-field="sourceUrl"]')?.value,
    occurredAt: occurredRaw ? new Date(occurredRaw).getTime() : undefined,
  });
  status('CASE ITEM SAVED');
  await refresh(activeCase!.id);
}

async function addItem(type: CaseItemType): Promise<void> {
  if (!activeCase) return;
  const title = window.prompt(`${type.toUpperCase()} title:`)?.trim();
  if (!title) return;
  const detail = window.prompt('Short detail or note:', '') ?? '';
  const count = items.length;
  const item = await createCaseItem(activeCase.id, { type, title, detail, confidence: type === 'claim' || type === 'source' ? 'unverified' : 'analyst', x: 36 + (count % 4) * 250, y: 36 + Math.floor(count / 4) * 180, occurredAt: type === 'event' ? Date.now() : undefined });
  selectedItemId = item.id;
  await refresh(activeCase.id);
}

async function removeSelectedItem(): Promise<void> {
  if (!selectedItemId || !window.confirm('Delete this item and its relationships?')) return;
  await deleteCaseItem(selectedItemId);
  selectedItemId = null;
  await refresh(activeCase!.id);
}

async function removeCurrentCase(): Promise<void> {
  if (!activeCase || !window.confirm(`Delete “${activeCase.title}” and every item in it?`)) return;
  await deleteCase(activeCase.id);
  activeCase = null;
  await refresh();
}

async function createNewCase(): Promise<void> {
  const title = window.prompt('Case title:', 'New Investigation')?.trim();
  if (!title) return;
  const record = await createCase({ title });
  await refresh(record.id);
}

async function exportCurrent(): Promise<void> {
  if (!activeCase) return;
  const snapshot = await exportCaseDesk(activeCase.id);
  download(`${cleanFileName(activeCase.title)}.pvcase.json`, new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  download(`${cleanFileName(activeCase.title)}.md`, new Blob([caseToMarkdown(activeCase, items, links)], { type: 'text/markdown' }));
  status('CASE JSON AND MARKDOWN EXPORTED');
}

async function exportAll(): Promise<void> {
  const snapshot = await exportCaseDesk();
  download(`project-v-case-desk-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
}

async function importArchive(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try { await importCaseDesk(JSON.parse(await file.text())); await refresh(); status('CASE ARCHIVE IMPORTED'); }
  catch (error) { status(error instanceof Error ? error.message : 'Unable to import archive.', true); }
}

async function analyzeCase(): Promise<void> {
  if (!activeCase) return;
  const output = app.querySelector<HTMLElement>('[data-ai-output]');
  const start = app.querySelector<HTMLButtonElement>('[data-report-action="analyze"]');
  const stop = app.querySelector<HTMLButtonElement>('[data-report-action="stop"]');
  if (!output || !start || !stop) return;

  aiAbort?.abort();
  const controller = new AbortController();
  aiAbort = controller;
  let emitted = 0;
  output.textContent = 'CONNECTING TO LOCAL AI…\nLoading the desktop credential vault and selected Ollama model.';
  start.disabled = true;
  stop.disabled = false;
  status('LOCAL AI CASE ANALYSIS RUNNING');

  const report = caseToMarkdown(activeCase, items, links).slice(0, 45_000);
  try {
    await streamLocalCommand({
      signal: controller.signal,
      temperature: 0.15,
      messages: [
        { role: 'system', content: 'You are the Project V Case Analyst. Treat every supplied item as analyst material, not established truth. Separate evidence, claims, contradictions, uncertainty, missing evidence, and suggested verification steps. Cite item titles in square brackets. Do not invent sources.' },
        { role: 'user', content: `Analyze this case file:\n\n${report}` },
      ],
      onToken: (token) => {
        if (emitted === 0) output.textContent = '';
        emitted += token.length;
        output.textContent += token;
        output.scrollTop = output.scrollHeight;
      },
    });
    if (emitted === 0) {
      output.textContent = 'The local model completed the request but returned an empty response. Verify the selected model under API Keys and try again.';
    }
    status(emitted > 0 ? 'CASE ANALYSIS COMPLETE' : 'LOCAL AI RETURNED AN EMPTY RESPONSE', emitted === 0);
  } catch (error) {
    if (controller.signal.aborted) {
      if (emitted === 0) output.textContent = 'CASE ANALYSIS STOPPED';
      status('CASE ANALYSIS STOPPED');
    } else {
      const message = error instanceof Error ? error.message : 'Local AI analysis failed.';
      output.textContent = `LOCAL AI CASE ANALYSIS FAILED\n\n${message}\n\nOpen API Keys and verify OLLAMA_API_URL, OLLAMA_MODEL, and that Ollama is running.`;
      status('LOCAL AI CASE ANALYSIS FAILED', true);
    }
  } finally {
    start.disabled = false;
    stop.disabled = true;
    if (aiAbort === controller) aiAbort = null;
  }
}

installWorkspaceLockGuard();
renderShell();
window.addEventListener('pointermove', dragMove, { passive: false });
window.addEventListener('pointerup', endDrag);
void refresh();
const unsubscribe = subscribeCaseDesk(() => void refresh(activeCase?.id));
window.addEventListener('beforeunload', () => { unsubscribe(); aiAbort?.abort(); });

