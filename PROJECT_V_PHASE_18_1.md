# Project V Watchtower — Phase 18.1 Startup Hotfix

## Problem

Phase Eighteen registered Tauri's updater plugin during every desktop startup, but the normal development configuration intentionally has no updater endpoint or public signing key. Tauri therefore attempted to deserialize a missing `plugins.updater` configuration and exited before opening the command deck.

The visible failure was:

```text
PluginInitialization("updater", "Error deserializing 'plugins.updater' ... invalid type: null, expected struct Config")
```

## Fix

- The updater dependency is now optional behind the Cargo feature `updater`.
- `npm run desktop:dev` does not load the updater plugin.
- Unsigned local builds do not load the updater plugin.
- Update commands return a safe disabled response when the feature is absent.
- The signed Windows release script enables `--features updater` and supplies `src-tauri/tauri.release.conf.json`.
- The actual signed release still requires the production updater public key, HTTPS endpoint, and signing private key described in the release guide.

## Run development

```powershell
npm run desktop:dev
```

No updater environment variables or signing keys are needed for development.

## Build a signed release

Use the existing release workflow:

```powershell
npm run release:windows
```

The workflow now compiles with the `updater` Cargo feature automatically.

## Security rationale

Tauri requires updater artifacts to be signed and the updater public key to be embedded in the release configuration. The application no longer inserts a fake development key merely to make startup succeed. The updater exists only in builds that are deliberately manufactured with the signed release configuration.
