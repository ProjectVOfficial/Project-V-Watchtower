import { invalidateColorCache } from './theme-colors';

export type Theme = 'dark' | 'light';
export type WatchtowerUiTheme = 'classic' | 'shadow' | 'midnight';

const STORAGE_KEY = 'worldmonitor-theme';
const DEFAULT_THEME: Theme = 'dark';
const WATCHTOWER_UI_THEME_STORAGE_KEY = 'project-v-watchtower-ui-theme-v1';
const DEFAULT_WATCHTOWER_UI_THEME: WatchtowerUiTheme = 'classic';
let watchtowerThemeSyncInstalled = false;

function parseWatchtowerUiTheme(value: string | null): WatchtowerUiTheme | null {
  if (value === 'classic' || value === 'shadow' || value === 'midnight') return value;
  return null;
}

function applyWatchtowerUiThemeToDocument(theme: WatchtowerUiTheme, dispatch = false): void {
  document.documentElement.dataset.watchtowerTheme = theme;
  if (dispatch) {
    window.dispatchEvent(new CustomEvent('project-v-watchtower-theme-changed', { detail: { theme } }));
  }
}

function installWatchtowerThemeSync(): void {
  if (watchtowerThemeSyncInstalled || typeof window === 'undefined') return;
  watchtowerThemeSyncInstalled = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== WATCHTOWER_UI_THEME_STORAGE_KEY) return;
    const theme = parseWatchtowerUiTheme(event.newValue) ?? DEFAULT_WATCHTOWER_UI_THEME;
    applyWatchtowerUiThemeToDocument(theme, true);
  });
}

/**
 * Read the stored theme preference from localStorage.
 * Returns 'dark' or 'light' if valid, otherwise DEFAULT_THEME.
 */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (e.g., sandboxed iframe, private browsing)
  }
  return DEFAULT_THEME;
}

/**
 * Read the current theme from the document root's data-theme attribute.
 */
export function getCurrentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value === 'dark' || value === 'light') return value;
  return DEFAULT_THEME;
}

/**
 * Set the active theme: update DOM attribute, invalidate color cache,
 * persist to localStorage, update meta theme-color, and dispatch event.
 */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  invalidateColorCache();
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    const variant = document.documentElement.dataset.variant;
    meta.content = theme === 'dark' ? (variant === 'happy' ? '#1A2332' : '#0a0f0a') : (variant === 'happy' ? '#FAFAF5' : '#f8f9fa');
  }
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

/**
 * Project V Watchtower shell palette. This is intentionally separate from the
 * upstream light/dark preference so Watchtower can keep its dark operating
 * environment while switching visual identities.
 */
export function getStoredWatchtowerUiTheme(): WatchtowerUiTheme {
  try {
    const stored = parseWatchtowerUiTheme(localStorage.getItem(WATCHTOWER_UI_THEME_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_WATCHTOWER_UI_THEME;
}

export function getCurrentWatchtowerUiTheme(): WatchtowerUiTheme {
  const current = document.documentElement.dataset.watchtowerTheme;
  if (current === 'classic' || current === 'shadow' || current === 'midnight') return current;
  return DEFAULT_WATCHTOWER_UI_THEME;
}

export function setWatchtowerUiTheme(theme: WatchtowerUiTheme): void {
  applyWatchtowerUiThemeToDocument(theme, false);
  try {
    localStorage.setItem(WATCHTOWER_UI_THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
  window.dispatchEvent(new CustomEvent('project-v-watchtower-theme-changed', { detail: { theme } }));
}

export function applyStoredWatchtowerUiTheme(): void {
  applyWatchtowerUiThemeToDocument(getStoredWatchtowerUiTheme(), false);
  installWatchtowerThemeSync();
}

/**
 * Apply the stored theme preference to the document before components mount.
 * Only sets the data-theme attribute and meta theme-color — does NOT dispatch
 * events or invalidate the color cache (components aren't mounted yet).
 *
 * The inline script in index.html already handles the fast FOUC-free path.
 * This is a safety net for cases where the inline script didn't run.
 */
export function applyStoredTheme(): void {
  const variant = document.documentElement.dataset.variant;

  // Check raw localStorage to distinguish "no preference" from "explicitly chose dark"
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* noop */ }
  const hasExplicitPreference = raw === 'dark' || raw === 'light';

  let effective: Theme;
  if (hasExplicitPreference) {
    // User made an explicit choice — respect it regardless of variant
    effective = raw as Theme;
  } else {
    // No stored preference: happy defaults to light, others to dark
    effective = variant === 'happy' ? 'light' : DEFAULT_THEME;
  }

  document.documentElement.dataset.theme = effective;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    if (effective === 'dark') {
      meta.content = variant === 'happy' ? '#1A2332' : '#0a0f0a';
    } else {
      meta.content = variant === 'happy' ? '#FAFAF5' : '#f8f9fa';
    }
  }

  applyStoredWatchtowerUiTheme();
}
