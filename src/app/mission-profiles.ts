import type { DeckPresetId, DeckWorkspaceId } from '@/app/deck-workspaces';

export type MissionProfileId =
  | 'global-watch'
  | 'breaking-news'
  | 'osint-investigation'
  | 'military-watch'
  | 'cyber-watch'
  | 'minimal-map'
  | 'custom';

export interface MissionProfileDefinition {
  id: MissionProfileId;
  label: string;
  description: string;
  icon: string;
  workspaceId?: DeckWorkspaceId;
  presetId?: Exclude<DeckPresetId, 'custom'>;
  quickBar: readonly string[];
  detail: string;
}

export const MISSION_PROFILES: readonly MissionProfileDefinition[] = [
  {
    id: 'global-watch',
    label: 'GLOBAL WATCH',
    description: 'Broad world picture for continuous situational awareness',
    icon: '◎',
    workspaceId: 'global-pulse',
    presetId: 'command',
    quickBar: ['modules', 'apps', 'analysis', 'osint', 'alerts', 'voice', 'security', 'map-width'],
    detail: 'GLOBAL PULSE · COMMAND LAYOUT',
  },
  {
    id: 'breaking-news',
    label: 'BREAKING NEWS',
    description: 'Live feeds, camera coverage, alerts, and rapid verification',
    icon: '!',
    workspaceId: 'live-ops',
    presetId: 'video-wall',
    quickBar: ['modules', 'cameras', 'analysis', 'osint', 'alerts', 'voice', 'security', 'map-width'],
    detail: 'LIVE OPS · VIDEO WALL',
  },
  {
    id: 'osint-investigation',
    label: 'OSINT INVESTIGATION',
    description: 'Research-first desk for collection, analysis, and case work',
    icon: '⌖',
    workspaceId: 'intelligence',
    presetId: 'analysis',
    quickBar: ['save', 'modules', 'apps', 'analysis', 'osint', 'alerts', 'security', 'export'],
    detail: 'INTELLIGENCE · ANALYSIS LAYOUT',
  },
  {
    id: 'military-watch',
    label: 'MILITARY WATCH',
    description: 'Map-forward posture for live events and strategic monitoring',
    icon: '◇',
    workspaceId: 'live-ops',
    presetId: 'map-focus',
    quickBar: ['modules', 'cameras', 'analysis', 'osint', 'alerts', 'voice', 'security', 'map-width'],
    detail: 'LIVE OPS · MAP FOCUS',
  },
  {
    id: 'cyber-watch',
    label: 'CYBER',
    description: 'Security, advisories, signals, OSINT, and analytical tooling',
    icon: '⬡',
    workspaceId: 'intelligence',
    presetId: 'three-column',
    quickBar: ['modules', 'plugins', 'analysis', 'osint', 'alerts', 'security', 'save', 'export'],
    detail: 'INTELLIGENCE · THREE COLUMN',
  },
  {
    id: 'minimal-map',
    label: 'MINIMAL MAP',
    description: 'Quiet map-first view with only essential intelligence visible',
    icon: '⌗',
    workspaceId: 'watchtower',
    presetId: 'minimal',
    quickBar: ['modules', 'alerts', 'osint', 'security', 'map-width'],
    detail: 'WATCHTOWER · MINIMAL LAYOUT',
  },
  {
    id: 'custom',
    label: 'CUSTOM',
    description: 'Keep the current desk, layout, and Quick Bar exactly as configured',
    icon: '✦',
    quickBar: [],
    detail: 'MANUAL CONFIGURATION',
  },
] as const;

export function getMissionProfile(profileId: MissionProfileId): MissionProfileDefinition | undefined {
  return MISSION_PROFILES.find((profile) => profile.id === profileId);
}

export function isMissionProfileId(value: unknown): value is MissionProfileId {
  return typeof value === 'string' && MISSION_PROFILES.some((profile) => profile.id === value);
}
