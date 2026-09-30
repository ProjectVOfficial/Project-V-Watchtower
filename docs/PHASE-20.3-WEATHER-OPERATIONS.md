# Project V Watchtower — Phase 20.3 Weather Operations Foundation

Phase 20.3 begins the dedicated Weather Operations system while preserving the confirmed Phase 20.2.8 Air Operations runtime.

## Design

The primary Map 2.0 remains a situational hub. It gains a small `WX` filter and `WX OPS` launcher rather than embedding a large weather suite into the normal map.

`WX OPS` opens a dedicated command surface with three operating regions:

- Selected Location / Weather Intelligence
- Central Weather Map
- Active Weather / Alert Intelligence

A fixed Analyst Notes row remains visible at the bottom.

## Data paths

- Existing Watchtower weather alerts continue to use the current `fetchWeatherAlerts()` service.
- Open-Meteo supplies current conditions plus hourly and daily forecasts for a selected coordinate.
- RainViewer supplies radar timeline metadata and tiled radar imagery.

## Radar behavior

Weather Operations requests the RainViewer map manifest, uses the most recent available past-radar frame by default, and exposes previous/next, scrubber, playback, visibility, opacity, and timed refresh controls.

## Alert behavior

Active NWS alerts are sorted by severity and expiration. Where polygon coordinates are available, Weather Operations renders them on the map; otherwise a centroid point can be used. Alert filtering supports All, Extreme, Severe, and Moderate.

## Location intelligence

A location can be selected by:

- map click
- city/region search
- direct `latitude,longitude`

The left rail then shows current conditions, a 12-hour view, and a 7-day outlook.

## Local notes

Location-bound notes use:

`project-v-weather-operations-notes-v1`

They stay local in Watchtower storage and use rounded coordinates as the note key.

## Intentionally deferred

- Lightning observations
- Tropical cyclone / hurricane track intelligence
- Air quality / smoke
- Dedicated global warning feeds beyond the existing NWS layer
- Weather-to-Case / Timeline handoff
- AI weather briefing and natural-language map queries

These can be added after the Phase 20.3 foundation survives desktop development testing.
