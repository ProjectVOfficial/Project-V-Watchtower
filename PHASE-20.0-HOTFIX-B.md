# Project V Watchtower — Phase 20.0 Hotfix B

## Multi-Provider Live Air

This patch replaces the OpenSky-only Map 2.0 live-air path with a provider-independent implementation.

### Provider order

`AUTO` is the default:

1. **ADSB.lol** — primary live aircraft provider, queried directly from the public v2 point API.
2. **OpenSky** — retained as the existing Watchtower relay fallback when that runtime feature is available.

The Map 2.0 toolbar now includes a provider selector:

- `AUTO · ADSB.LOL`
- `ADSB.LOL`
- `OPEN SKY`

The preference is stored locally and is also saved with Map 2.0 saved views.

### ADSB.lol regional coverage

The public point API accepts a center coordinate and radius up to 250 nautical miles. Watchtower divides the visible regional map into at most a 3x3 grid of point queries, deduplicates aircraft by ICAO hex, and renders the combined result.

To avoid excessive public API traffic, ADSB.lol mode requires map zoom 5 or greater. Normal refresh is approximately 30 seconds; following an aircraft refreshes approximately every 15 seconds, with a 10-second hard minimum between refresh starts.

### Aircraft metadata

When ADSB.lol supplies the fields, the inspector can now show:

- callsign
- ICAO hex
- registration
- aircraft type
- barometric/geometric altitude
- groundspeed
- track/heading
- vertical rate
- squawk
- aircraft category
- emergency status

Case Desk and Assistant handoffs now preserve the active provider and the extra aircraft metadata.

### Data attribution

ADSB.lol states that its public API/data is available under the Open Data Commons Open Database License (ODbL) v1.0. Watchtower identifies ADSB.lol in the aircraft inspector when it is the active source.

### Deferred providers

ADS-B Exchange and FAA/NAS/SWIM are not implemented in this patch. The provider layer is now separated so they can be added later without rebuilding the map rendering system.
