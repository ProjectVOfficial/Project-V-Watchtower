import DOMPurify from 'dompurify';

export type ResearchDocumentKind = 'pdf' | 'text' | 'markdown' | 'html' | 'csv' | 'json' | 'memory';

export interface ResearchChunk {
  id: string;
  documentId: string;
  ordinal: number;
  page?: number;
  text: string;
}

export interface ResearchDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  kind: ResearchDocumentKind;
  size: number;
  pageCount?: number;
  addedAt: number;
  updatedAt: number;
  enabled: boolean;
  tags: string[];
  text: string;
  chunks: ResearchChunk[];
}

export interface ResearchExcerpt {
  id: string;
  documentId?: string;
  documentTitle: string;
  title: string;
  text: string;
  page?: number;
  createdAt: number;
  enabled: boolean;
}

export interface ResearchSearchResult {
  id: string;
  documentId?: string;
  documentTitle: string;
  title: string;
  kind: 'document' | 'memory' | 'excerpt';
  text: string;
  page?: number;
  score: number;
}

export interface ResearchLibrarySnapshot {
  version: 1;
  exportedAt: number;
  documents: ResearchDocument[];
  excerpts: ResearchExcerpt[];
}

const DB_NAME = 'project-v-research-library';
const DB_VERSION = 1;
const DOCUMENT_STORE = 'documents';
const EXCERPT_STORE = 'excerpts';
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_500_000;
const CHUNK_TARGET = 1400;
const CHUNK_OVERLAP = 220;
const MAX_DOCUMENTS = 120;

const SEARCH_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'analyst', 'and', 'answer', 'archive', 'based', 'before',
  'brief', 'cite', 'claim', 'compare', 'contradiction', 'contradictions', 'current', 'document', 'documents',
  'evidence', 'explain', 'from', 'have', 'identify', 'into', 'library', 'local', 'material', 'most', 'relevant',
  'report', 'research', 'search', 'should', 'situation', 'strongest', 'summarize', 'tell', 'that', 'the', 'their',
  'there', 'these', 'they', 'this', 'those', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

let databasePromise: Promise<IDBDatabase> | null = null;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        const documents = db.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
        documents.createIndex('updatedAt', 'updatedAt');
        documents.createIndex('enabled', 'enabled');
      }
      if (!db.objectStoreNames.contains(EXCERPT_STORE)) {
        const excerpts = db.createObjectStore(EXCERPT_STORE, { keyPath: 'id' });
        excerpts.createIndex('createdAt', 'createdAt');
        excerpts.createIndex('documentId', 'documentId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local research library.'));
  });
  return databasePromise;
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName}.`));
  });
}

async function putInStore<T>(storeName: string, value: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Unable to save ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Unable to save ${storeName}.`));
  });
}

async function deleteFromStore(storeName: string, key: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`Unable to delete from ${storeName}.`));
  });
}

function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent('project-v-research-changed'));
}

function compactWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(value: string): string {
  const textOnly = DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return compactWhitespace(textOnly);
}

function detectKind(file: File): ResearchDocumentKind {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (file.type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (file.type === 'text/csv' || name.endsWith('.csv')) return 'csv';
  if (file.type === 'application/json' || name.endsWith('.json')) return 'json';
  if (file.type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.log')) return 'text';
  throw new Error(`${file.name} is not a supported research format.`);
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled document';
}

function chunkText(documentId: string, text: string, pages?: string[]): ResearchChunk[] {
  if (pages && pages.length > 0) {
    const chunks: ResearchChunk[] = [];
    pages.forEach((pageText, pageIndex) => {
      const pageChunks = splitIntoChunks(pageText);
      pageChunks.forEach((chunk, index) => chunks.push({
        id: `${documentId}-p${pageIndex + 1}-${index}`,
        documentId,
        ordinal: chunks.length,
        page: pageIndex + 1,
        text: chunk,
      }));
    });
    return chunks;
  }
  return splitIntoChunks(text).map((chunk, index) => ({
    id: `${documentId}-c${index}`,
    documentId,
    ordinal: index,
    text: chunk,
  }));
}

function splitIntoChunks(value: string): string[] {
  const text = compactWhitespace(value);
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_TARGET);
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n\n', end);
      const sentence = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end));
      const breakAt = Math.max(paragraph, sentence);
      if (breakAt > start + Math.floor(CHUNK_TARGET * 0.55)) end = breakAt + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function extractPdf(file: File): Promise<{ text: string; pages: string[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(compactWhitespace(text));
  }
  return { text: pages.join('\n\n'), pages, pageCount: pdf.numPages };
}

