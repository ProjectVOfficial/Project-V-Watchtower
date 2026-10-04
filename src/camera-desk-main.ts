import './styles/workspace-windows.css';
import './styles/camera-desk.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { installWorkspaceLockGuard } from '@/services/workspace-lock-guard';
import { isDesktopRuntime, getLocalApiPort } from '@/services/runtime';
import { invokeTauri, tryInvokeTauri } from '@/services/tauri-bridge';
import {
  addCameraStream,
  archiveBuiltInCameraStream,
  getArchivedBuiltInCameraStreams,
  getCameraWallVisibleStreams,
  loadCameraWallStore,
  removeCameraGroup,
  removeCameraStream,
  resetBuiltInCameraStream,
  restoreBuiltInCameraStreams,
  saveCameraGroup,
  saveCameraWallStore,
  subscribeCameraWall,
  updateCameraStream,
  type CameraStreamDefinition,
  type CameraStreamType,
  type CameraWallLayout,
} from '@/services/camera-wall';

applyStoredTheme();
installWorkspaceLockGuard();

const mount = document.getElementById('cameraDeskApp');
if (!mount) throw new Error('Camera Desk mount point is missing.');

let store = loadCameraWallStore();
let addMode = new URLSearchParams(location.search).get('mode') === 'new';
let editingStreamId: string | null = null;
let sourceTab: 'core' | 'custom' | 'all' = 'core';
let statusMessage = 'CAMERA WALL READY';
let statusClass = '';
let reconnectTimer: number | null = null;
let cleanupSubscription: (() => void) | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
}

function layoutLimit(layout: CameraWallLayout): number {
  if (layout === 'single') return 1;
  if (layout === 'two-by-two') return 4;
  if (layout === 'focus-four') return 5;
  return 9;
}

function layoutLabel(layout: CameraWallLayout): string {
  switch (layout) {
    case 'focus-four': return 'ONE LARGE + FOUR';
    case 'two-by-two': return 'TWO BY TWO';
    case 'three-by-three': return 'THREE BY THREE';
    case 'single': return 'SINGLE FOCUS';
    default: return 'CAMERA WALL';
  }
}

function selectedStreams(): CameraStreamDefinition[] {
  return getCameraWallVisibleStreams(store).slice(0, layoutLimit(store.layout));
}

function sameStreamSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((id) => values.has(id));
}

function sourceList(): CameraStreamDefinition[] {
  const archived = new Set(store.archivedCoreStreamIds);
  const available = store.streams.filter((stream) => !(stream.builtIn && archived.has(stream.id)));
  if (sourceTab === 'core') return available.filter((stream) => stream.builtIn);
  if (sourceTab === 'custom') return available.filter((stream) => !stream.builtIn);
  return available;
}

function buildYouTubeUrl(videoId: string): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  if (isDesktopRuntime()) {
    const port = Number(getLocalApiPort());
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const url = new URL('/api/youtube-embed', `http://127.0.0.1:${port}`);
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('autoplay', '1');
    url.searchParams.set('mute', store.muted ? '1' : '0');
    return url.href;
  }
  const url = new URL(`/embed/${videoId}`, 'https://www.youtube-nocookie.com');
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('mute', store.muted ? '1' : '0');
  url.searchParams.set('controls', '1');
  url.searchParams.set('modestbranding', '1');
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('rel', '0');
  return url.href;
}

function safeIframeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function setStatus(message: string, error = false): void {
  statusMessage = message;
  statusClass = error ? 'error' : '';
  const element = mount?.querySelector<HTMLElement>('[data-camera-status]');
  if (element) {
    element.textContent = message;
    element.classList.toggle('error', error);
  }
}

