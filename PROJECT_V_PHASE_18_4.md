# Project V Watchtower — Phase 18.4

## Trusted workspace lock hotfix

This patch fixes trusted Project V windows opening behind the **COMMAND DECK LOCKED** overlay while the primary Watchtower window is otherwise usable.

### Cause

Two lock-state edge cases could affect Launch Desk and the other separate Project V workspaces:

1. A previously closed locked session could leave a stale `project-v-command-lock-v1` record in local storage.
2. When **Lock when window loses focus** was enabled, opening a trusted Project V child window transferred focus away from the command deck and was mistakenly treated like leaving Watchtower for an outside application.

### Changes

- The primary Watchtower window now clears stale child-window lock state during startup.
- Opening Case Desk, Data Desk, Map Desk, Assistant, Analysis Room, Launch Desk, Camera Wall, or OSINT Desk announces an intentional trusted-window focus transfer.
- Project Lock ignores that short intentional focus transfer.
- Manual lock, inactivity lock, PIN unlock, and lock broadcasts to all separate Project V windows remain active.
- Trusted workspace windows still display the lock screen whenever the primary command deck is genuinely locked.

### Run

No dependency changes were made.

```powershell
npm run desktop:dev
```

If a child window from the previous session is still open, close it once and reopen it after the patched primary Watchtower window has started.
