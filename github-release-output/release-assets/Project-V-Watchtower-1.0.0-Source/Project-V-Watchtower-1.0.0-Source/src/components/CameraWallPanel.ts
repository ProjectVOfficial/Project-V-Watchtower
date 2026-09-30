import { Panel } from './Panel';
import { loadCameraWallStore, getCameraWallVisibleStreams, subscribeCameraWall } from '@/services/camera-wall';
import { openProjectVWorkspaceWindow } from '@/services/workspace-windows';

export class CameraWallPanel extends Panel {
  private cleanup: (() => void) | null = null;

  constructor() {
    super({
      id: 'camera-wall',
      title: 'CAMERA WALL',
      showCount: true,
      className: 'v-camera-wall-panel',
      infoTooltip: 'Manage public webcams and authorized video streams in a separate monitoring wall. Custom streams remain local to this Watchtower installation.',
    });
    const element = this.getElement();
    element.dataset.moduleDefaultW = '6';
    element.dataset.moduleDefaultH = '4';
    element.dataset.moduleMinW = '4';
    element.dataset.moduleMinH = '3';
    element.dataset.moduleCategory = 'operations';
    this.cleanup = subscribeCameraWall(() => this.render());
    this.render();
  }

  private render(): void {
    const store = loadCameraWallStore();
    const selected = getCameraWallVisibleStreams(store);
    const customCount = store.streams.filter((item) => !item.builtIn).length;
    this.setCount(selected.length);
    this.content.innerHTML = `
      <div class="v-camera-wall-summary">
        <div><strong>${selected.length}</strong><span>ACTIVE STREAMS</span></div>
        <div><strong>${store.groups.length}</strong><span>SAVED GROUPS</span></div>
        <div><strong>${customCount}</strong><span>CUSTOM SOURCES</span></div>
      </div>
      <div class="v-camera-wall-preview">
        ${selected.slice(0, 4).map((stream) => `<div><span class="live"></span><strong>${this.escape(stream.name)}</strong><small>${this.escape(stream.location)}</small></div>`).join('') || '<p>NO STREAMS SELECTED</p>'}
      </div>
      <div class="v-desk-actions">
        <button type="button" data-action="open">OPEN CAMERA WALL</button>
        <button type="button" data-action="add">ADD STREAM</button>
      </div>
      <div class="v-camera-wall-foot">LAYOUT ${store.layout.replace(/-/g, ' ').toUpperCase()} · ${store.muted ? 'MUTED' : 'AUDIO ENABLED'} · ${store.autoReconnect ? 'AUTO RECONNECT' : 'MANUAL RETRY'}</div>
    `;
    this.content.querySelector<HTMLButtonElement>('[data-action="open"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('camera-desk'));
    this.content.querySelector<HTMLButtonElement>('[data-action="add"]')?.addEventListener('click', () => void openProjectVWorkspaceWindow('camera-desk', { mode: 'new' }));
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
