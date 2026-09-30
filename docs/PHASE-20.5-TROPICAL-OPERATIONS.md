# Project V Watchtower — Phase 20.5

## Tropical Operations

Phase 20.5 adds a dedicated Tropical Operations workspace launched from Weather Operations. It uses the NOAA/NWS National Hurricane Center and Central Pacific Hurricane Center tropical GIS summary service.

### Included operational layers

- Active tropical cyclone forecast points
- Forecast track
- NHC forecast cone
- Past/best track points and line
- Forecast wind radii
- Advisory wind field
- Tropical cyclone coastal watch/warning geometry when published
- Seven-day tropical development outlook points and potential-development regions

### Workspace

Weather Operations receives a **TROPICAL OPS** action. Tropical Operations opens over Weather Operations without changing the main Watchtower panel layout.

The Tropical workspace includes:

- Active cyclone list
- Seven-day tropical-development list
- Official NHC map layers
- Selected-system intensity and movement summary
- Forecast-point table
- OUTLOOK / CONE / WIND visibility controls
- Fit-to-active control
- Copy Brief
- Locally stored analyst notes
- Return to Weather Operations

### Data behavior

The NHC summary MapServer is queried as GeoJSON. Each individual layer is isolated so one unavailable product does not erase the other tropical products. The workspace reports a partial-source state when one or more NHC layers fail.

Data is cached for 15 minutes and the open Tropical Operations workspace refreshes every 15 minutes. Manual refresh remains available.

### Boundaries

Phase 20.5 intentionally does not add AI analysis, storm-surge inundation, probabilistic wind grids, or historical HURDAT track search. Those can be layered in later after the basic tropical command view is proven stable.
