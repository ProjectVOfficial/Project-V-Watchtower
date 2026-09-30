# Project V Watchtower — Phase 18.3 Development Startup Hotfix

## Fixed

The Phase 18.2 desktop shortcut module imported the desktop-runtime helper from a nonexistent alias:

```ts
@/runtime
```

The helper actually lives at:

```ts
@/services/runtime
```

Vite therefore stopped during import analysis before the Tauri window could finish loading.

## Development workflow

You do **not** need to build the application before running development mode.

Run:

```powershell
npm install
npm run desktop:dev
```

`desktop:dev` starts Vite and compiles the Tauri development executable automatically. A release build is only needed when creating installers or portable packages.

## Preserved behavior

- Native File / Edit / Help menu remains removed.
- `Ctrl + ,` still opens API & Data Sources.
- `Ctrl + Alt + I` still toggles developer tools during desktop development.
- Release scripts and updater configuration are unchanged.
