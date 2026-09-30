# Project V Watchtower — Phase 20.7.1 Sentinel Diagnostic

Incremental patch over Phase 20.7.

## New TEST control

Each Phoenix Sentinel row in `MODULES → WATCHLISTS → PHOENIX SENTINELS` now includes `TEST`.

Pressing TEST injects one synthetic, unique, CRITICAL headline through the same Sentinel matching path used by newly loaded Watchtower headlines. If the Sentinel matches, Watchtower:

1. increments that Sentinel's match counter;
2. creates a `PHOENIX SENTINEL` operational alert;
3. sends the alert through the paired Phoenix receiver.

The synthetic item is clearly labeled as a Sentinel test signal and uses `example.invalid`; it is not presented as a real-world event.

The CRITICAL test severity is deliberate so the diagnostic can pass any configured Sentinel threshold from WATCH+ through CRITICAL+.
