# Project V Watchtower — Phoenix 0.9.8 Bridge Update

Copy these files over the current Watchtower 1.1.0-1 source tree, preserving paths.

Changed application files:

- `src/services/phoenix-bridge.ts` (new)
- `src/services/operations-center.ts`
- `src/components/OperationsPanels.ts`
- `src/styles/project-v-theme.css`
- `src-tauri/src/main.rs`

The update sends each newly-created Watchtower Operational Alert to the authenticated Phoenix Desktop 0.9.8 loopback receiver. Phoenix is optional: offline delivery is queued and retried without blocking Watchtower.

The pairing token is stored in the existing Watchtower OS-backed secret vault. The endpoint is restricted to loopback HTTP and `/api/watchtower/alert`.

## Validation

Run:

```powershell
npm run typecheck
```

Stop if it fails. Then use the normal desktop test/build flow.
