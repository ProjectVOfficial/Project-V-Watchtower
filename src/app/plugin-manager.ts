import type { Panel } from '@/components/Panel';
import type { DeckWorkspaceManager } from './deck-workspaces';
import {
  PROJECT_V_STARTER_PLUGINS,
  ProjectVModuleRegistry,
  pluginDataStorageKey,
  pluginPanelId,
  validateProjectVPluginManifest,
} from '@/modules/plugin-registry';
import type { InstalledProjectVPlugin, ProjectVPluginManifest } from '@/modules/plugin-types';

interface PluginManagerOptions {
  registry: ProjectVModuleRegistry;
  workspaces: DeckWorkspaceManager;
  getPanel: (panelId: string) => Panel | undefined;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function permissionSummary(plugin: InstalledProjectVPlugin): string {
  const permissions = plugin.manifest.permissions ?? [];
  return permissions.length > 0 ? permissions.map((item) => item.replace(/-/g, ' ').toUpperCase()).join(' · ') : 'NO HOST PERMISSIONS';
}

function manifestReview(manifest: ProjectVPluginManifest): string {
  const permissions = manifest.permissions?.length ? manifest.permissions.join(', ') : 'none';
  const origins = manifest.allowedNetworkOrigins?.length ? `\nAllowed network origins: ${manifest.allowedNetworkOrigins.join(', ')}` : '';
  return `Install local plugin “${manifest.name}” v${manifest.version}?\n\nAuthor: ${manifest.author}\nCategory: ${manifest.category}\nPermissions: ${permissions}${origins}\n\nPlugins run inside a restricted sandbox, but imported code should still be reviewed before installation.`;
}

export class PluginManagerController {
  private readonly registry: ProjectVModuleRegistry;
  private readonly workspaces: DeckWorkspaceManager;
  private readonly getPanel: (panelId: string) => Panel | undefined;
  private readonly cleanups: Array<() => void> = [];
  private searchQuery = '';
  private statusMessage = '';
  private statusType: 'info' | 'success' | 'error' = 'info';

  constructor(options: PluginManagerOptions) {
    this.registry = options.registry;
    this.workspaces = options.workspaces;
    this.getPanel = options.getPanel;
  }

  init(): void {
    this.setupControls();
    this.render();
  }

  destroy(): void {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.close();
  }

  render(): void {
    const list = document.getElementById('pluginManagerList');
    const count = document.getElementById('pluginManagerCount');
    const status = document.getElementById('pluginManagerStatus');
    if (!list) return;

    const installed = this.registry.getInstalledPlugins();
    const enabledCount = installed.filter((plugin) => plugin.enabled).length;
    if (count) count.textContent = installed.length > 0 ? `${enabledCount}/${installed.length}` : '0';
    if (status) {
      status.textContent = this.statusMessage;
      status.className = `v-plugin-manager-status ${this.statusMessage ? 'visible' : ''} ${this.statusType}`;
    }

    const filtered = installed.filter((plugin) => {
      if (!this.searchQuery) return true;
      const haystack = `${plugin.manifest.name} ${plugin.manifest.id} ${plugin.manifest.description} ${plugin.manifest.author} ${plugin.manifest.category}`.toLowerCase();
      return haystack.includes(this.searchQuery);
    });

    if (filtered.length === 0) {
      list.innerHTML = installed.length === 0
        ? `<div class="v-plugin-manager-empty"><strong>NO LOCAL PLUGINS INSTALLED</strong><span>Install the Project V starter pack or import a reviewed <code>.json</code> manifest.</span></div>`
        : '<div class="v-plugin-manager-empty"><strong>NO PLUGINS MATCH THIS SEARCH</strong></div>';
      return;
    }

    list.innerHTML = filtered.map((plugin) => this.renderPlugin(plugin)).join('');
  }

