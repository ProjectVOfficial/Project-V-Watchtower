# Project V Watchtower — Phase 20.0 Hotfix A

## Live aircraft route fix
The Vite OpenSky proxy targets `https://opensky-network.org/api`. The live-air
client now requests `/api/opensky/states/all`, allowing the proxy rewrite to
resolve the official `/states/all` endpoint instead of the API root.

The request also adds `extended=1` so the optional OpenSky aircraft category is
available to the inspector.

## ADS-B-style rendering
Live aircraft are now rendered with a top-down plane silhouette rather than a
text glyph. Markers rotate with true track and use an altitude palette inspired
by dense flight-tracking maps.

The data source remains OpenSky, so this changes the Watchtower visualization,
not the underlying coverage network.
