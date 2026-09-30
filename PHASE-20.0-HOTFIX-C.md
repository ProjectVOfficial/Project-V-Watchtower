# Project V Watchtower — Phase 20.0 Hotfix C

## Worldwide Airspace window

This hotfix adds an **AIRSPACE** control to the Map 2.0 situational deck.

- Desktop/Tauri: opens `https://adsb.lol/` through Watchtower's existing restricted Source Browser window command.
- Browser development: opens ADSB.lol in a separate browser window/tab.
- The remote aircraft site is not embedded into Watchtower's trusted map DOM.
- The existing native Live Air provider selector remains available for future work.
- Selecting the `AIR` situational filter no longer automatically enables the experimental native Live Air feed; Live Air is now explicitly opt-in via the `LIVE AIR` button.

This provides immediate access to ADSB.lol's full worldwide aircraft visualization while keeping Watchtower's own map focused on intelligence overlays and cross-linked operational data.
