# Project V // Watchtower — Phase Two

Phase Two expands the Phase One visual shell into a configurable multi-workspace deck and repairs the path to the application's full API-key settings screen.

## What changed

### Movable world map

The map is now a first-class deck module inside the same CSS grid as the other panels.

1. Select **EDIT DECK**.
2. Drag the map by its header.
3. Drag its bottom edge to change height.
4. Drag its right edge to change width.
5. Select **LOCK DECK** when finished.

Map position, height, and width are saved with the active workspace.

### Four independent workspaces

The top navigation now switches between:

- **Watchtower** — general command overview
- **Global Pulse** — news, economy, climate, and human-impact modules
- **Live Ops** — real-time feeds, cameras, fires, alerts, and service health
- **Intelligence** — analysis, risk, signal, and monitoring modules

Each workspace saves its own:

- panel order
- panel row spans
- panel column spans
- map position
- map height
- map width

Use **RESET** to restore the current workspace preset. **EXPORT** creates a JSON backup of all workspace layouts. **IMPORT** restores a previously exported layout file.

### Prominent API settings

A dedicated **API KEYS** control is now visible in the top command bar. It opens the full API and data-source settings screen rather than the smaller interface-settings dialog.

The control reports:

- `READY` when all enabled local features have the required values
- `N MISSING` when enabled features still need credentials
- `SERVER` when credentials are managed by a hosted backend

Configuration-error messages inside panels, including the NASA FIRMS fire panel, now include a working **Open Settings** button in both desktop and local browser modes.

### Local browser development

When running at `http://localhost` or `http://127.0.0.1`, API values entered in the settings screen are saved in that browser's local storage and synchronized into the running Vite development server without restarting it.

This behavior is intended for a private development machine. Browser-local secrets are not equivalent to the operating-system credential vault. The Tauri desktop build continues to use its native secret storage and local sidecar.

## Run the project

```bash
npm install
npm run dev
```

Open the local address printed by Vite. Use the **API KEYS** button in the top bar to configure NASA FIRMS, Finnhub, FRED, Ollama, and other optional services.

For the native desktop build, use the existing Tauri scripts in `package.json`.

## Principal Phase Two files

```text
src/app/deck-workspaces.ts
src/app/panel-layout.ts
src/app/event-handlers.ts
src/components/Panel.ts
src/components/RuntimeConfigPanel.ts
src/services/open-runtime-settings.ts
src/services/runtime-config.ts
src/settings-main.ts
src/styles/project-v-theme.css
src/styles/settings-window.css
settings.html
vite.config.ts
```

## Upstream and license

This remains a modified fork of World Monitor and retains its `AGPL-3.0-only` license. See `LICENSE` and preserve upstream attribution when distributing or hosting modified versions.
