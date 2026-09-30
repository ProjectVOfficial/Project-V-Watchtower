# Project V Watchtower — Phase 20.0 Hotfix D

## Airspace focus handoff

The Map 2.0 AIRSPACE action now announces the isolated ADSB.lol window to Watchtower's existing trusted-window focus handoff before the native child window opens.

This preserves the user's `LOCK WHEN WINDOW LOSES FOCUS` security preference for normal external focus changes while preventing the Access Gate from immediately locking the primary Watchtower deck when the operator intentionally moves between Watchtower and the Airspace child window.

The inactivity auto-lock timer is unchanged.
