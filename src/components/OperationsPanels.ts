import { Panel } from './Panel';
import type {
  AlertRuleKind,
  OperationalSeverity,
  ProjectVOperationsCenter,
  TimelineConfidence,
} from '@/services/operations-center';
import { escapeHtml } from '@/utils/sanitize';
import { openRuntimeSettings } from '@/services/open-runtime-settings';
import { sendToCaseDesk } from '@/services/case-handoff';
import { sendOperationalAlertToPhoenix } from '@/services/phoenix-ai-bridge';

function timeAgo(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
}

function dateTimeLocalValue(timestamp = Date.now()): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function downloadText(filename: string, text: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

abstract class OperationsPanel extends Panel {
  protected readonly operations: ProjectVOperationsCenter;
  private readonly unsubscribe: () => void;

  constructor(options: ConstructorParameters<typeof Panel>[0], operations: ProjectVOperationsCenter) {
    super(options);
    this.operations = operations;
    this.unsubscribe = operations.subscribe(() => this.render());
  }

  public override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }

  protected abstract render(): void;
}

export class AlertCenterPanel extends OperationsPanel {
  private filter: 'open' | 'all' | 'critical' = 'open';

  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'alert-center',
      title: 'ALERT CENTER',
      showCount: true,
      className: 'panel-wide v-operations-panel',
      infoTooltip: 'Local operational alerts generated from Watchtower breaking news, custom rules, and watchlist matches. Alerts are leads until independently verified.',
    }, operations);
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '3';
    this.render();
  }

  protected render(): void {
    const all = this.operations.getAlerts();
    const openCount = all.filter((alert) => alert.status === 'open').length;
    const criticalCount = all.filter((alert) => alert.status === 'open' && (alert.severity === 'critical' || alert.severity === 'high')).length;
    const filtered = all.filter((alert) => {
      if (this.filter === 'open') return alert.status === 'open';
      if (this.filter === 'critical') return alert.status !== 'resolved' && (alert.severity === 'critical' || alert.severity === 'high');
      return true;
    });
    this.setCount(openCount);
    this.setNewBadge(openCount, criticalCount > 0);

    this.content.innerHTML = `
      <div class="v-ops-toolbar">
        <div class="v-ops-summary">
          <span><strong>${openCount}</strong> OPEN</span>
          <span class="critical"><strong>${criticalCount}</strong> HIGH/CRITICAL</span>
          <span><strong>${all.filter((item) => item.status === 'acknowledged').length}</strong> ACK</span>
        </div>
        <div class="v-ops-filter-row">
          <button type="button" data-filter="open" class="${this.filter === 'open' ? 'active' : ''}">OPEN</button>
          <button type="button" data-filter="critical" class="${this.filter === 'critical' ? 'active' : ''}">PRIORITY</button>
          <button type="button" data-filter="all" class="${this.filter === 'all' ? 'active' : ''}">ALL</button>
          <button type="button" data-action="clear">CLEAR RESOLVED</button>
        </div>
      </div>
      <div class="v-alert-list">
        ${filtered.length === 0 ? '<div class="v-ops-empty">NO ALERTS MATCH THIS FILTER</div>' : filtered.slice(0, 100).map((alert) => `
          <article class="v-alert-item severity-${alert.severity} status-${alert.status}" data-alert-id="${escapeHtml(alert.id)}">
            <div class="v-alert-accent"></div>
            <div class="v-alert-main">
              <div class="v-alert-meta">
                <span class="v-severity-badge ${alert.severity}">${alert.severity.toUpperCase()}</span>
                <span>${escapeHtml(alert.category)}</span>
                <span>${escapeHtml(alert.source)}</span>
                <time>${timeAgo(alert.detectedAt)}</time>
              </div>
              <strong>${escapeHtml(alert.title)}</strong>
              <p>${escapeHtml(alert.detail)}</p>
              ${alert.location ? `<small>LOCATION: ${escapeHtml(alert.location)}</small>` : ''}
            </div>
            <div class="v-alert-actions">
              ${alert.link ? '<button type="button" data-action="open">SOURCE</button>' : ''}
              <button type="button" data-action="timeline">TIMELINE</button>
              <button type="button" data-action="case">CASE</button>
              <button type="button" data-action="phoenix">PHOENIX</button>
              <button type="button" data-action="sentinel">SENTINEL</button>
              <button type="button" data-action="ack">${alert.status === 'acknowledged' ? 'UNACK' : 'ACK'}</button>
              <button type="button" data-action="resolve">RESOLVE</button>
            </div>
          </article>
        `).join('')}
      </div>
    `;

    this.content.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        this.filter = button.dataset.filter as typeof this.filter;
        this.render();
      });
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="clear"]')?.addEventListener('click', () => this.operations.clearResolvedAlerts());
    this.content.querySelectorAll<HTMLElement>('[data-alert-id]').forEach((item) => {
      const id = item.dataset.alertId;
      if (!id) return;
      item.querySelector<HTMLButtonElement>('[data-action="ack"]')?.addEventListener('click', () => this.operations.acknowledgeAlert(id));
      item.querySelector<HTMLButtonElement>('[data-action="resolve"]')?.addEventListener('click', () => this.operations.resolveAlert(id));
      item.querySelector<HTMLButtonElement>('[data-action="timeline"]')?.addEventListener('click', () => this.operations.addAlertToTimeline(id));
      item.querySelector<HTMLButtonElement>('[data-action="case"]')?.addEventListener('click', () => {
        const alert = all.find((candidate) => candidate.id === id);
        if (!alert) return;
        void sendToCaseDesk({
          type: 'event',
          title: alert.title,
          detail: alert.detail,
          confidence: 'unverified',
          source: alert.source,
          sourceUrl: alert.link,
          occurredAt: alert.sourceTime ?? alert.detectedAt,
          metadata: {
            'Watchtower alert ID': alert.id,
            Severity: alert.severity,
            Category: alert.category,
            Location: alert.location ?? '',
            Workspace: alert.workspaceId,
          },
        });
      });
      item.querySelector<HTMLButtonElement>('[data-action="phoenix"]')?.addEventListener('click', (event) => {
        const alert = all.find((candidate) => candidate.id === id);
        if (!alert) return;
        const button = event.currentTarget as HTMLButtonElement;
        const original = button.textContent || 'PHOENIX';
        button.disabled = true;
        button.textContent = 'SENDING…';
        void sendOperationalAlertToPhoenix(alert, { manual: true })
          .then((result) => {
            button.textContent = result.ok ? (result.duplicate ? 'ALREADY SENT' : 'SENT') : 'FAILED';
            if (!result.ok) window.alert(result.message);
          })
          .catch((error: unknown) => {
            button.textContent = 'FAILED';
            window.alert(error instanceof Error ? error.message : 'Unable to send this alert to Phoenix.');
          })
          .finally(() => {
            window.setTimeout(() => {
              button.disabled = false;
              button.textContent = original;
            }, 1600);
          });
      });
      item.querySelector<HTMLButtonElement>('[data-action="sentinel"]')?.addEventListener('click', (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const original = button.textContent || 'SENTINEL';
        try {
          const sentinel = this.operations.addPhoenixSentinelFromAlert(id);
          button.textContent = sentinel ? 'ARMED' : 'NOT FOUND';
        } catch (error) {
          button.textContent = 'FAILED';
          window.alert(error instanceof Error ? error.message : 'Unable to arm Phoenix Sentinel.');
        } finally {
          window.setTimeout(() => {
            if (button.isConnected) button.textContent = original;
          }, 1800);
        }
      });
      item.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => {
        const alert = all.find((candidate) => candidate.id === id);
        if (alert?.link) window.open(alert.link, '_blank', 'noopener,noreferrer');
      });
    });
  }
}

