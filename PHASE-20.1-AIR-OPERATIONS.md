# Project V Watchtower — Phase 20.1
## Air Operations Desk

Phase 20.1 introduces a Project V-native aircraft workspace without replacing the primary Watchtower Map 2.0.

### Included

- New **AIR OPERATIONS MAP** core module under the module library
- New **AIR OPS** action on the Map 2.0 command strip
- Purpose-built MapLibre aircraft map using Watchtower styling
- ADSB.lol regional live-air feed normalized through the existing Map 2.0 aircraft model
- Vite development proxy for ADSB.lol to avoid WebView/browser cross-origin failures during `desktop:dev`
- 30-second auto refresh plus manual refresh
- Aircraft map markers rotated by heading and colored by altitude/status
- Contact list and callsign/ICAO/registration search
- Filters for ALL, AIRBORNE, EMERGENCY, and WATCHED
- Aircraft inspector with registration, type, altitude, speed, heading, vertical rate, squawk, and status
- Persistent per-aircraft analyst notes
- Watchlist integration
- `MAIN MAP` handoff to Map 2.0
- `SEND TO AI` handoff to the Project V local Assistant
- `ADD TO CASE` handoff to Case Desk with aircraft metadata
- `ADSB.LOL` fallback action to the isolated worldwide Airspace window

### Architecture

The main Watchtower map remains the strategic situational picture. Air Operations is a specialized aviation module. This prevents large, fast-moving aircraft datasets from crowding the primary intelligence map while still allowing aircraft observations to enter Watchtower workflows.

During development, requests to ADSB.lol use a narrow Vite proxy path (`/__adsb_lol`) that only allows recognized read-only aircraft endpoints. This phase intentionally does not add a new Tauri/Rust dependency.

### Deferred to Phase 20.2

- Production/native sidecar aircraft proxy
- Global military-only feed and advanced aircraft classification
- Flight tracks/history persistence
- Timeline handoff and alert rules
- Multi-provider failover beyond the existing Map 2.0 provider abstraction
- Rich route/airport enrichment
