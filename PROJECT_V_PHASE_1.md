# Project V Watchtower — Phase 1

This fork preserves the World Monitor data, map, services, Tauri runtime, and AGPL-3.0 license while replacing the primary visual shell with an original Project V Watchtower interface.

## Included in Phase 1

- Project V / Watchtower branding and metadata (upstream core version retained)
- Two-level command header inspired by professional situation-room dashboards
- Original black, oxblood-red, ivory, green, and amber visual system
- Redesigned map and panel chrome
- Improved spacing, borders, typography, focus states, and responsive behavior
- Deck edit/lock control
- Panel dragging and row/column resizing available only in Edit Deck mode
- Existing panel order and size persistence retained
- Existing source attribution and AGPL licensing retained

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use **EDIT DECK** in the upper operations bar to rearrange and resize modules. Select **LOCK DECK** when finished.

## Important

The map remains a dedicated top module in Phase 1. Converting it into a fully movable grid module, multiple workspaces, layout export/import, maximize/collapse controls, and module creation are reserved for later phases.

## Verification performed for this package

- Parsed modified JSON configuration and JSON-LD metadata successfully.
- Parsed/transpiled the modified TypeScript files successfully and checked them for unused imports introduced by the redesign.
- Checked the Project V stylesheet for balanced structure.
- Confirmed the deliverable excludes `node_modules` and generated `dist` output.

A complete `npm run build` was not available in the packaging environment because its package registry could not retrieve `youtubei.js@16.0.1`. This is a dependency-download limitation rather than a reported TypeScript syntax failure. Run `npm install` and `npm run build` on the development machine before distributing a compiled release.

## Primary Phase 1 files

```text
index.html
README.md
PROJECT_V_PHASE_1.md
src/main.ts
src/app/panel-layout.ts
src/app/event-handlers.ts
src/components/Panel.ts
src/styles/project-v-theme.css
src-tauri/src/main.rs
src-tauri/tauri.conf.json
vite.config.ts
```
