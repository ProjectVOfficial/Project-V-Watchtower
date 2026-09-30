/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_WS_API_URL?: string;
  readonly VITE_PROJECT_V_UPDATER_ENABLED?: string;
  readonly VITE_PROJECT_V_RELEASE_MANIFEST_URL?: string;
  readonly VITE_PROJECT_V_RELEASE_PAGE_URL?: string;
  readonly VITE_PROJECT_V_API_GATEWAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
