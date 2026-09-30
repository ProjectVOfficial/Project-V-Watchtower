export type CaseStatus = 'open' | 'on-hold' | 'closed';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type CaseItemType = 'entity' | 'claim' | 'source' | 'event' | 'note' | 'dataset';
export type CaseConfidence = 'confirmed' | 'probable' | 'unverified' | 'disputed' | 'disproven' | 'analyst';

export interface ProjectVCase {
  id: string;
  title: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CaseItem {
  id: string;
  caseId: string;
  type: CaseItemType;
  title: string;
  detail: string;
  confidence: CaseConfidence;
  source?: string;
  sourceUrl?: string;
  occurredAt?: number;
  x: number;
  y: number;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CaseLink {
  id: string;
  caseId: string;
  fromId: string;
  toId: string;
  label: string;
  createdAt: number;
}

export interface CaseDeskSnapshot {
  schema: 'project-v-case-desk';
  version: 1;
  exportedAt: number;
  cases: ProjectVCase[];
  items: CaseItem[];
  links: CaseLink[];
}

export interface CaseStats {
  total: number;
  active: number;
  critical: number;
  unverified: number;
  recentlyUpdated?: ProjectVCase;
}

const DB_NAME = 'project-v-case-desk';
const DB_VERSION = 1;
const CASE_STORE = 'cases';
const ITEM_STORE = 'items';
const LINK_STORE = 'links';
const CHANNEL_NAME = 'project-v-case-desk-events';
let databasePromise: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clean(value: string, max = 5000): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => clean(tag, 40).toLowerCase()).filter(Boolean))).slice(0, 24);
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CASE_STORE)) {
        const store = db.createObjectStore(CASE_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(ITEM_STORE)) {
        const store = db.createObjectStore(ITEM_STORE, { keyPath: 'id' });
        store.createIndex('caseId', 'caseId');
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(LINK_STORE)) {
        const store = db.createObjectStore(LINK_STORE, { keyPath: 'id' });
        store.createIndex('caseId', 'caseId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the Project V Case Desk database.'));
  });
  return databasePromise;
}

async function all<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName}.`));
  });
}

async function get<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName}.`));
  });
}

async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Unable to save ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Unable to save ${storeName}.`));
  });
}

async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Unable to delete from ${storeName}.`));
  });
}

function announce(kind: string, caseId?: string): void {
  window.dispatchEvent(new CustomEvent('project-v-case-desk-changed', { detail: { kind, caseId } }));
  try {
    channel ??= new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ kind, caseId, at: Date.now() });
  } catch { /* BroadcastChannel is optional */ }
}

export function subscribeCaseDesk(listener: () => void): () => void {
  const local = () => listener();
  window.addEventListener('project-v-case-desk-changed', local);
  let subscribedChannel: BroadcastChannel | null = null;
  try {
    subscribedChannel = new BroadcastChannel(CHANNEL_NAME);
    subscribedChannel.addEventListener('message', local);
  } catch { /* no-op */ }
  return () => {
    window.removeEventListener('project-v-case-desk-changed', local);
    subscribedChannel?.close();
  };
}

export async function listCases(): Promise<ProjectVCase[]> {
  return (await all<ProjectVCase>(CASE_STORE)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCase(caseId: string): Promise<ProjectVCase | null> {
  return get<ProjectVCase>(CASE_STORE, caseId);
}

export async function createCase(input: Partial<Pick<ProjectVCase, 'title' | 'description' | 'priority' | 'status' | 'tags'>> = {}): Promise<ProjectVCase> {
  const now = Date.now();
  const record: ProjectVCase = {
    id: id('case'),
    title: clean(input.title ?? 'Untitled Case', 160) || 'Untitled Case',
    description: clean(input.description ?? '', 20_000),
    status: input.status ?? 'open',
    priority: input.priority ?? 'normal',
    tags: cleanTags(input.tags ?? []),
    createdAt: now,
    updatedAt: now,
  };
  await put(CASE_STORE, record);
  announce('case-created', record.id);
  return record;
}

export async function updateCase(caseId: string, changes: Partial<Omit<ProjectVCase, 'id' | 'createdAt'>>): Promise<ProjectVCase> {
  const current = await getCase(caseId);
  if (!current) throw new Error('Case not found.');
  const next: ProjectVCase = {
    ...current,
    ...changes,
    title: changes.title === undefined ? current.title : (clean(changes.title, 160) || 'Untitled Case'),
    description: changes.description === undefined ? current.description : clean(changes.description, 20_000),
    tags: changes.tags === undefined ? current.tags : cleanTags(changes.tags),
    updatedAt: Date.now(),
  };
  await put(CASE_STORE, next);
  announce('case-updated', caseId);
  return next;
}

export async function deleteCase(caseId: string): Promise<void> {
  const [items, links] = await Promise.all([listCaseItems(caseId), listCaseLinks(caseId)]);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([CASE_STORE, ITEM_STORE, LINK_STORE], 'readwrite');
    tx.objectStore(CASE_STORE).delete(caseId);
    for (const item of items) tx.objectStore(ITEM_STORE).delete(item.id);
    for (const link of links) tx.objectStore(LINK_STORE).delete(link.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete case.'));
  });
  announce('case-deleted', caseId);
}

export async function listCaseItems(caseId: string): Promise<CaseItem[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(ITEM_STORE, 'readonly').objectStore(ITEM_STORE).index('caseId').getAll(caseId);
    request.onsuccess = () => resolve((request.result as CaseItem[]).sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error ?? new Error('Unable to read case items.'));
  });
}