async function extractFile(file: File, kind: ResearchDocumentKind): Promise<{ text: string; pages?: string[]; pageCount?: number }> {
  if (kind === 'pdf') return extractPdf(file);
  let text = await file.text();
  if (kind === 'html') text = stripHtml(text);
  if (kind === 'json') {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* retain malformed JSON as text */ }
  }
  return { text: compactWhitespace(text) };
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
}

export async function listResearchDocuments(): Promise<ResearchDocument[]> {
  const documents = await getAllFromStore<ResearchDocument>(DOCUMENT_STORE);
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listResearchExcerpts(): Promise<ResearchExcerpt[]> {
  const excerpts = await getAllFromStore<ResearchExcerpt>(EXCERPT_STORE);
  return excerpts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getResearchDocument(id: string): Promise<ResearchDocument | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCUMENT_STORE, 'readonly');
    const request = tx.objectStore(DOCUMENT_STORE).get(id);
    request.onsuccess = () => resolve((request.result as ResearchDocument | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read the document.'));
  });
}

export async function importResearchFiles(
  files: File[],
  onProgress?: (fileName: string, completed: number, total: number) => void,
): Promise<ResearchDocument[]> {
  const existing = await listResearchDocuments();
  if (existing.length + files.length > MAX_DOCUMENTS) throw new Error(`The local library supports up to ${MAX_DOCUMENTS} documents.`);
  const imported: ResearchDocument[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    onProgress?.(file.name, index, files.length);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than the 30 MB import limit.`);
    const kind = detectKind(file);
    const extracted = await extractFile(file, kind);
    const text = extracted.text.slice(0, MAX_TEXT_CHARS);
    if (!text.trim()) throw new Error(`${file.name} did not contain extractable text.`);
    const id = newId('doc');
    const now = Date.now();
    const document: ResearchDocument = {
      id,
      title: titleFromFileName(file.name),
      fileName: file.name,
      mimeType: file.type || 'text/plain',
      kind,
      size: file.size,
      pageCount: extracted.pageCount,
      addedAt: now,
      updatedAt: now,
      enabled: true,
      tags: [],
      text,
      chunks: chunkText(id, text, extracted.pages),
    };
    await putInStore(DOCUMENT_STORE, document);
    imported.push(document);
    onProgress?.(file.name, index + 1, files.length);
  }
  notifyChanged();
  return imported;
}

export async function createResearchMemory(title: string, text: string, tags: string[] = []): Promise<ResearchDocument> {
  const cleanText = compactWhitespace(text).slice(0, MAX_TEXT_CHARS);
  if (!cleanText) throw new Error('Memory text cannot be empty.');
  const id = newId('memory');
  const now = Date.now();
  const document: ResearchDocument = {
    id,
    title: title.trim().slice(0, 160) || 'Research memory',
    fileName: '',
    mimeType: 'text/plain',
    kind: 'memory',
    size: new Blob([cleanText]).size,
    addedAt: now,
    updatedAt: now,
    enabled: true,
    tags: normalizeTags(tags),
    text: cleanText,
    chunks: chunkText(id, cleanText),
  };
  await putInStore(DOCUMENT_STORE, document);
  notifyChanged();
  return document;
}

export async function updateResearchDocument(
  id: string,
  changes: Partial<Pick<ResearchDocument, 'title' | 'text' | 'tags' | 'enabled'>>,
): Promise<ResearchDocument> {
  const document = await getResearchDocument(id);
  if (!document) throw new Error('Document not found.');
  const nextText = changes.text === undefined ? document.text : compactWhitespace(changes.text).slice(0, MAX_TEXT_CHARS);
  const updated: ResearchDocument = {
    ...document,
    title: changes.title === undefined ? document.title : changes.title.trim().slice(0, 160) || document.title,
    text: nextText,
    tags: changes.tags === undefined ? document.tags : normalizeTags(changes.tags),
    enabled: changes.enabled ?? document.enabled,
    updatedAt: Date.now(),
    size: document.kind === 'memory' ? new Blob([nextText]).size : document.size,
    chunks: changes.text === undefined ? document.chunks : chunkText(document.id, nextText),
  };
  await putInStore(DOCUMENT_STORE, updated);
  notifyChanged();
  return updated;
}

export async function deleteResearchDocument(id: string): Promise<void> {
  await deleteFromStore(DOCUMENT_STORE, id);
  const excerpts = await listResearchExcerpts();
  await Promise.all(excerpts.filter((excerpt) => excerpt.documentId === id).map((excerpt) => deleteFromStore(EXCERPT_STORE, excerpt.id)));
  notifyChanged();
}

export async function saveResearchExcerpt(input: {
  documentId?: string;
  documentTitle: string;
  title?: string;
  text: string;
  page?: number;
}): Promise<ResearchExcerpt> {
  const cleanText = compactWhitespace(input.text).slice(0, 8000);
  if (!cleanText) throw new Error('Excerpt text cannot be empty.');
  const excerpt: ResearchExcerpt = {
    id: newId('excerpt'),
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    title: input.title?.trim().slice(0, 160) || `Excerpt from ${input.documentTitle}`,
    text: cleanText,
    page: input.page,
    createdAt: Date.now(),
    enabled: true,
  };
  await putInStore(EXCERPT_STORE, excerpt);
  notifyChanged();
  return excerpt;
}

export async function updateResearchExcerpt(id: string, changes: Partial<Pick<ResearchExcerpt, 'title' | 'text' | 'enabled'>>): Promise<ResearchExcerpt> {
  const excerpts = await listResearchExcerpts();
  const excerpt = excerpts.find((item) => item.id === id);
  if (!excerpt) throw new Error('Excerpt not found.');
  const updated: ResearchExcerpt = {
    ...excerpt,
    title: changes.title === undefined ? excerpt.title : changes.title.trim().slice(0, 160) || excerpt.title,
    text: changes.text === undefined ? excerpt.text : compactWhitespace(changes.text).slice(0, 8000),
    enabled: changes.enabled ?? excerpt.enabled,
  };
  await putInStore(EXCERPT_STORE, updated);
  notifyChanged();
  return updated;
}

export async function deleteResearchExcerpt(id: string): Promise<void> {
  await deleteFromStore(EXCERPT_STORE, id);
  notifyChanged();
}

function tokenize(value: string): string[] {
  return Array.from(new Set((value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [])
    .filter((token) => token.length > 2 && !SEARCH_STOPWORDS.has(token))));
}

function scoreText(text: string, title: string, query: string, tokens: string[]): number {
  if (!query.trim()) return 0.5;
  const lowerText = text.toLowerCase();
  const lowerTitle = title.toLowerCase();
  let score = 0;
  if (lowerText.includes(query.toLowerCase())) score += 15;
  if (lowerTitle.includes(query.toLowerCase())) score += 24;
  tokens.forEach((token) => {
    if (lowerTitle.includes(token)) score += 6;
    let cursor = 0;
    let count = 0;
    while ((cursor = lowerText.indexOf(token, cursor)) !== -1 && count < 8) {
      score += 1.2;
      cursor += token.length;
      count += 1;
    }
  });
  const coverage = tokens.length === 0 ? 0 : tokens.filter((token) => lowerText.includes(token) || lowerTitle.includes(token)).length / tokens.length;
  return score + coverage * 8;
}

export async function searchResearchLibrary(query: string, limit = 20, enabledOnly = false): Promise<ResearchSearchResult[]> {
  const [documents, excerpts] = await Promise.all([listResearchDocuments(), listResearchExcerpts()]);
  const tokens = tokenize(query);
  const results: ResearchSearchResult[] = [];
  documents.filter((document) => !enabledOnly || document.enabled).forEach((document) => {
    const chunks = document.chunks.length > 0 ? document.chunks : chunkText(document.id, document.text);
    chunks.forEach((chunk) => {
      const score = scoreText(chunk.text, document.title, query, tokens);
      if (query.trim() && score <= 0) return;
      results.push({
        id: chunk.id,
        documentId: document.id,
        documentTitle: document.title,
        title: document.title,
        kind: document.kind === 'memory' ? 'memory' : 'document',
        text: chunk.text,
        page: chunk.page,
        score: score + (document.enabled ? 1 : 0) + Math.max(0, 2 - ((Date.now() - document.updatedAt) / 86_400_000 / 180)),
      });
    });
  });
  excerpts.filter((excerpt) => !enabledOnly || excerpt.enabled).forEach((excerpt) => {
    const score = scoreText(excerpt.text, excerpt.title, query, tokens) + 5;
    if (query.trim() && score <= 5) return;
    results.push({
      id: excerpt.id,
      documentId: excerpt.documentId,
      documentTitle: excerpt.documentTitle,
      title: excerpt.title,
      kind: 'excerpt',
      text: excerpt.text,
      page: excerpt.page,
      score,
    });
  });
  const deduped = new Map<string, ResearchSearchResult>();
  results.sort((a, b) => b.score - a.score).forEach((result) => {
    const key = `${result.documentId ?? 'excerpt'}|${result.text.slice(0, 120).toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, result);
  });
  return Array.from(deduped.values()).slice(0, Math.max(1, limit));
}

