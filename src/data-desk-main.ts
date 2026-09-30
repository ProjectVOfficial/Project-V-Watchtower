import { installWorkspaceLockGuard } from './services/workspace-lock-guard';
import './styles/workspace-windows.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import {
  createWorkbook,
  createWorkbookSnapshot,
  deleteWorkbook,
  getWorkbook,
  importWorkbook,
  listWorkbooks,
  restoreWorkbookSnapshot,
  saveWorkbook,
  type ProjectVWorkbook,
} from '@/services/data-desk';
import { createCsv, createXlsx, cellReference, type LiteSheet } from '@/services/xlsx-lite';
import { sendToCaseDesk } from '@/services/case-handoff';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';
import { streamLocalCommand } from '@/services/local-ai-command';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';

applyStoredTheme();
// Data Desk is a separate native window and must initialize its own view of
// the desktop vault before local-AI analysis can read Ollama settings.
void loadDesktopSecrets().catch((error) => console.warn('[data-desk] Unable to load desktop secrets', error));
const appElement = document.getElementById('dataDeskApp');
if (!appElement) throw new Error('Data Desk mount point is missing.');
const app: HTMLElement = appElement;

let workbooks: ProjectVWorkbook[] = [];
let active: ProjectVWorkbook | null = null;
let selectedCell = { row: 0, column: 0 };
let selectedRow = 0;
let workbookSearch = '';
let gridSearch = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let aiAbort: AbortController | null = null;

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function fileName(value: string, extension: string): string {
  const clean = value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'workbook';
  return `${clean}.${extension}`;
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) await tryInvokeTauri<void>('close_data_desk_window');
  else window.close();
}

