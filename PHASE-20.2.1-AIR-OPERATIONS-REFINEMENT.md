# Project V Watchtower — Phase 20.2.1
## Air Operations Refinement

This overlay refines the Phase 20.2 Air Operations 2.1 implementation after live desktop testing.

### Changes

- Restores the draggable Map 2.0 Situational Deck.
  - The time-range strip remains on its own row.
  - Drag the `MAP 2.0 // SITUATIONAL DECK · DRAG` brand block to move it.
  - The position is stored locally.
  - Double-click the drag block to reset it to the default position.
- Strengthens aircraft selection.
  - Selected aircraft receives a large high-contrast targeting ring.
  - Selected callsign/identity is displayed directly over the aircraft.
  - Contact-list selection is more visible and includes registration/ICAO context.
  - `LOCATE` recenters on the selected aircraft.
- Adds conservative visual position smoothing.
  - Watchtower still fetches authoritative feed positions on the existing feed cadence.
  - Between reports, airborne aircraft may be visually dead-reckoned for no more than 20 seconds using the last reported speed and heading.
  - Smoothed positions are display-only and are never written into the observed trail/history.
- Expands local trail/history feedback.
  - Local aircraft observations are retained for up to three hours while the Air Operations panel is alive.
  - Up to 160 distinct reported positions are retained per aircraft.
  - `LOCAL FLIGHT HISTORY` reports observed point count, duration, approximate traveled distance, first observation, and last observation.
  - `HISTORY` opens the local history section.
  - If only one point exists, the UI explicitly explains that a trail cannot be drawn until a second distinct report is received.
- Makes degraded ADS-B operation less alarming.
  - Rate limiting with retained contacts now shows a cached/degraded state instead of a red fatal-looking status.
  - ADSB.lol regional requests are spaced slightly farther apart and the default cooldown is longer.
  - Worldwide special-aircraft results remain cached longer to reduce unnecessary requests.
- Reinforces the Air Operations Module Library entry.
  - Air Operations is forced enabled at the interface layer when the command surface is opened.
  - The Module Library is repaired when stale UI state reports `DISABLED IN INTERFACE SETTINGS`.
  - An `OPEN` action is restored/added to the Air Operations module card.

### Important history limitation

`LOCAL FLIGHT HISTORY` is Watchtower-observed history, not a claim to reproduce the complete historical ADSB.lol/tar1090 track archive. `ADSB DETAIL` remains the long-range external history/detail fallback.

### Validation performed

- TypeScript syntax/transpile validation passed for all modified TypeScript files.
- CSS brace validation passed for both modified/imported stylesheet files.
- The overlay was reviewed against the Phase 20.2 package and the Phase 20.1 Map 2.0 drag/focus hotfixes to preserve those fixes.

A full application build was not run because the complete Watchtower repository and installed dependency tree are not part of this overlay package.
