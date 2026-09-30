# Project V Watchtower — Phase Eighteen

## Distribution, Updates, Access Keys, and Data-Service Foundation

Phase Eighteen closes the original foundation roadmap and prepares Project V Watchtower for a real Windows release line.

## API and access-screen changes

The old prominent World Monitor license card has been removed from the API overview.

The overview now shows:

- **Local Desktop — Active:** installed and portable local editions do not require a Project V license.
- **Watchtower Access Key:** generates a `wt_live_...` key for future paired devices, self-hosted services, approved plugin APIs, and the optional Mobile Companion.
- **Project V First routing:** local sidecar, direct provider credentials, and optional inherited upstream fallback.

The existing World Monitor credential is preserved and relocated to:

```text
API KEYS → UPSTREAM & COMPATIBILITY
```

It is clearly labeled as an optional inherited credential. Removing it does not disable the Project V interface, layouts, Ollama, Research Library, cases, maps, alerts, communications, Camera Wall, OSINT Desk, plugins, or Analysis Room. Some inherited data panels may lose their cloud fallback when local/direct sources are unavailable.

## Project V release identity

The release line now begins at:

```text
Project V Watchtower 1.0.0
```

The package, Rust binary, product name, publisher metadata, release notes, and executable naming use Project V Watchtower branding.

The legacy Tauri application identifier is intentionally retained for this first release so existing localStorage, IndexedDB, WebView data, credentials, cases, research records, and workspace state are not silently abandoned. A future identifier migration should be performed only with a tested data-migration utility.

## Windows editions

Phase Eighteen prepares three Windows artifacts from one source tree:

### NSIS installer

```text
Project-V-Watchtower-1.0.0-Setup.exe
```

Suitable for most users. It supports current-user or machine installation according to the installer selection.

### MSI installer

```text
Project-V-Watchtower-1.0.0-x64.msi
```

Suitable for managed Windows deployment and administrators who prefer MSI packaging.

### Portable archive

```text
Project-V-Watchtower-1.0.0-Windows-x64-Portable.zip
```

The portable archive requires no installer. Extract it and run:

```text
Project-V-Watchtower.exe
```

A `portable.flag` file tells Watchtower to keep its native cache and logs in the adjacent `ProjectVData` directory.

### Portable-edition limitation

Portable means **non-installable**, not zero-footprint. Windows WebView2 profile data and protected API credentials may remain associated with the current Windows user. This is intentional: API secrets continue using the operating-system credential vault instead of being copied into a readable portable folder.

## Future update system

Installed editions use Tauri's signed updater path:

1. Watchtower checks the configured HTTPS `latest.json` endpoint.
2. A Project V update notification appears when a newer version exists.
3. The user selects **Download & Restart**.
4. Tauri verifies the updater signature before installation.
5. Watchtower installs the update and restarts.

Portable editions do not overwrite themselves while running. They check the Project V release manifest and offer **Download Portable**. The user closes Watchtower, verifies the archive, and replaces the old program files while retaining or restoring `ProjectVData`.

Update checks are disabled in ordinary development builds unless release endpoints are supplied.

## Release signing

Two separate signing systems should be used:

- **Tauri updater signing** protects update artifacts and is mandatory for the updater flow.
- **Windows Authenticode signing** identifies the publisher to Windows and helps reduce unknown-publisher warnings.

Generate the updater key outside the repository:

```powershell
npm install
npm run release:keygen
```

The default location is:

```text
%USERPROFILE%\.project-v\signing\watchtower-updater.key
```

Never commit or distribute the private key.

## Release manufacturing

The Windows release pipeline is:

```text
Source validation
→ Vite and TypeScript build
→ Rust/Tauri build
→ NSIS + MSI
→ updater signatures
→ portable archive
→ corresponding source archive
→ latest.json
→ project-v-release.json
→ SHA256SUMS.txt
→ integrity verification
```

