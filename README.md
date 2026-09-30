# Project V // Watchtower

**Project V // Watchtower** is a local-first situational-awareness and OSINT desktop environment for Windows, built from the open-source **World Monitor** foundation and expanded into a Project V command center for research, monitoring, alerts, mapping, communications, video, and analyst workflows.

> **Upstream:** [koala73/worldmonitor](https://github.com/koala73/worldmonitor)  
> **License:** GNU Affero General Public License v3.0 only (**AGPL-3.0-only**)  
> **Status:** Active Project V development

---

## What Watchtower is

Watchtower takes the World Monitor foundation and extends it into a desktop-oriented intelligence workspace designed around configurable desks, movable panels, local workflows, and Project V integrations.

The goal is not simply to mirror the upstream web dashboard. Watchtower is intended to function as a persistent desktop command center where users can organize information, monitor changing conditions, research events, work with maps and media, and connect supporting Project V tools.

## Highlights

Current Project V work includes capabilities such as:

- configurable, movable and resizable workspace panels
- saved desks and workspace layouts
- map-based situational awareness
- alert center and geofenced monitoring
- dedicated communications and video/camera workflows
- research and case-oriented tools
- OSINT utilities and source aggregation
- watchlists and timelines
- local-first AI assistance
- Project V // Phoenix integration
- modular/plugin-oriented tools
- Windows desktop packaging through Tauri
- portable deployment workflows
- local storage and privacy-oriented operation

## Map and monitoring

Watchtower expands the map into a broader operational surface for intelligence and monitoring.

Project V development includes or is exploring layers and workflows for:

- weather
- aviation
- fire activity
- infrastructure
- alerts and incidents
- geographic watch areas
- operational map annotations
- satellite / Earth-style viewing

Map functionality evolves independently from the upstream World Monitor presentation and may differ significantly between Project V releases.

## Desks and workspaces

Watchtower is designed around persistent workspaces rather than a single fixed dashboard.

Users can organize different monitoring tasks into dedicated desks, including combinations of:

- map panels
- alerts
- research tools
- video feeds
- communications
- watchlists
- timelines
- analyst utilities

Layouts can be adjusted to fit the task instead of forcing every workflow into one static interface.

## Video and camera workflows

Project V builds include dedicated concepts for live media monitoring, including:

- YouTube and public video sources
- news streams
- live cameras
- camera-wall layouts
- multi-source monitoring

Availability depends on the selected source and release.

## Local AI and Phoenix integration

Watchtower is designed to work with **Project V // Phoenix** as a local assistant and analysis layer.

The integration is intended to pass structured Watchtower context to Phoenix for follow-up analysis while preserving source context and avoiding unsupported claims.

Phoenix remains a separate Project V application with its own permissions, memory, and tool controls.

## Research and analyst tools

Watchtower includes Project V additions for research-oriented workflows such as:

- research libraries
- source review
- case handoff
- watchlists
- timelines
- saved operational context
- alert review
- investigation-oriented utilities

The exact tool set may vary by release.

## Local-first design

Project V favors local operation where practical.

Watchtower is intended to keep workspace state, layouts, research context, and local integrations under the user's control while still allowing public data sources and APIs to be used where configured.

Do not commit private configuration, credentials, API keys, local databases, or user-specific intelligence data to this repository.

## Building from source

This repository contains the Project V Watchtower source tree.

Typical development setup uses Node.js / npm together with the Tauri desktop toolchain.

A common development flow is:

```powershell
npm install
npm run typecheck
npm run desktop:dev
```

Build scripts and prerequisites may change as the project evolves. Review `package.json`, the Tauri configuration, and current release documentation before producing a packaged build.

## Project V ecosystem

Watchtower is part of the broader Project V ecosystem, which includes projects such as:

- **Phoenix** — local AI assistant and intelligence platform
- **Gatekeeper** — firewall and privacy control
- **Blacklight** — antivirus and local threat protection
- **Vault** — encrypted virtual storage
- **Navigator** — file management
- **Trace** — executable analysis
- **Process Lab** — process and memory analysis
- **Chronicle** — archival and provenance research
- **Project V Browser** — privacy-focused browser

These projects are developed independently and may integrate with Watchtower where useful.

---

## Upstream relationship

Project V // Watchtower is a **modified downstream fork** of World Monitor.

World Monitor remains the upstream project and is not affiliated with or responsible for Project V // Watchtower.

Project V does not claim ownership of upstream World Monitor code or documentation. Upstream authors retain copyright in their original contributions, while Project V contributors retain copyright in their original downstream modifications and additions.

The combined covered work remains distributed under **AGPL-3.0-only**.

See:

- [LICENSE](LICENSE)
- [NOTICE.md](NOTICE.md)
- [UPSTREAM_AND_LICENSE.md](UPSTREAM_AND_LICENSE.md)

for the applicable license, attribution, and upstream relationship information.

## Trademarks and branding

**Project V**, **Project V // Watchtower**, and associated Project V branding identify the downstream Project V project.

World Monitor names and branding belong to their respective owners. Nothing in this repository implies endorsement by the upstream World Monitor project.

---

## Repository notes

This repository tracks the Project V Watchtower source and public project documentation.

Please avoid committing:

- `.env` or `.env.local`
- API keys or access tokens
- private signing material
- local databases
- build output
- IDE caches
- machine-specific state
- private research data

The public `.env.example` template may be retained when it contains placeholders only and no real secrets.

---

**Project V Official**  
**Project V // Watchtower**
