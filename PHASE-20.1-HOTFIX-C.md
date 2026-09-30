# Project V Watchtower — Phase 20.1 Hotfix C

## Air Operations command view

`AIR OPS` now opens the existing Air Operations panel as a focused, full command surface inside Watchtower. The normal Live Ops workspace remains the host workspace, but it is no longer necessary to scroll down the page to use Air Operations.

The focused surface can be closed with **RETURN TO DECK**, **Escape**, or by navigating to another main deck.

## Module Library

When **AIR OPERATIONS MAP** is already docked, its Module Library card now receives an explicit **OPEN** action. **REMOVE** is preserved.

## Aircraft feed resilience

Air Operations now requests aircraft through the existing `auto` provider path rather than forcing ADSB.lol for every refresh.

ADSB.lol regional requests are serialized rather than burst in parallel. When HTTP 429 is returned, the provider enters a temporary cooldown. If some regional queries have already succeeded, those contacts are retained as a partial result. If the live refresh fails after a prior successful set, the last contacts remain on-screen and are marked as cached/last-known.

The Air Operations automatic refresh interval is 45 seconds.

## Preserved fixes

This package uses the Hotfix B `panel-layout.ts`, so the permanent **EDIT DECK / LOCK DECK** control remains beside **LAYOUT**.
