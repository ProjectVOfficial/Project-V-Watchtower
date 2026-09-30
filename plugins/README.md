# Project V Watchtower local plugins

Phase Six introduces a small local module format for adding custom panels without editing the Watchtower core for every tool.

## Install a plugin

1. Start Watchtower and open **PLUGINS** in the operations bar.
2. Select **IMPORT PLUGIN**.
3. Choose a reviewed `.pvplugin.json` or `.json` manifest.
4. Read the author, requested permissions, and allowed network origins.
5. Confirm installation, then add the module to the active desk.

The three files under `plugins/examples/` are reference plugins. The same three are available from **STARTER PACK** inside Watchtower.

## Security boundary

Imported modules render in an iframe with `sandbox="allow-scripts"`. They do not receive same-origin access to Watchtower, Node.js, Tauri, cookies, the parent DOM, top-level navigation, forms, or unrestricted network access.

A plugin receives host capabilities only when its manifest requests them and the user approves installation:

- `storage`: up to 64 KB of namespaced local data. The manifest registry itself is capped at 4 MB.
- `network`: outbound fetch/image/media access only to declared origins, plus the ability to open a declared origin in a new tab.
- `notifications`: Project V in-app toast messages.
- `clipboard-read`: read text through the browser clipboard API.
- `clipboard-write`: write text through the browser clipboard API.

Local plugins are code. Review manifests before importing them, especially HTML, JavaScript, permissions, and network origins.

## Manifest

The schema is published at:

```text
public/plugins/project-v-plugin-manifest.schema.json
```

Core fields:

```json
{
  "schemaVersion": 1,
  "id": "yourname.watchtower.example",
  "name": "Example Module",
  "version": "1.0.0",
  "description": "What the module does.",
  "author": "Your Name",
  "category": "system",
  "defaultSize": { "w": 4, "h": 3 },
  "minSize": { "w": 2, "h": 2 },
  "permissions": [],
  "entry": {
    "type": "sandbox-html",
    "html": "<main>Hello Watchtower</main>",
    "css": "body { background: #090909; color: #eee; }",
    "script": "console.log(ProjectV.pluginId);"
  }
}
```

Plugin IDs use a lowercase reverse-domain-style form. Grid width is 2–12 cells and height is 2–14 cells.

## Host bridge

Inside plugin JavaScript, `window.ProjectV` exposes:

```js
ProjectV.pluginId
ProjectV.storage.get(key)
ProjectV.storage.set(key, value)
ProjectV.storage.remove(key)
ProjectV.clipboard.read()
ProjectV.clipboard.write(text)
ProjectV.notify(message, level)
ProjectV.openExternal(url)
ProjectV.getContext()
```

Bridge calls return promises. Calls fail when the corresponding permission was not approved.

`getContext()` returns the active workspace ID, interface theme, locale, plugin ID, plugin version, and granted permissions. It does not expose other panel data. Cross-panel and AI context access are reserved for later permission versions.

## Backup and update

- **EXPORT** saves one manifest.
- **EXPORT ALL** saves a registry backup.
- Importing a manifest with the same ID updates that plugin while preserving its enabled state and install date.
- Registry backups can be imported through **IMPORT PLUGIN**.
- Plugin data remains namespaced after uninstall so reinstalling does not silently destroy notes. Use **CLEAR DATA** before uninstalling, or clear browser/app storage, to remove it.
