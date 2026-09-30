# Project V Watchtower — Phase 20.0 Map 2.0 Foundation

Phase 20.0 begins the native situational-awareness map upgrade without replacing the existing map engine.

## Included

- Compact **MAP 2.0 // SITUATIONAL DECK** overlay on the desktop DeckGL map.
- Operational quick filters:
  - ALL
  - CRISIS
  - MILITARY
  - AIR
  - INFRA
  - CYBER
- Named saved map views with local persistence.
- Saved views preserve center, zoom, tactical/satellite basemap, time range, map-layer state, and Live Air state.
- Native **Live Air** layer backed by Watchtower's existing OpenSky relay.
- Visible-region-only state-vector requests.
- Opt-in aircraft polling with a quota-aware cadence.
- Aircraft heading markers and local track trails.
- Persistent aircraft watchlist.
- Aircraft inspector with altitude, speed, heading, vertical rate, squawk, and airborne/ground state.
- Aircraft actions:
  - FOLLOW
  - TRACK
  - WATCH
  - INTEL
  - ADD TO CASE
- `project-v-map2-focus` event hook for later alerts/news/intelligence → map focusing.

## Architecture

The OpenSky provider is not embedded in a remote webpage. The map requests data through the existing Watchtower relay route and renders aircraft as native deck.gl layers. Live Air is off unless the analyst enables it, and it does not fetch while disabled.

Normal polling is intentionally conservative. The visible region is refreshed approximately every two minutes, with a thirty-second cadence only while following a selected aircraft. Map movement is rate-limited by the same thirty-second floor.

## Deferred Map 2.0 work

This foundation leaves room for later expansion after real-world testing:

- high-density aircraft clustering
- replay/historical track integration when provider access permits
- richer alert/news/case focus handoffs
- maritime live-follow parity
- provider health/remaining-credit indicators when the relay exposes them
- more advanced saved-view management
