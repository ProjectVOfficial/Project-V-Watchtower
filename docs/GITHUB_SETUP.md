# Project V // Watchtower GitHub Structure

## Active repository

The active Watchtower source repository is:

`https://github.com/ProjectVOfficial/Project-V-Watchtower`

It is a GitHub fork of:

`https://github.com/koala73/worldmonitor`

The repository now contains the upstream source lineage plus Project V-specific documentation and, going forward, Project V Watchtower source changes.

## Legacy repository

The earlier standalone repository is preserved at:

`https://github.com/ProjectVOfficial/Project-V-Watchtower-Legacy`

It retains the historical standalone Watchtower commits, screenshots, tags, and 1.x release assets.

Do not use the legacy repository as the active development remote for new Watchtower work.

## Recommended local remotes

For a local clone of the active repository:

```powershell
git clone https://github.com/ProjectVOfficial/Project-V-Watchtower.git
cd Project-V-Watchtower

git remote add upstream https://github.com/koala73/worldmonitor.git
git remote -v
```

Expected structure:

- `origin` → Project V fork
- `upstream` → World Monitor

## Updating from upstream

Review upstream changes before integrating them into Watchtower.

A normal workflow is:

```powershell
git fetch upstream
git checkout main
git merge upstream/main
```

For a heavily modified Watchtower branch, use a dedicated integration branch and validate before merging into the Project V release line.

## Releases

Future Project V Watchtower binaries should be published from the active fork's Releases page.

A release should include:

- version/tag
- Windows installer and/or portable build
- SHA-256 checksums
- release notes
- a clear source revision
- corresponding source required by AGPL-3.0-only

Historical 1.x release assets remain in the legacy repository.

## Secrets and local data

Never commit:

- API keys or tokens
- `.env` secrets
- private research/case databases
- local credentials
- signing private keys
- model files
- build caches
- user-specific logs
- private Watchtower workspaces
