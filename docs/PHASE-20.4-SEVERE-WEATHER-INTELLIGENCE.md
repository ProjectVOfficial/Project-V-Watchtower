# Project V Watchtower — Phase 20.4
## Severe Weather Intelligence

Phase 20.4 builds on the stable Phase 20.3 Weather Operations workspace without changing the Map 2.0 launch architecture or Air Operations code.

### Added
- Direct NWS alert-detail enrichment with graceful fallback to the existing normalized alert feed.
- Urgency, certainty, status, response type, issuer, effective/onset/end/expiration, and official instructions when supplied.
- Severe-weather machine fields when present in NWS alert parameters, including storm motion, gusts, hail, tornado detection/damage threat, flash-flood damage threat, and waterspout detection.
- Strong selected-alert map highlighting.
- NWS storm-motion map guide when motion metadata exists. The dashed line is a short linear visualization of reported motion, not a forecast cone.
- WATCH LOCATION / WATCH AREA targets, up to 12, stored locally.
- Green map rings for watched weather targets.
- Current surface-wind direction glyph at the selected location.
- Watchtower local weather history, retained for up to 24 hours with up to 144 observations per location.
- Selected-location automatic weather refresh every ten minutes while Weather Ops remains open.
- Local trend summary: temperature delta, pressure direction/delta, peak gust, latest precipitation, and recent observation rows.
- COPY BRIEF for selected locations and active alerts.

### Data integrity behavior
The Weather Ops foundation continues to use the Phase 20.3 forecast/radar/alert sources. Phase 20.4 does not synthesize missing official values. Direct NWS alert detail is optional; if it fails, the normal alert remains available.

Weather history records only values Watchtower actually receives from its configured weather source. It is not a substitute for an official historical observations archive.

### Deferred intentionally
- Tropical Operations / NHC forecast cone and wind-field integration
- Lightning strike layer
- Cross-module Case Desk / Timeline / AI handoffs

Those should be added as separate, testable phases after this severe-weather layer is proven stable.
