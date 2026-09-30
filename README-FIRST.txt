PROJECT V WATCHTOWER — PHASE 20.5.4
AIR OPERATIONS MAP NAVIGATION + SELECTED AIRCRAFT VISIBILITY REPAIR

Baseline:
- Install on top of the current Phase 20.5.3 Windows Air Feed Production Repair.
- Keep application version unchanged.

CHANGED FILES
- src/components/AirOperationsPanel.ts
- src/styles/air-operations.css

WHAT THIS FIXES
- Explicitly re-enables MapLibre scroll-wheel, drag-pan, double-click zoom, and touch zoom handlers.
- Stops the enclosing Watchtower deck from also consuming wheel events while the pointer is over the Air Ops map.
- Adds MAP -, MAP +, and WORLD VIEW toolbar controls so the map can always be recovered without the mouse wheel.
- Reduces the aggressive auto-zoom when selecting a contact.
- LOCATE now uses a context-preserving zoom instead of forcing zoom 8+.
- Adds a DOM-based crosshair anchor for the selected aircraft so its chosen position remains visible even if the symbol layer is delayed or degraded.
- Re-renders retained/cached aircraft into the map after a provider/rate-limit failure.

INSTALL
1. Close Watchtower and stop npm run desktop:dev.
2. Drag the included src folder into the Watchtower project root.
3. Merge/replace the two matching files.
4. Run npm run desktop:dev first.
5. Open AIR OPS.
6. Click WORLD VIEW. Confirm the global map returns.
7. Use MAP - and MAP +. Confirm zoom works.
8. Select a contact and click LOCATE. Confirm the crosshair appears and the map centers with geographic context.
9. Once dev passes, rebuild with npm run desktop:build:full and retest the raw EXE / NSIS / portable editions.
