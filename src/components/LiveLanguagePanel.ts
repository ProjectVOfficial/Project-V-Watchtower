import { Panel } from './Panel';
import {
  LIVE_LANGUAGE_TARGETS,
  clearLiveLanguageTranscript,
  exportLiveLanguageTranscript,
  getLiveLanguageSnapshot,
  startLiveLanguageCapture,
  stopLiveLanguageCapture,
  subscribeLiveLanguage,
  updateLiveLanguageSettings,
  type LiveLanguageDisplayMode,
  type LiveLanguageSnapshot,
  type LiveLanguageSource,
  type LiveLanguageTarget,
} from '@/services/live-language';
import '@/styles/live-language.css';

export class LiveLanguagePanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'live-language',
      title: 'LIVE LANGUAGE',
      showCount: true,
      className: 'panel-wide v-live-language-panel',
      infoTooltip: 'Local multilingual speech transcription with optional Ollama translation. Capture microphone audio or shared/system audio from a Watchtower, Camera Wall, or communications window.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '5';
    element.dataset.moduleMinH = '4';
    element.dataset.moduleCategory = 'operations';
    this.cleanup = subscribeLiveLanguage((state) => this.render(state));
    this.render(getLiveLanguageSnapshot());
  }

  private render(state: LiveLanguageSnapshot): void {
    this.setCount(state.entries.length);
    const transcriptVisible = state.settings.displayMode === 'transcript' || state.settings.displayMode === 'both';
    const recent = state.entries.slice(-16).reverse();
    this.content.innerHTML = `
      <div class="v-live-language-shell">
        <div class="v-live-language-banner">
          <div><span>${state.running ? 'LIVE CAPTURE' : 'LOCAL LANGUAGE DESK'}</span><strong>${this.escape(state.status)}</strong></div>
          <div class="v-live-language-led ${state.running ? 'active' : ''}"><i></i>${state.modelReady ? 'WHISPER READY' : state.loadingModel ? 'LOADING MODEL' : 'MODEL ON DEMAND'}</div>
        </div>

        <div class="v-live-language-summary">
          <article><strong>${state.entries.length}</strong><span>TRANSCRIPT SEGMENTS</span></article>
          <article><strong>${state.settings.source === 'system' ? 'SHARED' : 'MIC'}</strong><span>AUDIO SOURCE</span></article>
          <article><strong>${this.escape(this.targetLabel(state.settings.target).toUpperCase())}</strong><span>TRANSLATION TARGET</span></article>
          <article><strong>${state.settings.displayMode.toUpperCase()}</strong><span>DISPLAY MODE</span></article>
        </div>

        <div class="v-live-language-controls">
          <label>SOURCE
            <select data-live-language-source ${state.running ? 'disabled' : ''}>
              <option value="system"${state.settings.source === 'system' ? ' selected' : ''}>SHARED / SYSTEM AUDIO</option>
              <option value="microphone"${state.settings.source === 'microphone' ? ' selected' : ''}>MICROPHONE</option>
            </select>
          </label>
          <label>TRANSLATE TO
            <select data-live-language-target>
              ${LIVE_LANGUAGE_TARGETS.map((item) => `<option value="${item.id}"${item.id === state.settings.target ? ' selected' : ''}>${this.escape(item.label.toUpperCase())}</option>`).join('')}
            </select>
          </label>
          <label>DISPLAY
            <select data-live-language-display>
              <option value="captions"${state.settings.displayMode === 'captions' ? ' selected' : ''}>CAPTIONS</option>
              <option value="transcript"${state.settings.displayMode === 'transcript' ? ' selected' : ''}>SIDE TRANSCRIPT</option>
              <option value="both"${state.settings.displayMode === 'both' ? ' selected' : ''}>BOTH</option>
            </select>
          </label>
          <label class="v-live-language-save"><input type="checkbox" data-live-language-save${state.settings.saveTranscript ? ' checked' : ''}> SAVE TRANSCRIPT LOCALLY</label>
        </div>

        <div class="v-live-language-actions">
          <button type="button" class="primary" data-live-language-action="${state.running ? 'stop' : 'start'}">${state.running ? 'STOP LISTENING' : 'START LIVE LANGUAGE'}</button>
          <button type="button" data-live-language-action="copy"${state.entries.length ? '' : ' disabled'}>COPY TRANSCRIPT</button>
          <button type="button" data-live-language-action="export"${state.entries.length ? '' : ' disabled'}>EXPORT TXT</button>
          <button type="button" class="danger" data-live-language-action="clear"${state.entries.length ? '' : ' disabled'}>CLEAR</button>
        </div>

        ${state.error ? `<div class="v-live-language-error"><strong>LIVE LANGUAGE ERROR</strong><span>${this.escape(state.error)}</span></div>` : ''}
        <div class="v-live-language-help">
          <span>WHISPER</span><p>Speech recognition runs locally in Watchtower with the bundled Transformers runtime. The Whisper model loads on first use and is cached by the webview when supported.</p>
          <span>AUDIO</span><p>For Camera Wall or communications audio choose SHARED / SYSTEM AUDIO, then select the window and enable Share audio. Watchtower does not inject capture code into isolated remote provider webviews.</p>
          <span>TRANSLATION</span><p>Optional translation uses your configured local Ollama model. If Ollama is unavailable, the original Whisper transcript remains available.</p>
        </div>

        <section class="v-live-language-transcript ${transcriptVisible ? '' : 'display-disabled'}">
          <header><strong>LIVE TRANSCRIPT</strong><span>${transcriptVisible ? 'VISIBLE' : 'CAPTIONS-ONLY MODE'}</span></header>
          <div class="v-live-language-transcript-list">
            ${recent.length ? recent.map((entry) => `
              <article>
                <time>${this.escape(new Date(entry.createdAt).toLocaleTimeString())}</time>
                <div><p>${this.escape(entry.original)}</p>${entry.target !== 'original' ? `<strong>${entry.translating ? 'TRANSLATING…' : this.escape(entry.translated || entry.original)}</strong>` : ''}</div>
              </article>`).join('') : '<div class="v-live-language-empty">NO TRANSCRIPT YET<br><small>Start Live Language and play or speak audio.</small></div>'}
          </div>
        </section>
      </div>
    `;

    this.bind(state);
  }

  private bind(state: LiveLanguageSnapshot): void {
    this.content.querySelector<HTMLSelectElement>('[data-live-language-source]')?.addEventListener('change', (event) => {
      updateLiveLanguageSettings({ source: (event.currentTarget as HTMLSelectElement).value as LiveLanguageSource });
    });
    this.content.querySelector<HTMLSelectElement>('[data-live-language-target]')?.addEventListener('change', (event) => {
      updateLiveLanguageSettings({ target: (event.currentTarget as HTMLSelectElement).value as LiveLanguageTarget });
    });
    this.content.querySelector<HTMLSelectElement>('[data-live-language-display]')?.addEventListener('change', (event) => {
      updateLiveLanguageSettings({ displayMode: (event.currentTarget as HTMLSelectElement).value as LiveLanguageDisplayMode });
    });
    this.content.querySelector<HTMLInputElement>('[data-live-language-save]')?.addEventListener('change', (event) => {
      updateLiveLanguageSettings({ saveTranscript: (event.currentTarget as HTMLInputElement).checked });
    });

    this.content.querySelector<HTMLButtonElement>('[data-live-language-action="start"]')?.addEventListener('click', () => {
      void startLiveLanguageCapture().catch(() => undefined);
    });
    this.content.querySelector<HTMLButtonElement>('[data-live-language-action="stop"]')?.addEventListener('click', () => {
      stopLiveLanguageCapture();
    });
    this.content.querySelector<HTMLButtonElement>('[data-live-language-action="clear"]')?.addEventListener('click', () => {
      if (!state.entries.length || window.confirm('Clear the current Live Language transcript?')) clearLiveLanguageTranscript();
    });
    this.content.querySelector<HTMLButtonElement>('[data-live-language-action="export"]')?.addEventListener('click', () => exportLiveLanguageTranscript());
    this.content.querySelector<HTMLButtonElement>('[data-live-language-action="copy"]')?.addEventListener('click', () => void this.copyTranscript(state));
  }

  private async copyTranscript(state: LiveLanguageSnapshot): Promise<void> {
    const text = state.entries.map((entry) => {
      const translated = entry.translated && entry.translated !== entry.original ? `\n→ ${entry.translated}` : '';
      return `[${new Date(entry.createdAt).toLocaleTimeString()}] ${entry.original}${translated}`;
    }).join('\n\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  private targetLabel(target: LiveLanguageTarget): string {
    return LIVE_LANGUAGE_TARGETS.find((item) => item.id === target)?.label ?? 'English';
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
  }

  public override destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    super.destroy();
  }
}
