# Project V // Watchtower — Phase Four

Phase Four replaces the loose, order-based Phase Three layout with a **collision-safe twelve-column command grid**. The map and information modules are now docked into explicit cells instead of behaving like windows laid over a canvas.

## Main result

Normal operating mode no longer permits one module to occupy the same deck space as another. Moving or enlarging a module causes neighboring modules to reflow into the next available dock position.

The new default Watchtower structure is modeled after the command-center references:

```text
┌──────────────────────────────────────────┬────────────────────┐
│                                          │ STRATEGIC POSTURE  │
│                                          ├────────────────────┤
│                WORLD MAP                 │ AI INSIGHTS        │
│                                          ├────────────────────┤
│                                          │ STRATEGIC RISK     │
├──────────────────────────────────────────┼────────────────────┤
│ LIVE NEWS                                │ INTEL FEED         │
├──────────────────────────────────────────┼────────────────────┤
│ LIVE WEBCAMS                             │ FIRES / CII        │
└──────────────────────────────────────────┴────────────────────┘
```

Only modules enabled in Interface Settings are shown. Disabled modules retain safe reserved geometry and are rechecked if enabled later.

## Docked movement

1. Select **EDIT DECK**.
2. Grab the six-dot handle in a module header.
3. Move the pointer over the desired dock area.
4. The red preview displays the exact destination and dimensions.
5. Release the pointer.
6. Select **LOCK DECK** when finished.

The moved module takes the selected position. Any conflicting modules are pushed to the nearest available cells. They do not render over the map.

## Collision-aware resizing

In Edit Deck mode, use the lower-right red corner to resize a module.

- Width is measured in twelve-column grid cells.
- Height is measured in fixed command rows.
- The map has a larger minimum height.
- Neighboring modules are reflowed after release.
- Legacy freeform bottom and right-edge resize rails are disabled for Project V because they used incompatible span storage.

## Map width modes

The map menu now maps to the dock grid:

- **MAP: FULL** — twelve columns
- **MAP: COMMAND** — eight columns, leaving a four-column intelligence rail
- **MAP: COMPACT** — six columns

Changing the map width also triggers collision-safe reflow.

## Auto Arrange

Phase Four adds **AUTO ARRANGE** to the operations bar on wide displays.

It removes avoidable gaps while preserving module dimensions and preventing collisions. This is useful after hiding, restoring, resizing, or enabling several modules.

## Workspace presets

Each workspace has its own structured default:

- **Watchtower** — eight-column map with a four-column intelligence rail
- **Global Pulse** — map, risk overview, news, markets, and economic modules
- **Live Ops** — full-width map followed by live news, fires, cameras, and operational feeds
- **Intelligence** — map with AI/risk rail and wider analysis modules below

Every workspace independently remembers:

- dock position
- width and height
- minimized state
- hidden state
- active map width

## Phase Three migration

Phase Four uses:

```text
project-v-docked-workspaces-v3
```

When a Phase Two or Phase Three layout is found:

- loose panel coordinates are intentionally discarded
- hidden and minimized choices are preserved
- each workspace receives the clean Phase Four command preset
- old storage remains untouched for fallback purposes

This automatic reset is deliberate because carrying the earlier order-based geometry forward would recreate the scattered layout.

## Interface-setting changes

When a module is enabled or disabled through Interface Settings, the panel now emits a Project V availability event. The dock manager revalidates the active layout so a newly enabled module cannot appear on top of an existing module.

## Responsive behavior

The full dock editor is intended for desktop command-center use. At widths below 1,050 pixels, the dashboard becomes a deliberate vertical stack and ignores desktop grid coordinates. Dragging and corner resizing are hidden at that width to avoid producing unusable layouts.

## Files changed

```text
src/app/deck-workspaces.ts
src/app/deck-editor.ts
src/app/panel-layout.ts
src/app/event-handlers.ts
src/components/Panel.ts
src/styles/project-v-theme.css
```

## Validation performed

- The new workspace manager and deck editor passed focused TypeScript checking.
- All modified TypeScript files passed TypeScript syntax transpilation.
- A headless fake-DOM test exercised all four presets and confirmed no visible-panel collisions.
- The same test confirmed collision-free drag, resize, hide, restore, collapse, expand, and Auto Arrange operations.
- JSON files were parsed successfully.
- The final ZIP was tested for archive integrity.

A complete dependency installation and Vite production build could not be completed in this environment because its package mirror is missing multiple dependencies, including `youtubei.js@16.0.1` and `@deck.gl/aggregation-layers`. The source-level and focused dock-engine validation completed successfully.

## Run

```powershell
npm install
npm run dev
```

The first Phase Four launch automatically creates the new docked workspace storage. Use **RESET** on any workspace to restore its clean command-center preset.

## Upstream and license

This remains a modified World Monitor fork under `AGPL-3.0-only`. Preserve the included license, source-availability obligations, and upstream attribution when distributing or hosting the modified application.

## Maintenance update: workspace scrolling

The accompanying Phase Four scroll-fix build restores `.main-content` as the dashboard's vertical scroll container. This allows docked rows below the viewport to be reached without changing or resetting saved layouts. See `PROJECT_V_PHASE_4_SCROLL_FIX.md`.
