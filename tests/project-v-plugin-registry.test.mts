import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_V_STARTER_PLUGINS,
  ProjectVModuleRegistry,
  pluginPanelId,
  validateProjectVPluginManifest,
} from '../src/modules/plugin-registry.ts';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function installBrowserMocks(): EventTarget {
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  return target;
}

test('validates and manages the Project V starter plugin pack', () => {
  const target = installBrowserMocks();
  let changes = 0;
  target.addEventListener('project-v-plugin-registry-change', () => { changes += 1; });

  assert.match(pluginPanelId('ProjectV.Tools.Field Notes'), /^plugin-projectv-tools-field-notes-[0-9a-f]{8}$/);
  assert.equal(PROJECT_V_STARTER_PLUGINS.length, 3);
  for (const manifest of PROJECT_V_STARTER_PLUGINS) {
    const validation = validateProjectVPluginManifest(manifest);
    assert.equal(validation.valid, true, `${manifest.id}: ${validation.errors.join(' ')}`);
  }

  const registry = new ProjectVModuleRegistry();
  assert.equal(registry.installStarterPack().every((result) => result.valid), true);
  assert.equal(registry.getInstalledPlugins().length, 3);
  assert.equal(registry.getEnabledPlugins().length, 3);
  assert.equal(changes, 3);

  const firstId = PROJECT_V_STARTER_PLUGINS[0]!.id;
  assert.equal(registry.setEnabled(firstId, false), true);
  assert.equal(registry.getEnabledPlugins().length, 2);
  assert.equal(registry.setEnabled(firstId, true), true);
  assert.equal(registry.getEnabledPlugins().length, 3);

  const backup = JSON.parse(registry.exportRegistry()) as { schema: string; plugins: unknown[] };
  assert.equal(backup.schema, 'project-v-plugin-registry');
  assert.equal(backup.plugins.length, 3);
  assert.equal(registry.uninstall(firstId), true);
  assert.equal(registry.getInstalledPlugins().length, 2);
});

test('rejects malformed and overprivileged manifests', () => {
  installBrowserMocks();
  const malformed = validateProjectVPluginManifest({ schemaVersion: 1, id: 'BAD ID' });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.length >= 4);

  const unsupportedPermission = validateProjectVPluginManifest({
    ...PROJECT_V_STARTER_PLUGINS[0],
    id: 'projectv.tests.unsupported',
    permissions: ['filesystem'],
  });
  assert.equal(unsupportedPermission.valid, false);
  assert.match(unsupportedPermission.errors.join(' '), /Unsupported permission/);
});