export async function collectResearchContext(query: string, limit = 8): Promise<ResearchSearchResult[]> {
  const results = await searchResearchLibrary(query, limit, true);
  if (results.length > 0) return results;
  const documents = (await listResearchDocuments()).filter((document) => document.enabled).slice(0, limit);
  return documents.map((document) => ({
    id: document.chunks[0]?.id ?? document.id,
    documentId: document.id,
    documentTitle: document.title,
    title: document.title,
    kind: document.kind === 'memory' ? 'memory' : 'document',
    text: document.chunks[0]?.text ?? document.text.slice(0, CHUNK_TARGET),
    page: document.chunks[0]?.page,
    score: 0.1,
  }));
}

export async function exportResearchLibrary(): Promise<ResearchLibrarySnapshot> {
  const [documents, excerpts] = await Promise.all([listResearchDocuments(), listResearchExcerpts()]);
  return { version: 1, exportedAt: Date.now(), documents, excerpts };
}

function isSnapshot(value: unknown): value is ResearchLibrarySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ResearchLibrarySnapshot>;
  return candidate.version === 1 && Array.isArray(candidate.documents) && Array.isArray(candidate.excerpts);
}

export async function importResearchLibrarySnapshot(value: unknown): Promise<{ documents: number; excerpts: number }> {
  if (!isSnapshot(value)) throw new Error('This is not a valid Project V research-library backup.');
  for (const document of value.documents.slice(0, MAX_DOCUMENTS)) {
    if (!document || typeof document.id !== 'string' || typeof document.title !== 'string' || typeof document.text !== 'string') continue;
    const cleanDocument: ResearchDocument = {
      ...document,
      tags: normalizeTags(Array.isArray(document.tags) ? document.tags : []),
      enabled: document.enabled !== false,
      updatedAt: Number.isFinite(document.updatedAt) ? document.updatedAt : Date.now(),
      addedAt: Number.isFinite(document.addedAt) ? document.addedAt : Date.now(),
      text: document.text.slice(0, MAX_TEXT_CHARS),
      chunks: Array.isArray(document.chunks) && document.chunks.length > 0 ? document.chunks : chunkText(document.id, document.text),
    };
    await putInStore(DOCUMENT_STORE, cleanDocument);
  }
  for (const excerpt of value.excerpts.slice(0, 500)) {
    if (!excerpt || typeof excerpt.id !== 'string' || typeof excerpt.text !== 'string') continue;
    await putInStore(EXCERPT_STORE, { ...excerpt, enabled: excerpt.enabled !== false });
  }
  notifyChanged();
  return { documents: value.documents.length, excerpts: value.excerpts.length };
}
