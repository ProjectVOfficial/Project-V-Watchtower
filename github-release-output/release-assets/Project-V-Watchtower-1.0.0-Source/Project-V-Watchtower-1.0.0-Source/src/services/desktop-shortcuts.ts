import { isDesktopRuntime } from '@/services/runtime';
import { invokeTauri } from '@/services/tauri-bridge';
import { openRuntimeSettings } from '@/services/open-runtime-settings';

/**
 * Keeps the useful development accelerators after the native Windows
 * File/Edit/Help menu is removed from the Project V command deck.
 *
 * Browser/WebView editing shortcuts (undo, redo, cut, copy, paste and select
 * all) remain native and are deliberately not intercepted here.
 */
export function installDesktopShortcuts(): () => void {
  if (!isDesktopRuntime()) return () => {};

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;

    const primaryModifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    // Ctrl/Cmd + , opens Project V API & Data Sources settings.
    if (primaryModifier && !event.altKey && !event.shiftKey && event.key === ',') {
      event.preventDefault();
      void openRuntimeSettings();
      return;
    }

    // Ctrl/Cmd + Alt + I toggles WebView developer tools in desktop:dev.
    if (primaryModifier && event.altKey && !event.shiftKey && key === 'i') {
      event.preventDefault();
      void invokeTauri<boolean>('toggle_developer_tools').catch((error) => {
        console.warn('[desktop-shortcuts] Developer tools unavailable', error);
      });
    }
  };

  window.addEventListener('keydown', handleKeyDown, true);
  return () => window.removeEventListener('keydown', handleKeyDown, true);
}
