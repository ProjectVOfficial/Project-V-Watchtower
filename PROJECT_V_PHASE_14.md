# Project V Watchtower — Phase Fourteen

## Launch Deck, Application Handoff, Built-In Map Actions, and Spoken Alerts

Phase Fourteen keeps Watchtower focused as the command center instead of embedding another full browser. It adds a controlled desktop **Launch Deck** for opening approved external tools such as Project V Browser, Tor Browser, Microsoft Excel, VLC, or another analyst-selected program.

This phase also connects the existing built-in Watchtower map popups to the operational workflow and adds optional spoken alert announcements.

## Launch Deck

A new **APPS** control appears in the upper command bar. The movable **LAUNCH DECK** module is also available under:

```text
MODULES → SYSTEM → LAUNCH DECK
```

Select **OPEN LAUNCH DESK** for the full separate Project V window.

The Launch Desk supports:

- Selecting an installed Windows `.exe` with a native file picker
- Assigning a display name and category
- Optional startup arguments
- Optional working directory
- Pinning approved applications to the small command-deck module
- Launching applications outside Watchtower
- Optional URL handoff
- Optional local-file handoff
- Search
- Import and export of the launcher registry
- Cross-window synchronization
- Project Lock coverage

Example applications include:

```text
Project V Browser
Tor Browser
Microsoft Excel
VLC Media Player
Visual Studio Code
Other analyst-approved desktop tools
```

You can also say:

```text
Open Launch Deck
```

through the Phase Thirteen Voice Command Center.

## Safe launch behavior

The Launch Deck does not run a shell command string. The desktop backend starts the exact executable path selected by the analyst and passes arguments directly to that process.

On Windows:

- Registered applications must be `.exe` files.
- Known command shells and Windows script hosts are blocked.
- Sandboxed plugins cannot invoke the native application launcher.
- Imported launcher records are marked **REQUIRES REVIEW**.
- An imported executable path must be explicitly approved before it can run.
- URL and file handoffs are disabled per application until the analyst enables them.

Imported configuration cannot silently start an application.

## URL and file handoff

An approved application can optionally receive one explicit URL or file path.

Examples:

```text
Project V Browser + https://example.org
Tor Browser + https://example.org
Excel + E:\Research\Incident Log.xlsx
VLC + E:\Media\Reference Video.mp4
```

The target program must support receiving that type of command-line argument. Watchtower cannot guarantee that every application will recognize a URL or file argument.

## No additional built-in browser

Phase Fourteen does not add a second full browser to Watchtower.

The intended division remains:

```text
WATCHTOWER
Monitoring, operations, alerts, research, cases, maps, and local AI

PROJECT V BROWSER
Private web research and normal browsing

TOR BROWSER
Dedicated Tor browsing when needed
```

The Launch Deck makes those separate programs accessible without duplicating their complete functionality inside Watchtower.

## Built-in map signal actions

The current Watchtower world map remains the primary live map. Its existing information popups now include a Project V action strip:

```text
SAVE MARKER
TIMELINE
CREATE ALERT
ADD TO CASE
ASK LOCAL AI
```

This allows a map item such as an outage, conflict marker, aircraft, vessel, earthquake, weather alert, military site, or other supported signal to enter the operational system without recreating it manually.

### Save Marker

When usable coordinates are available, the popup can save the selected signal as a Map Operations marker. It becomes available to the existing Map Desk, cases, timelines, and future geospatial work.

### Timeline

Creates an unverified Event Timeline entry containing the normalized title, source, time, category, detail, and source URL when available.

### Create Alert

Creates a local operational alert using the map signal's severity, location, source, and timestamp. Duplicate map alerts are suppressed using a stable fingerprint.

### Add to Case

Sends the selected map item to the Case Desk as unverified evidence and preserves available coordinates and source metadata.

### Ask Local AI

Opens the separate Command Assistant and submits a structured prompt asking the local model to compare the selected map signal with current Watchtower context, look for corroboration or contradiction, and identify what should be verified next.

The map signal remains labeled as unverified until an analyst confirms it.

## Map Desk relationship

The separate Map Desk remains available for larger drawing and editing tasks such as:

- Circles
- Rectangles
- Polygons
- Routes
- Measurements
- Saved areas of interest
- Geofence-rule configuration
- GeoJSON import and export

Phase Fourteen does not force analysts to recreate existing Watchtower map signals in that separate map. Existing map popups can now save and hand off their information directly.

## Spoken operational alerts

The **ALERT RULES** module now contains:

```text
VOICE READOUT
VOICE WATCH+
VOICE ELEVATED+
VOICE HIGH+
VOICE CRITICAL+
```

When enabled, newly created operational alerts at or above the selected spoken threshold are read aloud using the system voice configured in the Phase Thirteen Voice Command Center.

Spoken alert output includes:

- Project V Watchtower identification
- Alert severity
- Alert title
- Location when available

This uses local system speech synthesis. It reads the incoming alert headline; it does not silently ask the AI to invent or expand the alert.

Quiet Mode suppresses spoken alerts. Desktop and sound notification thresholds remain separately configurable.

## Local storage

Launch Deck records are stored under:

```text
project-v-launch-deck-v1
```

Assistant map handoffs use a short-lived local record under:

```text
project-v-assistant-pending-handoff-v1
```

Launch Deck configuration is included in normal Project V configuration and full backups because it uses the standard `project-v-` storage namespace. API keys and Project Lock credentials remain excluded according to the Phase Ten backup rules.

## Desktop and browser development modes

For native file selection and local application startup, run:

```powershell
npm install
npm run desktop:dev
```

In browser development mode:

```powershell
npm run dev
```

Watchtower can display and edit Launch Deck records, but a normal browser tab cannot start arbitrary local desktop applications. The full launch functionality therefore requires the Tauri desktop runtime.

## Validation performed

Phase Fourteen validation included:

- Syntax transpilation of every changed TypeScript file
- Targeted strict checking of changed TypeScript modules with external packages stubbed
- Launch Deck save, export, import, approval, and registry simulation
- Built-in map signal normalization simulation
- JSON parsing checks
- HTML structure checks
- CSS delimiter checks
- Rust delimiter and command-registration checks
- Tauri trusted-window and capability checks
- ZIP archive-integrity testing

Phase Fourteen adds no new npm dependency.

A complete Windows Tauri compile still needs to be performed locally because Rust tooling and the complete project dependency directory are unavailable in the packaging environment.
