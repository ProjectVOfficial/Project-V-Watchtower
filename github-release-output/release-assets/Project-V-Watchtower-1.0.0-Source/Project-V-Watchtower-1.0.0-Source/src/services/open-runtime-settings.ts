import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';

const SETTINGS_WINDOW_NAME = 'project-v-api-settings';

function openBrowserSettings(): void {
  const url = new URL('/settings.html', window.location.origin).toString();
  const popup = window.open(
    url,
    SETTINGS_WINDOW_NAME,
    'popup=yes,width=1100,height=760,resizable=yes,scrollbars=yes',
  );

  if (popup) {
    popup.focus();
    return;
  }

  // Popup blockers should not make the control appear broken.
  window.location.assign(url);
}

/**
 * Opens the full API key / runtime configuration screen.
 * Desktop builds use the native Tauri settings window. Local browser builds
 * open the bundled settings page in a dedicated window.
 */
export async function openRuntimeSettings(): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('open_settings_window_command');
      return;
    } catch (error) {
      console.warn('[settings] Native settings window failed; using browser fallback', error);
    }
  }

  openBrowserSettings();
}
