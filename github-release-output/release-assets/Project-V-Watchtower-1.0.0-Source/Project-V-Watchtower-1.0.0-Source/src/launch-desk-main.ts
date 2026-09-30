import './styles/workspace-windows.css';
import './styles/launch-desk.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import { installWorkspaceLockGuard } from '@/services/workspace-lock-guard';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import {
  approveLaunchDeckApplication,
  deleteLaunchDeckApplication,
  exportLaunchDeck,
  getLaunchDeckApplication,
  importLaunchDeck,
  launchDeckApplication,
  listLaunchDeckApplications,
  saveLaunchDeckApplication,
  selectLaunchExecutable,
  selectLaunchHandoffFile,
  setLaunchDeckPinned,
  subscribeLaunchDeck,
  type LaunchDeckApplication,
  type LaunchDeckCategory,
} from '@/services/launch-deck';

applyStoredTheme();
installWorkspaceLockGuard();

const mount = document.getElementById('launchDeskApp');
if (!mount) throw new Error('Launch Desk mount point is missing.');

let selectedId: string | null = null;
let status = 'READY';
let search = '';
let cleanup: (() => void) | null = null;

function applications(): LaunchDeckApplication[] {
  const query = search.trim().toLowerCase();
  return listLaunchDeckApplications().filter((app) => !query || `${app.name} ${app.path} ${app.category}`.toLowerCase().includes(query));
}

function categoryLabel(category: LaunchDeckCategory): string {
  return category.toUpperCase();
}

function icon(app: LaunchDeckApplication): string {
  if (app.category === 'browser') return '◉';
  if (app.category === 'research') return '▦';
  if (app.category === 'communications') return '✦';
  if (app.category === 'media') return '▶';
  if (app.category === 'utilities') return '⚙';
  return 'V';
}

function render(): void {
  const all = applications();
  const selected = selectedId ? getLaunchDeckApplication(selectedId) : null;
  mount!.innerHTML = `
    <div class="pv-window-shell pv-launch-desk-shell">
      <header class="pv-window-header">
        <div class="pv-window-brand"><span class="pv-window-mark">V</span><div><strong>PROJECT V // LAUNCH DESK</strong><small>APPROVED APPLICATIONS · SAFE HANDOFF · EXTERNAL TOOL CONTROL</small></div></div>
        <div class="pv-window-header-actions">
          <button data-action="new">ADD APPLICATION</button>
          <button data-action="import">IMPORT</button>
          <button data-action="export">EXPORT</button>
          <button data-action="close">CLOSE</button>
          <input type="file" accept="application/json,.json" data-import hidden>
        </div>
      </header>
      <main class="pv-launch-desk-main">
        <aside class="pv-launch-sidebar">
          <input type="search" data-search placeholder="SEARCH APPLICATIONS" value="${escapeHtml(search)}">
          <div class="pv-launch-app-list">
            ${all.length ? all.map((app) => `
              <button class="pv-launch-app-card ${selectedId === app.id ? 'selected' : ''}" data-app-id="${escapeHtml(app.id)}">
                <span class="pv-launch-icon">${escapeHtml(icon(app))}</span>
                <span><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(categoryLabel(app.category))}</small></span>
                <em>${app.pinned ? 'PINNED' : ''}</em>
              </button>
            `).join('') : '<div class="pv-launch-empty">NO APPLICATIONS CONFIGURED<br><small>Select ADD APPLICATION to register Project V, Tor Browser, Excel, VLC, or another trusted executable.</small></div>'}
          </div>
        </aside>
        <section class="pv-launch-content">
          ${selected ? renderApplication(selected) : renderWelcome()}
        </section>
      </main>
      <footer class="pv-launch-status"><span>${escapeHtml(status)}</span><small>${isDesktopRuntime() ? 'DESKTOP RUNTIME ACTIVE' : 'BROWSER DEV MODE · LOCAL APPLICATION STARTUP DISABLED'}</small></footer>
    </div>
  `;
  bind();
}

function renderWelcome(): string {
  return `
    <section class="pv-launch-welcome">
      <span class="pv-launch-welcome-mark">V</span>
      <h1>APPLICATION HANDOFF READY</h1>
      <p>Watchtower remains the command center. Approved programs open separately and receive only the file or URL you explicitly hand off.</p>
      <div class="pv-launch-safety-grid">
        <div><strong>NO SHELL COMMANDS</strong><span>Watchtower launches the exact executable you select.</span></div>
        <div><strong>NO PLUGIN ACCESS</strong><span>Sandboxed plugins cannot start desktop programs.</span></div>
        <div><strong>OPTIONAL HANDOFF</strong><span>URL and file arguments are disabled until you approve them per application.</span></div>
      </div>
      <button data-action="new" class="primary">ADD FIRST APPLICATION</button>
    </section>
  `;
}