export class AlertRulesPanel extends OperationsPanel {
  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'alert-rules',
      title: 'ALERT RULES',
      showCount: true,
      className: 'v-operations-panel',
      infoTooltip: 'Rules run locally while Watchtower is open. Keyword and source rules inspect current news; volume rules trigger when the number of matching headlines in the last hour reaches the threshold.',
    }, operations);
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '3';
    this.render();
  }

  protected render(): void {
    const rules = this.operations.getRules();
    const prefs = this.operations.getNotificationPreferences();
    this.setCount(rules.filter((rule) => rule.enabled).length);
    this.content.innerHTML = `
      <form class="v-ops-form v-rule-form">
        <div class="v-form-row"><input name="name" maxlength="64" placeholder="RULE NAME" required></div>
        <div class="v-form-row split">
          <select name="kind">
            <option value="keyword">KEYWORD</option>
            <option value="source">SOURCE</option>
            <option value="news-volume">HOURLY VOLUME</option>
          </select>
          <select name="severity">
            <option value="watch">WATCH</option>
            <option value="elevated">ELEVATED</option>
            <option value="high">HIGH</option>
            <option value="critical">CRITICAL</option>
          </select>
        </div>
        <div class="v-form-row split">
          <input name="query" maxlength="200" placeholder="TERMS, SOURCE, OR OPTIONAL FILTER" required>
          <input name="threshold" type="number" min="1" max="1000" value="5" title="Volume threshold">
        </div>
        <button type="submit">ADD LOCAL RULE</button>
      </form>
      <section class="v-notification-settings">
        <strong>NOTIFICATIONS</strong>
        <label><input type="checkbox" data-pref="enabled" ${prefs.enabled ? 'checked' : ''}> ENABLED</label>
        <label><input type="checkbox" data-pref="desktop" ${prefs.desktop ? 'checked' : ''}> DESKTOP</label>
        <label><input type="checkbox" data-pref="sound" ${prefs.sound ? 'checked' : ''}> SOUND</label>
        <label><input type="checkbox" data-pref="spoken" ${prefs.spoken ? 'checked' : ''}> VOICE READOUT</label>
        <label><input type="checkbox" data-pref="quietMode" ${prefs.quietMode ? 'checked' : ''}> QUIET MODE</label>
        <select data-pref="minimumSeverity" aria-label="Minimum notification severity">
          ${(['info', 'watch', 'elevated', 'high', 'critical'] as OperationalSeverity[]).map((severity) => `<option value="${severity}" ${prefs.minimumSeverity === severity ? 'selected' : ''}>${severity.toUpperCase()}+</option>`).join('')}
        </select>
        <select data-pref="spokenMinimumSeverity" aria-label="Minimum spoken alert severity" title="Minimum severity for spoken alert readouts">
          ${(['watch', 'elevated', 'high', 'critical'] as OperationalSeverity[]).map((severity) => `<option value="${severity}" ${prefs.spokenMinimumSeverity === severity ? 'selected' : ''}>VOICE ${severity.toUpperCase()}+</option>`).join('')}
        </select>
        <small>VOICE READOUT USES THE VOICE, RATE, AND PITCH SELECTED IN VOICE COMMAND CENTER.</small>
      </section>
      <div class="v-rule-list">
        ${rules.length === 0 ? '<div class="v-ops-empty">NO CUSTOM RULES</div>' : rules.map((rule) => `
          <article class="v-rule-item ${rule.enabled ? '' : 'disabled'}" data-rule-id="${escapeHtml(rule.id)}">
            <label><input type="checkbox" data-action="toggle" ${rule.enabled ? 'checked' : ''}></label>
            <div><strong>${escapeHtml(rule.name)}</strong><small>${rule.kind.toUpperCase()} · ${escapeHtml(rule.query || 'ALL')} ${rule.kind === 'news-volume' ? `· ≥${rule.threshold}/HR` : ''}</small></div>
            <span class="v-severity-badge ${rule.severity}">${rule.severity.toUpperCase()}</span>
            <button type="button" data-action="delete">×</button>
          </article>
        `).join('')}
      </div>
    `;
    const form = this.content.querySelector<HTMLFormElement>('.v-rule-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const kind = String(data.get('kind')) as AlertRuleKind;
      const name = String(data.get('name') ?? '');
      const query = String(data.get('query') ?? '');
      const severity = String(data.get('severity')) as OperationalSeverity;
      const threshold = Number(data.get('threshold') ?? 1);
      this.operations.addRule({ name, kind, query, severity, threshold, enabled: true });
      form.reset();
    });
    this.content.querySelectorAll<HTMLElement>('[data-rule-id]').forEach((item) => {
      const id = item.dataset.ruleId;
      if (!id) return;
      item.querySelector<HTMLInputElement>('[data-action="toggle"]')?.addEventListener('change', (event) => {
        this.operations.updateRule(id, { enabled: (event.currentTarget as HTMLInputElement).checked });
      });
      item.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => this.operations.deleteRule(id));
    });
    this.content.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((input) => {
      input.addEventListener('change', () => void this.operations.updateNotificationPreferences({ [input.dataset.pref!]: input.checked }));
    });
    this.content.querySelector<HTMLSelectElement>('[data-pref="minimumSeverity"]')?.addEventListener('change', (event) => {
      void this.operations.updateNotificationPreferences({ minimumSeverity: (event.currentTarget as HTMLSelectElement).value as OperationalSeverity });
    });
    this.content.querySelector<HTMLSelectElement>('[data-pref="spokenMinimumSeverity"]')?.addEventListener('change', (event) => {
      void this.operations.updateNotificationPreferences({ spokenMinimumSeverity: (event.currentTarget as HTMLSelectElement).value as OperationalSeverity });
    });
  }
}

