# Project V Watchtower — Phase 20.2

## Air Operations 2.1

This phase turns the Phase 20.1 Air Operations command surface into a progressive Project V flight-intelligence map.

### Coverage model

**AUTO · PROGRESSIVE** is the default:

- At world zoom, Watchtower uses ADSB.lol's worldwide `mil`, `pia`, and `ladd` feeds. This gives a useful strategic global picture without attempting to tile the entire planet with hundreds of public point queries.
- At regional zoom (3.6+), Watchtower switches to dense live viewport traffic using the existing ADSB.lol regional point-query path with automatic OpenSky fallback when available.
- **WORLD · SPECIAL TRAFFIC** locks the map to worldwide Military / PIA / LADD coverage.
- **REGIONAL · LIVE TRAFFIC** locks the map to dense local/regional traffic and automatically zooms in if needed.
- **ADSB GLOBAL** remains available for the full external tar1090/ADSB.lol worldwide civilian view.

This design intentionally avoids pretending that the public ADSB.lol point API exposes one unrestricted worldwide civilian endpoint. The native Watchtower map is progressive: strategic worldwide at low zoom, dense civilian traffic as the operator zooms into a region.

### Map rendering

Aircraft rendering is moved from one DOM marker per aircraft to a MapLibre GeoJSON source with clustering.

At world/continent zoom, dense aircraft groups collapse into count clusters instead of becoming an unreadable cloud of airplane icons. As the map is zoomed in, the clusters dissolve into individually rotatable aircraft symbols.

Selected aircraft receive a stronger highlight. Watched aircraft and emergency contacts receive their own halos.

### Aircraft intelligence panel

The right-side panel is now collapsible. The selected-aircraft inspector includes collapsible sections for:

- Identity / registration / aircraft type / category
- Position and altitude
- Ground speed and vertical rate
- IAS / TAS / Mach
- True and magnetic heading
- Track rate and roll
- Wind and temperature when present in the feed
- MCP and FMS selected altitude
- Selected heading / QNH / navigation modes
- Signal source / raw source type
- RSSI / message count / last-message age / last-position age
- NIC / radius of containment
- Military / PIA / LADD / interesting database flags

Fields appear as `N/A` when the aircraft does not broadcast them or the provider does not supply them.

### Filters

The FILTERS drawer can filter contacts by current best position/source type:

- ADS-B
- UAT / ADS-R
- TIS-B
- ADS-C
- MLAT
- Mode-S
- Other

Database-flag filters:

- Military
- PIA
- LADD
- Interesting

Altitude minimum / maximum filtering is also included.

No source or database flag selected means no restriction for that group.

### Aircraft trails and follow mode

Watchtower now records a bounded in-memory session trail for aircraft it observes while Air Operations is running. Select an aircraft and use:

- **FOLLOW** to keep the map centered on it as new positions arrive.
- **TRAIL ON / OFF** to show or hide its locally observed session path.

The native trail is deliberately labeled a **session trail**. Historical positions from before Watchtower observed the aircraft are not fabricated. **ADSB DETAIL** opens the selected ICAO address on ADSB.lol for the external route/history experience.

### Existing Watchtower handoffs preserved

Selected aircraft still support:

- Watch / unwatch
- Main Map handoff
- Send to AI
- Add to Case
- ICAO-bound analyst notes

The richer aircraft fields and database/source flags are included in the Air Operations context available to these actions where appropriate.

### Rate-limit behavior

ADSB.lol requests remain serialized and now have one-second spacing. Global special traffic is cached in memory for two minutes. If a provider temporarily rate-limits Watchtower, the last successful contacts remain visible rather than disappearing.

### Development proxy

`vite.config.ts` now permits the additional safe ADSB.lol development-proxy paths used by this phase:

- `/v2/mil`
- `/v2/pia`
- `/v2/ladd`
- `/v2/type/...`

The proxy remains allowlisted rather than acting as a general outbound proxy.
