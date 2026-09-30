# Project V Watchtower — Phase Eight

## Local Document Intelligence and Research Memory

Phase Eight adds a local research layer to Watchtower. It allows reports, PDFs, notes, and saved excerpts to become searchable context for the Phase Seven Command Assistant without uploading those files to a cloud AI provider.

The existing AI Insights, Strategic Risk, and other monitoring panels remain separate. The research library supplies additional analyst-controlled source material that can be compared against live workspace signals.

## What was added

### Research Library core module

A new **RESEARCH LIBRARY** panel is available in the module library and is included in the default Intelligence and Assistant desks.

It supports:

- PDF files with extractable text
- Plain text files
- Markdown
- HTML
- CSV
- JSON
- Analyst-created memory notes
- Saved document excerpts

The panel can be moved, resized, minimized, hidden, restored, and placed inside custom desks using the existing dock system.

### Local file ingestion

Files can be imported with **IMPORT FILES** or dropped directly onto the panel.

During import, Watchtower:

1. Reads the file locally in the browser or desktop webview.
2. Extracts and normalizes its text.
3. Splits the text into overlapping retrieval chunks.
4. Stores the extracted text and metadata in IndexedDB.
5. Makes enabled documents available to local Assistant retrieval.

PDF extraction uses `pdfjs-dist` and preserves page numbers for retrieved chunks whenever text is available.

Scanned or image-only PDFs are not OCR-processed in this phase. They will report that no extractable text was found unless the PDF already contains a text layer.

### Local search

The Research Library includes phrase and keyword search across:

- Imported document chunks
- Analyst memory notes
- Saved excerpts
- Document titles
- Tags

Results show the source title and PDF page number when available. Search results can be opened or saved as persistent excerpts.

### Analyst memory

**NEW MEMORY** creates a persistent local note that can contain:

- Background facts
- Working hypotheses
- Decisions
- Source notes
- Investigation context
- Long-term reminders for the local Assistant

Memory notes can be edited, tagged, excluded from AI context, backed up, or deleted.

### Saved excerpts

Text selected inside the document reader can be saved as an excerpt. Search results can also be converted into excerpts.

Each excerpt retains:

- Source document title
- Page number when available
- Excerpt title
- Text
- Creation date
- AI-context inclusion state

### Assistant research context

The Phase Seven Assistant now includes two additional context modes:

- **Research Library Only** — retrieves relevant enabled documents, memories, and excerpts
- **Workspace + Research** — combines current Watchtower signals with relevant local research

Two new quick commands were added:

- **Research Brief** — automatically switches to Research Library Only
- **Cross-Check Archive** — automatically switches to Workspace + Research

Document and memory context is labeled with the same `S1`, `S2`, and similar source markers used by workspace panels. PDF page numbers are included in source titles when available.

The Assistant is instructed to treat imported documents as user-supplied material rather than automatically authenticated truth. It must distinguish document claims, live panel signals, generated analysis, and inference.

## Privacy model

- Imported files are processed locally.
- Original file bytes are not uploaded by this module.
- Extracted text, chunks, metadata, memories, and excerpts are stored in local IndexedDB.
- Documents are sent to the AI only when they are enabled and a research context mode is selected.
- Research context is sent only to the locally configured Ollama or compatible endpoint.
- API keys are never stored inside research documents or added automatically to prompts.
- Backups are ordinary JSON exports containing extracted text. Treat backup files as sensitive research material.

## Storage and limits

The local database is:

```text
project-v-research-library
```

Current safeguards include:

- 30 MB maximum input file size
- 120-document library limit
- 2.5 million extracted characters per document
- 8,000 characters per saved excerpt
- 500 excerpts accepted during backup restoration

Browser storage quotas still apply. Large libraries may need to be divided into separate Project V profiles in a later phase.

## Backup and restore

The Research Library toolbar includes:

- **BACKUP** — exports documents, extracted text, chunks, memories, metadata, and excerpts as JSON
- **RESTORE** — imports a Project V research-library JSON backup

This is separate from workspace-layout export and import.

## New dependency

```text
pdfjs-dist ^4.10.38
```

Use `npm install`, not `npm ci`, when first opening this phase so the newly added package can be resolved and the lockfile can be updated if your registry rewrites package URLs.

## Files added

```text
src/components/ResearchLibraryPanel.ts
src/services/research-library.ts
PROJECT_V_PHASE_8.md
```

## Main files updated

```text
package.json
package-lock.json
src/app/deck-workspaces.ts
src/app/panel-layout.ts
src/components/CommandAssistantPanel.ts
src/components/index.ts
src/config/panels.ts
src/services/command-context.ts
src/styles/project-v-theme.css
```

## Validation completed

- All modified TypeScript files passed isolated syntax transpilation.
- The research service passed a targeted strict TypeScript check with PDF.js declarations.
- The Research Library panel passed a targeted strict TypeScript check with local component stubs.
- The Assistant and command-context changes passed a targeted strict TypeScript check.
- The Project V theme stylesheet parsed successfully with PostCSS.
- All JSON files parsed successfully.
- Package and package-lock dependency entries were validated.
- The final ZIP passed archive-integrity testing.

A full application build could not be completed in this environment because its internal package mirror does not provide `pdfjs-dist`. A normal public npm registry should resolve the dependency on the development machine.

## Run

```powershell
npm install
npm run dev
```

Then:

1. Open **ASSISTANT** or **INTELLIGENCE**.
2. Open or restore the **RESEARCH LIBRARY** module.
3. Import a PDF or text document.
4. Leave **USE IN AI CONTEXT** enabled for material the Assistant may retrieve.
5. Choose **RESEARCH LIBRARY ONLY** or **WORKSPACE + RESEARCH** in the Assistant.

## Next planned phase

Phase Nine will focus on communications, alert rules, operational timelines, notifications, scheduled briefings, and other command-center workflow tools.
