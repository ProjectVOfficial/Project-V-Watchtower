import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';

export type ProjectVWorkspaceWindow = 'case-desk' | 'data-desk' | 'map-operations' | 'assistant-desk' | 'analysis-room' | 'launch-desk' | 'camera-desk' | 'osint-desk';

const DEFINITIONS: Record<ProjectVWorkspaceWindow, { path: string; command: string; features: string }> = {
  'case-desk': { path: '/case-desk.html', command: 'open_case_desk_window', features: 'popup,width=1420,height=900,resizable=yes' },
  'data-desk': { path: '/data-desk.html', command: 'open_data_desk_window', features: 'popup,width=1420,height=900,resizable=yes' },
  'map-operations': { path: '/map-operations.html', command: 'open_map_operations_window', features: 'popup,width=1500,height=920,resizable=yes' },
  'assistant-desk': { path: '/assistant-desk.html', command: 'open_assistant_desk_window', features: 'popup,width=1180,height=860,resizable=yes' },
  'analysis-room': { path: '/analysis-room.html', command: 'open_analysis_room_window', features: 'popup,width=1540,height=920,resizable=yes' },
  'launch-desk': { path: '/launch-desk.html', command: 'open_launch_desk_window', features: 'popup,width=1180,height=820,resizable=yes' },
  'camera-desk': { path: '/camera-desk.html', command: 'open_camera_desk_window', features: 'popup,width=1500,height=920,resizable=yes' },
  'osint-desk': { path: '/osint-desk.html', command: 'open_osint_desk_window', features: 'popup,width=1320,height=860,resizable=yes' },
};

export async function openProjectVWorkspaceWindow(type: ProjectVWorkspaceWindow, query: Record<string, string> = {}): Promise<void> {
  // Opening another trusted Project V window transfers focus away from the
  // command deck. Tell Project Lock not to interpret that intentional focus
  // transfer as the user leaving Watchtower.
  window.dispatchEvent(new CustomEvent('project-v-trusted-window-opening', { detail: { type } }));
  const definition = DEFINITIONS[type];
  const params = new URLSearchParams(query);
  const relative = `${definition.path}${params.size ? `?${params}` : ''}`;
  if (isDesktopRuntime()) {
    await invokeTauri<void>(definition.command, { baseUrl: window.location.origin, query: params.toString() || null });
    return;
  }
  window.open(new URL(relative, window.location.origin).href, `project-v-${type}`, definition.features);
}
