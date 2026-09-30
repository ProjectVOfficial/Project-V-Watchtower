# Phase 20.5.3 — Windows Production Air Feed Repair

## Problem

Air Operations succeeded under `npm run desktop:dev` but failed in compiled Windows builds with `Failed to fetch` and zero contacts.

## Cause

The Air Operations service used the Vite-only `__adsb_lol` proxy during development and switched to a direct `https://api.adsb.lol` WebView request in production. The production WebView therefore bypassed Watchtower's existing local API sidecar and could fail on the browser/WebView cross-origin boundary.

## Repair

The packaged Tauri runtime now requests ADSB.lol through:

```text
Air Operations
  -> /api/local-adsb-lol?path=...
  -> Watchtower local sidecar
  -> https://api.adsb.lol
```

Development continues to use the existing Vite proxy:

```text
Air Operations
  -> /__adsb_lol/...
  -> Vite dev proxy
  -> https://api.adsb.lol
```

Normal web builds retain the direct provider route.

The new local sidecar handler is intentionally narrow and read-only. It accepts only the ADSB.lol endpoints used by Air Operations and validates point coordinates/radius before making the upstream request.
