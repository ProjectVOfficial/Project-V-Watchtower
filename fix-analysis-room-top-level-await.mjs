import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? process.cwd());
const relativeFile = 'src/analysis-room-main.ts';
const fullPath = path.join(root, relativeFile);
const packagePath = path.join(root, 'package.json');

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(packagePath)) {
  fail(`package.json was not found in:\n${root}`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (packageJson.name !== 'project-v-watchtower') {
  fail(`This does not look like Project V Watchtower. Found package name: ${packageJson.name ?? '(missing)'}`);
}

if (!fs.existsSync(fullPath)) {
  fail(`Required file was not found:\n${fullPath}`);
}

const original = fs.readFileSync(fullPath, 'utf8');
const newline = original.includes('\r\n') ? '\r\n' : '\n';
const normalized = original.replace(/\r\n/g, '\n');

const patterns = [
  {
    name: 'single-quoted startup block',
    from: `await loadCases();
if (!currentMission && queryParams.get('new') === '1') currentMission = createResearchMission();
render();`,
    to: `async function initializeAnalysisRoom(): Promise<void> {
  await loadCases();
  if (!currentMission && queryParams.get('new') === '1') currentMission = createResearchMission();
  render();
}

void initializeAnalysisRoom().catch((error: unknown) => {
  console.error('[analysis-room] Initialization failed:', error);
  render();
});`,
  },
  {
    name: 'double-quoted startup block',
    from: `await loadCases();
if (!currentMission && queryParams.get("new") === "1") currentMission = createResearchMission();
render();`,
    to: `async function initializeAnalysisRoom(): Promise<void> {
  await loadCases();
  if (!currentMission && queryParams.get("new") === "1") currentMission = createResearchMission();
  render();
}

void initializeAnalysisRoom().catch((error: unknown) => {
  console.error("[analysis-room] Initialization failed:", error);
  render();
});`,
  },
];

const matching = patterns.filter(({ from }) => normalized.includes(from));

if (matching.length !== 1) {
  const alreadyPatched = normalized.includes('async function initializeAnalysisRoom(): Promise<void>');
  if (alreadyPatched) {
    console.log('No changes needed: Analysis Room initialization is already wrapped in an async function.');
    console.log('\nNext command:\nnpm run build:desktop');
    process.exit(0);
  }

  fail(
    `Expected exactly one Analysis Room startup block, but found ${matching.length}. ` +
    'The file was not modified. Upload the last 80 lines of src/analysis-room-main.ts for review.'
  );
}

const selected = matching[0];
const updatedNormalized = normalized.replace(selected.from, selected.to);
const updated = newline === '\r\n'
  ? updatedNormalized.replace(/\n/g, '\r\n')
  : updatedNormalized;

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(
  root,
  '.build-fix-backups',
  timestamp,
  relativeFile,
);

fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(fullPath, updated, 'utf8');

console.log(`PATCHED  ${relativeFile}`);
console.log('');
console.log('Removed the unsupported top-level await without changing the Vite browser target.');
console.log(`Backup: ${backupPath}`);
console.log('');
console.log('Next command:');
console.log('npm run build:desktop');
