import { Panel } from './Panel';
import type { ProjectVOperationsCenter } from '@/services/operations-center';
import { createResearchMemory } from '@/services/research-library';
import { invokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

interface RecentSource {
  title: string;
  url: string;
  openedAt: number;
}

const RECENT_KEY = 'project-v-source-browser-recents-v1';

function normalizeUrl(value: string): URL {
  const prepared = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const url = new URL(prepared);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Only HTTPS links and localhost HTTP links are allowed.');
  }
  return url;
}

function loadRecent(): RecentSource[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentSource => Boolean(item)
      && typeof item === 'object'
      && typeof (item as RecentSource).title === 'string'
      && typeof (item as RecentSource).url === 'string'
      && typeof (item as RecentSource).openedAt === 'number').slice(0, 12);
  } catch {
    return [];
  }
}

function saveRecent(source: RecentSource): void {
  const next = [source, ...loadRecent().filter((item) => item.url !== source.url)].slice(0, 12);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export class SourceBrowserPanel extends Panel {
  private readonly operations: ProjectVOperationsCenter;

  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'source-browser',
      title: 'SOURCE BROWSER',
      showCount: true,
      className: 'panel-wide v-source-browser-panel',
      infoTooltip: 'A limited browser handoff module. It opens reviewed HTTPS pages in an untrusted desktop webview or external browser, then lets you save the link to Research or an Event Timeline.',
    });
    this.operations = operations;
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '3';
    element.dataset.moduleCategory = 'research';
    this.render();
  }

  private render(): void {
    const recent = loadRecent();
    this.setCount(recent.length);
    this.content.innerHTML = `
      <div class="v-source-browser-shell">
        <div class="v-source-browser-bar">
          <input data-field="title" maxlength="160" placeholder="SOURCE TITLE">
          <input data-field="url" type="text" maxlength="1000" placeholder="https://example.org/report">
          <button type="button" data-action="open">OPEN WINDOW</button>
          <button type="button" data-action="external">EXTERNAL</button>
        </div>
        <textarea data-field="note" rows="3" maxlength="4000" placeholder="OPTIONAL ANALYST NOTE, WHY THIS SOURCE MATTERS, OR WHAT TO VERIFY"></textarea>
        <div class="v-source-browser-actions">
          <button type="button" data-action="research">SAVE TO RESEARCH</button>
          <button type="button" data-action="timeline">ADD TO TIMELINE</button>
          <button type="button" data-action="copy">COPY LINK</button>
        </div>
        <div class="v-source-browser-warning"><strong>LIMITED INTEGRATION</strong><span>This is not the full Project V Browser. Remote pages receive no Watchtower IPC permissions. Sites may reject embedded WebView sign-in; use EXTERNAL when necessary.</span></div>
        <div class="v-source-recents">
          <div class="v-source-recents-head"><strong>RECENT SOURCES</strong><button type="button" data-action="clear-recents">CLEAR</button></div>
          ${recent.length === 0 ? '<div class="v-source-empty">NO SOURCES OPENED YET</div>' : recent.map((item, index) => `<button type="button" data-recent-index="${index}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(new URL(item.url).hostname)}</span><time>${new Date(item.openedAt).toLocaleString()}</time></button>`).join('')}
        </div>
        <div class="v-source-browser-status" data-status></div>
      </div>
    `;

    this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void this.open(true));
    this.content.querySelector<HTMLButtonElement>('[data-action="external"]')?.addEventListener('click', () => void this.open(false));
    this.content.querySelector<HTMLButtonElement>('[data-action="research"]')?.addEventListener('click', () => void this.saveToResearch());
    this.content.querySelector<HTMLButtonElement>('[data-action="timeline"]')?.addEventListener('click', () => this.addToTimeline());
    this.content.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener('click', () => void this.copy());
    this.content.querySelector<HTMLButtonElement>('[data-action="clear-recents"]')?.addEventListener('click', () => {
      localStorage.removeItem(RECENT_KEY);
      this.render();
    });
    this.content.querySelectorAll<HTMLButtonElement>('[data-recent-index]').forEach((button) => button.addEventListener('click', () => {
      const item = recent[Number(button.dataset.recentIndex)];
      if (!item) return;
      const title = this.content.querySelector<HTMLInputElement>('[data-field="title"]');
      const url = this.content.querySelector<HTMLInputElement>('[data-field="url"]');
      if (title) title.value = item.title;
      if (url) url.value = item.url;
    }));
  }

  private getInput(): { title: string; url: URL; note: string } {
    const rawUrl = this.content.querySelector<HTMLInputElement>('[data-field="url"]')?.value ?? '';
    const url = normalizeUrl(rawUrl);
    const rawTitle = this.content.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim() ?? '';
    const note = this.content.querySelector<HTMLTextAreaElement>('[data-field="note"]')?.value.trim() ?? '';
    return { title: rawTitle || url.hostname, url, note };
  }

  private async open(integrated: boolean): Promise<void> {
    try {
      const source = this.getInput();
      if (integrated && isDesktopRuntime()) {
        await invokeTauri<void>('open_source_browser_window', { url: source.url.href, title: source.title });
      } else {
        window.open(source.url.href, '_blank', 'noopener,noreferrer');
      }
      saveRecent({ title: source.title, url: source.url.href, openedAt: Date.now() });
      this.render();
      const titleInput = this.content.querySelector<HTMLInputElement>('[data-field="title"]');
      const urlInput = this.content.querySelector<HTMLInputElement>('[data-field="url"]');
      const noteInput = this.content.querySelector<HTMLTextAreaElement>('[data-field="note"]');
      if (titleInput) titleInput.value = source.title;
      if (urlInput) urlInput.value = source.url.href;
      if (noteInput) noteInput.value = source.note;
      this.setStatus(`${source.title} OPENED ${integrated && isDesktopRuntime() ? 'IN RESTRICTED WINDOW' : 'EXTERNALLY'}`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to open source.', true);
    }
  }

  private async saveToResearch(): Promise<void> {
    try {
      const source = this.getInput();
      await createResearchMemory(
        `SOURCE // ${source.title}`,
        `Source URL: ${source.url.href}\n\nAnalyst note:\n${source.note || 'No note added.'}`,
        ['source-link', source.url.hostname],
      );
      this.setStatus('SOURCE SAVED TO RESEARCH LIBRARY');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to save source.', true);
    }
  }

  private addToTimeline(): void {
    try {
      const source = this.getInput();
      this.operations.addTimelineEvent({
        title: source.title,
        detail: source.note || `Source saved for analyst review: ${source.url.href}`,
        category: 'SOURCE REVIEW',
        source: source.url.hostname,
        link: source.url.href,
        occurredAt: Date.now(),
        confidence: 'analyst',
      });
      this.setStatus('SOURCE ADDED TO EVENT TIMELINE');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to add timeline item.', true);
    }
  }

  private async copy(): Promise<void> {
    try {
      const source = this.getInput();
      await navigator.clipboard.writeText(source.url.href);
      this.setStatus('SOURCE LINK COPIED');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to copy source link.', true);
    }
  }

  private setStatus(message: string, error = false): void {
    const status = this.content.querySelector<HTMLElement>('[data-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }
}
