# Project V Watchtower — Phase 20.7 Phoenix Sentinel Monitoring

Phase 20.7 extends the working Phase 20.6 Phoenix AI bridge without changing its native pairing contract or Rust/Tauri credential handling.

## What changes

### Map signal actions
The built-in Watchtower map popup now adds:

- `SEND TO PHOENIX` — one-time structured handoff of the selected map signal.
- `WATCH WITH PHOENIX` — creates a persistent Phoenix Sentinel monitor from the selected signal.

The existing `TIMELINE`, `CREATE ALERT`, `ADD TO CASE`, and `ASK LOCAL AI` actions remain unchanged.

### Alert Center
Every operational alert now has both:

- `PHOENIX` — one-time manual handoff.
- `SENTINEL` — arm a persistent monitor using terms derived from that alert.

### Watchlists module
The existing `WATCHLISTS` panel now contains a `PHOENIX SENTINELS` section. No new dock panel is introduced.

A Sentinel has:

- name
- monitor terms
- enabled/disabled state
- minimum incoming Watchtower severity (`WATCH+`, `ELEVATED+`, `HIGH+`, `CRITICAL+`)
- match count
- last match time/title

Sentinels can also be created manually in the Watchlists module.

## Monitoring behavior

Watchtower already scans newly loaded headlines while the application is running. Phase 20.7 attaches Sentinel matching to that existing scan path instead of starting another polling system.

When a newly loaded headline matches an enabled Sentinel:

1. Watchtower creates a local operational alert with category `PHOENIX SENTINEL`.
2. That alert remains visible in Alert Center.
3. Watchtower sends the alert directly to the paired Phoenix receiver, even when the global Phoenix auto-forward threshold is higher than the headline severity.
4. Phoenix can then notify, speak, store, and reason over the received alert using the existing 0.9.8a/0.9.8b Watchtower inbox context.

Existing matching headlines are primed as already seen when a Sentinel is armed, enabled, or has its threshold changed. This prevents an immediate backlog flood.

## Safety / scope

- No dependency changes.
- No `src-tauri` / Rust changes.
- No changes to the Phase 20.6 credential vault or receiver token.
- Existing alert rules, watchlists, timelines, cases, layouts, and notification preferences are preserved.
- Sentinel state is stored inside the existing `project-v-operations-center-v1` local record as an additive field.
- A duplicate Sentinel with the same name and terms is re-enabled rather than duplicated.

## Current limits

- Sentinel monitoring runs while Watchtower is open. It is not a Windows background service.
- Phase 20.7 uses term/location/category correlation against newly loaded Watchtower headlines. It is not yet semantic/vector AI correlation.
- If Phoenix is offline when a Sentinel match occurs, the Sentinel alert remains in Watchtower Alert Center. Use its `PHOENIX` button after Phoenix reconnects; automatic retry is deferred.
- The source headline remains unverified unless separately corroborated.

## Suggested first test

1. Start Phoenix and Watchtower desktop development mode.
2. Confirm `V -> PROJECT V BRIDGE -> PHOENIX AI` shows `PAIRED / ONLINE`.
3. Click the Ukraine conflict area on the Watchtower map.
4. Click `WATCH WITH PHOENIX`.
5. Open `WATCHLISTS` and confirm a Phoenix Sentinel was added with terms such as `ukraine`, `donetsk`, and `luhansk` when available.
6. Confirm Phoenix receives a low-priority `Phoenix Sentinel armed` message.
7. Leave Watchtower running. A future newly loaded matching headline should create a `PHOENIX SENTINEL` alert and be sent to Phoenix.
8. In Phoenix Chat ask: `What did the Ukraine Sentinel just detect?`