function renderShell(): void {
  app.innerHTML = `
    <div class="pv-workspace-shell">
      <header class="pv-workspace-header">
        <div class="pv-workspace-brand"><span>PROJECT V // STRUCTURED INTELLIGENCE</span><strong>DATA DESK</strong></div>
        <div class="pv-workspace-header-actions">
          <button data-global="new">NEW WORKBOOK</button>
          <button data-global="import">IMPORT XLSX / CSV</button>
          <button data-global="case-desk">OPEN CASE DESK</button>
          <button data-global="close" class="secondary">CLOSE</button>
          <input type="file" data-import-input accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>
        </div>
      </header>
      <div class="pv-data-layout">
        <aside class="pv-data-sidebar">
          <div class="pv-sidebar-search"><input type="search" placeholder="SEARCH WORKBOOKS" data-workbook-search></div>
          <div class="pv-workbook-list" data-workbook-list></div>
        </aside>
        <main class="pv-data-main" data-data-main></main>
        <aside class="pv-data-inspector" data-data-inspector></aside>
      </div>
      <div class="pv-window-status" data-window-status>LOCAL DATA DESK READY</div>
    </div>
  `;
  app.querySelector<HTMLButtonElement>('[data-global="new"]')?.addEventListener('click', () => void newWorkbook());
  app.querySelector<HTMLButtonElement>('[data-global="import"]')?.addEventListener('click', () => app.querySelector<HTMLInputElement>('[data-import-input]')?.click());
  app.querySelector<HTMLButtonElement>('[data-global="case-desk"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('case-desk'));
  app.querySelector<HTMLButtonElement>('[data-global="close"]')?.addEventListener('click', () => void closeWindow());
  app.querySelector<HTMLInputElement>('[data-workbook-search]')?.addEventListener('input', (event) => { workbookSearch = (event.target as HTMLInputElement).value.toLowerCase(); renderWorkbookList(); });
  app.querySelector<HTMLInputElement>('[data-import-input]')?.addEventListener('change', (event) => void importSelected(event));
}

function status(message: string, error = false): void {
  const element = app.querySelector<HTMLElement>('[data-window-status]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function activeSheet(): LiteSheet | null {
  if (!active) return null;
  return active.sheets.find((sheet) => sheet.id === active!.activeSheetId) ?? active.sheets[0] ?? null;
}

async function refresh(preferredId?: string): Promise<void> {
  workbooks = await listWorkbooks();
  const queryId = new URLSearchParams(location.search).get('workbook') ?? undefined;
  const id = preferredId || active?.id || queryId;
  active = (id ? workbooks.find((workbook) => workbook.id === id) : null) ?? workbooks[0] ?? null;
  selectedCell = { row: 0, column: 0 }; selectedRow = 0;
  renderWorkbookList(); renderMain(); renderInspector();
}

function renderWorkbookList(): void {
  const list = app.querySelector<HTMLElement>('[data-workbook-list]');
  if (!list) return;
  const filtered = workbooks.filter((workbook) => `${workbook.title} ${workbook.fileName}`.toLowerCase().includes(workbookSearch));
  list.innerHTML = filtered.length ? filtered.map((workbook) => `
    <button class="pv-workbook-list-item ${workbook.id === active?.id ? 'active' : ''}" data-workbook-id="${workbook.id}">
      <span>${workbook.sourceType.toUpperCase()}</span><strong>${escapeHtml(workbook.title)}</strong><small>${workbook.sheets.length} SHEET${workbook.sheets.length === 1 ? '' : 'S'} · ${new Date(workbook.updatedAt).toLocaleDateString()}</small>
    </button>
  `).join('') : '<div class="pv-empty-state">NO WORKBOOKS MATCH</div>';
  list.querySelectorAll<HTMLButtonElement>('[data-workbook-id]').forEach((button) => button.addEventListener('click', () => void selectWorkbook(button.dataset.workbookId!)));
}

async function selectWorkbook(id: string): Promise<void> {
  active = await getWorkbook(id); selectedCell = { row: 0, column: 0 }; selectedRow = 0; renderWorkbookList(); renderMain(); renderInspector();
}

function renderMain(): void {
  const main = app.querySelector<HTMLElement>('[data-data-main]');
  if (!main) return;
  if (!active) {
    main.innerHTML = '<div class="pv-welcome"><strong>NO WORKBOOK LOADED</strong><span>Import an XLSX or CSV file, or create a local workbook. Original files are not overwritten.</span><div><button data-welcome-import>IMPORT FILE</button><button data-welcome-new>CREATE WORKBOOK</button></div></div>';
    main.querySelector<HTMLButtonElement>('[data-welcome-import]')?.addEventListener('click', () => app.querySelector<HTMLInputElement>('[data-import-input]')?.click());
    main.querySelector<HTMLButtonElement>('[data-welcome-new]')?.addEventListener('click', () => void newWorkbook());
    return;
  }
  const sheet = activeSheet();
  main.innerHTML = `
    <section class="pv-data-header-card">
      <input class="pv-workbook-title" data-workbook-title value="${escapeHtml(active.title)}" maxlength="160">
      <div class="pv-data-actions">
        <button data-data-action="save">SAVE</button>
        <button data-data-action="snapshot">SNAPSHOT</button>
        <button data-data-action="xlsx">EXPORT XLSX</button>
        <button data-data-action="csv">EXPORT CSV</button>
        <button data-data-action="delete" class="danger">DELETE</button>
      </div>
    </section>
    <div class="pv-sheet-tabs" data-sheet-tabs>
      ${active.sheets.map((candidate) => `<button data-sheet-id="${candidate.id}" class="${candidate.id === sheet?.id ? 'active' : ''}">${escapeHtml(candidate.name)}</button>`).join('')}
      <button data-sheet-action="add">+</button><button data-sheet-action="rename">RENAME</button><button data-sheet-action="delete">REMOVE</button>
    </div>
    <div class="pv-formula-bar"><span data-cell-reference>${cellReference(selectedCell.row, selectedCell.column)}</span><input data-formula-input value="${escapeHtml(cellDisplayValue(sheet, selectedCell.row, selectedCell.column))}" placeholder="CELL VALUE OR =FORMULA"></div>
    <div class="pv-grid-toolbar">
      <button data-grid-action="row">+ ROW</button><button data-grid-action="column">+ COLUMN</button><button data-grid-action="delete-row">DELETE ROW</button><button data-grid-action="delete-column">DELETE COLUMN</button>
      <input type="search" data-grid-search value="${escapeHtml(gridSearch)}" placeholder="FIND IN SHEET">
      <span>SELECTED ROW ${selectedRow + 1}</span>
    </div>
    <div class="pv-sheet-grid-wrap" data-grid-wrap></div>
  `;
  main.querySelector<HTMLButtonElement>('[data-data-action="save"]')?.addEventListener('click', () => void saveActive(true));
  main.querySelector<HTMLButtonElement>('[data-data-action="snapshot"]')?.addEventListener('click', () => void snapshot());
  main.querySelector<HTMLButtonElement>('[data-data-action="xlsx"]')?.addEventListener('click', exportXlsx);
  main.querySelector<HTMLButtonElement>('[data-data-action="csv"]')?.addEventListener('click', exportCsv);
  main.querySelector<HTMLButtonElement>('[data-data-action="delete"]')?.addEventListener('click', () => void removeWorkbook());
  main.querySelectorAll<HTMLButtonElement>('[data-sheet-id]').forEach((button) => button.addEventListener('click', () => { active!.activeSheetId = button.dataset.sheetId!; selectedCell = { row: 0, column: 0 }; selectedRow = 0; renderMain(); renderInspector(); scheduleSave(); }));
  main.querySelector<HTMLButtonElement>('[data-sheet-action="add"]')?.addEventListener('click', addSheet);
  main.querySelector<HTMLButtonElement>('[data-sheet-action="rename"]')?.addEventListener('click', renameSheet);
  main.querySelector<HTMLButtonElement>('[data-sheet-action="delete"]')?.addEventListener('click', deleteSheet);
  main.querySelector<HTMLInputElement>('[data-formula-input]')?.addEventListener('change', (event) => updateSelectedCell((event.target as HTMLInputElement).value));
  main.querySelector<HTMLButtonElement>('[data-grid-action="row"]')?.addEventListener('click', addRow);
  main.querySelector<HTMLButtonElement>('[data-grid-action="column"]')?.addEventListener('click', addColumn);
  main.querySelector<HTMLButtonElement>('[data-grid-action="delete-row"]')?.addEventListener('click', deleteRow);
  main.querySelector<HTMLButtonElement>('[data-grid-action="delete-column"]')?.addEventListener('click', deleteColumn);
  main.querySelector<HTMLInputElement>('[data-grid-search]')?.addEventListener('input', (event) => { gridSearch = (event.target as HTMLInputElement).value.toLowerCase(); renderGrid(); });
  renderGrid();
}

function dimensions(sheet: LiteSheet): { rows: number; columns: number } {
  return { rows: Math.min(500, Math.max(30, sheet.rows.length)), columns: Math.min(60, Math.max(12, ...sheet.rows.map((row) => row.length))) };
}

function cellDisplayValue(sheet: LiteSheet | null, row: number, column: number): string {
  if (!sheet) return '';
  const reference = cellReference(row, column);
  return sheet.formulas[reference] ? `=${sheet.formulas[reference]}` : (sheet.rows[row]?.[column] ?? '');
}

function renderGrid(): void {
  const wrap = app.querySelector<HTMLElement>('[data-grid-wrap]');
  const sheet = activeSheet();
  if (!wrap || !sheet) return;
  const size = dimensions(sheet);
  const headers = Array.from({ length: size.columns }, (_, column) => `<th>${cellReference(0, column).replace(/\d+$/, '')}</th>`).join('');
  const rows = Array.from({ length: size.rows }, (_, row) => {
    const cells = Array.from({ length: size.columns }, (_, column) => {
      const value = cellDisplayValue(sheet, row, column);
      const match = Boolean(gridSearch && value.toLowerCase().includes(gridSearch));
      return `<td class="${selectedCell.row === row && selectedCell.column === column ? 'selected' : ''} ${match ? 'match' : ''}"><input data-cell-row="${row}" data-cell-column="${column}" value="${escapeHtml(value)}"></td>`;
    }).join('');
    return `<tr class="${selectedRow === row ? 'selected-row' : ''}"><th>${row + 1}</th>${cells}</tr>`;
  }).join('');
  wrap.innerHTML = `<table class="pv-sheet-grid"><thead><tr><th class="corner"></th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll<HTMLInputElement>('[data-cell-row]').forEach((input) => {
    input.addEventListener('focus', () => selectCell(Number(input.dataset.cellRow), Number(input.dataset.cellColumn)));
    input.addEventListener('input', () => { setCell(Number(input.dataset.cellRow), Number(input.dataset.cellColumn), input.value); scheduleSave(); });
  });
}

function selectCell(row: number, column: number): void {
  selectedCell = { row, column }; selectedRow = row;
  const reference = app.querySelector<HTMLElement>('[data-cell-reference]');
  const formula = app.querySelector<HTMLInputElement>('[data-formula-input]');
  if (reference) reference.textContent = cellReference(row, column);
  if (formula) formula.value = cellDisplayValue(activeSheet(), row, column);
  app.querySelectorAll('td.selected').forEach((element) => element.classList.remove('selected'));
  app.querySelector<HTMLInputElement>(`[data-cell-row="${row}"][data-cell-column="${column}"]`)?.closest('td')?.classList.add('selected');
  app.querySelectorAll('tbody tr.selected-row').forEach((element) => element.classList.remove('selected-row'));
  app.querySelector<HTMLInputElement>(`[data-cell-row="${row}"]`)?.closest('tr')?.classList.add('selected-row');
  renderInspector();
}

function setCell(row: number, column: number, value: string): void {
  const sheet = activeSheet(); if (!sheet) return;
  sheet.rows[row] ??= [];
  while (sheet.rows[row]!.length <= column) sheet.rows[row]!.push('');
  const reference = cellReference(row, column);
  if (value.startsWith('=')) { sheet.formulas[reference] = value.slice(1); sheet.rows[row]![column] = ''; }
  else { delete sheet.formulas[reference]; sheet.rows[row]![column] = value; }
}

function updateSelectedCell(value: string): void {
  setCell(selectedCell.row, selectedCell.column, value);
  const input = app.querySelector<HTMLInputElement>(`[data-cell-row="${selectedCell.row}"][data-cell-column="${selectedCell.column}"]`);
  if (input) input.value = value;
  scheduleSave();
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveActive(false), 600);
}

async function saveActive(showStatus: boolean): Promise<void> {
  if (!active) return;
  const title = app.querySelector<HTMLInputElement>('[data-workbook-title]')?.value;
  if (title !== undefined) active.title = title;
  active = await saveWorkbook(active);
  workbooks = await listWorkbooks(); renderWorkbookList();
  if (showStatus) status('WORKBOOK SAVED TO LOCAL DATA DESK');
}

function renderInspector(): void {
  const inspector = app.querySelector<HTMLElement>('[data-data-inspector]');
  const sheet = activeSheet();
  if (!inspector || !active || !sheet) {
    if (inspector) inspector.innerHTML = '<div class="pv-inspector-empty"><strong>DATA TOOLS</strong><span>Open a workbook to inspect rows, snapshots, and local AI analysis.</span></div>';
    return;
  }
  const row = sheet.rows[selectedRow] ?? [];
  const header = sheet.rows[0] ?? [];
  inspector.innerHTML = `
    <div class="pv-inspector-head"><span>ROW ${selectedRow + 1}</span><strong>DATA TOOLS</strong></div>
    <div class="pv-selected-row-preview">${row.slice(0, 30).map((value, index) => `<div><span>${escapeHtml(header[index] || cellReference(0, index).replace(/\d+$/, ''))}</span><code>${escapeHtml(value)}</code></div>`).join('') || '<em>EMPTY ROW</em>'}</div>
    <div class="pv-inspector-actions vertical"><button data-tool-action="case">SEND ROW TO CASE</button><button data-tool-action="ai-row">ANALYZE ROW</button><button data-tool-action="ai-sheet">SUMMARIZE SHEET</button></div>
    <section class="pv-snapshot-section"><header><strong>SNAPSHOTS</strong><span>${active.snapshots.length}</span></header>${active.snapshots.length ? active.snapshots.slice().reverse().map((snapshot) => `<button data-snapshot-id="${snapshot.id}"><strong>${escapeHtml(snapshot.label)}</strong><small>${new Date(snapshot.createdAt).toLocaleString()}</small></button>`).join('') : '<div class="pv-empty-state">NO SNAPSHOTS YET</div>'}</section>
    <section class="pv-data-ai"><header><strong>LOCAL AI OUTPUT</strong><button data-ai-stop disabled>STOP</button></header><pre data-ai-output>Choose ANALYZE ROW or SUMMARIZE SHEET. Only the selected data is sent to your configured local AI endpoint.</pre></section>
  `;
  inspector.querySelector<HTMLButtonElement>('[data-tool-action="case"]')?.addEventListener('click', () => void sendRowToCase());
  inspector.querySelector<HTMLButtonElement>('[data-tool-action="ai-row"]')?.addEventListener('click', () => void analyzeData('row'));
  inspector.querySelector<HTMLButtonElement>('[data-tool-action="ai-sheet"]')?.addEventListener('click', () => void analyzeData('sheet'));
  inspector.querySelector<HTMLButtonElement>('[data-ai-stop]')?.addEventListener('click', () => aiAbort?.abort());
  inspector.querySelectorAll<HTMLButtonElement>('[data-snapshot-id]').forEach((button) => button.addEventListener('click', () => void restoreSnapshot(button.dataset.snapshotId!)));
}

async function newWorkbook(): Promise<void> {
  const title = window.prompt('Workbook title:', 'Untitled Workbook')?.trim(); if (!title) return;
  const workbook = await createWorkbook(title); await refresh(workbook.id);
}

async function importSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
  status(`IMPORTING ${file.name.toUpperCase()}...`);
  try { const workbook = await importWorkbook(file); await refresh(workbook.id); status(`${file.name.toUpperCase()} IMPORTED AS A LOCAL WORKING COPY`); }
  catch (error) { status(error instanceof Error ? error.message : 'Unable to import workbook.', true); }
}

async function removeWorkbook(): Promise<void> {
  if (!active || !window.confirm(`Delete the Project V working copy of “${active.title}”? The original file is not affected.`)) return;
  await deleteWorkbook(active.id); active = null; await refresh();
}

function addSheet(): void {
  if (!active) return;
  const name = window.prompt('Worksheet name:', `Sheet ${active.sheets.length + 1}`)?.trim(); if (!name) return;
  const sheet: LiteSheet = { id: `sheet-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, name: name.slice(0, 31), rows: Array.from({ length: 20 }, () => Array(8).fill('')), formulas: {} };
  active.sheets.push(sheet); active.activeSheetId = sheet.id; renderMain(); renderInspector(); scheduleSave();
}

function renameSheet(): void {
  const sheet = activeSheet(); if (!sheet) return;
  const name = window.prompt('Worksheet name:', sheet.name)?.trim(); if (!name) return;
  sheet.name = name.slice(0, 31); renderMain(); scheduleSave();
}

function deleteSheet(): void {
  if (!active || active.sheets.length <= 1 || !window.confirm('Remove this worksheet from the Project V working copy?')) return;
  active.sheets = active.sheets.filter((sheet) => sheet.id !== active!.activeSheetId); active.activeSheetId = active.sheets[0]!.id; renderMain(); renderInspector(); scheduleSave();
}

function addRow(): void { const sheet = activeSheet(); if (!sheet) return; const columns = Math.max(8, ...sheet.rows.map((row) => row.length)); sheet.rows.splice(selectedRow + 1, 0, Array(columns).fill('')); renderGrid(); scheduleSave(); }
function addColumn(): void { const sheet = activeSheet(); if (!sheet) return; const column = selectedCell.column + 1; for (const row of sheet.rows) row.splice(column, 0, ''); sheet.formulas = {}; renderGrid(); scheduleSave(); }
function deleteRow(): void { const sheet = activeSheet(); if (!sheet || sheet.rows.length <= 1 || !window.confirm(`Delete row ${selectedRow + 1}?`)) return; sheet.rows.splice(selectedRow, 1); selectedRow = Math.max(0, selectedRow - 1); selectedCell.row = selectedRow; sheet.formulas = {}; renderGrid(); renderInspector(); scheduleSave(); }
function deleteColumn(): void { const sheet = activeSheet(); if (!sheet || !window.confirm(`Delete column ${cellReference(0, selectedCell.column).replace(/\d+$/, '')}?`)) return; for (const row of sheet.rows) row.splice(selectedCell.column, 1); selectedCell.column = Math.max(0, selectedCell.column - 1); sheet.formulas = {}; renderGrid(); renderInspector(); scheduleSave(); }

async function snapshot(): Promise<void> {
  if (!active) return; await saveActive(false); const label = window.prompt('Snapshot label:', 'Manual snapshot')?.trim() || 'Manual snapshot'; active = await createWorkbookSnapshot(active.id, label); status('WORKBOOK SNAPSHOT CREATED'); renderInspector();
}

async function restoreSnapshot(snapshotId: string): Promise<void> {
  if (!active || !window.confirm('Restore this workbook snapshot? Current unsaved sheet changes will be replaced.')) return;
  active = await restoreWorkbookSnapshot(active.id, snapshotId); renderMain(); renderInspector(); status('SNAPSHOT RESTORED');
}

function exportXlsx(): void {
  if (!active) return; download(fileName(active.title, 'xlsx'), createXlsx({ title: active.title, sheets: active.sheets })); status('XLSX EXPORTED');
}

function exportCsv(): void {
  const sheet = activeSheet(); if (!active || !sheet) return; download(fileName(`${active.title}-${sheet.name}`, 'csv'), createCsv(sheet)); status('CURRENT SHEET EXPORTED AS CSV');
}

async function sendRowToCase(): Promise<void> {
  if (!active) return;
  const sheet = activeSheet();
  if (!sheet) return;
  const header = sheet.rows[0] ?? [];
  const row = sheet.rows[selectedRow] ?? [];
  const metadata: Record<string, string> = {
    'Workbook ID': active.id,
    Workbook: active.title,
    'Source file': active.fileName || 'Project V local workbook',
    Worksheet: sheet.name,
    Row: String(selectedRow + 1),
  };
  row.forEach((value, index) => {
    if (value !== '') metadata[header[index] || cellReference(0, index).replace(/\d+$/, '')] = value;
  });
  const item = await sendToCaseDesk({
    type: 'dataset',
    title: `${active.title} // ${sheet.name} // ROW ${selectedRow + 1}`,
    detail: `Structured row filed from ${active.fileName || active.title}, worksheet ${sheet.name}, row ${selectedRow + 1}.`,
    confidence: 'analyst',
    source: `${active.title} — ${sheet.name} — Row ${selectedRow + 1}`,
    metadata,
  });
  if (item) status('SELECTED ROW FILED IN CASE DESK');
}

function sheetContext(sheet: LiteSheet, mode: 'row' | 'sheet'): string {
  if (mode === 'row') {
    const header = sheet.rows[0] ?? []; const row = sheet.rows[selectedRow] ?? [];
    return row.map((value, index) => `${header[index] || cellReference(0, index).replace(/\d+$/, '')}: ${value}`).join('\n').slice(0, 20_000);
  }
  return sheet.rows.slice(0, 150).map((row, index) => `${index + 1}: ${row.slice(0, 40).join(' | ')}`).join('\n').slice(0, 45_000);
}

async function analyzeData(mode: 'row' | 'sheet'): Promise<void> {
  const sheet = activeSheet(); const output = app.querySelector<HTMLElement>('[data-ai-output]'); const stop = app.querySelector<HTMLButtonElement>('[data-ai-stop]');
  if (!active || !sheet || !output || !stop) return;
  aiAbort?.abort(); aiAbort = new AbortController(); output.textContent = 'CONNECTING TO LOCAL AI…\nLoading the desktop credential vault and selected Ollama model.'; stop.disabled = false;
  try {
    await streamLocalCommand({
      signal: aiAbort.signal,
      temperature: 0.15,
      messages: [
        { role: 'system', content: 'You are the Project V Data Analyst. Analyze only the supplied structured data. Identify patterns, duplicates, missing fields, inconsistencies, and questions for verification. Do not invent facts. Cite worksheet row numbers or column names.' },
        { role: 'user', content: `${mode === 'row' ? 'Analyze this selected workbook row' : 'Summarize and review this worksheet sample'} from ${active.title} / ${sheet.name}:\n\n${sheetContext(sheet, mode)}` },
      ],
      onToken: (token) => { output.textContent += token; output.scrollTop = output.scrollHeight; },
    });
  } catch (error) {
    if (!aiAbort.signal.aborted) output.textContent += `\n\nERROR: ${error instanceof Error ? error.message : 'Local AI analysis failed.'}`;
  } finally { stop.disabled = true; aiAbort = null; }
}

installWorkspaceLockGuard();
renderShell();
void refresh();
window.addEventListener('beforeunload', () => { aiAbort?.abort(); if (saveTimer) clearTimeout(saveTimer); });