  private renderPlugin(plugin: InstalledProjectVPlugin): string {
    const manifest = plugin.manifest;
    const panelId = pluginPanelId(manifest.id);
    const panel = this.getPanel(panelId)?.getElement();
    const hidden = panel?.classList.contains('deck-hidden') ?? true;
    const onDesk = plugin.enabled && Boolean(panel) && !hidden;
    const origins = manifest.allowedNetworkOrigins ?? [];
    const action = !plugin.enabled
      ? `<button type="button" data-plugin-action="enable" data-plugin-id="${escapeText(manifest.id)}">ENABLE</button>`
      : onDesk
        ? `<button type="button" data-plugin-action="remove" data-plugin-id="${escapeText(manifest.id)}">REMOVE FROM DESK</button>`
        : `<button type="button" data-plugin-action="add" data-plugin-id="${escapeText(manifest.id)}">ADD TO DESK</button>`;
    return `
      <article class="v-plugin-manager-item ${plugin.enabled ? 'enabled' : 'disabled'}">
        <div class="v-plugin-manager-item-head">
          <span class="v-plugin-icon">${escapeText(manifest.icon ?? '◇')}</span>
          <div><strong>${escapeText(manifest.name)}</strong><small>${escapeText(manifest.id)} · v${escapeText(manifest.version)}</small></div>
          <span class="v-plugin-state">${plugin.enabled ? (onDesk ? 'ACTIVE' : 'ENABLED') : 'DISABLED'}</span>
        </div>
        <p>${escapeText(manifest.description)}</p>
        <div class="v-plugin-meta-grid">
          <span><b>AUTHOR</b>${escapeText(manifest.author)}</span>
          <span><b>CATEGORY</b>${escapeText(manifest.category.toUpperCase())}</span>
          <span><b>DEFAULT</b>${manifest.defaultSize.w} × ${manifest.defaultSize.h}</span>
          <span><b>UPDATED</b>${new Date(plugin.updatedAt).toLocaleDateString()}</span>
        </div>
        <div class="v-plugin-permissions"><b>PERMISSIONS</b><span>${escapeText(permissionSummary(plugin))}</span></div>
        ${origins.length > 0 ? `<div class="v-plugin-origins"><b>NETWORK</b><span>${origins.map(escapeText).join('<br>')}</span></div>` : ''}
        <div class="v-plugin-manager-item-actions">
          ${action}
          ${plugin.enabled ? `<button type="button" data-plugin-action="disable" data-plugin-id="${escapeText(manifest.id)}">DISABLE</button>` : ''}
          <button type="button" data-plugin-action="export" data-plugin-id="${escapeText(manifest.id)}">EXPORT</button>
          <button type="button" data-plugin-action="clear-data" data-plugin-id="${escapeText(manifest.id)}">CLEAR DATA</button>
          <button type="button" class="danger" data-plugin-action="uninstall" data-plugin-id="${escapeText(manifest.id)}">UNINSTALL</button>
        </div>
      </article>`;
  }

  private setupControls(): void {
    const openButton = document.getElementById('pluginManagerBtn');
    const closeButton = document.getElementById('pluginManagerClose');
    const backdrop = document.getElementById('pluginManagerBackdrop');
    const list = document.getElementById('pluginManagerList');
    const importInput = document.getElementById('pluginImportInput') as HTMLInputElement | null;
    const search = document.getElementById('pluginManagerSearch') as HTMLInputElement | null;

    const open = () => this.open();
    const close = () => this.close();
    openButton?.addEventListener('click', open);
    closeButton?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    const onSearch = () => {
      this.searchQuery = search?.value.trim().toLowerCase() ?? '';
      this.render();
    };
    search?.addEventListener('input', onSearch);

    const onListClick = (event: Event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-plugin-action]');
      const pluginId = button?.dataset.pluginId;
      const action = button?.dataset.pluginAction;
      if (!button || !pluginId || !action) return;
      this.handleAction(pluginId, action);
    };
    list?.addEventListener('click', onListClick);

