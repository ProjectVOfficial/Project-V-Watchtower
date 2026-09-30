# Project V Watchtower — Phase Twelve

## Advanced Map Operations, Geofenced Alerts, and Assistant Window

Phase Twelve adds a dedicated operational map workspace without crowding the primary command deck. It also adds an optional separate Command Assistant window, live Watchtower feed refresh before AI analysis, and a limited read-aloud preview ahead of the full voice-control phase.

## Map Operations panel

Find the compact panel under:

```text
MODULES → MAPS → MAP OPERATIONS
```

The panel shows saved areas, routes and markers, active geofence rules, and the most recently edited map item. Select **OPEN MAP DESK** to launch the full workspace. In browser development it opens as a popup. In the Tauri desktop runtime it opens as a separate Project V window.

## Project V Map Desk

The dedicated Map Desk supports:

- Operational markers
- Circular areas of interest
- Rectangular areas of interest
- Freeform polygons
- Multi-point routes
- Distance and area measurement
- Names, notes, tags, colors, and visibility controls
- Fit-to-item navigation
- Persistent last map position and zoom
- PNG map snapshots
- Project V map backups
- GeoJSON import and export
- Sending a map item to the Case Desk
- Adding a map item to the Event Timeline

Map records are stored locally under:

```text
project-v-map-operations-v1
```

Because the key uses the `project-v-` prefix, Map Operations state is included in Project V configuration and full backups.

## Geofenced alert rules

Circles, rectangles, and polygons can have geofence rules. A rule can specify:

- Rule name
- Enabled or disabled state
- Optional keywords
- Optional event categories
- Alert severity

While Watchtower is running, the monitor checks current geolocated inputs for entries inside saved areas. Phase Twelve checks:

- Geolocated news and intelligence headlines
- Military flight positions
- Military vessel positions
- Earthquake events

Matches are sent into the Phase Nine Alert Center and use the existing notification preferences. Duplicate alerts are suppressed while an item remains inside a geofence. Monitoring does not continue after Watchtower is fully closed.

## Separate Command Assistant window

The existing Assistant panel now includes:

```text
OPEN WINDOW
```

This launches:

```text
PROJECT V // COMMAND ASSISTANT
```

The separate Assistant window shares the same local conversation history, Ollama configuration, context scope, and research access as the panel. Keep the primary Watchtower window open when using workspace context because it provides the current panels, feeds, alerts, map operations, and research snapshot to the Assistant window.

In normal browser development the Assistant opens as a popup. In desktop mode it opens as a dedicated Tauri window and is covered by Project Lock.

## Live source refresh

Both the panel and separate Assistant window now offer:

```text
LIVE REFRESH
```

When enabled, Watchtower requests fresh data from its configured sources before collecting context for a question. The refresh currently includes the applicable news, natural-event, weather, military, Telegram, NASA FIRMS, and AIS loaders. Availability still depends on configured API keys, provider rate limits, cached responses, and network status.

Live Refresh is not unrestricted web browsing. The model receives only data successfully loaded by the configured Watchtower services and the context scopes selected by the analyst.

Map Operations and active geofence summaries are also available to the Assistant as cited workspace context.

## Voice status

Full voice control remains planned for Phase Thirteen. Phase Twelve includes an early **READ REPLIES ALOUD** option in the separate Assistant window using the operating system/WebView speech engine where supported.

Phase Thirteen is still planned to add:

- Push-to-talk
- Speech-to-text commands
- Spoken briefings
- Visible command transcripts
- Confirmation before sensitive actions

The Phase Twelve read-aloud control does not activate a microphone and does not execute voice commands.

## Running Phase Twelve

For the full native separate-window experience:

```powershell
npm install
npm run desktop:dev
```

For ordinary browser development:

```powershell
npm install
npm run dev
```

The Map Desk and Assistant Desk will use popup windows in browser mode.

If the Phase Eight PDF dependency is missing from an older installed `node_modules` directory:

```powershell
npm install pdfjs-dist@4.10.38
```

## Validation performed

- Targeted strict TypeScript checking passed for all Phase Twelve source files and modified integration files.
- Map geometry, distance, polygon containment, GeoJSON generation, and geofence matching were exercised in a simulated local-storage environment.
- All project JSON files were parsed.
- The new HTML entry points and Vite build inputs were checked.
- CSS delimiter and HTML structure checks passed.
- The release ZIP passed archive-integrity testing.

A complete Vite production build could not be performed in the packaging environment because its internal npm mirror does not provide `pdfjs-dist@4.10.38` or `youtubei.js@16.0.1`. A complete Tauri compile also could not be performed because Rust tooling was unavailable. Run the first full desktop compile on Windows before distributing the application.
