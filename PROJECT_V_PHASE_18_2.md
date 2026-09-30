# Project V Watchtower — Phase 18.2

## Native Menu Cleanup

Phase 18.2 removes the inherited Windows `File / Edit / Help` menu from the main Project V Watchtower command deck.

The removal does not affect:

- Project V's custom top command bar
- API & Data Sources settings
- panel and workspace controls
- text-field editing commands
- separate Project V windows
- development builds
- updater and release manufacturing commands

## Preserved shortcuts

The useful native-menu accelerators are preserved through the trusted Project V desktop bridge:

```text
Ctrl + ,       Open API & Data Sources settings
Ctrl + Alt + I Toggle WebView2 developer tools in desktop:dev
```

Normal WebView editing shortcuts continue to work without interception:

```text
Ctrl + Z       Undo
Ctrl + Y       Redo
Ctrl + X       Cut
Ctrl + C       Copy
Ctrl + V       Paste
Ctrl + A       Select all
```

Developer tools are intentionally unavailable in ordinary signed release builds unless the release is explicitly compiled with Tauri's `devtools` feature.

## Running the patch

```powershell
npm run desktop:dev
```

The normal Windows title bar remains. Only the extra native `File / Edit / Help` row is removed.

## Validation

- The native menu builder and menu-event handler were removed.
- The main desktop window explicitly removes any inherited menu during setup.
- Settings and developer-tools shortcuts were moved to an explicit keyboard handler.
- The new TypeScript passed syntax transpilation.
- All project JSON files parsed successfully.
- The package passed ZIP integrity validation.

Rust/Tauri compilation must still be performed on the Windows development machine because the packaging environment does not include the Rust toolchain.
