# Project V Watchtower — Phase Seven

## Local AI Command Assistant

Phase Seven adds an interactive, local-first command assistant built around the existing Ollama configuration. It does **not** replace the existing AI Insights, Strategic Risk, or Strategic Posture panels. Instead, it can use those panels as context and compare their generated conclusions against visible news and intelligence modules.

## What was added

### Dedicated Assistant workspace

The previously reserved **ASSISTANT** navigation item is now a functioning workspace with a default command layout:

- V // Command Assistant
- AI Insights
- Strategic Risk
- AI Strategic Posture
- World map
- Intel Feed
- Live Intelligence
- Country Instability

The workspace remains compatible with the Phase Four/Five dock engine, presets, drag-and-drop movement, resizing, hidden modules, custom desks, export, and import.

### V // Command Assistant panel

The new core module provides:

- Streaming local chat through Ollama's native chat API
- OpenAI-compatible local endpoint fallback for LM Studio and similar servers
- Persistent local conversation history
- Stop-generation control
- Markdown response rendering with HTML sanitization
- Local model connection testing
- Direct access to the API Keys screen
- Four analyst shortcuts:
  - Brief Desk
  - Risk Review
  - Check AI Insights
  - Top Five

### Selectable context

The analyst can choose how much Watchtower data is sent to the configured local model:

- **Current Workspace** — visible panels, map state, and recent headlines
- **Visible Panels** — only currently visible module text
- **AI Insights + Risk** — AI Insights, Strategic Risk, Strategic Posture, and Country Instability
- **No Panel Context** — conversation only

Context is labeled as `S1`, `S2`, and so on. The assistant's system instructions require the model to cite those labels, distinguish generated assessment from confirmed information, expose contradictions, and avoid inventing sources.

### AI Insights integration

The existing AI Insights panel remains a concise automated briefing module. The new assistant can:

- Read the AI Insights summary
- Compare it against underlying visible panels
- Identify unsupported statements or contradictions
- Explain what appears confirmed versus inferred
- Suggest what should be verified next

AI Insights is explicitly treated as an **unverified analytical lead**, not a source of record.

## Local AI configuration

Open **API KEYS** and configure:

```text
OLLAMA_API_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<an installed model name>
```

The assistant supports both:

```text
/api/chat
```

and OpenAI-compatible:

```text
/v1/chat/completions
```

The web Content Security Policy now permits connections to local `localhost` and `127.0.0.1` ports for Ollama or another local model server.

If a browser reports a CORS error, the local model server must allow the Watchtower origin. The desktop build avoids most normal browser-origin limitations, but the model server still has to be running and reachable.

## Privacy model

- Conversation history is stored in local browser/application storage.
- Panel context is sent only to the locally configured endpoint.
- No cloud provider is used by the Command Assistant.
- The existing AI Insights pipeline may still use its separately enabled summarization providers.
- API keys are not included in assistant prompts.
- The assistant cannot access local files, email, Project V Browser data, or plugin data unless a later phase explicitly grants that capability.

## New storage keys

```text
project-v-command-assistant-history-v1
project-v-command-assistant-scope-v1
```

Workspace layouts continue using the Phase Five workspace store:

```text
project-v-workspaces-v4
```

## Files added

```text
src/components/CommandAssistantPanel.ts
src/services/local-ai-command.ts
src/services/command-context.ts
PROJECT_V_PHASE_7.md
```

## Main files updated

```text
index.html
src/app/deck-workspaces.ts
src/app/panel-layout.ts
src/components/index.ts
src/config/panels.ts
src/styles/project-v-theme.css
```

## Validation completed

- Modified TypeScript files passed syntax transpilation checks.
- No Phase Seven diagnostics appeared during the targeted strict check; unrelated errors were caused by unavailable third-party type packages in this environment.
- A mock local server confirmed:
  - Ollama model discovery
  - Native Ollama NDJSON streaming
  - OpenAI-compatible SSE streaming
- Context tests confirmed:
  - Current-workspace collection
  - AI Insights-only filtering
  - News source labeling
  - No-context mode
- All JSON files were parsed.
- The final ZIP passed archive-integrity testing.

## Run

```powershell
npm install
npm run dev
```

Then open **ASSISTANT** in the top navigation and use **TEST LOCAL AI**.

## Next planned phase

Phase Eight will add local document intelligence and memory, including PDF/text ingestion, a research library, retrieval into the assistant, source excerpts, and citation-aware document answers.
