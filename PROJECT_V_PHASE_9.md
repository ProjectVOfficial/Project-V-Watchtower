# Project V Watchtower — Phase Nine

## Operational Awareness, Alerts, Watchlists, Timelines, and Source Health

Phase Nine turns Watchtower from a passive dashboard into a local operational workflow. The application can now collect high-priority signals, apply analyst-defined rules, match watchlists, build incident timelines, and show which important data sources need attention.

The new operational data is stored locally under:

```text
project-v-operations-center-v1
```

No new npm dependency was introduced in this phase.

## New modules

### Alert Center

The Alert Center collects:

- Existing Watchtower breaking-news events
- News items already classified as alerts
- Custom alert-rule matches
- Watchlist matches
- Volume-threshold alerts

Each alert records:

- Severity
- Category
- Source
- Detection time
- Source time
- Workspace
- Location, when available
- Open, acknowledged, or resolved state

Available actions:

- Open the original source
- Acknowledge or unacknowledge
- Resolve
- Send the alert to the Event Timeline
- Clear resolved alerts

A new `ALERTS` control appears in the top command bar. It displays the number of open alerts and highlights when high or critical alerts are present. Clicking it opens the Live Ops workspace and reveals the Alert Center.

### Alert Rules

Rules run locally while Watchtower is open.

Supported rule types:

- Keyword match
- Source match
- Hourly headline-volume threshold

Rules can be enabled, disabled, assigned a severity, or deleted.

### Watchlists

Watchlists can track:

- Countries and cities
- Organizations and people
- Military units
- Vessels and aircraft identifiers
- Companies
- Infrastructure
- Conflicts and topics
- Any custom keyword phrase

Watchlists search loaded headline titles, sources, and location labels. Match counts and the latest match time are stored locally.

### Event Timeline

The Event Timeline creates a chronological incident record from:

- Alert Center items
- Manual analyst entries
- Source links
- Analyst notes

Confidence labels include:

- Confirmed
- Unverified
- Disputed
- Analyst observation

The timeline can be exported as Markdown for research, reporting, or later Case Builder integration.

### Source Health

Source Health checks:

- Browser network state
- World-news ingestion and freshness
- Local Ollama connectivity
- NASA FIRMS configuration
- FRED configuration
- Finnhub configuration
- OpenSky configuration
- AIS vessel configuration
- ACLED configuration

It provides direct access to API Keys and can manually refresh the checks.

## Local notifications

Notification preferences are managed inside Alert Rules:

- Enable or disable notifications
- Desktop notifications
- Short alert sound
- Quiet mode
- Minimum severity threshold

Desktop notification permission is requested only when the user explicitly enables desktop notifications.

Notifications and rules operate only while Watchtower is running. A closed-application Windows background service is intentionally deferred to the desktop-hardening phase.

## Workspace integration

The new modules are integrated into the dock system and Module Library:

```text
Alert Center
Alert Rules
Watchlists
Event Timeline
Source Health
```

They support the same controls as other Watchtower modules:

- Dragging
- Collision-safe docking
- Resizing
- Minimizing
- Maximizing
- Hiding and restoring
- Per-workspace persistence

Default placements were added to Watchtower, Live Ops, Intelligence, and Assistant workspaces. Existing saved layouts are preserved. Newly introduced modules inherit the appropriate preset visibility rather than being forced open in every workspace.

## Assistant integration

The local Command Assistant now includes two additional quick actions:

```text
OPERATIONS BRIEF
TIMELINE REVIEW
```

The Assistant can analyze the operational panels whenever they are included in the selected workspace context. Alerts and analyst timeline entries remain explicitly treated as leads or notes rather than automatically becoming confirmed facts.

## Data-refresh integration

When the main news loader completes an update, it emits a local Project V data-update event. The operations engine immediately:

- Rescans alerts
- Applies rules
- Applies watchlists
- Refreshes source health

A twenty-second scan remains as a fallback while Watchtower is open.

## Security and privacy

- Operational state remains in local browser/application storage.
- No cloud account is required.
- Notification permission is opt-in.
- External links are restricted to HTTP and HTTPS.
- Alert fingerprints prevent duplicate entries.
- Volume rules produce one alert per rule per hour rather than flooding the Alert Center.
- Stored lists are capped to prevent unlimited growth.

## Validation performed

- Modified TypeScript files passed syntax transpilation.
- Focused strict TypeScript diagnostics reported no Phase Nine errors.
- A simulated browser harness verified:
  - Built-in alert creation
  - Keyword rules
  - Hourly volume rules
  - Watchlist matching
  - Duplicate suppression
  - Timeline insertion
  - Source-health generation
- CSS brace integrity passed.
- All project JSON files parse successfully.
- ZIP archive integrity was checked after packaging.

A complete Vite production build still requires the project dependencies to be installed on the target machine.

## Run

```powershell
npm install
npm run dev
```

If Phase Eight PDF support was installed separately, confirm it remains present:

```powershell
npm ls pdfjs-dist
```

## Deferred operational additions

The following were intentionally left for later phases or a Phase Nine expansion after the core workflow is proven stable:

- Always-running background alerts while Watchtower is closed
- Mobile push notifications
- Email or Telegram sending
- Person-to-person encrypted messaging
- Cloud synchronization
- Automated external actions
- Full evidence Case Builder
- Scheduled AI briefings while the application is closed
