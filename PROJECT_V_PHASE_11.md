# Project V Watchtower — Phase Eleven

## Case Desk, Evidence Board, and Data Desk

Phase Eleven adds two full Project V workspaces that open separately from the main command deck. The command dashboard keeps compact status panels, while investigations and spreadsheet work receive dedicated windows with enough room for editing and analysis.

## Case Desk

Open the Case Desk from:

```text
MODULES → RESEARCH → CASE DESK
```

The compact dashboard panel shows active cases, critical cases, unverified or disputed items, and the most recently updated investigation.

**OPEN CASE DESK** launches the dedicated `PROJECT V // CASE DESK` window. The Case Desk supports:

- Create, rename, prioritize, pause, close, and delete cases
- Tags and case descriptions
- Draggable evidence cards
- Entity, claim, source, event, note, and dataset cards
- Confirmed, probable, unverified, disputed, disproven, and analyst confidence labels
- Visual relationships between evidence cards
- Chronological case timeline
- Source links and structured metadata
- Markdown case reports
- JSON case archives
- Local Ollama case analysis

Alert Center entries, Event Timeline entries, Research Library documents, search results, saved excerpts, and Data Desk rows can be filed directly into a case. The Case Desk opens to the newly filed item so its provenance remains visible.

## Data Desk

Open the Data Desk from:

```text
MODULES → RESEARCH → DATA LIBRARY
```

The compact dashboard panel shows workbook and worksheet totals and the most recently updated workbook.

**OPEN DATA DESK** launches the dedicated `PROJECT V // DATA DESK` window. It supports:

- Import `.xlsx` and `.csv`
- Create local workbooks
- View multiple worksheets with tabs
- Edit cells
- Add and remove rows, columns, and worksheets
- Rename worksheets and workbooks
- Search the active worksheet
- Copy and paste through normal cell editing
- Preserve basic formulas during import and export
- Create and restore local workbook snapshots
- Export a workbook as `.xlsx`
- Export the active worksheet as `.csv`
- Send selected rows to a Case Desk investigation
- Analyze a selected row or worksheet sample with the configured local AI

Imported files become Project V working copies stored locally. The original file is not overwritten. Export creates a new file.

## Spreadsheet safety and limits

Phase Eleven intentionally does not execute macros or embedded code.

Supported:

- Ordinary cell values
- Multiple sheets
- Basic formulas preserved as formulas
- Common `.xlsx` ZIP/XML workbooks
- CSV files

Not fully supported in the built-in editor:

- Legacy `.xls` files
- VBA or macro execution
- Power Query
- External workbook connections
- Pivot-table editing
- Advanced charts
- Password-protected workbooks
- Complete preservation of complex Excel formatting
- Excel's full formula-calculation engine

For advanced Excel-only features, keep the original workbook and open it separately in Microsoft Excel. The planned Launch Deck can provide a direct application button in a later phase.

## Separate-window behavior

Desktop mode:

```powershell
npm run desktop:dev
```

The Case Desk and Data Desk open as native Project V Tauri windows. Their last open instance is reused unless a specific case or workbook must be opened.

Browser development mode:

```powershell
npm run dev
```

The same workspaces open as browser popup windows. The browser must permit popups for the local development address.

## Project Lock

The primary Watchtower Project Lock is broadcast to the dedicated Case Desk and Data Desk windows. When the main command deck locks, those workspaces hide their contents and display:

```text
PROJECT V // WATCHTOWER
COMMAND DECK LOCKED
```

Unlock from the primary Watchtower window to restore all Project V workspace windows.

## Backup and recovery

Phase Ten full and protected backups now include:

- Research Library
- Case Desk cases, evidence cards, and relationships
- Data Desk workbooks and snapshots

Case Desk and Data Desk also retain their own direct export tools.

## Local storage

```text
IndexedDB: project-v-case-desk
IndexedDB: project-v-data-desk
```

Case and workbook records remain local to the Watchtower browser profile or desktop webview profile unless deliberately exported or supplied to the configured local AI.

## New primary files

```text
case-desk.html
data-desk.html
src/case-desk-main.ts
src/data-desk-main.ts
src/services/case-desk.ts
src/services/case-handoff.ts
src/services/data-desk.ts
src/services/xlsx-lite.ts
src/services/workspace-windows.ts
src/services/workspace-lock-guard.ts
src/components/CaseStatusPanel.ts
src/components/DataLibraryPanel.ts
src/styles/workspace-windows.css
```

## Validation performed

- Core Case Desk, Data Desk, XLSX, handoff, window, and lock services passed targeted strict TypeScript checking.
- Dedicated Case Desk and Data Desk entrypoints passed targeted strict TypeScript checking.
- Modified TypeScript files passed syntax transpilation.
- JSON files parsed successfully.
- CSS brace and comment structure passed integrity checking.
- A generated `.xlsx` export opened successfully with Python `openpyxl` and passed ZIP integrity testing.
- Phase Eleven adds no new npm dependency.

A complete Vite and Tauri production build could not be performed in the packaging environment because the project dependency directory and Rust toolchain were unavailable. Run the first desktop compile on the Windows development machine before distribution.
