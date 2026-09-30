# Project V Watchtower — Phase 16.1

## Satellite Map, OSINT Desk, Assistant Scroll, and UI Cleanup

Phase 16.1 is a focused maintenance and capability patch built on Phase Sixteen. It does not add a new npm dependency.

## 1. Satellite basemap on the existing Watchtower map

The primary Watchtower map now includes a basemap selector inside its existing map controls:

- `TACTICAL` — the existing dark vector basemap
- `SATELLITE` — satellite imagery beneath the existing Watchtower markers, alerts, boundaries, popups, and Deck.gl layers

The selected basemap is remembered locally under:

```text
project-v-map-basemap-v1
```

The satellite layer uses an attributed raster-imagery source rendered by the MapLibre map already present in Watchtower. It is not a Google Earth embed. A future Google Maps Tile API adapter would require a separately configured Google project, API key, session-token flow, billing, and Google attribution/terms handling.

The satellite switch is available on the desktop/WebGL map. The lightweight mobile SVG fallback remains tactical-only.

## 2. Fullscreen Command Assistant scrolling repair

The separate Command Assistant window now keeps its message history inside a bounded scrolling region at every supported window size, including maximized/fullscreen desktop use.

Changes include:

- A persistent vertical message scrollbar
- Independent scrolling for the quick-command/source rail
- Mouse-wheel and touch scrolling inside the conversation
- Preserving the analyst's reading position when older messages are being reviewed
- Automatic following while a local Ollama response is streaming
- A floating `LATEST ↓` button when the view is away from the newest response
- Dynamic-viewport-height handling for maximized WebView2 windows

## 3. Separate Project V OSINT Desk

A new trusted workspace window is available from:

```text
Top command bar → OSINT TOOLS
Voice command → “Open OSINT Desk”
```

In browser development it opens as a popup. In Tauri desktop mode it opens as a separate Project V window.

Supported query modes:

- Username
- Email
- Domain
- IP address
- Phone number
- General search text

Included public-source launchers:

- DuckDuckGo exact search
- Bing exact search
- GitHub public profiles
- Reddit public profiles
- Keybase public profiles
- Have I Been Pwned manual breach check
- Certificate Transparency search
- URLScan domain observations
- VirusTotal domain and IP pages
- AbuseIPDB
- Shodan host pages

The OSINT Desk opens services through the existing restricted Source Browser window in desktop mode.

### Custom services

Use `ADD TOOL` to register an HTTPS service URL template containing one or more of:

```text
{query}
{username}
{email}
{domain}
{ip}
{phone}
```

Custom launchers can be exported, imported, and removed. Imported or added tools do not receive API keys or Watchtower application access.

Local storage keys:

```text
project-v-osint-custom-tools-v1
project-v-osint-search-history-v1
```

The OSINT Desk is a public-source launcher. It does not bypass authentication, automate access to private accounts, defeat provider controls, or guarantee the accuracy of third-party results.

## 4. Upstream discussion popup removed

The inherited `Join the Discussion / Open Discussion` prompt is now suppressed whenever the Project V brand is active. This does not remove upstream attribution, licensing notices, or source-code obligations.

## Desktop use

For the complete separate-window experience:

```powershell
npm run desktop:dev
```

For ordinary browser development:

```powershell
npm run dev
```

No new npm package is required for this patch. If this is a fresh extraction without dependencies, run `npm install` first.

## Validation performed

- TypeScript syntax transpilation passed for all changed TypeScript files
- All JSON files parsed successfully
- HTML entry points and Vite multi-page input were checked
- OSINT URL templates are restricted to HTTPS
- Satellite style switching returns a fresh MapLibre style object for repeat switching
- Tauri command registration and trusted-window lists were structurally checked
- CSS brace and archive-integrity checks passed

A complete Vite/Tauri production build still needs to be compiled on the Windows development machine because this packaging environment does not contain the project dependency directory or Rust toolchain.