function renderApplication(app: LaunchDeckApplication): string {
  return `
    <section class="pv-launch-detail">
      <div class="pv-launch-detail-heading">
        <div class="pv-launch-large-icon">${escapeHtml(icon(app))}</div>
        <div><span>${escapeHtml(categoryLabel(app.category))}</span><h1>${escapeHtml(app.name)}</h1><small>LAUNCHED ${app.launchCount} TIMES${app.lastLaunchedAt ? ` · LAST ${new Date(app.lastLaunchedAt).toLocaleString()}` : ''}</small></div>
      </div>
      <div class="pv-launch-path"><span>EXECUTABLE</span><code>${escapeHtml(app.path)}</code></div>
      ${app.workingDirectory ? `<div class="pv-launch-path"><span>WORKING DIRECTORY</span><code>${escapeHtml(app.workingDirectory)}</code></div>` : ''}
      ${app.arguments.length ? `<div class="pv-launch-arguments"><span>STARTUP ARGUMENTS</span>${app.arguments.map((argument) => `<code>${escapeHtml(argument)}</code>`).join('')}</div>` : ''}
      <div class="pv-launch-capabilities">
        <span class="${app.allowUrlHandoff ? 'enabled' : ''}">URL HANDOFF ${app.allowUrlHandoff ? 'APPROVED' : 'BLOCKED'}</span>
        <span class="${app.allowFileHandoff ? 'enabled' : ''}">FILE HANDOFF ${app.allowFileHandoff ? 'APPROVED' : 'BLOCKED'}</span>
        <span class="${app.pinned ? 'enabled' : ''}">COMMAND PANEL ${app.pinned ? 'PINNED' : 'HIDDEN'}</span>
        <span class="${app.approved ? 'enabled' : 'approval-required'}">PATH ${app.approved ? 'APPROVED' : 'REQUIRES REVIEW'}</span>
      </div>
      <div class="pv-launch-primary-actions">
        ${app.approved
          ? `<button data-action="launch" class="primary">OPEN ${escapeHtml(app.name.toUpperCase())}</button>`
          : '<button data-action="approve" class="primary">APPROVE EXECUTABLE PATH</button>'}
        ${app.allowUrlHandoff ? '<button data-action="url">OPEN URL</button>' : ''}
        ${app.allowFileHandoff ? '<button data-action="file">OPEN FILE</button>' : ''}
      </div>
      <div class="pv-launch-secondary-actions">
        <button data-action="edit">EDIT</button>
        <button data-action="pin">${app.pinned ? 'UNPIN' : 'PIN TO PANEL'}</button>
        <button data-action="delete" class="danger">DELETE</button>
      </div>
    </section>
  `;
}

