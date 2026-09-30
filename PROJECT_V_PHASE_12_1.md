# Project V Watchtower — Phase 12.1

## Case Desk local-AI hotfix

Phase 12.1 fixes a desktop-window initialization issue affecting the Case Desk and Data Desk local-AI tools.

### Root cause

Each Tauri workspace window runs in its own JavaScript context. The main Watchtower and Assistant windows loaded the desktop credential vault, but the Case Desk and Data Desk did not. Their AI requests therefore waited indefinitely for the Ollama configuration readiness signal, leaving the output area blank.

### Changes

- Case Desk initializes desktop secrets when its window starts.
- Data Desk initializes desktop secrets when its window starts.
- Case analysis shows a visible connecting state instead of an empty panel.
- Case analysis displays useful errors and empty-response guidance.
- Added an **API KEYS** shortcut beside **ANALYZE CASE**.
- Stop behavior displays a clear stopped state.

### Run

```powershell
npm install
npm run desktop:dev
```

Confirm Ollama is running and that `OLLAMA_API_URL` and `OLLAMA_MODEL` are configured under **API KEYS**.
