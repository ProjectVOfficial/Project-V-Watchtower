# Project V Watchtower — Phase 10.1

## Communications Dock and Project Lock repair

This maintenance release builds on Phase Ten. It adds an optional native communications dock inside the Communications Wall panel and repairs the auto-lock overlay so the command-deck lock screen remains visible instead of leaving a black viewport.

## Native communications dock

The Communications Wall now offers three launch paths:

- **DOCK** — in the Tauri desktop application, place an approved remote service in a child WebView2 viewport aligned with the Communications Wall panel.
- **OPEN WINDOW** — open the service in a separate restricted Project V webview window.
- **EXTERNAL** — open the service in the system browser.

Supported built-in dock services:

- Google Voice
- Discord
- Google Messages
- Telegram Web
- Slack
- Microsoft Teams

The dock tracks the panel while the page scrolls and while the panel is resized. It automatically hides while:

- Project Lock is active
- Edit Deck mode is active
- the panel is outside the visible viewport
- the application tab is hidden

The remote child webview has no matching Tauri capability and therefore receives no Watchtower IPC permission. The trusted main webview keeps the existing `core:default` capability.

### Browser development mode

When running `npm run dev`, the Communications Wall shows **TRY IFRAME** rather than the native dock. This is a compatibility fallback only. Many communication providers prevent iframe embedding or embedded sign-in. Use the desktop runtime for the real dock:

```powershell
npm run desktop:dev
```

A Google account may still reject sign-in inside an embedded user agent. In that case, use **OPEN WINDOW** or **EXTERNAL**. The provider controls this behavior.

## Project Lock repair

The lock overlay is now moved to a top-level body portal before locking. This avoids clipping and stacking problems caused by the viewport-locked application container.

The repaired lock flow now:

- displays `PROJECT V // WATCHTOWER`
- displays `COMMAND DECK LOCKED`
- preserves PIN unlock behavior
- hides the native communications dock
- restores the dock only after the deck is unlocked and visible
- recreates the lock overlay if it is ever missing from the DOM

## Desktop implementation notes

Phase 10.1 enables Tauri's `unstable` feature for multiwebview support and adds these commands:

```text
open_communications_dock
update_communications_dock
hide_communications_dock
reload_communications_dock
close_communications_dock
```

The child webview is limited to the existing approved communications host list.

## Files changed

```text
src/components/CommunicationsWallPanel.ts
src/services/communications-center.ts
src/app/security-center.ts
src/styles/project-v-theme.css
src-tauri/src/main.rs
src-tauri/Cargo.toml
src-tauri/capabilities/default.json
```

## Running

Browser development:

```powershell
npm install
npm run dev
```

Desktop development with native communications docking:

```powershell
npm install
npm run desktop:dev
```

## Validation performed

- Modified TypeScript files passed syntax transpilation.
- Project JSON files parsed successfully.
- Communications hosts remain allowlisted in both TypeScript and Rust.
- The remote dock does not match a Tauri capability.
- The lock overlay is portaled outside `#app` and is forced visible while locked.
- Archive integrity was checked after packaging.

A Rust compiler was not available in the packaging environment, so the new multiwebview Rust commands must be compiled and tested on the Windows development machine before distribution.