export class WatchlistsPanel extends OperationsPanel {
  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'watchlists',
      title: 'WATCHLISTS',
      showCount: true,
      className: 'v-operations-panel',
      infoTooltip: 'Track countries, locations, organizations, units, vessels, aircraft, companies, or topic keywords across loaded Watchtower headlines.',
    }, operations);
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '3';
    this.render();
  }

  protected render(): void {
    const watchlists = this.operations.getWatchlists();
    const sentinels = this.operations.getPhoenixSentinels();
    this.setCount(watchlists.filter((item) => item.enabled).length + sentinels.filter((item) => item.enabled).length);
    this.content.innerHTML = `
      <form class="v-ops-form v-watch-form">
        <input name="name" maxlength="64" placeholder="WATCHLIST NAME" required>
        <textarea name="terms" rows="2" maxlength="1000" placeholder="TERMS SEPARATED BY COMMAS" required></textarea>
        <div class="v-form-row split">
          <select name="severity">
            <option value="watch">WATCH</option>
            <option value="elevated">ELEVATED</option>
            <option value="high">HIGH</option>
          </select>
          <button type="submit">CREATE WATCHLIST</button>
        </div>
      </form>
      <div class="v-watch-list">
        ${watchlists.length === 0 ? '<div class="v-ops-empty">NO ACTIVE WATCHLISTS</div>' : watchlists.map((watchlist) => `
          <article class="v-watch-item ${watchlist.enabled ? '' : 'disabled'}" data-watch-id="${escapeHtml(watchlist.id)}">
            <div class="v-watch-heading">
              <label><input type="checkbox" data-action="toggle" ${watchlist.enabled ? 'checked' : ''}></label>
              <strong>${escapeHtml(watchlist.name)}</strong>
              <span class="v-severity-badge ${watchlist.severity}">${watchlist.severity.toUpperCase()}</span>
              <button type="button" data-action="delete">×</button>
            </div>
            <p>${watchlist.terms.map((term) => `<span>${escapeHtml(term)}</span>`).join('')}</p>
            <small>${watchlist.matchCount} MATCHES${watchlist.lastMatchAt ? ` · LAST ${timeAgo(watchlist.lastMatchAt)}` : ''}</small>
          </article>
        `).join('')}
      </div>
      <section class="v-notification-settings">
        <strong>PHOENIX SENTINELS</strong>
        <small>MONITORS NEW WATCHTOWER HEADLINES WHILE WATCHTOWER IS OPEN. QUALIFIED MATCHES ARE SAVED AS ALERTS AND SENT TO THE PAIRED PHOENIX RECEIVER.</small>
      </section>
      <form class="v-ops-form v-sentinel-form">
        <input name="name" maxlength="80" placeholder="SENTINEL NAME" required>
        <textarea name="terms" rows="2" maxlength="1000" placeholder="MONITOR TERMS SEPARATED BY COMMAS" required></textarea>
        <div class="v-form-row split">
          <select name="minimumSeverity" title="Minimum incoming Watchtower severity">
            <option value="watch">WATCH+</option>
            <option value="elevated">ELEVATED+</option>
            <option value="high">HIGH+</option>
            <option value="critical">CRITICAL+</option>
          </select>
          <button type="submit">CREATE SENTINEL</button>
        </div>
      </form>
      <div class="v-watch-list v-sentinel-list">
        ${sentinels.length === 0 ? '<div class="v-ops-empty">NO PHOENIX SENTINELS ARMED</div>' : sentinels.map((sentinel) => `
          <article class="v-watch-item ${sentinel.enabled ? '' : 'disabled'}" data-sentinel-id="${escapeHtml(sentinel.id)}">
            <div class="v-watch-heading">
              <label><input type="checkbox" data-action="toggle" ${sentinel.enabled ? 'checked' : ''}></label>
              <strong>${escapeHtml(sentinel.name)}</strong>
              <select data-action="threshold" aria-label="Sentinel minimum severity">
                ${(['watch', 'elevated', 'high', 'critical'] as OperationalSeverity[]).map((severity) => `<option value="${severity}" ${sentinel.minimumSeverity === severity ? 'selected' : ''}>${severity.toUpperCase()}+</option>`).join('')}
              </select>
              <button type="button" data-action="test" title="Inject one synthetic matching headline through the real Sentinel path">TEST</button>
              <button type="button" data-action="delete">×</button>
            </div>
            <p>${sentinel.terms.map((term) => `<span>${escapeHtml(term)}</span>`).join('')}</p>
            <small>${sentinel.matchCount} MATCHES${sentinel.lastMatchAt ? ` · LAST ${timeAgo(sentinel.lastMatchAt)}` : ''}${sentinel.lastTitle ? ` · ${escapeHtml(sentinel.lastTitle)}` : ''}</small>
          </article>
        `).join('')}
      </div>
    `;
    const form = this.content.querySelector<HTMLFormElement>('.v-watch-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get('name') ?? '');
      const terms = String(data.get('terms') ?? '').split(',');
      const severity = String(data.get('severity')) as OperationalSeverity;
      this.operations.addWatchlist(name, terms, severity);
      form.reset();
    });
    this.content.querySelectorAll<HTMLElement>('[data-watch-id]').forEach((item) => {
      const id = item.dataset.watchId;
      if (!id) return;
      item.querySelector<HTMLInputElement>('[data-action="toggle"]')?.addEventListener('change', (event) => {
        this.operations.toggleWatchlist(id, (event.currentTarget as HTMLInputElement).checked);
      });
      item.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => this.operations.deleteWatchlist(id));
    });
    const sentinelForm = this.content.querySelector<HTMLFormElement>('.v-sentinel-form');
    sentinelForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(sentinelForm);
      const name = String(data.get('name') ?? '');
      const terms = String(data.get('terms') ?? '').split(',');
      const minimumSeverity = String(data.get('minimumSeverity') ?? 'watch') as OperationalSeverity;
      try {
        this.operations.addPhoenixSentinel(name, terms, minimumSeverity);
        sentinelForm.reset();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Unable to create Phoenix Sentinel.');
      }
    });
    this.content.querySelectorAll<HTMLElement>('[data-sentinel-id]').forEach((item) => {
      const id = item.dataset.sentinelId;
      if (!id) return;
      item.querySelector<HTMLInputElement>('[data-action="toggle"]')?.addEventListener('change', (event) => {
        this.operations.togglePhoenixSentinel(id, (event.currentTarget as HTMLInputElement).checked);
      });
      item.querySelector<HTMLSelectElement>('[data-action="threshold"]')?.addEventListener('change', (event) => {
        this.operations.updatePhoenixSentinelMinimumSeverity(id, (event.currentTarget as HTMLSelectElement).value as OperationalSeverity);
      });
      item.querySelector<HTMLButtonElement>('[data-action="test"]')?.addEventListener('click', (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const fired = this.operations.testPhoenixSentinel(id);
        button.textContent = fired ? 'TEST SENT' : 'TEST FAILED';
        window.setTimeout(() => this.render(), 1200);
      });
      item.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => this.operations.deletePhoenixSentinel(id));
    });
  }
}

