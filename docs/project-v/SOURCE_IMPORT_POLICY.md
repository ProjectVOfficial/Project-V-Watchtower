# Watchtower source import policy

This branch is the staging area for importing the current Project V // Watchtower source tree on top of the official World Monitor fork lineage.

## Explicitly excluded

The following local, generated, secret-bearing, or release-output paths must not be committed:

- `.env`
- `.env.local`
- `.env.example`
- `.env.*`
- `.vs/`
- `.build-fix-backups/`
- `github-release-output/`
- `node_modules/`
- Rust/Tauri `target/`
- generated build/release directories
- packaged installers, executables, archives, caches, and logs
- local credentials, connector secrets, private keys, and machine-specific state

## Import principle

Project V source changes should be layered on top of the existing World Monitor fork history rather than replacing upstream lineage wholesale.

The upstream license and required attribution/notice material must be preserved. Project V-specific source, branding, documentation, and integrations can then be committed as downstream changes.

## Source package

The current source package supplied for import is `Project-V-Watchtower-Source.zip`. It is treated as an input artifact only and should not itself be committed to the repository.