export async function createCaseItem(caseId: string, input: Partial<Omit<CaseItem, 'id' | 'caseId' | 'createdAt' | 'updatedAt'>>): Promise<CaseItem> {
  if (!(await getCase(caseId))) throw new Error('Case not found.');
  const now = Date.now();
  const record: CaseItem = {
    id: id('item'),
    caseId,
    type: input.type ?? 'note',
    title: clean(input.title ?? 'Untitled item', 180) || 'Untitled item',
    detail: clean(input.detail ?? '', 40_000),
    confidence: input.confidence ?? 'analyst',
    source: input.source ? clean(input.source, 300) : undefined,
    sourceUrl: input.sourceUrl ? clean(input.sourceUrl, 2000) : undefined,
    occurredAt: input.occurredAt,
    x: Math.max(0, Math.round(input.x ?? 48)),
    y: Math.max(0, Math.round(input.y ?? 48)),
    metadata: input.metadata ? Object.fromEntries(Object.entries(input.metadata).slice(0, 100).map(([key, value]) => [clean(key, 100), clean(value, 10_000)])) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await put(ITEM_STORE, record);
  await touchCase(caseId);
  announce('item-created', caseId);
  return record;
}

export async function updateCaseItem(itemId: string, changes: Partial<Omit<CaseItem, 'id' | 'caseId' | 'createdAt'>>): Promise<CaseItem> {
  const current = await get<CaseItem>(ITEM_STORE, itemId);
  if (!current) throw new Error('Case item not found.');
  const next: CaseItem = {
    ...current,
    ...changes,
    title: changes.title === undefined ? current.title : (clean(changes.title, 180) || 'Untitled item'),
    detail: changes.detail === undefined ? current.detail : clean(changes.detail, 40_000),
    source: changes.source === undefined ? current.source : clean(changes.source ?? '', 300) || undefined,
    sourceUrl: changes.sourceUrl === undefined ? current.sourceUrl : clean(changes.sourceUrl ?? '', 2000) || undefined,
    x: changes.x === undefined ? current.x : Math.max(0, Math.round(changes.x)),
    y: changes.y === undefined ? current.y : Math.max(0, Math.round(changes.y)),
    updatedAt: Date.now(),
  };
  await put(ITEM_STORE, next);
  await touchCase(current.caseId);
  announce('item-updated', current.caseId);
  return next;
}

export async function deleteCaseItem(itemId: string): Promise<void> {
  const current = await get<CaseItem>(ITEM_STORE, itemId);
  if (!current) return;
  const links = (await listCaseLinks(current.caseId)).filter((link) => link.fromId === itemId || link.toId === itemId);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ITEM_STORE, LINK_STORE], 'readwrite');
    tx.objectStore(ITEM_STORE).delete(itemId);
    for (const link of links) tx.objectStore(LINK_STORE).delete(link.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to delete case item.'));
  });
  await touchCase(current.caseId);
  announce('item-deleted', current.caseId);
}

export async function listCaseLinks(caseId: string): Promise<CaseLink[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(LINK_STORE, 'readonly').objectStore(LINK_STORE).index('caseId').getAll(caseId);
    request.onsuccess = () => resolve(request.result as CaseLink[]);
    request.onerror = () => reject(request.error ?? new Error('Unable to read case links.'));
  });
}

