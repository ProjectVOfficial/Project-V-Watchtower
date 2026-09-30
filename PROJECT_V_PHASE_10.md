# Project V Watchtower — Phase Ten

## Desktop Hardening, Recovery, Restricted Web Dock, and Communications Wall

Phase Ten closes the original foundation roadmap by adding a security and recovery layer around the existing Watchtower features. It also introduces the requested communications workspace and a limited source browser without merging the full Project V Browser codebase.

The new top-bar control is:

```text
SECURITY
```

It opens the Project V Security Center with these sections:

```text
OVERVIEW
PROJECT LOCK
BACKUPS
NETWORK
PLUGIN ACCESS
DIAGNOSTICS
WEB DOCK
```

## Communications Wall

The Communications Wall is implemented as a built-in Watchtower module rather than an ordinary Phase Six plugin. It needs controlled Tauri window creation and a fixed host allowlist, which should not be granted to an imported plugin.

Included launchers:

- Google Voice
- Discord
- Google Messages
- Telegram Web
- Slack
- Microsoft Teams

Custom HTTPS communication links can also be saved. A custom endpoint is opened externally unless its hostname is on the desktop integrated-window allowlist.

In the Tauri desktop runtime, approved services can open in separate untrusted WebView2 windows. These remote pages are not listed as trusted Watchtower windows and are not given Watchtower IPC capabilities, API-key access, panel access, research access, or plugin permissions.

In browser development mode, communication services open in the normal browser instead.

Provider limitations still apply. Google, Discord, Microsoft, and other services may reject embedded sign-in, require additional verification, or change their web-client behavior. Use the `EXTERNAL` action whenever a provider does not function correctly inside WebView2.

The module is available from:

```text
MODULES → LIVE OPS → COMMUNICATIONS WALL
```

It is also linked from:

```text
SECURITY → WEB DOCK
```

## Limited Source Browser

Phase Ten deliberately does not merge the complete Project V Browser. Instead, it adds a smaller restricted Source Browser module for Watchtower research workflows.

It can:

- Open HTTPS pages in a separate untrusted desktop webview
- Open a page in the normal external browser
- Copy a source link
- Save a URL and analyst note into the Research Library
- Add a URL and analyst note to the Event Timeline
- Keep a short local recent-source list

Allowed addresses are HTTPS URLs and localhost HTTP addresses. Remote pages do not receive Watchtower IPC permissions.

The module is available from:

```text
MODULES → RESEARCH → SOURCE BROWSER
```

and:

```text
SECURITY → WEB DOCK
```

This provides the useful handoff actions discussed for Project V Browser while avoiding a risky full application merge. A deeper Project V Browser bridge can be added later after both applications have stable interfaces.

## Project Lock

Project Lock places a full-screen lock layer over the Watchtower command deck.

Available controls:

- Manual lock
- Four-to-twelve-digit numeric PIN
- Automatic lock after inactivity
- Optional lock when the main window loses focus
- Short delay after five failed attempts

The PIN itself is not stored. Watchtower stores a PBKDF2-SHA256 verifier with a random salt and 210,000 iterations.

Project Lock protects an open application from casual access. It does not replace Windows sign-in, BitLocker or other full-disk encryption, malware protection, or operating-system account security.

## Secure desktop credential migration

The Tauri credential service now uses:

```text
project-v-watchtower
```

Existing credentials saved under the upstream `world-monitor` keyring service are migrated into the Project V consolidated vault when possible. Migration occurs inside Rust and does not expose the secret values to frontend JavaScript.

The existing API Keys screen remains the place to add, test, remove, and manage provider credentials.

Browser development mode still uses the existing localhost development-secret mechanism. The operating-system keyring is available only in the Tauri desktop runtime.

## Backup Center

Backup types:

### Configuration backup

Includes Project V and compatible upstream configuration records such as:

- Workspaces and layouts
- Plugin manifests and plugin data
- Alert rules and watchlists
- Event timelines
- AI conversation history
- Interface settings
- Local module data

### Full archive

Includes the configuration backup plus the Phase Eight Research Library documents and excerpts.

### Protected archive

Encrypts a full archive in the browser with:

```text
AES-256-GCM
PBKDF2-SHA256
210,000 iterations
```

Protected archives require a passphrase of at least eight characters.

API keys, localhost runtime secrets, session markers, and the Project Lock PIN verifier are excluded from exported backups. Restoring a backup preserves the current machine's API-key store and current Project Lock PIN.

Before a restore, Watchtower creates a last-known-good configuration snapshot. The Backup Center can restore that snapshot if a later import causes a problem.

