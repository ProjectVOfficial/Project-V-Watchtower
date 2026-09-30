# Phase 20.5.2 — Windows Production Build Fix

The direct NWS alert fallback introduced two metadata properties (`countryCode` and `source`) on an object typed as the existing `WeatherAlert` interface. That interface does not define those fields, so strict TypeScript production compilation failed with TS2353.

This patch removes those two unsupported properties from the object literal. They were not referenced elsewhere in the weather-operations service and are not required for the alert list, geometry, detail view, filtering, or NWS direct-detail workflow.

No other Watchtower file is changed.
