# Project V Watchtower — Phase Sixteen

## Local Multi-Agent Research

Phase Sixteen adds a separate **Project V // Analysis Room** for coordinated, source-aware research using the configured local Ollama model.

Open it from:

- Top command bar → **ANALYSIS ROOM**
- **MODULES → AI → AI RESEARCH LAB**
- Command Assistant → **ANALYSIS ROOM**
- Voice command: **Open Analysis Room**

## Analyst roles

A mission can use these local specialist roles:

1. **Collector** — extracts relevant signals and builds an evidence ledger.
2. **Verifier** — tests claims against supplied sources and records confidence and gaps.
3. **Timeline Analyst** — reconstructs chronology and flags temporal conflicts.
4. **Contradiction Analyst** — finds incompatible accounts, circular sourcing, and unsupported leaps.
5. **Geospatial Analyst** — reviews locations, routes, map layers, geofences, and geographic uncertainty.
6. **Briefing Officer** — synthesizes the specialist outputs into the final assessment.

The Briefing Officer is always included. Other specialist roles can be enabled or disabled per mission.

## Mission context

Each mission can use:

- Current Watchtower workspace
- Visible panels
- AI Insights and strategic-risk modules
- Research Library results
- Workspace plus Research Library
- No Watchtower context
- Optional live-source refresh before collection
- An attached Case Desk investigation

The primary Watchtower window must remain open when a separate Analysis Room requests live workspace context.

## Case Desk integration

An open Case Desk investigation can be attached to a mission. Its evidence items are added to the source snapshot using the same `[S#]` labeling system.

After the run, **SEND REPORT TO CASE** stores the final briefing as an analyst note. Agent outputs do not silently convert unverified evidence into confirmed facts.

## Mission controls

The Analysis Room supports:

- Persistent mission queue
- Mission title and question editing
- Agent selection
- Start, stop, and rerun
- Per-agent streaming output
- Saved source excerpts and URLs
- Markdown export
- Local AI connection testing
- Direct API Keys access
- Project Lock protection

Mission data is stored locally under:

```text
project-v-multi-agent-research-v1
```

It is included in Phase Ten Project V backups because the backup system automatically captures `project-v-*` local-storage records.

## Important analytic limitation

The six roles may use the same local language model. Agreement between agents is **not independent corroboration**. The original Watchtower, document, map, news, and Case Desk sources remain the evidence. The interface keeps agent outputs separate so the analyst can inspect how the final briefing was produced.

## Performance

Agents run sequentially to keep local resource use predictable and to allow later roles to review earlier specialist work. A full six-agent mission may take several minutes depending on the selected model and computer.

No new npm dependency was added in this phase.

## Running

For the native separate window:

```powershell
npm run desktop:dev
```

For browser development, the Analysis Room opens as a popup:

```powershell
npm run dev
```

## Validation

Phase Sixteen was checked for:

- TypeScript syntax across all modified files
- Isolated strict type checking of the Analysis Room workflow and mission store
- Workspace geometry conflicts
- Tauri command registration and trusted-window inclusion
- HTML entry-point and Vite multi-page registration
- JSON validity
- CSS brace integrity
- ZIP archive integrity

A complete Vite/Tauri production build still needs to be run on the Windows development machine because the packaging environment does not contain the project dependency directory or Rust toolchain.

## Next planned phase

Phase Seventeen is the **Mobile Companion** foundation: local-network alert and briefing access, quick notes, timeline review, and tightly scoped desktop pairing.