## Crash recovery and Safe Mode

Watchtower records a local session marker and reports when the previous session may not have closed cleanly.

Safe Mode:

- Starts Watchtower without loading imported plugin panels
- Leaves core Watchtower modules available
- Can be enabled from Security Overview or Diagnostics
- Can be exited by reloading normally

The Diagnostics section also provides a manual last-known-good restore point.

## Plugin permission management

The Security Center can revoke or restore the permissions requested by installed Phase Six plugins:

- Local storage
- Network access
- Notifications
- Clipboard read
- Clipboard write

Revoking a permission rebuilds the plugin panel with the reduced bridge and content-security policy. Plugins remain sandboxed in script-only iframes and do not gain Tauri, Node.js, API-key, local-file, or unrestricted parent-page access.

## Network Control

Network modes:

```text
NORMAL
RESTRICTED
LOCAL AI ONLY
EMERGENCY DISCONNECT
```

- `NORMAL` allows configured Watchtower connections.
- `RESTRICTED` allows same-origin requests, localhost services, and explicitly listed origins.
- `LOCAL AI ONLY` blocks external requests while permitting localhost services such as Ollama.
- `EMERGENCY DISCONNECT` blocks new external fetch and WebSocket requests from the frontend.

Blocked requests are recorded in an in-memory session audit list.

The network guard applies to new frontend fetch and WebSocket connections. It does not retroactively terminate an already-open media stream, an external communication window, or an operating-system process. Close those separately when a complete disconnect is required.

## Diagnostics

Diagnostics can report:

- Project V version
- Browser-development or Tauri runtime
- Current workspace
- Panel and plugin counts
- Online status
- Network policy
- Research document and excerpt counts
- Browser storage usage and quota when supported
- Recent blocked network requests
- Whether Safe Mode is active
- Whether the desktop secret vault is available

Reports are exported without API-key values.

## Workspace integration

The new panels participate in the existing dock system:

```text
Communications Wall
Source Browser
```

They can be moved, resized, minimized, maximized, hidden, restored, and assigned independently to workspaces.

Default Phase Ten placement:

- Watchtower: Source Browser
- Live Ops: Communications Wall and Source Browser
- Intelligence: Source Browser
- Assistant: Source Browser and Communications Wall

Existing saved workspace layouts are preserved. Use `MODULES` to reveal the new panels when they do not appear automatically in a migrated custom layout.

## Validation performed

- Focused strict TypeScript diagnostics reported no errors in the twelve modified Phase Ten TypeScript files.
- All twelve modified TypeScript files passed isolated syntax transpilation.
- A browser simulation verified:
  - PIN creation and verification
  - Incorrect-PIN rejection
  - Secret and PIN-verifier exclusion from backups
  - AES-GCM protected-backup round trips
  - Incorrect protected-backup passphrase rejection
  - Configuration restoration
  - Preservation of current API secrets and Project Lock PIN during restore
  - Local-only network blocking and audit creation
- A communications-service simulation verified:
  - Built-in launcher loading
  - Custom endpoint storage and removal
  - Unsafe protocol rejection
  - Integrated-host allowlisting
  - Tauri command routing for an approved desktop endpoint
- Internal imports for all modified files resolve to project files.
- All project JSON files parse successfully.
- CSS and Rust brace-integrity checks passed.

The complete production build could not be run in this environment because its package mirror does not provide `pdfjs-dist@4.10.38`, which was introduced in Phase Eight. Rust tooling was also unavailable here, so the Tauri changes require a desktop build check on the target Windows machine.

## Run in browser development mode

```powershell
npm install
npm run dev
```

Browser development mode supports the Security Center, Project Lock, backups, Network Control, plugin permissions, diagnostics, and external web handoffs. It does not provide the operating-system credential vault or integrated Tauri webview windows.

## Run with desktop features

```powershell
npm install
npm run desktop:dev
```

This enables:

- Operating-system keyring storage
- Credential migration
- Integrated approved communications windows
- Restricted Source Browser webview

If the Phase Eight PDF package is missing from an older `node_modules` installation, run:

```powershell
npm install pdfjs-dist@4.10.38
```

## Intentionally deferred

- Full Project V Browser codebase integration
- Always-running Windows service while Watchtower is closed
- System-tray monitoring
- Encrypted storage for every IndexedDB research record at rest
- Cloud synchronization
- Remote or mobile unlocking
- Reading or automating message content from Google Voice, Discord, or other communication providers
- Provider-specific chat APIs or bots

Those can become later phases after the Phase Ten desktop foundation is tested on the target machine.
