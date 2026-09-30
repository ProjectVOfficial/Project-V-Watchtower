export interface LiteSheet {
  id: string;
  name: string;
  rows: string[][];
  formulas: Record<string, string>;
}

export interface LiteWorkbook {
  title: string;
  sheets: LiteSheet[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseXml(bytes: Uint8Array): Document {
  const document = new DOMParser().parseFromString(textDecoder.decode(bytes), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The workbook contains invalid XML.');
  return document;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress XLSX files. Use the desktop runtime or a current Chromium browser.');
  const stream = new Blob([toArrayBufferBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('The XLSX ZIP directory could not be found.');
  const entryCount = readU16(view, eocd + 10);
  let cursor = readU32(view, eocd + 16);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, cursor) !== 0x02014b50) throw new Error('The XLSX ZIP directory is damaged.');
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const fileNameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const name = textDecoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));
    if (readU32(view, localOffset) !== 0x04034b50) throw new Error(`The XLSX entry ${name} is damaged.`);
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    let content: Uint8Array;
    if (method === 0) content = compressed;
    else if (method === 8) content = await inflateRaw(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method}.`);
    files.set(name.replace(/^\//, ''), content);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function columnIndex(reference: string): number {
  const match = reference.match(/^([A-Z]+)\d+$/i);
  if (!match) return 0;
  let result = 0;
  for (const character of match[1]!.toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
  return result - 1;
}

function rowIndex(reference: string): number {
  const match = reference.match(/^[A-Z]+(\d+)$/i);
  return Math.max(0, Number.parseInt(match?.[1] ?? '1', 10) - 1);
}

export function cellReference(row: number, column: number): string {
  let value = column + 1;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

function allText(element: Element | null): string {
  if (!element) return '';
  return Array.from(element.getElementsByTagName('t')).map((node) => node.textContent ?? '').join('');
}

function resolveTarget(target: string): string {
  const clean = target.replace(/^\//, '');
  if (clean.startsWith('xl/')) return clean;
  const parts = ['xl', ...clean.split('/')];
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') normalized.pop();
    else if (part && part !== '.') normalized.push(part);
  }
  return normalized.join('/');
}

export async function parseXlsx(file: File): Promise<LiteWorkbook> {
  const files = await unzip(await file.arrayBuffer());
  const workbookBytes = files.get('xl/workbook.xml');
  if (!workbookBytes) throw new Error('The workbook.xml file is missing.');
  const workbookXml = parseXml(workbookBytes);
  const relBytes = files.get('xl/_rels/workbook.xml.rels');
  const relationships = new Map<string, string>();
  if (relBytes) {
    const relXml = parseXml(relBytes);
    for (const relationship of Array.from(relXml.getElementsByTagName('Relationship'))) {
      const relationId = relationship.getAttribute('Id');
      const target = relationship.getAttribute('Target');
      if (relationId && target) relationships.set(relationId, resolveTarget(target));
    }
  }
  const sharedStrings: string[] = [];
  const sharedBytes = files.get('xl/sharedStrings.xml');
  if (sharedBytes) {
    const sharedXml = parseXml(sharedBytes);
    for (const stringItem of Array.from(sharedXml.getElementsByTagName('si'))) sharedStrings.push(allText(stringItem));
  }
  const sheets: LiteSheet[] = [];
  const sheetElements = Array.from(workbookXml.getElementsByTagName('sheet'));
  for (let sheetIndex = 0; sheetIndex < sheetElements.length; sheetIndex += 1) {
    const sheetElement = sheetElements[sheetIndex]!;
    const name = sheetElement.getAttribute('name') || `Sheet ${sheetIndex + 1}`;
    const relationId = sheetElement.getAttribute('r:id') || sheetElement.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = (relationId && relationships.get(relationId)) || `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetBytes = files.get(path);
    if (!sheetBytes) continue;
    const sheetXml = parseXml(sheetBytes);
    const rows: string[][] = [];
    const formulas: Record<string, string> = {};
    for (const cell of Array.from(sheetXml.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') || 'A1';
      const r = rowIndex(reference);
      const c = columnIndex(reference);
      rows[r] ??= [];
      while (rows[r]!.length <= c) rows[r]!.push('');
      const type = cell.getAttribute('t') || 'n';
      const value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      const formula = cell.getElementsByTagName('f')[0]?.textContent ?? '';
      if (formula) formulas[reference.toUpperCase()] = formula;
      let rendered = value;
      if (type === 's') rendered = sharedStrings[Number.parseInt(value, 10)] ?? '';
      else if (type === 'inlineStr') rendered = allText(cell.getElementsByTagName('is')[0] ?? null);
      else if (type === 'b') rendered = value === '1' ? 'TRUE' : 'FALSE';
      rows[r]![c] = rendered;
    }
    sheets.push({ id: `sheet-${sheetIndex + 1}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, name, rows: rows.length ? rows : [['']], formulas });
  }
  if (!sheets.length) throw new Error('No worksheets were found in the XLSX file.');
  return { title: file.name.replace(/\.xlsx$/i, ''), sheets };
}

export function parseCsv(text: string, name = 'Sheet 1'): LiteSheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.length > 1 || row[0]) rows.push(row);
  return { id: `sheet-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, name, rows: rows.length ? rows : [['']], formulas: {} };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function zipStore(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, offset, true);
  return concat([...localParts, central, eocd]);
}

function contentTypeXml(sheetCount: number): string {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function worksheetXml(sheet: LiteSheet): string {
  const rows = sheet.rows.map((row, rowIndexValue) => {
    const cells = row.map((value, column) => {
      const reference = cellReference(rowIndexValue, column);
      const formula = sheet.formulas[reference];
      if (formula) return `<c r="${reference}"><f>${xmlEscape(formula)}</f><v>${xmlEscape(value)}</v></c>`;
      const trimmed = value.trim();
      if (trimmed !== '' && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return `<c r="${reference}"><v>${trimmed}</v></c>`;
      if (/^(TRUE|FALSE)$/i.test(trimmed)) return `<c r="${reference}" t="b"><v>${/^TRUE$/i.test(trimmed) ? '1' : '0'}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndexValue + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function createXlsx(workbook: LiteWorkbook): Blob {
  const now = new Date().toISOString();
  const sheetRecords = workbook.sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name.slice(0, 31) || `Sheet ${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = workbook.sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: '[Content_Types].xml', data: textEncoder.encode(contentTypeXml(workbook.sheets.length)) },
    { name: '_rels/.rels', data: textEncoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetRecords}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${workbook.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: textEncoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') },
    { name: 'docProps/core.xml', data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(workbook.title)}</dc:title><dc:creator>Project V Watchtower</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`) },
    { name: 'docProps/app.xml', data: textEncoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Project V Watchtower</Application><AppVersion>1.0</AppVersion></Properties>`) },
  ];
  workbook.sheets.forEach((sheet, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: textEncoder.encode(worksheetXml(sheet)) }));
  return new Blob([toArrayBufferBytes(zipStore(entries))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function createCsv(sheet: LiteSheet): Blob {
  const text = sheet.rows.map((row) => row.map((value) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join(',')).join('\r\n');
  return new Blob([text], { type: 'text/csv;charset=utf-8' });
}
