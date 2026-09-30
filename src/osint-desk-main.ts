import './styles/workspace-windows.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { escapeHtml } from '@/utils/sanitize';
import { installWorkspaceLockGuard } from '@/services/workspace-lock-guard';
import { isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import {
  clearOsintHistory,
  deleteCustomOsintTool,
  exportOsintTools,
  getOsintTools,
  importOsintTools,
  loadOsintHistory,
  openOsintTool,
  type OsintOpenMode,
  saveCustomOsintTool,
  type OsintQueryType,
  type OsintToolDefinition,
} from '@/services/osint-tools';

applyStoredTheme();
installWorkspaceLockGuard();

const mount = document.getElementById('osintDeskApp');
if (!mount) throw new Error('OSINT Desk mount point is missing.');

let queryType: OsintQueryType = 'username';
let query = '';
let filter = 'all';
let status = 'READY';
let error = false;

function render(): void {
  const tools = getOsintTools();
  const visible = tools.filter((tool) => tool.queryTypes.includes(queryType) && (filter === 'all' || tool.category === filter));
  const history = loadOsintHistory();
  mount!.innerHTML = `
    <div class="pv-window-shell pv-osint-desk-shell">
      <header class="pv-window-header">
        <div class="pv-window-brand"><span class="pv-window-mark">V</span><div><strong>PROJECT V // OSINT DESK</strong><small>PUBLIC-SOURCE QUERY LAUNCHER · USER-CONTROLLED SERVICES · NO AUTOMATED ACCOUNT ACCESS</small></div></div>
        <div class="pv-window-header-actions">
          <button data-action="add">ADD TOOL</button>
          <button data-action="export">EXPORT</button>
          <button data-action="import">IMPORT</button>
          <button data-action="close">CLOSE</button>
          <input type="file" accept="application/json,.json" data-import hidden>
        </div>
      </header>
      <section class="pv-osint-querybar">
        <label>QUERY TYPE<select data-query-type>
          ${(['username','email','domain','ip','phone','text'] as OsintQueryType[]).map((type) => `<option value="${type}" ${queryType === type ? 'selected' : ''}>${type.toUpperCase()}</option>`).join('')}
        </select></label>
        <label class="wide">IDENTIFIER<input data-query maxlength="500" value="${escapeHtml(query)}" placeholder="Enter a username, email, domain, IP address, phone number, or search phrase"></label>
        <button class="primary" data-action="run-first" ${visible.length && query.trim() ? '' : 'disabled'}>OPEN FIRST MATCH</button>
        <button data-action="copy" ${query.trim() ? '' : 'disabled'}>COPY QUERY</button>
      </section>
      <nav class="pv-osint-tabs">
        ${[['all','ALL'],['search','SEARCH'],['identity','IDENTITY'],['domain','DOMAIN'],['network','NETWORK'],['custom','CUSTOM']].map(([id,label]) => `<button data-filter="${id}" class="${filter === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav>
      <main class="pv-osint-main">
        <section class="pv-osint-tool-grid">
          ${visible.length ? visible.map((tool) => toolCard(tool)).join('') : '<div class="pv-osint-empty">NO TOOLS MATCH THIS QUERY TYPE AND CATEGORY</div>'}
        </section>
        <aside class="pv-osint-history">
          <header><strong>RECENT QUERIES</strong><button data-action="clear-history">CLEAR</button></header>
          <div>${history.length ? history.slice(0, 30).map((item) => {
            const tool = tools.find((candidate) => candidate.id === item.toolId);
            return `<button data-history-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.query)}</strong><span>${escapeHtml(item.queryType.toUpperCase())} · ${escapeHtml(tool?.name ?? 'REMOVED TOOL')}</span><time>${new Date(item.openedAt).toLocaleString()}</time></button>`;
          }).join('') : '<p>NO SEARCHES OPENED YET</p>'}</div>
          <footer><strong>AUTHORIZED PUBLIC-SOURCE USE ONLY</strong><span>Project V opens the service you select. It does not bypass logins, scrape private accounts, or guarantee that third-party results are accurate.</span></footer>
        </aside>
      </main>
      <footer class="pv-window-status ${error ? 'error' : ''}" data-status>${escapeHtml(status)}</footer>
    </div>`;
  bind(visible, history);
}

function toolCard(tool: OsintToolDefinition): string {
  return `<article class="pv-osint-tool-card ${tool.builtIn ? 'core' : 'custom'}">
    <header><span>${tool.builtIn ? 'CORE' : 'CUSTOM'}</span><strong>${escapeHtml(tool.name)}</strong></header>
    <p>${escapeHtml(tool.description)}</p>
    <div class="types">${tool.queryTypes.map((type) => `<span>${type.toUpperCase()}</span>`).join('')}</div>
    <footer><button data-tool-open="${escapeHtml(tool.id)}">OPEN</button><button data-tool-external="${escapeHtml(tool.id)}">BROWSER</button>${tool.builtIn ? '' : `<button data-tool-delete="${escapeHtml(tool.id)}" class="danger">DELETE</button>`}</footer>
  </article>`;
}

function bind(visible: OsintToolDefinition[], history: ReturnType<typeof loadOsintHistory>): void {
  const typeSelect = mount!.querySelector<HTMLSelectElement>('[data-query-type]');
  typeSelect?.addEventListener('change', () => { queryType = typeSelect.value as OsintQueryType; render(); });
  const queryInput = mount!.querySelector<HTMLInputElement>('[data-query]');
  queryInput?.addEventListener('input', () => { query = queryInput.value; updateButtons(); });
  queryInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); const first = visible[0]; if (first && query.trim()) void run(first); }
  });
  mount!.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter ?? 'all'; render(); }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-tool-open]').forEach((button) => button.addEventListener('click', () => {
    const tool = getOsintTools().find((candidate) => candidate.id === button.dataset.toolOpen);
    if (tool) void run(tool, 'restricted');
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-tool-external]').forEach((button) => button.addEventListener('click', () => {
    const tool = getOsintTools().find((candidate) => candidate.id === button.dataset.toolExternal);
    if (tool) void run(tool, 'external');
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-tool-delete]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.toolDelete ?? '';
    if (!window.confirm('Delete this custom OSINT launcher?')) return;
    deleteCustomOsintTool(id); status = 'CUSTOM TOOL DELETED'; error = false; render();
  }));
  mount!.querySelector<HTMLButtonElement>('[data-action="run-first"]')?.addEventListener('click', () => { if (visible[0]) void run(visible[0]); });
  mount!.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener('click', () => void navigator.clipboard.writeText(query.trim()).then(() => setStatus('QUERY COPIED')).catch(() => setStatus('CLIPBOARD UNAVAILABLE', true)));
  mount!.querySelector<HTMLButtonElement>('[data-action="add"]')?.addEventListener('click', addTool);
  mount!.querySelector<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', exportTools);
  const input = mount!.querySelector<HTMLInputElement>('[data-import]');
  mount!.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => void importTools(input));
  mount!.querySelector<HTMLButtonElement>('[data-action="clear-history"]')?.addEventListener('click', () => { clearOsintHistory(); status = 'HISTORY CLEARED'; render(); });
  mount!.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', () => void closeWindow());
  mount!.querySelectorAll<HTMLButtonElement>('[data-history-id]').forEach((button) => button.addEventListener('click', () => {
    const item = history.find((candidate) => candidate.id === button.dataset.historyId);
    if (!item) return;
    query = item.query; queryType = item.queryType; render();
  }));
}

function updateButtons(): void {
  const enabled = Boolean(query.trim());
  mount!.querySelectorAll<HTMLButtonElement>('[data-action="run-first"], [data-action="copy"]').forEach((button) => { button.disabled = !enabled; });
}

function openedStatus(tool: OsintToolDefinition, mode: OsintOpenMode): string {
  if (mode === 'restricted-window') return `${tool.name.toUpperCase()} OPENED IN PROJECT V SOURCE WINDOW`;
  if (mode === 'default-browser') return `${tool.name.toUpperCase()} OPENED IN DEFAULT BROWSER`;
  return `${tool.name.toUpperCase()} OPENED IN BROWSER POPUP`;
}

async function run(tool: OsintToolDefinition, preference: 'restricted' | 'external' = 'restricted'): Promise<void> {
  try {
    setStatus(`OPENING ${tool.name.toUpperCase()}…`);
    const mode = await openOsintTool(tool, query, queryType, preference);
    status = openedStatus(tool, mode);
    error = false;
    render();
  } catch (cause) {
    setStatus(cause instanceof Error ? cause.message : 'Unable to open OSINT service.', true);
  }
}

function addTool(): void {
  const name = window.prompt('Tool name');
  if (!name) return;
  const template = window.prompt('HTTPS URL template. Use {query}, {username}, {email}, {domain}, {ip}, or {phone}.');
  if (!template) return;
  const types = window.prompt('Supported types, comma separated: username,email,domain,ip,phone,text', queryType)?.split(',').map((value) => value.trim().toLowerCase()) as OsintQueryType[] | undefined;
  try {
    saveCustomOsintTool({ name, urlTemplate: template, queryTypes: types ?? [queryType], description: 'User-added public-source lookup launcher.' });
    status = 'CUSTOM TOOL ADDED'; error = false; filter = 'custom'; render();
  } catch (cause) {
    setStatus(cause instanceof Error ? cause.message : 'Unable to add tool.', true);
  }
}

function exportTools(): void {
  const blob = new Blob([exportOsintTools()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `project-v-osint-tools-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  URL.revokeObjectURL(url);
  setStatus('CUSTOM TOOL REGISTRY EXPORTED');
}

async function importTools(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try { const count = importOsintTools(await file.text()); status = `${count} CUSTOM TOOL(S) IMPORTED`; error = false; filter = 'custom'; render(); }
  catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Unable to import tools.', true); }
}

function setStatus(message: string, isError = false): void {
  status = message; error = isError;
  const el = mount!.querySelector<HTMLElement>('[data-status]');
  if (el) { el.textContent = message; el.classList.toggle('error', isError); }
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) { await tryInvokeTauri<void>('close_osint_desk_window'); return; }
  window.close();
}

render();
