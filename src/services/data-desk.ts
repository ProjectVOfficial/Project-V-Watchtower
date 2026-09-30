import { parseCsv, parseXlsx, type LiteSheet, type LiteWorkbook } from './xlsx-lite';

export interface WorkbookSnapshot {
  id: string;
  label: string;
  createdAt: number;
  sheets: LiteSheet[];
}

export interface ProjectVWorkbook extends LiteWorkbook {
  id: string;
  fileName: string;
  sourceType: 'xlsx' | 'csv' | 'manual';
  activeSheetId: string;
  createdAt: number;
  updatedAt: number;
  snapshots: WorkbookSnapshot[];
}

export interface DataDeskStats {
  total: number;
  sheetCount: number;
  recentlyUpdated?: ProjectVWorkbook;
}

export interface DataDeskSnapshot {
  schema: 'project-v-data-desk';
  version: 1;
  exportedAt: number;
  workbooks: ProjectVWorkbook[];
}

const DB_NAME = 'project-v-data-desk';
const DB_VERSION = 1;
const STORE = 'workbooks';
const CHANNEL_NAME = 'project-v-data-desk-events';
let databasePromise: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSheet(sheet: LiteSheet): LiteSheet {
  return { ...sheet, rows: sheet.rows.map((row) => [...row]), formulas: { ...sheet.formulas } };
}

function cloneWorkbook(workbook: ProjectVWorkbook): ProjectVWorkbook {
  return { ...workbook, sheets: workbook.sheets.map(cloneSheet), snapshots: workbook.snapshots.map((snapshot) => ({ ...snapshot, sheets: snapshot.sheets.map(cloneSheet) })) };
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the Project V Data Desk database.'));
  });
  return databasePromise;
}

function announce(kind: string, workbookId?: string): void {
  window.dispatchEvent(new CustomEvent('project-v-data-desk-changed', { detail: { kind, workbookId } }));
  try {
    channel ??= new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ kind, workbookId, at: Date.now() });
  } catch { /* optional */ }
}

export function subscribeDataDesk(listener: () => void): () => void {
  const local = () => listener();
  window.addEventListener('project-v-data-desk-changed', local);
  let remote: BroadcastChannel | null = null;
  try { remote = new BroadcastChannel(CHANNEL_NAME); remote.addEventListener('message', local); } catch { /* optional */ }
  return () => { window.removeEventListener('project-v-data-desk-changed', local); remote?.close(); };
}

async function put(workbook: ProjectVWorkbook): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(workbook);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save workbook.'));
  });
}

export async function listWorkbooks(): Promise<ProjectVWorkbook[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as ProjectVWorkbook[]).sort((a, b) => b.updatedAt - a.updatedAt).map(cloneWorkbook));
    request.onerror = () => reject(request.error ?? new Error('Unable to read workbooks.'));
  });
}

export async function getWorkbook(workbookId: string): Promise<ProjectVWorkbook | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(workbookId);
    request.onsuccess = () => resolve(request.result ? cloneWorkbook(request.result as ProjectVWorkbook) : null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read workbook.'));
  });
}

export async function createWorkbook(title = 'Untitled Workbook'): Promise<ProjectVWorkbook> {
  const now = Date.now();
  const sheet: LiteSheet = { id: id('sheet'), name: 'Sheet 1', rows: Array.from({ length: 20 }, () => Array(8).fill('')), formulas: {} };
  const workbook: ProjectVWorkbook = { id: id('workbook'), title: title.trim().slice(0, 160) || 'Untitled Workbook', fileName: '', sourceType: 'manual', activeSheetId: sheet.id, sheets: [sheet], snapshots: [], createdAt: now, updatedAt: now };
  await put(workbook);
  announce('workbook-created', workbook.id);
  return cloneWorkbook(workbook);
}

export async function importWorkbook(file: File): Promise<ProjectVWorkbook> {
  if (file.size > 40 * 1024 * 1024) throw new Error('Workbook exceeds the 40 MB local import limit.');
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xls')) throw new Error('Legacy .xls files are not executed or parsed. Open the file in Excel and save it as .xlsx or .csv first.');
  let parsed: LiteWorkbook;
  let sourceType: ProjectVWorkbook['sourceType'];
  if (lower.endsWith('.xlsx')) { parsed = await parseXlsx(file); sourceType = 'xlsx'; }
  else if (lower.endsWith('.csv')) { parsed = { title: file.name.replace(/\.csv$/i, ''), sheets: [parseCsv(await file.text(), 'Sheet 1')] }; sourceType = 'csv'; }
  else throw new Error('Supported Data Desk formats are .xlsx and .csv.');
  const now = Date.now();
  const workbook: ProjectVWorkbook = { id: id('workbook'), title: parsed.title || file.name, fileName: file.name, sourceType, activeSheetId: parsed.sheets[0]!.id, sheets: parsed.sheets, snapshots: [], createdAt: now, updatedAt: now };
  await put(workbook);
  announce('workbook-imported', workbook.id);
  return cloneWorkbook(workbook);
}

export async function saveWorkbook(workbook: ProjectVWorkbook): Promise<ProjectVWorkbook> {
  const next = { ...cloneWorkbook(workbook), title: workbook.title.trim().slice(0, 160) || 'Untitled Workbook', updatedAt: Date.now(), snapshots: workbook.snapshots.slice(-12) };
  await put(next);
  announce('workbook-updated', next.id);
  return cloneWorkbook(next);
}

export async function deleteWorkbook(workbookId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(workbookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete workbook.'));
  });
  announce('workbook-deleted', workbookId);
}

export async function createWorkbookSnapshot(workbookId: string, label = 'Manual snapshot'): Promise<ProjectVWorkbook> {
  const workbook = await getWorkbook(workbookId);
  if (!workbook) throw new Error('Workbook not found.');
  workbook.snapshots.push({ id: id('snapshot'), label: label.trim().slice(0, 100) || 'Manual snapshot', createdAt: Date.now(), sheets: workbook.sheets.map(cloneSheet) });
  return saveWorkbook(workbook);
}

export async function restoreWorkbookSnapshot(workbookId: string, snapshotId: string): Promise<ProjectVWorkbook> {
  const workbook = await getWorkbook(workbookId);
  if (!workbook) throw new Error('Workbook not found.');
  const snapshot = workbook.snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error('Snapshot not found.');
  workbook.sheets = snapshot.sheets.map(cloneSheet);
  workbook.activeSheetId = workbook.sheets[0]?.id ?? '';
  return saveWorkbook(workbook);
}

export async function getDataDeskStats(): Promise<DataDeskStats> {
  const workbooks = await listWorkbooks();
  return { total: workbooks.length, sheetCount: workbooks.reduce((sum, workbook) => sum + workbook.sheets.length, 0), recentlyUpdated: workbooks[0] };
}


export async function exportDataDesk(): Promise<DataDeskSnapshot> {
  return { schema: 'project-v-data-desk', version: 1, exportedAt: Date.now(), workbooks: await listWorkbooks() };
}

export async function importDataDeskSnapshot(snapshot: DataDeskSnapshot): Promise<number> {
  if (snapshot?.schema !== 'project-v-data-desk' || snapshot.version !== 1 || !Array.isArray(snapshot.workbooks)) {
    throw new Error('This is not a supported Project V Data Desk archive.');
  }
  for (const workbook of snapshot.workbooks) {
    if (!workbook?.id || !Array.isArray(workbook.sheets)) continue;
    await put(cloneWorkbook(workbook));
  }
  announce('archive-imported');
  return snapshot.workbooks.length;
}
