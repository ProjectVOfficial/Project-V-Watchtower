import type { ProjectVPluginManifest, ProjectVPluginPermission } from '@/modules/plugin-types';

const STORE_KEY = 'project-v-plugin-permission-grants-v1';
const ALL_PERMISSIONS: ProjectVPluginPermission[] = [
  'storage',
  'network',
  'notifications',
  'clipboard-read',
  'clipboard-write',
];

interface PermissionStore {
  version: 1;
  grants: Record<string, Partial<Record<ProjectVPluginPermission, boolean>>>;
}

function loadStore(): PermissionStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<PermissionStore> | null;
    if (!parsed || parsed.version !== 1 || !parsed.grants || typeof parsed.grants !== 'object') {
      return { version: 1, grants: {} };
    }
    return { version: 1, grants: parsed.grants };
  } catch {
    return { version: 1, grants: {} };
  }
}

function saveStore(store: PermissionStore): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function getPluginPermissionGrant(
  pluginId: string,
  permission: ProjectVPluginPermission,
  requested = false,
): boolean {
  if (!requested) return false;
  const explicit = loadStore().grants[pluginId]?.[permission];
  return explicit !== false;
}

export function getEffectivePluginPermissions(manifest: ProjectVPluginManifest): Set<ProjectVPluginPermission> {
  const requested = new Set(manifest.permissions ?? []);
  return new Set(ALL_PERMISSIONS.filter((permission) =>
    requested.has(permission) && getPluginPermissionGrant(manifest.id, permission, true)
  ));
}

export function setPluginPermissionGrant(
  pluginId: string,
  permission: ProjectVPluginPermission,
  granted: boolean,
): void {
  const store = loadStore();
  const pluginGrants = { ...(store.grants[pluginId] ?? {}) };
  pluginGrants[permission] = granted;
  store.grants[pluginId] = pluginGrants;
  saveStore(store);
  window.dispatchEvent(new CustomEvent('project-v-plugin-registry-change', {
    detail: { action: 'permissions', pluginId },
  }));
}

export function resetPluginPermissionGrants(pluginId: string): void {
  const store = loadStore();
  if (!(pluginId in store.grants)) return;
  delete store.grants[pluginId];
  saveStore(store);
  window.dispatchEvent(new CustomEvent('project-v-plugin-registry-change', {
    detail: { action: 'permissions', pluginId },
  }));
}
