# Project V Watchtower — Phase Six

## Module and plugin foundation

Phase Six turns the Phase Five module library into an expandable local extension system. Core World Monitor-derived panels remain intact, while reviewed Project V plugin manifests can now create additional movable and resizable modules without changing the central panel layout code.

## What was added

### Plugin Control

A new **PLUGINS** button appears in the top operations bar. The drawer can:

- Import one reviewed `.pvplugin.json` or JSON manifest.
- Import a complete Project V plugin-registry backup.
- Install the included starter module pack.
- Search installed plugins.
- Display author, version, category, requested permissions, and network origins.
- Enable, disable, update, export, clear local data, or uninstall a plugin.
- Add or remove an enabled plugin from the active workspace.
- Export all installed manifests as a registry backup.
- Export a clean starter manifest template.

### Sandboxed local modules

Plugin modules run in an iframe with only script execution enabled. They do not receive same-origin access to the Watchtower page, Node.js, Tauri APIs, the parent DOM, forms, top-level navigation, or unrestricted network requests.

A permission-gated host bridge supports:

- Namespaced local storage, limited to 64 KB per plugin. The installed-manifest registry is capped at 4 MB to avoid silently exhausting browser storage.
- In-app notifications.
- Clipboard read and write.
- Opening a URL from an explicitly declared network origin.
- Reading limited workspace context such as the active desk, locale, theme, version, and granted permissions.

Plugin content is additionally constrained by a per-plugin Content Security Policy. Network-capable plugins are restricted to the origins listed in their manifest.

### Dock-engine integration

Plugin metadata now participates in the same twelve-column command grid as core modules:

- Default width and height.
- Minimum width and height.
- Category.
- Version and source.
- Permission count.
- Hidden, minimized, and per-workspace state.

Plugin modules can be dragged, resized, minimized, maximized, removed, restored, and included in custom workspaces just like existing Watchtower modules. Imported updates preserve the module's saved geometry where possible.

### Improved Module Library

The Module Library now distinguishes **CORE** and **PLUGIN** modules and adds dedicated **AI** and **RESEARCH** categories. Plugin descriptions and metadata are searchable.

### Starter module pack

Three local examples are included:

1. **Field Notes** — a namespaced local scratchpad using the storage bridge.
2. **Quick Launch** — approved links to public resources using a declared network-origin allowlist.
3. **System Pulse** — a lightweight local time and session-status panel.

They can be installed from **PLUGINS → STARTER PACK**. Editable copies are also under `plugins/examples/`.

## Developer files

```text
src/modules/plugin-types.ts
src/modules/plugin-registry.ts
src/components/PluginPanel.ts
src/app/plugin-manager.ts
public/plugins/project-v-plugin-manifest.schema.json
plugins/README.md
plugins/examples/
tests/project-v-plugin-registry.test.mts
```

## Storage

```text
project-v-plugin-registry-v1
project-v-plugin-data-v1:<plugin-id>
```

Uninstalling a plugin removes its manifest and module but intentionally leaves its namespaced data. This prevents an accidental uninstall from silently deleting notes. Use **CLEAR DATA** in Plugin Control, or clear browser/desktop-app storage, to remove retained plugin data.

## Using Phase Six

```powershell
npm install
npm run dev
```

Then:

1. Open **PLUGINS**.
2. Choose **STARTER PACK** or **IMPORT PLUGIN**.
3. Review permissions and network origins.
4. Confirm installation.
5. Use **ADD TO DESK** if the module is not already visible.
6. Activate **EDIT DECK** to move or resize it.

## Security boundary and limitations

This is a local HTML-module system, not unrestricted native-code loading. Imported plugins cannot directly access other panel contents, secrets, files, Ollama, the Tauri command layer, or Project V Browser internals. Those capabilities should only be introduced later through narrowly scoped, explicit permissions.

A sandbox reduces risk but does not make arbitrary third-party code trustworthy. Review plugin manifests before installation. A plugin granted network or clipboard access can use those approved capabilities.

## Validation performed

- Targeted strict TypeScript checking passed for the registry, plugin panel, plugin manager, workspace engine, and deck editor.
- Every modified TypeScript file passed syntax transpilation, including the main panel-layout integration.
- All three starter manifests passed the production manifest validator.
- Registry tests passed for installation, persistence, enable/disable, export, uninstall, invalid IDs, and unsupported permissions.
- The manifest schema and all example JSON files parsed successfully.

A complete Vite production build was not run in this environment because the project dependencies are not installed here and the available package mirror previously lacked required upstream packages. Run `npm install` and `npm run build` on the development machine for the full dependency-backed build.

## Next planned phase

Phase Seven is the local AI command assistant: a dedicated Ollama-backed module, workspace context selection, panel summaries, cited briefing workflows, and a controlled path for plugins to request AI services later.
