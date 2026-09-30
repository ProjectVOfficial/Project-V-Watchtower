# Project V Watchtower — Phase 15.1

## Camera Wall source-management and news-link hotfix

Phase 15.1 is a focused patch for the two issues reported after Phase Fifteen:

1. stale or removed camera streams could remain on the wall and could not be repaired from the interface; and
2. country-intelligence news links could trigger a Windows **Application not found** dialog.

No new npm package is required.

## Camera Wall changes

The Camera Wall now supports a fully manual selection state. It is possible to deselect every stream without the active preset automatically restoring two or more cameras.

Each visible camera now includes:

- **EDIT** — change its YouTube ID/URL, HLS URL, HTTPS embed URL, name, location, or notes;
- **OPEN** — open the original source in the restricted Project V Source Browser window;
- **HIDE** — remove that camera from the current wall without deleting its saved source;
- **EXPAND** — enter fullscreen for that camera cell.

Built-in camera entries can be edited when a provider removes or replaces a livestream. The editor also includes **RESET CORE SOURCE** to restore the source originally shipped with Project V.

The source rail now has three categories:

- **CORE STREAMS**
- **CUSTOM LIVE CAMS**
- **ALL**

Custom streams remain removable. Built-in streams remain part of the catalog but can be hidden from the current wall or have their source repaired.

When selected cameras no longer match a saved camera group, the group selector now displays **MANUAL SELECTION** so it is clear that the wall is using a custom combination.

### Repairing a broken stream

1. Open **CAMERAS**.
2. Select **EDIT** on the failed camera cell or beside the source in the left rail.
3. Paste a current YouTube livestream URL or video ID, HLS `.m3u8` URL, or compatible HTTPS embed page.
4. Select **SAVE SOURCE**.

Project V cannot restore a stream that its provider has removed, made private, disabled for embedding, or restricted by region. The new editor allows the analyst to replace that source without changing code.

## Country-intelligence news links

External links clicked from the main Watchtower interface now open first in the restricted **Project V Source Browser** desktop window. This includes the **Top News** links in country-intelligence views.

If the restricted window cannot be created, Watchtower falls back to the system browser. The Windows fallback now uses the registered URL protocol handler instead of passing web links to `explorer.exe`, which avoids the reported **Application not found** dialog on affected systems.

The restricted source window receives no Watchtower API keys or trusted IPC permissions.

## Running the patch

For the native Camera Wall and Source Browser windows:

```powershell
npm run desktop:dev
```

For ordinary browser development:

```powershell
npm run dev
```

Browser development uses normal browser tabs for source links because native Tauri windows are unavailable.

## Validation

The patch passed:

- TypeScript syntax transpilation for all changed frontend files;
- Camera Wall persistence tests, including a completely empty manual selection;
- built-in camera source editing and reset tests;
- custom stream creation tests;
- CSS brace and structure checks;
- JSON parsing checks;
- archive-integrity testing.

The Rust change could not be compiled in the packaging environment because Rust tooling is unavailable. It must receive its first full Tauri compile on the Windows development computer through `npm run desktop:dev`.
