# Project V // Watchtower Installation

## Legacy 1.x builds

Existing Project V // Watchtower 1.x Windows builds were published before the repository was migrated onto the official World Monitor fork.

They remain available from the preserved legacy repository:

**https://github.com/ProjectVOfficial/Project-V-Watchtower-Legacy/releases**

The most recent legacy release is **Project V // Watchtower 1.1.0**.

Available legacy assets include Windows installer, MSI, portable executable, checksums, and corresponding-source materials.

## Future builds

Future Project V // Watchtower builds produced from this fork should be published from this repository's Releases page and tied to the exact source revision used to build them.

Do not assume that a legacy 1.x binary corresponds to the current `main` branch of this fork.

## Windows requirements

Typical Watchtower desktop requirements include:

- Windows 10 or Windows 11, 64-bit
- Microsoft WebView2 Runtime
- adequate disk space for the application, caches, records, and optional local models
- internet access for live external feeds
- Ollama or another supported local inference service only when using optional local AI features that require it

Exact requirements can change by release. Read the release notes for the build you install.

## Verify downloads

When a release publishes `SHA256SUMS.txt`, verify the downloaded file before running it.

PowerShell example:

```powershell
Get-FileHash ".\Project-V-Watchtower.exe" -Algorithm SHA256
```

Compare the result with the checksum published with that exact release.

A matching checksum verifies that the downloaded bytes match the published asset. It does not by itself prove that the publisher's build environment was uncompromised.

## Windows warnings

Unsigned or newly published builds may trigger Windows SmartScreen or unknown-publisher warnings.

Only continue after confirming that:

1. the file came from an official Project V Watchtower release;
2. the filename and version match the release notes;
3. the SHA-256 checksum matches when a checksum is provided.

## Updating

Before installing a newer Watchtower build:

1. close Watchtower;
2. create or export a backup of important local data;
3. read the new release notes;
4. verify the download;
5. install or launch the new build;
6. confirm workspaces and local records are present.

## Optional local AI

Local inference software such as Ollama is installed separately unless a future release explicitly states otherwise.

Keep API keys, model-service credentials, private databases, and local configuration out of Git commits, issue attachments, screenshots, and release source archives.

## Troubleshooting

If Watchtower does not start:

- restart Windows;
- confirm WebView2 Runtime is installed;
- check whether endpoint security quarantined the executable;
- re-download and verify the release asset;
- use Safe Mode if the installed build provides it;
- report reproducible errors without secrets.

If live panels are empty, verify network access, provider availability, credentials where required, and provider rate limits.
