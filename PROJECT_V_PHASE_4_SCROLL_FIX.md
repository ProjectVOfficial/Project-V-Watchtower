# Project V // Watchtower — Phase Four Scroll Fix

This maintenance patch corrects the dashboard-level scrolling problem visible after the Phase Four docked-grid conversion.

## What caused it

World Monitor locks `html`, `body`, and `#app` to the viewport. The application therefore expects `.main-content` to act as the vertical scrolling surface.

The first Phase Four docked-grid rule changed `.main-content` to `overflow: visible`. The grid could continue below the screen, but the locked outer page had nowhere to scroll. The lower modules existed, yet they could not be reached.

## What changed

The Project V docked workspace now:

- restores vertical scrolling on `.main-content`
- keeps horizontal overflow hidden
- reserves a stable scrollbar gutter
- adds a visible Project V scrollbar at the right edge
- retains the twelve-column collision-safe dock layout
- adds lower padding so the final row is not flush against the viewport edge
- preserves internal panel scrolling for feeds and lists

## Expected behavior

The top command bars remain in place while the dashboard workspace scrolls beneath them. Modules below the map can now be reached with:

- the mouse wheel while the pointer is outside a map interaction area
- the right-side workspace scrollbar
- Page Up, Page Down, Home, and End
- a touchpad two-finger scroll

The map still keeps its own wheel interaction for zooming when the pointer is directly over it.

## File changed

```text
src/styles/project-v-theme.css
```

## Run

```powershell
npm install
npm run dev
```

No layout reset is required. Existing Phase Four workspace positions remain intact.
