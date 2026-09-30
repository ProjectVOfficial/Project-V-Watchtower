# Project V Watchtower — Phase 16.2 Hotfix

This hotfix repairs two issues reported after Phase 16.1: OSINT launchers that appeared to do nothing, and Analysis Room source/case controls that were unclear or unavailable.

## OSINT Desk repairs

Each OSINT tool now has two launch choices:

- **OPEN** — opens the result in the restricted Project V Source Browser window.
- **BROWSER** — opens the result through the computer's registered default HTTPS browser.

Additional repairs:

- The OSINT Desk now detects the Tauri invoke bridge directly, which is more reliable inside secondary desktop windows.
- The Project V Source Browser is centered and explicitly brought into focus.
- If the restricted Source Browser cannot be created, Watchtower automatically falls back to the default browser.
- Browser-development popups now report when the browser blocks them.
- OPEN and BROWSER remain clickable with an empty field so the status bar can explain that an identifier is required instead of silently presenting an inactive control.
- Successful searches continue to be stored in Recent Queries.

Enter a username, email, domain, IP address, telephone number, or phrase in the **IDENTIFIER** field before launching a search.

## Analysis Room source snapshot repair

The right-side **SOURCE SNAPSHOT** rail now includes a **CAPTURE** button.

CAPTURE:

- Refreshes configured Watchtower sources when requested.
- Collects the selected workspace/research context.
- Includes evidence from an attached Case Desk investigation.
- Saves the source list with the mission.
- Displays source titles, types, and short excerpts in the rail.

The screenshot showed **NO WATCHTOWER CONTEXT** while **REFRESH LIVE SOURCES BEFORE RUN** was enabled. Previously, that combination produced an empty snapshot. Phase 16.2 treats it as a request to use **WORKSPACE + RESEARCH**, updates the mission, and captures a source snapshot before the agents run.

If no original sources are available, the agent prompt now explicitly prohibits invented publications, URLs, dates, quotations, and source labels. If a local model still cites labels that are not in the saved snapshot, Watchtower displays an **UNSUPPORTED SOURCE LABELS DETECTED** warning above that agent's output.

This does not give Ollama unrestricted internet search. The snapshot is built from Watchtower's connected feeds, visible/current workspace context, Research Library material, and attached Case Desk evidence.

## Report export and Case Desk handoff

The Analysis Room action row now includes:

- **EXPORT REPORT** — downloads the completed mission as Markdown.
- **SEND REPORT TO CASE** — used when a Case Desk investigation is already attached.
- **CREATE CASE + SEND REPORT** — shown when the mission has a final report but no case is attached.

The case handoff is no longer disabled simply because no case was selected. Watchtower asks for a case title, creates the investigation, attaches it to the mission, and saves the final report as an analyst note.

## Running the hotfix

No new npm dependency was added.

```powershell
npm run desktop:dev
```

For a fresh extraction:

```powershell
npm install
npm run desktop:dev
```

## Validation

Completed in the packaging environment:

- TypeScript syntax validation for all changed frontend files
- OSINT URL construction and launch-fallback simulation
- Popup-blocking error simulation
- Analysis Room feature-wiring checks
- JSON validation across the project
- CSS brace and structural checks
- Rust command registration and source-window structure checks
- ZIP integrity verification

A complete Rust/Tauri compilation still needs to run on the Windows development machine because Rust tooling is not installed in the packaging environment.
