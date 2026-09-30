import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const packagePath = path.join(root, 'package.json');

if (!fs.existsSync(packagePath)) {
  console.error(`ERROR: package.json was not found in:\n${root}`);
  console.error('Run this script from the worldmonitor-2.5.23 project folder, or pass the project path as the first argument.');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (packageJson.name !== 'project-v-watchtower') {
  console.error(`ERROR: This does not look like Project V Watchtower.\nFound package name: ${packageJson.name ?? '(missing)'}`);
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(root, '.build-fix-backups', timestamp);

const patches = [
  {
    file: 'src/map-operations-main.ts',
    replacements: [
      {
        label: 'Move preserveDrawingBuffer into MapLibre canvasContextAttributes',
        from: `    preserveDrawingBuffer: true,`,
        to: `    canvasContextAttributes: { preserveDrawingBuffer: true },`,
      },
    ],
  },
  {
    file: 'src/services/multi-agent-research.ts',
    replacements: [
      {
        label: 'Guard indexed mission lookup under noUncheckedIndexedAccess',
        from: `  const current = store.missions[index];
  const selectedAgents: ResearchAgentId[] = Array.isArray(changes.selectedAgents)`,
        to: `  const current = store.missions[index];
  if (!current) return null;
  const selectedAgents: ResearchAgentId[] = Array.isArray(changes.selectedAgents)`,
      },
      {
        label: 'Copy selectedAgents instead of mutating the stored mission',
        from: `    : current.selectedAgents;`,
        to: `    : [...current.selectedAgents];`,
      },
    ],
  },
  {
    file: 'src/services/osint-tools.ts',
    replacements: [
      {
        label: 'Add an ES2020-compatible literal replacement helper',
        from: `function validateTool(tool: Partial<OsintToolDefinition>): OsintToolDefinition | null {`,
        to: `function applyTemplateReplacements(template: string, replacements: Record<string, string>): string {
  let output = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    output = output.split(placeholder).join(value);
  }
  return output;
}

function validateTool(tool: Partial<OsintToolDefinition>): OsintToolDefinition | null {`,
      },
      {
        label: 'Replace replaceAll calls used for URL validation',
        from: `    url = new URL(urlTemplate.replaceAll('{query}', 'test').replaceAll('{username}', 'test').replaceAll('{email}', 'test@example.com').replaceAll('{domain}', 'example.com').replaceAll('{ip}', '1.1.1.1').replaceAll('{phone}', '15555550123'));`,
        to: `    url = new URL(applyTemplateReplacements(urlTemplate, {
      '{query}': 'test',
      '{username}': 'test',
      '{email}': 'test@example.com',
      '{domain}': 'example.com',
      '{ip}': '1.1.1.1',
      '{phone}': '15555550123',
    }));`,
      },
      {
        label: 'Replace replaceAll loop used for compiled OSINT URLs',
        from: `  let output = tool.urlTemplate;
  for (const [placeholder, value] of Object.entries(replacements)) output = output.replaceAll(placeholder, value);`,
        to: `  const output = applyTemplateReplacements(tool.urlTemplate, replacements);`,
      },
    ],
  },
  {
    file: 'src/services/research-library.ts',
    replacements: [
      {
        label: 'Narrow PDF.js text items before reading str',
        from: `      .map((item: { str?: string }) => item.str ?? '')`,
        to: `      .map((item) => ('str' in item ? item.str : ''))`,
      },
    ],
  },
  {
    file: 'src/services/security-center.ts',
    replacements: [
      {
        label: 'Add ArrayBuffer-backed byte-copy helper for Web Crypto',
        from: `async function deriveHash(secret: string, salt: Uint8Array, iterations: number): Promise<string> {`,
        to: `function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function deriveHash(secret: string, salt: Uint8Array, iterations: number): Promise<string> {`,
      },
      {
        label: 'Use ArrayBuffer-backed PBKDF2 salt for deriveBits',
        from: `    salt,
    iterations,
  }, material, 256);`,
        to: `    salt: toArrayBufferBytes(salt),
    iterations,
  }, material, 256);`,
      },
      {
        label: 'Use ArrayBuffer-backed PBKDF2 salt for deriveKey',
        from: `  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, {`,
        to: `  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBufferBytes(salt),
    iterations,
  }, material, {`,
      },
      {
        label: 'Use ArrayBuffer-backed IV and ciphertext for AES-GCM decryption',
        from: `    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);`,
        to: `    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBufferBytes(iv) },
      key,
      toArrayBufferBytes(ciphertext),
    );`,
      },
    ],
  },
  {
    file: 'src/services/xlsx-lite.ts',
    replacements: [
      {
        label: 'Add ArrayBuffer-backed byte-copy helper for Blob data',
        from: `async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {`,
        to: `function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {`,
      },
      {
        label: 'Pass ArrayBuffer-backed bytes to DecompressionStream Blob',
        from: `  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));`,
        to: `  const stream = new Blob([toArrayBufferBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));`,
      },
      {
        label: 'Pass ArrayBuffer-backed ZIP bytes to XLSX Blob',
        from: `  return new Blob([zipStore(entries)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });`,
        to: `  return new Blob([toArrayBufferBytes(zipStore(entries))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });`,
      },
    ],
  },
];

function occurrenceCount(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

const prepared = [];

try {
  for (const patch of patches) {
    const fullPath = path.join(root, patch.file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Required file not found: ${patch.file}`);
    }

    const original = fs.readFileSync(fullPath, 'utf8');
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    let updated = original.replace(/\r\n/g, '\n');

    for (const replacement of patch.replacements) {
      const count = occurrenceCount(updated, replacement.from);
      if (count !== 1) {
        throw new Error(
          `${patch.file}: expected exactly one match for "${replacement.label}", but found ${count}. No files were changed.`,
        );
      }
      updated = updated.replace(replacement.from, replacement.to);
    }

    prepared.push({
      ...patch,
      fullPath,
      original,
      updated: newline === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated,
    });
  }

  for (const item of prepared) {
    const backupPath = path.join(backupRoot, item.file);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, item.original, 'utf8');
  }

  for (const item of prepared) {
    fs.writeFileSync(item.fullPath, item.updated, 'utf8');
    console.log(`PATCHED  ${item.file}`);
  }

  console.log('');
  console.log('All six TypeScript source files were patched successfully.');
  console.log(`Backups: ${backupRoot}`);
  console.log('');
  console.log('Next command:');
  console.log('npm run typecheck');
} catch (error) {
  console.error('');
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  console.error('No source files were modified unless all validation checks passed.');
  process.exit(1);
}