function render(): void {
  const streams = selectedStreams();
  const activeGroup = store.groups.find((group) => group.id === store.activeGroupId);
  const manualSelection = !activeGroup || !sameStreamSet(activeGroup.streamIds, store.selectedStreamIds);
  const customGroups = store.groups.filter((group) => !group.builtIn);
  const editingStream = editingStreamId ? store.streams.find((stream) => stream.id === editingStreamId) ?? null : null;
  const listedStreams = sourceList();
  const archivedCoreStreams = getArchivedBuiltInCameraStreams(store);
  mount!.innerHTML = `
    <div class="pv-workspace-shell pv-camera-desk-shell">
      <header class="pv-workspace-header">
        <div class="pv-workspace-brand"><span>PROJECT V // LIVE OPERATIONS</span><strong>CAMERA WALL</strong></div>
        <div class="pv-workspace-header-actions">
          <button type="button" data-action="add-stream">ADD STREAM</button>
          <button type="button" data-action="save-group">SAVE GROUP</button>
          <button type="button" data-action="fullscreen">FULL SCREEN</button>
          <button type="button" data-action="close">CLOSE</button>
        </div>
      </header>
      <section class="pv-camera-toolbar">
        <label>GROUP
          <select data-camera-group>${manualSelection ? '<option value="manual" selected>MANUAL SELECTION</option>' : ''}${store.groups.map((group) => `<option value="${escapeHtml(group.id)}"${!manualSelection && group.id === store.activeGroupId ? ' selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select>
        </label>
        <label>LAYOUT
          <select data-camera-layout>
            ${(['focus-four', 'two-by-two', 'three-by-three', 'single'] as CameraWallLayout[]).map((layout) => `<option value="${layout}"${layout === store.layout ? ' selected' : ''}>${layoutLabel(layout)}</option>`).join('')}
          </select>
        </label>
        <label class="pv-camera-toggle"><input type="checkbox" data-camera-muted${store.muted ? ' checked' : ''}> MUTED</label>
        <label class="pv-camera-toggle"><input type="checkbox" data-camera-reconnect${store.autoReconnect ? ' checked' : ''}> AUTO RECONNECT</label>
        <button type="button" data-action="reload">RELOAD WALL</button>
        ${activeGroup && !activeGroup.builtIn ? '<button type="button" class="danger" data-action="delete-group">DELETE GROUP</button>' : ''}
      </section>
      <main class="pv-camera-desk-main">
        <aside class="pv-camera-sidebar">
          <div class="pv-camera-sidebar-head"><strong>STREAM SOURCES</strong><span>${store.selectedStreamIds.length} SELECTED</span></div>
          <div class="pv-camera-source-tabs" role="tablist" aria-label="Camera source category">
            <button type="button" data-source-tab="core" class="${sourceTab === 'core' ? 'active' : ''}">CORE STREAMS</button>
            <button type="button" data-source-tab="custom" class="${sourceTab === 'custom' ? 'active' : ''}">CUSTOM LIVE CAMS</button>
            <button type="button" data-source-tab="all" class="${sourceTab === 'all' ? 'active' : ''}">ALL</button>
          </div>
          ${archivedCoreStreams.length ? `<div class="pv-camera-core-restore"><span>${archivedCoreStreams.length} CORE SOURCE${archivedCoreStreams.length === 1 ? '' : 'S'} REMOVED</span><button type="button" data-action="restore-core-sources">RESTORE CORE SOURCES</button></div>` : ''}
          <div class="pv-camera-stream-list">
            ${listedStreams.length ? listedStreams.map((stream) => `
              <label class="pv-camera-stream-option${store.selectedStreamIds.includes(stream.id) ? ' selected' : ''}">
                <input type="checkbox" data-stream-select="${escapeHtml(stream.id)}"${store.selectedStreamIds.includes(stream.id) ? ' checked' : ''}>
                <span><strong>${escapeHtml(stream.name)}</strong><small>${escapeHtml(stream.location)} · ${stream.type.toUpperCase()}</small></span>
                <span class="pv-camera-source-tools"><em>${stream.builtIn ? 'CORE' : 'CUSTOM'}</em><button type="button" data-edit-stream="${escapeHtml(stream.id)}" title="Edit stream source">EDIT</button>${stream.builtIn ? '' : `<button type="button" class="danger" data-remove-stream="${escapeHtml(stream.id)}" title="Remove custom stream">×</button>`}</span>
              </label>`).join('') : '<div class="pv-camera-list-empty">NO STREAMS IN THIS CATEGORY<br><small>Use ADD STREAM to register an authorized source.</small></div>'}
          </div>
          <div class="pv-camera-sidebar-note">Only public streams and sources you are authorized to view should be added. Project V does not bypass provider access controls.</div>
        </aside>
        <section class="pv-camera-stage-wrap">
          <div class="pv-camera-stage layout-${store.layout}" data-camera-stage>
            ${streams.length ? streams.map((stream, index) => cameraCell(stream, index)).join('') : '<div class="pv-camera-empty"><strong>NO ACTIVE STREAMS</strong><p>Select sources from the left rail or choose a saved group.</p></div>'}
          </div>
          ${store.selectedStreamIds.length > layoutLimit(store.layout) ? `<div class="pv-camera-overflow-note">${store.selectedStreamIds.length - layoutLimit(store.layout)} additional selected stream(s) are hidden by this layout. Choose a larger layout to display them.</div>` : ''}
        </section>
      </main>
      <footer class="pv-window-status ${statusClass}" data-camera-status>${escapeHtml(statusMessage)}</footer>
      ${addMode || editingStream ? streamDialog(editingStream) : ''}
      ${customGroups.length ? '' : ''}
    </div>`;

  bindControls();
  bindMedia();
  scheduleReconnect();
}

function cameraCell(stream: CameraStreamDefinition, index: number): string {
  const focus = store.layout === 'focus-four' && index === 0 ? ' focus' : '';
  return `<article class="pv-camera-cell${focus}" data-camera-cell="${escapeHtml(stream.id)}">
    <header><div><span class="pv-camera-live-dot"></span><strong>${escapeHtml(stream.name)}</strong><small>${escapeHtml(stream.location)}</small></div><nav><button type="button" data-cell-action="edit" data-stream-id="${escapeHtml(stream.id)}">EDIT</button><button type="button" data-cell-action="external" data-stream-id="${escapeHtml(stream.id)}">OPEN</button><button type="button" data-cell-action="hide" data-stream-id="${escapeHtml(stream.id)}" title="Remove this stream from the current wall">HIDE</button><button type="button" data-cell-action="fullscreen" data-stream-id="${escapeHtml(stream.id)}">EXPAND</button></nav></header>
    <div class="pv-camera-media" data-camera-media="${escapeHtml(stream.id)}"><div class="pv-camera-loading">CONNECTING…</div></div>
    <footer><span data-camera-health="${escapeHtml(stream.id)}">CONNECTING</span><em>${stream.type.toUpperCase()}</em></footer>
  </article>`;
}

function streamDialog(stream: CameraStreamDefinition | null): string {
  const isEdit = Boolean(stream);
  return `<div class="pv-camera-dialog-backdrop" data-camera-dialog>
    <form class="pv-camera-dialog" data-add-stream-form>
      <header><strong>${isEdit ? 'EDIT CAMERA SOURCE' : 'ADD AUTHORIZED STREAM'}</strong><button type="button" data-action="cancel-add">×</button></header>
      <input type="hidden" name="streamId" value="${escapeHtml(stream?.id ?? '')}">
      <label>DISPLAY NAME<input name="name" required maxlength="80" placeholder="Operations Camera" value="${escapeHtml(stream?.name ?? '')}"></label>
      <label>LOCATION<input name="location" maxlength="100" placeholder="City, Country" value="${escapeHtml(stream?.location ?? '')}"></label>
      <label>STREAM TYPE<select name="type"><option value="youtube"${stream?.type === 'youtube' || !stream ? ' selected' : ''}>YOUTUBE VIDEO / LIVE ID</option><option value="hls"${stream?.type === 'hls' ? ' selected' : ''}>HLS .M3U8 URL</option><option value="iframe"${stream?.type === 'iframe' ? ' selected' : ''}>HTTPS EMBED PAGE</option></select></label>
      <label>SOURCE<input name="source" required placeholder="YouTube URL or video ID / https://…" value="${escapeHtml(stream?.source ?? '')}"></label>
      <label>NOTES<textarea name="notes" maxlength="300" placeholder="Ownership, authorization, purpose, or verification notes">${escapeHtml(stream?.notes ?? '')}</textarea></label>
      <div class="pv-camera-dialog-help">You can replace stale or removed YouTube IDs here. Project V will reload the wall immediately after saving. Provider restrictions still apply.</div>
      <footer>
        <div class="pv-camera-dialog-destructive">
          ${stream?.builtIn ? '<button type="button" class="danger" data-action="archive-core">REMOVE FROM CATALOG</button><button type="button" data-action="reset-core">RESET CORE SOURCE</button>' : stream ? '<button type="button" class="danger" data-action="delete-custom-source">DELETE SOURCE</button>' : ''}
        </div>
        <div class="pv-camera-dialog-primary"><button type="button" data-action="cancel-add">CANCEL</button><button type="submit">${isEdit ? 'SAVE SOURCE' : 'ADD TO WALL'}</button></div>
      </footer>
    </form>
  </div>`;
}

function bindControls(): void {
  mount!.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener('click', () => void closeWindow());
  mount!.querySelector<HTMLButtonElement>('[data-action="add-stream"]')?.addEventListener('click', () => { editingStreamId = null; addMode = true; render(); });
  mount!.querySelectorAll<HTMLButtonElement>('[data-action="cancel-add"]').forEach((button) => button.addEventListener('click', () => { addMode = false; editingStreamId = null; render(); }));
  mount!.querySelector<HTMLButtonElement>('[data-action="reload"]')?.addEventListener('click', () => { setStatus('RELOADING ALL STREAMS…'); render(); });
  mount!.querySelector<HTMLButtonElement>('[data-action="fullscreen"]')?.addEventListener('click', () => void toggleFullscreen());
  mount!.querySelector<HTMLButtonElement>('[data-action="restore-core-sources"]')?.addEventListener('click', () => {
    if (!confirm('Restore all core camera sources that were removed from the catalog?')) return;
    const restored = restoreBuiltInCameraStreams();
    store = loadCameraWallStore();
    setStatus(restored > 0 ? `${restored} CORE SOURCE${restored === 1 ? '' : 'S'} RESTORED` : 'NO CORE SOURCES TO RESTORE');
    render();
  });

  mount!.querySelectorAll<HTMLButtonElement>('[data-source-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.sourceTab;
    if (tab !== 'core' && tab !== 'custom' && tab !== 'all') return;
    sourceTab = tab;
    render();
  }));

  mount!.querySelector<HTMLSelectElement>('[data-camera-group]')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'manual') return;
    const group = store.groups.find((item) => item.id === value);
    if (!group) return;
    store.activeGroupId = group.id;
    store.selectedStreamIds = [...group.streamIds];
    store = saveCameraWallStore(store);
    setStatus(`${group.name} LOADED`);
    render();
  });
  mount!.querySelector<HTMLSelectElement>('[data-camera-layout]')?.addEventListener('change', (event) => {
    store.layout = (event.currentTarget as HTMLSelectElement).value as CameraWallLayout;
    store = saveCameraWallStore(store);
    render();
  });
  mount!.querySelector<HTMLInputElement>('[data-camera-muted]')?.addEventListener('change', (event) => {
    store.muted = (event.currentTarget as HTMLInputElement).checked;
    store = saveCameraWallStore(store);
    render();
  });
  mount!.querySelector<HTMLInputElement>('[data-camera-reconnect]')?.addEventListener('change', (event) => {
    store.autoReconnect = (event.currentTarget as HTMLInputElement).checked;
    store = saveCameraWallStore(store);
    scheduleReconnect();
  });
  mount!.querySelectorAll<HTMLInputElement>('[data-stream-select]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = checkbox.dataset.streamSelect;
      if (!id) return;
      store.selectedStreamIds = checkbox.checked
        ? [...new Set([...store.selectedStreamIds, id])]
        : store.selectedStreamIds.filter((streamId) => streamId !== id);
      store = saveCameraWallStore(store);
      render();
    });
  });
  mount!.querySelectorAll<HTMLButtonElement>('[data-remove-stream]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.removeStream;
      if (!id || !confirm('Remove this custom stream from Project V?')) return;
      removeCameraStream(id);
      store = loadCameraWallStore();
      render();
    });
  });
  mount!.querySelectorAll<HTMLButtonElement>('[data-edit-stream]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      editingStreamId = button.dataset.editStream ?? null;
      addMode = false;
      render();
    });
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="save-group"]')?.addEventListener('click', () => {
    const current = store.groups.find((group) => group.id === store.activeGroupId && !group.builtIn);
    const name = prompt('Name this camera group:', current?.name ?? 'CUSTOM WATCH');
    if (!name) return;
    try {
      const saved = saveCameraGroup(name, store.selectedStreamIds, current?.id);
      store = loadCameraWallStore();
      setStatus(`${saved.name} SAVED`);
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'GROUP SAVE FAILED', true);
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="delete-group"]')?.addEventListener('click', () => {
    if (!confirm('Delete this custom camera group?')) return;
    removeCameraGroup(store.activeGroupId);
    store = loadCameraWallStore();
    render();
  });
  mount!.querySelector<HTMLFormElement>('[data-add-stream-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const streamId = String(data.get('streamId') ?? '').trim();
      const update = {
        name: String(data.get('name') ?? ''),
        location: String(data.get('location') ?? ''),
        type: String(data.get('type') ?? 'youtube') as CameraStreamType,
        source: String(data.get('source') ?? ''),
        notes: String(data.get('notes') ?? ''),
      };
      if (streamId) updateCameraStream(streamId, update);
      else {
        addCameraStream({ ...update, region: 'custom' });
        sourceTab = 'custom';
      }
      store = loadCameraWallStore();
      addMode = false;
      editingStreamId = null;
      setStatus(streamId ? 'STREAM SOURCE UPDATED' : 'CUSTOM STREAM ADDED');
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'STREAM COULD NOT BE ADDED', true);
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="reset-core"]')?.addEventListener('click', () => {
    if (!editingStreamId || !confirm('Reset this core camera to the source shipped with Project V?')) return;
    try {
      resetBuiltInCameraStream(editingStreamId);
      store = loadCameraWallStore();
      editingStreamId = null;
      setStatus('CORE CAMERA SOURCE RESET');
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'SOURCE RESET FAILED', true);
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="archive-core"]')?.addEventListener('click', () => {
    if (!editingStreamId || !confirm('Remove this core source from the Camera Wall catalog? You can restore it later with RESTORE CORE SOURCES.')) return;
    try {
      archiveBuiltInCameraStream(editingStreamId);
      store = loadCameraWallStore();
      editingStreamId = null;
      setStatus('CORE CAMERA REMOVED FROM CATALOG');
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'CORE SOURCE COULD NOT BE REMOVED', true);
    }
  });
  mount!.querySelector<HTMLButtonElement>('[data-action="delete-custom-source"]')?.addEventListener('click', () => {
    if (!editingStreamId || !confirm('Delete this custom camera source from Project V?')) return;
    removeCameraStream(editingStreamId);
    store = loadCameraWallStore();
    editingStreamId = null;
    setStatus('CUSTOM CAMERA SOURCE DELETED');
    render();
  });
  mount!.querySelectorAll<HTMLButtonElement>('[data-cell-action="edit"]').forEach((button) => button.addEventListener('click', () => {
    editingStreamId = button.dataset.streamId ?? null;
    addMode = false;
    render();
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-cell-action="hide"]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.streamId;
    if (!id) return;
    store.selectedStreamIds = store.selectedStreamIds.filter((streamId) => streamId !== id);
    store = saveCameraWallStore(store);
    setStatus('STREAM REMOVED FROM CURRENT WALL');
    render();
  }));
  mount!.querySelectorAll<HTMLButtonElement>('[data-cell-action="external"]').forEach((button) => button.addEventListener('click', () => void openSource(button.dataset.streamId ?? '')));
  mount!.querySelectorAll<HTMLButtonElement>('[data-cell-action="fullscreen"]').forEach((button) => button.addEventListener('click', () => {
    const cell = mount!.querySelector<HTMLElement>(`[data-camera-cell="${CSS.escape(button.dataset.streamId ?? '')}"]`);
    void cell?.requestFullscreen();
  }));
}

function bindMedia(): void {
  selectedStreams().forEach((stream) => {
    const host = mount!.querySelector<HTMLElement>(`[data-camera-media="${CSS.escape(stream.id)}"]`);
    const health = mount!.querySelector<HTMLElement>(`[data-camera-health="${CSS.escape(stream.id)}"]`);
    if (!host) return;
    const live = () => {
      host.dataset.health = 'live';
      if (health) health.textContent = 'LIVE';
    };
    const fail = () => {
      host.dataset.health = 'error';
      if (health) health.textContent = 'SIGNAL ERROR';
    };

    if (stream.type === 'hls') {
      const video = document.createElement('video');
      video.src = stream.source;
      video.autoplay = true;
      video.muted = store.muted;
      video.controls = true;
      video.playsInline = true;
      video.addEventListener('playing', live);
      video.addEventListener('loadeddata', live);
      video.addEventListener('error', fail);
      host.replaceChildren(video);
      void video.play().catch(fail);
      return;
    }

    const iframeSource = stream.type === 'youtube' ? buildYouTubeUrl(stream.source) : safeIframeUrl(stream.source);
    if (!iframeSource) {
      fail();
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.src = iframeSource;
    iframe.title = `${stream.name} stream`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    iframe.setAttribute('sandbox', stream.type === 'youtube'
      ? 'allow-scripts allow-same-origin allow-presentation'
      : 'allow-scripts allow-presentation');
    iframe.addEventListener('load', live);
    iframe.addEventListener('error', fail);
    host.replaceChildren(iframe);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) window.clearInterval(reconnectTimer);
  reconnectTimer = null;
  if (!store.autoReconnect) return;
  reconnectTimer = window.setInterval(() => {
    const hasErrors = Boolean(mount?.querySelector('[data-camera-media][data-health="error"]'));
    if (hasErrors) {
      setStatus('AUTO RECONNECTING FAILED STREAMS…');
      render();
    }
  }, 45_000);
}

async function openSource(streamId: string): Promise<void> {
  const stream = store.streams.find((item) => item.id === streamId);
  if (!stream) return;
  const url = stream.type === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(stream.source)}` : stream.source;
  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('open_source_browser_window', {
        url,
        title: `${stream.name} // Camera Source`,
      });
      return;
    } catch {
      try {
        await invokeTauri<void>('open_url', { url });
        return;
      } catch { /* use browser fallback below */ }
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
}

async function closeWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    await tryInvokeTauri<void>('close_camera_desk_window');
    return;
  }
  window.close();
}

cleanupSubscription = subscribeCameraWall(() => {
  store = loadCameraWallStore();
  render();
});
window.addEventListener('beforeunload', () => {
  cleanupSubscription?.();
  if (reconnectTimer !== null) window.clearInterval(reconnectTimer);
});

render();
