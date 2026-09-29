# Legacy Watchtower Repository

## Why there are two repositories

Project V // Watchtower originally lived in a standalone GitHub repository.

On **September 29, 2026**, the active repository was recreated as a proper GitHub fork of World Monitor so GitHub itself records the upstream relationship and the full upstream source lineage is preserved.

## Active repository

https://github.com/ProjectVOfficial/Project-V-Watchtower

Use this repository for new Watchtower source development.

## Historical repository

https://github.com/ProjectVOfficial/Project-V-Watchtower-Legacy

The legacy repository is preserved for historical continuity. It contains:

- the earlier standalone commit history
- Watchtower-specific documentation from that period
- historical screenshots
- legacy tags
- Watchtower 1.x release assets
- historical corresponding-source archives and checksums

## What was migrated

Project V documentation and issue templates were migrated into the active fork where they do not interfere with required upstream files.

The upstream `LICENSE`, upstream `CHANGELOG.md`, and upstream `CONTRIBUTING.md` were intentionally preserved in the active fork. Historical Project V versions of conflicting documents are retained under `docs/project-v/`.

## Screenshots

Historical screenshots remain available in the legacy repository's `Images/` directory. They were intentionally left as part of the historical archive rather than rewriting the new fork's Git history.

## Release history

GitHub release objects and download assets do not automatically move when a standalone repository is replaced by a fork. The legacy 1.x releases therefore remain attached to the legacy repository.

Future Project V releases should be created from the active fork.
