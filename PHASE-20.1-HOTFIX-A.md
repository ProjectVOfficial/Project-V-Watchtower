# Project V Watchtower — Phase 20.1 Hotfix A
## Air Operations visibility + Map 2.0 control collision

Fixes two issues observed after the Phase 20.1 Air Operations Desk patch:

1. **AIR OPS opened Live Ops but the Air Operations module stayed hidden**
   - Air Operations is now enabled at the interface layer.
   - The AIR OPS open handler explicitly satisfies both interface visibility and workspace visibility before scrolling to the module.
   - The existing Live Ops workspace remains the host desk; the dedicated Air Operations module appears inside it as intended.

2. **Map 2.0 situation controls collided with the 1h / 6h / 24h / 48h / 7d / ALL strip**
   - The two control groups now have separate default rows.
   - The Map 2.0 situation deck can be dragged by the **MAP 2.0 / SITUATIONAL DECK · DRAG** brand area.
   - The dragged position is remembered locally.
   - Double-click the brand area to reset it to the default row.

No Air Operations data model, ADSB.lol normalization, notes, watchlist, Assistant handoff, or Case Desk handoff behavior is removed.
