# Project V Watchtower — Phase 20.4.1

## Weather Alert Feed Repair

Phase 20.4.1 fixes a failure mode where Weather Operations could display `0 ALERTS` together with `PARTIAL · 1 SOURCE ERROR` even while other Weather Ops providers continued working.

The existing `fetchWeatherAlerts()` path is retained first for compatibility with Watchtower's inherited normalized/bootstrap data. When that path fails or yields an empty circuit-breaker fallback, Weather Operations now performs an independent read of the official NWS active-alert GeoJSON endpoint.

### Direct fallback behavior

- Endpoint: `https://api.weather.gov/alerts/active?status=actual`
- Accepts GeoJSON/JSON.
- Normalizes event, severity, headline, description, affected area, onset, expiration, geometry and centroid into the existing `WeatherAlert` type.
- Handles Polygon and MultiPolygon alert geometry.
- Alerts without geometry still remain available in the alert list and detail panel.
- A successful direct response is retained in memory for up to 30 minutes and can be used only if a later direct request fails.

### Safety / compatibility

No version metadata, Air Operations code, dock layout, Weather Operations UI layout, radar logic, forecast logic, or analyst-note storage is changed.

### Validation

- TypeScript ES2020 target
- `strict: true`
- `noUncheckedIndexedAccess: true`
- No `.at()` usage
- ZIP integrity test