function bind(): void {
  mount!.querySelectorAll<HTMLButtonElement>('[data-app-id]').forEach((button) => button.addEventListener('click', () => {
    selectedId = button.dataset.appId ?? null;
    render();
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-action="new"]').forEach((button) => button.addEventListener('click', () => void editApplication(null)));
  mount!.querySelector<HTMLButtonElement>('[data-action="edit"]')?.addEventListener('click', () => void editApplication(selectedId ? getLaunchDeckApplication(selectedId) : null));
  mount!.querySelector<HTMLButtonElement>('[data-action="launch"]')?.addEventListener('click', () => void runSelected());
  mount!.querySelector<HTMLButtonElement>('[data-action="approve"]')?.addEventListener('click', () => void approveSelected());
  mount!.querySelector<HTMLButtonElement>('[data-action="url"]')?.addEventListener('click', () => void runUrl());
  mount!.querySelector<HTMLButtonElement>('[data-action="file"]')?.addEventListener('click', () => void runFile());
  mount!.querySelector<HTMLButtonElement>('[data-action="pin"]')?.addEventListener('click', () => {
    const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
    if (!app) return;
    setLaunchDeckPinned(app.id, !app.pinned);
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => {
    const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
    if (!app || !window.confirm(`Delete ${app.name} from Launch Deck? This will not uninstall the program.`)) return;
    deleteLaunchDeckApplication(app.id);
    selectedId = null;
  });
  mount!.querySelector<HTMLInputElement>('[data-search]')?.addEventListener('input', (event) => {
    search = (event.currentTarget as HTMLInputElement).value;
    render();
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', exportRegistry);
  const importInput = mount!.querySelector<HTMLInputElement>('[data-import]');
  mount!.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => void importRegistry(importInput));
  mount!.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', () => void closeWindow());
}

async function editApplication(existing: LaunchDeckApplication | null): Promise<void> {
  let path = existing?.path ?? '';
  if (!path && isDesktopRuntime()) path = await selectLaunchExecutable() ?? '';
  if (!path) {
    path = window.prompt('Enter the full executable path:', '')?.trim() ?? '';
  }
  if (!path) return;
  const name = window.prompt('Display name:', existing?.name ?? guessName(path))?.trim();
  if (!name) return;
  const category = (window.prompt('Category: browser, research, communications, media, utilities, or custom', existing?.category ?? 'custom')?.trim().toLowerCase() ?? 'custom') as LaunchDeckCategory;
  const argumentsText = window.prompt('Startup arguments, one per line. Leave blank for none:', existing?.arguments.join('\n') ?? '') ?? '';
  const workingDirectory = window.prompt('Optional working directory:', existing?.workingDirectory ?? '')?.trim() ?? '';
  const allowUrlHandoff = window.confirm('Allow Watchtower to append a URL when you explicitly choose OPEN URL?');
  const allowFileHandoff = window.confirm('Allow Watchtower to append a selected file path when you explicitly choose OPEN FILE?');
  try {
    const saved = saveLaunchDeckApplication({
      ...existing,
      name,
      path,
      category: ['browser', 'research', 'communications', 'media', 'utilities', 'custom'].includes(category) ? category : 'custom',
      arguments: argumentsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      workingDirectory: workingDirectory || undefined,
      pinned: existing?.pinned ?? true,
      approved: true,
      allowUrlHandoff,
      allowFileHandoff,
    });
    selectedId = saved.id;
    status = `${saved.name.toUpperCase()} SAVED`;
  } catch (error) {
    status = error instanceof Error ? error.message.toUpperCase() : 'APPLICATION COULD NOT BE SAVED';
  }
  render();
}

function guessName(path: string): string {
  const part = path.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? 'Application';
  return part.replace(/[-_]+/g, ' ');
}

async function approveSelected(): Promise<void> {
  const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
  if (!app) return;
  if (!isDesktopRuntime()) {
    status = 'PATH APPROVAL REQUIRES DESKTOP MODE';
    render();
    return;
  }
  const selectedPath = await selectLaunchExecutable();
  if (!selectedPath) return;
  try {
    const approved = approveLaunchDeckApplication(app.id, selectedPath);
    selectedId = approved.id;
    status = `${approved.name.toUpperCase()} PATH APPROVED`;
  } catch (error) {
    status = error instanceof Error ? error.message.toUpperCase() : 'PATH APPROVAL FAILED';
  }
  render();
}

async function runSelected(): Promise<void> {
  const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
  if (!app) return;
  await run(app);
}

async function runUrl(): Promise<void> {
  const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
  if (!app) return;
  const value = window.prompt(`Enter the URL to open in ${app.name}:`, 'https://')?.trim();
  if (!value) return;
  try {
    const parsed = new URL(value);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) throw new Error('Use an HTTPS URL. HTTP is allowed only for localhost.');
    await run(app, { type: 'url', value: parsed.toString() });
  } catch (error) {
    status = error instanceof Error ? error.message.toUpperCase() : 'INVALID URL';
    render();
  }
}

async function runFile(): Promise<void> {
  const app = selectedId ? getLaunchDeckApplication(selectedId) : null;
  if (!app) return;
  const value = isDesktopRuntime() ? await selectLaunchHandoffFile() : window.prompt('Enter the file path:');
  if (!value?.trim()) return;
  await run(app, { type: 'file', value: value.trim() });
}

async function run(app: LaunchDeckApplication, handoff?: { type: 'url' | 'file'; value: string }): Promise<void> {
  status = `STARTING ${app.name.toUpperCase()}…`;
  render();
  try {
    const result = await launchDeckApplication(app, handoff);
    status = `${app.name.toUpperCase()} STARTED · PID ${result.pid}`;
  } catch (error) {
    status = error instanceof Error ? error.message.toUpperCase() : 'APPLICATION LAUNCH FAILED';
  }
  render();
}

function exportRegistry(): void {
  const blob = new Blob([exportLaunchDeck()], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `project-v-launch-deck-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  status = 'LAUNCH DECK EXPORTED';
  render();
}

async function importRegistry(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const count = importLaunchDeck(JSON.parse(await file.text()));
    status = `${count} APPLICATION RECORDS IMPORTED · REVIEW PATHS BEFORE USE`;
  } catch (error) {
    status = error instanceof Error ? error.message.toUpperCase() : 'IMPORT FAILED';
  }
  render();
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    await tryInvokeTauri<void>('close_launch_desk_window');
    return;
  }
  window.close();
}

cleanup = subscribeLaunchDeck(() => render());
window.addEventListener('beforeunload', () => cleanup?.());

const params = new URLSearchParams(location.search);
render();
if (params.get('mode') === 'new') void editApplication(null);