A production build requires these environment variables:

```powershell
$env:PROJECT_V_UPDATER_PUBLIC_KEY = Get-Content "$HOME\.project-v\signing\watchtower-updater.key.pub" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY = "$HOME\.project-v\signing\watchtower-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "YOUR_PRIVATE_KEY_PASSWORD"

$env:PROJECT_V_UPDATE_ENDPOINT = "https://updates.example.org/watchtower/latest.json"
$env:PROJECT_V_RELEASE_MANIFEST_URL = "https://updates.example.org/watchtower/project-v-release.json"
$env:PROJECT_V_RELEASE_BASE_URL = "https://updates.example.org/watchtower/releases/1.0.0"
$env:PROJECT_V_RELEASE_PAGE_URL = "https://updates.example.org/watchtower/releases/1.0.0"
```

Then run from an elevated or normal Windows PowerShell, depending on the desired signing/build environment:

```powershell
npm run release:windows
```

The artifacts are written to:

```text
release\
```

Detailed instructions are in:

```text
docs/PROJECT_V_RELEASE_GUIDE.md
```

## Release artifacts

A completed release directory includes:

```text
Project-V-Watchtower-1.0.0-Setup.exe
Project-V-Watchtower-1.0.0-Setup.exe.sig
Project-V-Watchtower-1.0.0-x64.msi
Project-V-Watchtower-1.0.0-Windows-x64-Portable.zip
Project-V-Watchtower-1.0.0-Source.zip
latest.json
project-v-release.json
SHA256SUMS.txt
RELEASE_NOTES.md
LICENSE
```

Exact installer filenames can differ slightly based on Tauri's bundle naming, but the manifest generator discovers the resulting files automatically.

## Connector foundation

Phase Eighteen introduces a declarative connector catalog under:

```text
connectors\
```

It defines the initial source-routing metadata for:

- NASA FIRMS
- FRED
- Finnhub
- ACLED
- OpenSky
- AISStream
- Optional World Monitor upstream compatibility

The connector definitions describe credentials, refresh policy, caching, routing, and normalized record categories. They do not download or execute arbitrary JavaScript.

Validate them with:

```powershell
npm run connectors:validate
```

This is the foundation for future signed connector packs and an optional Project V Core/Synology service. Remote connector installation is not enabled yet.

## Project V gateway hook

A future self-hosted Project V API gateway can be supplied at build time with:

```text
VITE_PROJECT_V_API_GATEWAY
```

The routing order is now prepared as:

```text
Project V gateway when configured
→ local Watchtower sidecar
→ direct providers
→ optional inherited World Monitor fallback
```

No Synology service or public gateway is included in this phase.

## Distribution and license obligations

The release script creates a corresponding source archive and includes the AGPL license. Before public distribution, review all upstream notices, attribution, trademarks, data-provider terms, and third-party assets. Project V branding must not imply that the fork is the official World Monitor service.

## Validation completed in the packaging environment

The following checks passed:

- Modified TypeScript syntax transpilation
- 76 JSON files parsed successfully
- Version synchronization across npm, Tauri, and Cargo metadata
- Seven connector definitions validated
- Release-config generation tested
- Installer/portable/source manifest generation tested with simulated artifacts
- SHA-256 verification workflow tested
- Node release scripts passed syntax checks

A complete Windows Vite/Rust/Tauri release build was **not** possible in the packaging environment because it did not contain a Windows Rust/Tauri toolchain or the complete installed dependency directory. The first real NSIS, MSI, updater, and portable build must therefore be run and tested on your Windows computer before distribution.

## Deferred updates

The following remain intentional post-release additions rather than Phase Eighteen requirements:

- Mobile Companion
- Synology-hosted Watchtower Core
- Signed remote connector catalog
- Full Project V application identifier migration
- Native installer code-signing certificate integration
- Additional plugins and module packs
- Final visual and voice-command touch-up pass