    const onImport = async () => {
      const file = importInput?.files?.[0];
      if (importInput) importInput.value = '';
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text()) as unknown;
        this.installImportedPayload(raw);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'The plugin file is not valid JSON.', 'error');
      }
    };
    const importButton = document.getElementById('pluginImportBtn');
    const starterButton = document.getElementById('pluginStarterBtn');
    const templateButton = document.getElementById('pluginTemplateBtn');
    const exportAllButton = document.getElementById('pluginExportAllBtn');
    const onImportClick = () => importInput?.click();
    const onStarter = () => {
      const names = PROJECT_V_STARTER_PLUGINS.map((manifest) => manifest.name).join(', ');
      if (!window.confirm(`Install the Project V starter modules?\n\n${names}\n\nThey run locally in the restricted plugin sandbox.`)) return;
      const results = this.registry.installStarterPack();
      const failed = results.flatMap((result) => result.errors);
      this.setStatus(failed.length > 0 ? failed.join(' ') : 'Starter module pack installed.', failed.length > 0 ? 'error' : 'success');
    };
    const onTemplate = () => {
      downloadText('project-v-plugin-template.pvplugin.json', JSON.stringify(this.templateManifest(), null, 2));
      this.setStatus('Plugin manifest template exported.', 'success');
    };
    const onExportAll = () => {
      downloadText(`project-v-plugin-registry-${new Date().toISOString().slice(0, 10)}.json`, this.registry.exportRegistry());
      this.setStatus('Plugin registry exported.', 'success');
    };

    importInput?.addEventListener('change', onImport);
    importButton?.addEventListener('click', onImportClick);
    starterButton?.addEventListener('click', onStarter);
    templateButton?.addEventListener('click', onTemplate);
    exportAllButton?.addEventListener('click', onExportAll);

    const onRegistryChange = () => this.render();
    const onModuleChange = () => this.render();
    window.addEventListener('project-v-plugin-registry-change', onRegistryChange);
    window.addEventListener('project-v-module-state-change', onModuleChange);
    window.addEventListener('project-v-workspace-activated', onModuleChange);
    window.addEventListener('project-v-dock-layout-applied', onModuleChange);

    this.cleanups.push(() => {
      openButton?.removeEventListener('click', open);
      closeButton?.removeEventListener('click', close);
      backdrop?.removeEventListener('click', close);
      search?.removeEventListener('input', onSearch);
      list?.removeEventListener('click', onListClick);
      importInput?.removeEventListener('change', onImport);
      importButton?.removeEventListener('click', onImportClick);
      starterButton?.removeEventListener('click', onStarter);
      templateButton?.removeEventListener('click', onTemplate);
      exportAllButton?.removeEventListener('click', onExportAll);
      window.removeEventListener('project-v-plugin-registry-change', onRegistryChange);
      window.removeEventListener('project-v-module-state-change', onModuleChange);
      window.removeEventListener('project-v-workspace-activated', onModuleChange);
      window.removeEventListener('project-v-dock-layout-applied', onModuleChange);
    });
  }

  private installImportedPayload(raw: unknown): void {
    if (!isRecord(raw) || raw.schema !== 'project-v-plugin-registry' || !Array.isArray(raw.plugins)) {
      this.installReviewedManifest(raw);
      return;
    }

    const manifests: ProjectVPluginManifest[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const candidate of raw.plugins.slice(0, 64)) {
      const validation = validateProjectVPluginManifest(candidate);
      if (!validation.valid || !validation.manifest) {
        errors.push(...validation.errors);
        continue;
      }
      manifests.push(validation.manifest);
      warnings.push(...validation.warnings);
    }
    if (errors.length > 0 || manifests.length === 0) {
      this.setStatus(errors.length > 0 ? `Registry import blocked: ${errors.join(' ')}` : 'The registry backup contains no valid plugins.', 'error');
      return;
    }

    const permissionCount = manifests.reduce((total, manifest) => total + (manifest.permissions?.length ?? 0), 0);
    if (!window.confirm(`Restore ${manifests.length} Project V plugin${manifests.length === 1 ? '' : 's'} from this registry backup?\n\nTotal requested host permissions: ${permissionCount}\n\nExisting plugins with matching IDs will be updated. Review backups before importing them.`)) return;
    const results = manifests.map((manifest) => this.registry.install(manifest));
    const failed = results.flatMap((result) => result.errors);
    if (failed.length > 0) {
      this.setStatus(`Some plugins could not be restored: ${failed.join(' ')}`, 'error');
      return;
    }
    this.setStatus(`${manifests.length} plugin${manifests.length === 1 ? '' : 's'} restored.${warnings.length > 0 ? ` ${warnings.join(' ')}` : ''}`, 'success');
  }

  private installReviewedManifest(raw: unknown): void {
    const validation = validateProjectVPluginManifest(raw);
    if (!validation.valid || !validation.manifest) {
      this.setStatus(validation.errors.join(' '), 'error');
      return;
    }
    if (!window.confirm(manifestReview(validation.manifest))) return;
    const result = this.registry.install(validation.manifest);
    if (!result.valid) {
      this.setStatus(result.errors.join(' '), 'error');
      return;
    }
    const warning = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    this.setStatus(`${validation.manifest.name} installed.${warning}`, 'success');
  }

  private handleAction(pluginId: string, action: string): void {
    const plugin = this.registry.getPlugin(pluginId);
    if (!plugin) return;
    const panelId = pluginPanelId(pluginId);
    if (action === 'enable') {
      const enabled = this.registry.setEnabled(pluginId, true);
      this.setStatus(enabled ? `${plugin.manifest.name} enabled.` : `Unable to save the enabled state for ${plugin.manifest.name}.`, enabled ? 'success' : 'error');
    } else if (action === 'disable') {
      if (!window.confirm(`Disable “${plugin.manifest.name}”? It will be removed from every active deck until re-enabled.`)) return;
      const disabled = this.registry.setEnabled(pluginId, false);
      this.setStatus(disabled ? `${plugin.manifest.name} disabled.` : `Unable to save the disabled state for ${plugin.manifest.name}.`, disabled ? 'info' : 'error');
    } else if (action === 'add') {
      this.workspaces.setPanelHidden(panelId, false);
      this.setStatus(`${plugin.manifest.name} added to the active desk.`, 'success');
    } else if (action === 'remove') {
      this.workspaces.setPanelHidden(panelId, true);
      this.setStatus(`${plugin.manifest.name} removed from the active desk.`, 'info');
    } else if (action === 'export') {
      const exported = this.registry.exportPlugin(pluginId);
      if (exported) downloadText(`${pluginId.replace(/[^a-z0-9._-]/gi, '-')}.pvplugin.json`, exported);
      this.setStatus(`${plugin.manifest.name} manifest exported.`, 'success');
    } else if (action === 'clear-data') {
      if (!window.confirm(`Clear all local data stored by “${plugin.manifest.name}”?\n\nThis cannot be undone.`)) return;
      localStorage.removeItem(pluginDataStorageKey(pluginId));
      this.setStatus(`${plugin.manifest.name} local data cleared. Reload the module to refresh its view.`, 'info');
    } else if (action === 'uninstall') {
      if (!window.confirm(`Uninstall “${plugin.manifest.name}”?\n\nIts module will be removed. Namespaced plugin data remains on this device unless browser storage is cleared.`)) return;
      const removed = this.registry.uninstall(pluginId);
      this.setStatus(removed ? `${plugin.manifest.name} uninstalled.` : `Unable to uninstall ${plugin.manifest.name}.`, removed ? 'info' : 'error');
    }
    this.render();
  }

  private open(): void {
    this.render();
    document.body.classList.add('plugin-manager-open');
    document.getElementById('pluginManagerDrawer')?.classList.add('open');
    document.getElementById('pluginManagerBackdrop')?.classList.add('open');
  }

  private close(): void {
    document.body.classList.remove('plugin-manager-open');
    document.getElementById('pluginManagerDrawer')?.classList.remove('open');
    document.getElementById('pluginManagerBackdrop')?.classList.remove('open');
  }

  private setStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.statusMessage = message;
    this.statusType = type;
    this.render();
  }

  private templateManifest(): ProjectVPluginManifest {
    return {
      schemaVersion: 1,
      id: 'yourname.watchtower.example',
      name: 'Example Module',
      version: '1.0.0',
      description: 'Describe what this local Project V module does.',
      author: 'Your Name',
      category: 'system',
      icon: '◇',
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 2, h: 2 },
      permissions: [],
      entry: {
        type: 'sandbox-html',
        html: '<main><h1>EXAMPLE MODULE</h1><p>This content runs inside a restricted iframe.</p></main>',
        css: ':root{color-scheme:dark;font-family:monospace;background:#090909;color:#eee}body{margin:0;padding:16px}h1{font-size:16px;color:#d54b4b}',
        script: "console.log('Project V plugin ready', ProjectV.pluginId);",
      },
    };
  }
}