export async function createCaseLink(caseId: string, fromId: string, toId: string, label = 'RELATED TO'): Promise<CaseLink> {
  if (fromId === toId) throw new Error('An item cannot link to itself.');
  const items = await listCaseItems(caseId);
  if (!items.some((item) => item.id === fromId) || !items.some((item) => item.id === toId)) throw new Error('Both linked items must belong to the case.');
  const existing = (await listCaseLinks(caseId)).find((link) => link.fromId === fromId && link.toId === toId);
  if (existing) return existing;
  const record: CaseLink = { id: id('link'), caseId, fromId, toId, label: clean(label, 80) || 'RELATED TO', createdAt: Date.now() };
  await put(LINK_STORE, record);
  await touchCase(caseId);
  announce('link-created', caseId);
  return record;
}

export async function deleteCaseLink(linkId: string): Promise<void> {
  const link = await get<CaseLink>(LINK_STORE, linkId);
  if (!link) return;
  await remove(LINK_STORE, linkId);
  await touchCase(link.caseId);
  announce('link-deleted', link.caseId);
}

async function touchCase(caseId: string): Promise<void> {
  const record = await getCase(caseId);
  if (!record) return;
  await put(CASE_STORE, { ...record, updatedAt: Date.now() });
}

export async function getCaseStats(): Promise<CaseStats> {
  const cases = await listCases();
  const items = await all<CaseItem>(ITEM_STORE);
  return {
    total: cases.length,
    active: cases.filter((record) => record.status !== 'closed').length,
    critical: cases.filter((record) => record.status !== 'closed' && record.priority === 'critical').length,
    unverified: items.filter((item) => item.confidence === 'unverified' || item.confidence === 'disputed').length,
    recentlyUpdated: cases[0],
  };
}

export async function exportCaseDesk(caseId?: string): Promise<CaseDeskSnapshot> {
  const cases = caseId ? (await listCases()).filter((record) => record.id === caseId) : await listCases();
  const selected = new Set(cases.map((record) => record.id));
  const items = (await all<CaseItem>(ITEM_STORE)).filter((item) => selected.has(item.caseId));
  const links = (await all<CaseLink>(LINK_STORE)).filter((link) => selected.has(link.caseId));
  return { schema: 'project-v-case-desk', version: 1, exportedAt: Date.now(), cases, items, links };
}

export async function importCaseDesk(snapshot: CaseDeskSnapshot): Promise<void> {
  if (snapshot?.schema !== 'project-v-case-desk' || snapshot.version !== 1 || !Array.isArray(snapshot.cases) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.links)) {
    throw new Error('This is not a supported Project V Case Desk archive.');
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([CASE_STORE, ITEM_STORE, LINK_STORE], 'readwrite');
    for (const record of snapshot.cases) tx.objectStore(CASE_STORE).put(record);
    for (const item of snapshot.items) tx.objectStore(ITEM_STORE).put(item);
    for (const link of snapshot.links) tx.objectStore(LINK_STORE).put(link);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to import Case Desk archive.'));
  });
  announce('archive-imported');
}

export function caseToMarkdown(record: ProjectVCase, items: CaseItem[], links: CaseLink[]): string {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const lines = [
    `# ${record.title}`,
    '',
    `- Status: ${record.status}`,
    `- Priority: ${record.priority}`,
    `- Updated: ${new Date(record.updatedAt).toISOString()}`,
    `- Tags: ${record.tags.join(', ') || 'None'}`,
    '',
    record.description || '_No case description._',
    '',
    '## Evidence and Analysis',
    '',
  ];
  for (const item of items) {
    lines.push(`### ${item.title}`, '', `- Type: ${item.type}`, `- Confidence: ${item.confidence}`);
    if (item.source) lines.push(`- Source: ${item.source}`);
    if (item.sourceUrl) lines.push(`- Link: ${item.sourceUrl}`);
    if (item.occurredAt) lines.push(`- Occurred: ${new Date(item.occurredAt).toISOString()}`);
    lines.push('', item.detail || '_No detail._', '');
  }
  if (links.length) {
    lines.push('## Relationships', '');
    for (const link of links) lines.push(`- ${itemById.get(link.fromId)?.title ?? link.fromId} — ${link.label} → ${itemById.get(link.toId)?.title ?? link.toId}`);
  }
  return lines.join('\n');
}
