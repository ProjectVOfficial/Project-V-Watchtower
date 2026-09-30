export const PROJECT_V_PLUGIN_SCHEMA_VERSION = 1 as const;

export type ProjectVModuleCategory =
  | 'maps'
  | 'intelligence'
  | 'news'
  | 'operations'
  | 'markets'
  | 'weather'
  | 'ai'
  | 'research'
  | 'system';

export type ProjectVPluginPermission =
  | 'storage'
  | 'network'
  | 'notifications'
  | 'clipboard-read'
  | 'clipboard-write';

export interface ProjectVModuleSize {
  w: number;
  h: number;
}

export interface ProjectVPluginEntry {
  type: 'sandbox-html';
  html: string;
  css?: string;
  script?: string;
}

export interface ProjectVPluginManifest {
  schemaVersion: typeof PROJECT_V_PLUGIN_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: ProjectVModuleCategory;
  icon?: string;
  defaultSize: ProjectVModuleSize;
  minSize?: ProjectVModuleSize;
  refreshIntervalSeconds?: number;
  permissions?: ProjectVPluginPermission[];
  allowedNetworkOrigins?: string[];
  requiredRuntimeFeatures?: string[];
  entry: ProjectVPluginEntry;
}

export interface InstalledProjectVPlugin {
  manifest: ProjectVPluginManifest;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface ProjectVModuleDefinition {
  panelId: string;
  name: string;
  description: string;
  category: ProjectVModuleCategory;
  source: 'core' | 'plugin';
  version: string;
  author?: string;
  icon?: string;
  defaultSize: ProjectVModuleSize;
  minSize: ProjectVModuleSize;
  refreshIntervalSeconds?: number;
  permissions: ProjectVPluginPermission[];
  requiredRuntimeFeatures: string[];
  pluginId?: string;
}

export interface ProjectVPluginValidationResult {
  valid: boolean;
  manifest?: ProjectVPluginManifest;
  errors: string[];
  warnings: string[];
}