export class EventTimelinePanel extends OperationsPanel {
  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'event-timeline',
      title: 'EVENT TIMELINE',
      showCount: true,
      className: 'panel-wide v-operations-panel',
      infoTooltip: 'Build a chronological incident record from alerts and analyst notes. Confidence labels distinguish confirmed facts, unverified reports, disputes, and analyst observations.',
    }, operations);
    const element = this.getElement();
    element.dataset.moduleDefaultW = '8';
    element.dataset.moduleDefaultH = '6';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '3';
    this.render();
  }

  protected render(): void {
    const timeline = this.operations.getTimeline();
    this.setCount(timeline.length);
    this.content.innerHTML = `
      <form class="v-ops-form v-timeline-form">
        <div class="v-form-row split">
          <input name="title" maxlength="220" placeholder="EVENT TITLE" required>
          <input name="occurredAt" type="datetime-local" value="${dateTimeLocalValue()}" required>
        </div>
        <textarea name="detail" rows="2" maxlength="2000" placeholder="ANALYST NOTE OR EVENT DETAIL"></textarea>
        <div class="v-form-row split three">
          <input name="source" maxlength="100" value="Analyst" placeholder="SOURCE">
          <select name="confidence">
            <option value="analyst">ANALYST</option>
            <option value="unverified">UNVERIFIED</option>
            <option value="confirmed">CONFIRMED</option>
            <option value="disputed">DISPUTED</option>
          </select>
          <button type="submit">ADD EVENT</button>
        </div>
      </form>
      <div class="v-timeline-controls">
        <button type="button" data-action="export">EXPORT MARKDOWN</button>
        <button type="button" data-action="clear">CLEAR TIMELINE</button>
      </div>
      <div class="v-timeline-list">
        ${timeline.length === 0 ? '<div class="v-ops-empty">NO EVENTS RECORDED</div>' : timeline.slice(0, 200).map((event) => `
          <article class="v-timeline-item confidence-${event.confidence}" data-event-id="${escapeHtml(event.id)}">
            <time>${new Date(event.occurredAt).toLocaleString()}</time>
            <div class="v-timeline-marker"></div>
            <div class="v-timeline-body">
              <div><span>${escapeHtml(event.category)}</span><span class="confidence">${event.confidence.toUpperCase()}</span><small>${escapeHtml(event.source)}</small></div>
              <strong>${escapeHtml(event.title)}</strong>
              ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ''}
              ${event.link ? `<a href="${escapeHtml(event.link)}" target="_blank" rel="noopener noreferrer">OPEN SOURCE</a>` : ''}
              <button type="button" data-action="case">SEND TO CASE</button>
            </div>
            <button type="button" data-action="delete">×</button>
          </article>
        `).join('')}
      </div>
    `;
    const form = this.content.querySelector<HTMLFormElement>('.v-timeline-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const occurredAt = new Date(String(data.get('occurredAt'))).getTime();
      this.operations.addTimelineEvent({
        title: String(data.get('title') ?? ''),
        detail: String(data.get('detail') ?? ''),
        category: 'ANALYST ENTRY',
        source: String(data.get('source') ?? 'Analyst'),
        occurredAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
        confidence: String(data.get('confidence')) as TimelineConfidence,
      });
      form.reset();
      const dateInput = form.elements.namedItem('occurredAt') as HTMLInputElement | null;
      if (dateInput) dateInput.value = dateTimeLocalValue();
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="export"]')?.addEventListener('click', () => {
      downloadText(`project-v-timeline-${new Date().toISOString().slice(0, 10)}.md`, this.operations.exportTimelineMarkdown());
    });
    this.content.querySelector<HTMLButtonElement>('[data-action="clear"]')?.addEventListener('click', () => {
      if (window.confirm('Clear the complete local incident timeline?')) this.operations.clearTimeline();
    });
    this.content.querySelectorAll<HTMLElement>('[data-event-id]').forEach((item) => {
      const id = item.dataset.eventId;
      if (!id) return;
      item.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', () => this.operations.deleteTimelineEvent(id));
      item.querySelector<HTMLButtonElement>('[data-action="case"]')?.addEventListener('click', () => {
        const event = timeline.find((candidate) => candidate.id === id);
        if (!event) return;
        void sendToCaseDesk({
          type: 'event',
          title: event.title,
          detail: event.detail,
          confidence: event.confidence,
          source: event.source,
          sourceUrl: event.link,
          occurredAt: event.occurredAt,
          metadata: {
            'Timeline event ID': event.id,
            Category: event.category,
            Workspace: event.workspaceId,
          },
        });
      });
    });
  }
}

