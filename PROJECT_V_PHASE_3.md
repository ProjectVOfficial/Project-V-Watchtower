# Project V // Watchtower — Phase Three

Phase Three turns the dashboard layout into a visible deck editor. It focuses on direct module movement, map-layout control, workspace-specific module states, and safer Project V storage names.

## What changed

### Visual drag-and-drop

1. Select **EDIT DECK**.
2. Grab the new six-dot handle in a module header.
3. Drag the module across the deck.
4. A red landing placeholder shows exactly where it will be inserted.
5. Release the pointer and select **LOCK DECK** when finished.

The module content is no longer used as the drag surface, so maps, links, scrolling, video controls, buttons, and embedded feeds remain usable.

### Deliberate command grid

The large-screen layout now uses a predictable three-column command grid instead of dense automatic packing. This prevents small modules from filling visual gaps in a way that can make them appear to overlap the map.

Responsive behavior remains:

- three columns on large displays
- two columns on medium displays
- one column on mobile displays

### Map layout modes

The operations bar now includes:

- **MAP: FULL** — map spans the entire three-column top row
- **MAP: COMMAND** — map spans two columns, leaving one column for intelligence modules
- **MAP: COMPACT** — map occupies one column

The Watchtower preset and migrated Phase Two Watchtower layouts use the full-width map by default.

### Module controls

Every module now has consistent header controls:

- drag handle — shown in Edit Deck mode
- minimize / restore
- maximize / return to deck
- hide — shown in Edit Deck mode

Press `Escape` to close a maximized module or the module library.

### Module library

Select **MODULES** in the operations bar to open the module library.

It can:

- restore hidden modules
- expand minimized modules
- hide visible modules
- identify modules disabled through interface settings

Hidden and minimized states are stored separately for each workspace.

### Resize from the corner

Edit Deck mode now exposes a lower-right corner handle. Drag it to change width and height together. The existing bottom and right-edge resize handles remain available.

### Undo, redo, and save

The operations bar now includes:

- undo
- redo
- **SAVE**

Undo and redo retain up to forty layout states for the active workspace. `Ctrl+Z` or `Command+Z` also performs undo; add `Shift` for redo.

Layouts continue to save automatically. The Save button provides an explicit confirmation point.

### Project V storage migration

Deck and panel geometry now use Project V names:

```text
project-v-deck-workspaces-v2
project-v-panel-order
project-v-panel-spans
project-v-panel-col-spans
project-v-active-deck
```

Compatible Phase Two and older panel-size values are migrated automatically. Upstream protocol names, provider API names, generated RPC namespaces, and World Monitor service headers were intentionally retained where changing them could break compatibility.

## Using the editor

```text
EDIT DECK
  → drag with the six-dot handle
  → resize with an edge or corner
  → minimize, maximize, or hide modules
  → choose MAP: FULL / COMMAND / COMPACT
  → SAVE
LOCK DECK
```

A useful Watchtower arrangement is:

```text
WORLD MAP — FULL WIDTH
LIVE NEWS — two columns     INTEL FEED — one column
LIVE WEBCAMS — two columns  STRATEGIC RISK — one column
FIRES — one column          MARKETS — one column          ECONOMICS — one column
```

### Restoring a module

1. Select **MODULES**.
2. Find the module marked `HIDDEN`.
3. Select **RESTORE**.

A module marked `DISABLED IN SETTINGS` must first be enabled in the normal interface settings.

## Principal Phase Three files

```text
src/app/deck-editor.ts
src/app/deck-workspaces.ts
src/app/panel-layout.ts
src/components/Panel.ts
src/App.ts
src/styles/project-v-theme.css
```

## API and license keys

Phase Three does not generate, bypass, or embed an upstream hosted-service key. The prominent **API KEYS** screen from Phase Two remains in place for provider credentials and local runtime configuration.

## Validation performed

- Phase Three deck-editor and workspace-manager files passed strict TypeScript checking with unused-code and unchecked-index checks enabled.
- All modified TypeScript files passed TypeScript syntax transpilation.
- Modified source files produced no errors attributable to them during the broader local shim check.
- JSON files were parsed successfully.
- The final ZIP was tested for archive integrity.

A complete dependency installation and Vite production build could not be completed in this environment because its package mirror does not contain `youtubei.js@16.0.1`. Run the normal build on the development machine after installing dependencies.

## Run

```powershell
npm install
npm run dev
```

For the Tauri desktop runtime, continue using the existing desktop scripts in `package.json`.

## Upstream and license

This remains a modified fork of World Monitor and retains the `AGPL-3.0-only` license. Preserve the included license, source availability obligations, and upstream attribution when distributing or hosting the modified application.
