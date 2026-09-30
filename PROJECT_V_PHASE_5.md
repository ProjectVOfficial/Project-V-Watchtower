# Project V Watchtower — Phase Five

Phase Five builds on the Phase Four docked command grid and scroll fix. It adds independent command-center workspaces, layout presets, custom desk management, per-workspace scroll restoration, and a categorized module library.

## New workspace system

The four protected Project V workspaces remain available from the top navigation:

- **Watchtower** — command overview
- **Global Pulse** — news, economics, and human-impact monitoring
- **Live Ops** — real-time feeds, cameras, alerts, fires, and operational panels
- **Intelligence** — analysis, risk, posture, and intelligence signals

Each workspace keeps its own:

- Docked panel positions and dimensions
- Hidden and minimized modules
- Selected layout preset
- Vertical scroll position
- Map size and placement

Phase Four layouts are migrated automatically and retained as **Custom** layouts.

## Layout presets

Use the new **LAYOUT** control in the operations bar:

- **Command** — balanced map, intelligence rail, and operating panels
- **Map Focus** — enlarged map and compact intelligence rail
- **Analysis** — research and risk modules prioritized
- **Video Wall** — live news and webcams prioritized
- **Three Column** — dense analyst layout
- **Minimal** — map and essential intelligence only

Moving, resizing, minimizing, hiding, restoring, or auto-arranging a module changes the active preset label to **Custom**. Choosing a preset again restores its clean layout.

## Custom desks

Open **DESKS** in the primary navigation to manage workspaces.

Available controls:

- **New Desk** — creates a new workspace based on Watchtower
- **Duplicate** — copies the active workspace and its current layout
- **Rename** — renames a custom workspace
- **Set Default** — opens that workspace at the start of a fresh app/browser session
- **Delete** — removes a custom workspace

The four core Project V workspaces cannot be renamed or deleted. Duplicate a core workspace first to create an editable copy.

## Module library upgrade

The module drawer now includes:

- Search
- Category filters
- Maps and geospatial modules
- Intelligence and analysis modules
- News and information modules
- Live operations modules
- Markets and economics modules
- Weather and human-impact modules
- System and utility modules
- Docked, hidden, minimized, disabled, and configuration-required status
- The number of workspaces currently using each module

Restored modules are placed through the collision-safe dock engine and cannot cover another panel.

## Storage and migration

Phase Five uses:

```text
project-v-workspaces-v4
```

The following previous layout stores are recognized and migrated:

```text
project-v-docked-workspaces-v3
project-v-deck-workspaces-v2
project-v-deck-workspaces-v1
```

Workspace exports now contain custom workspace definitions, selected presets, default-workspace information, panel layouts, and scroll positions. Phase One through Phase Four layout exports remain import-compatible.

## Running the project

```powershell
npm install
npm run dev
```

For the Tauri desktop development build:

```powershell
npm run desktop:dev
```

## Validation performed

- Strict TypeScript checking passed for the Phase Five workspace and deck-editor engines.
- TypeScript syntax transpilation passed for the modified panel-layout file.
- A mocked-browser workspace harness tested every preset in every core workspace.
- The harness verified collision-free preset loading, movement, resizing, custom workspace duplication, rename, default selection, deletion, export, and import.
- JSON files were parsed and the final ZIP was archive-integrity tested.

A full Vite production build still requires the project dependencies to be installed on the target computer.