export class SourceHealthPanel extends OperationsPanel {
  constructor(operations: ProjectVOperationsCenter) {
    super({
      id: 'source-health',
      title: 'SOURCE HEALTH',
      showCount: true,
      className: 'v-operations-panel',
      infoTooltip: 'Local status view for the browser network, headline freshness, Ollama, and key-backed Watchtower data sources.',
    }, operations);
    const element = this.getElement();
    element.dataset.moduleDefaultW = '4';
    element.dataset.moduleDefaultH = '5';
    element.dataset.moduleMinW = '3';
    element.dataset.moduleMinH = '3';
    this.render();
  }

  protected render(): void {
    const records = this.operations.getSourceHealth();
    const issues = records.filter((record) => record.state !== 'online' && record.state !== 'disabled').length;
    this.setCount(issues);
    this.setErrorState(issues > 0, `${issues} sources need attention`);
    this.content.innerHTML = `
      <div class="v-source-health-toolbar">
        <div><strong>${records.filter((item) => item.state === 'online').length}</strong> ONLINE · <strong>${issues}</strong> NEED ATTENTION</div>
        <button type="button" data-action="refresh">REFRESH</button>
        <button type="button" data-action="settings">API KEYS</button>
      </div>
      <div class="v-source-health-list">
        ${records.length === 0 ? '<div class="v-ops-empty">CHECKING SOURCES…</div>' : records.map((record) => `
          <article class="v-source-health-item state-${record.state}">
            <span class="v-health-dot"></span>
            <div><strong>${escapeHtml(record.name)}</strong><p>${escapeHtml(record.detail)}</p><small>CHECKED ${timeAgo(record.lastCheckedAt)}</small></div>
            <span>${record.state.toUpperCase()}</span>
          </article>
        `).join('')}
      </div>
    `;
    this.content.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => void this.operations.refreshHealth());
    this.content.querySelector<HTMLButtonElement>('[data-action="settings"]')?.addEventListener('click', () => void openRuntimeSettings());
  }
}
