# Project V Watchtower — Phase Fifteen

## Camera Wall and Stream Management

Phase Fifteen adds a dedicated Project V camera-monitoring workspace while keeping the main command deck uncluttered.

### Opening the Camera Wall

Use any of the following:

- Select **CAMERAS → WALL** in the upper operations bar.
- Open **MODULES → LIVE OPERATIONS → CAMERA WALL**, then select **OPEN CAMERA WALL**.
- Select the monitor icon in the existing **Live Webcams** panel.
- Say **“Open Camera Wall”** through the Voice Command Center.

In Tauri desktop mode, the Camera Wall opens as a separate trusted Project V window. In browser development, it opens as a popup window.

### Included capabilities

- Saved stream groups
- One-large-plus-four layout
- Two-by-two layout
- Three-by-three layout
- Single-focus layout
- Built-in public webcam shortcuts
- Custom YouTube live/video sources
- Custom HLS `.m3u8` sources
- Custom HTTPS embed sources
- Mute-all control
- Per-stream source and full-screen controls
- Basic stream-health state
- Optional automatic retry for failed streams
- Full-window full-screen mode
- Local configuration persistence
- Project Lock protection

Camera Wall settings are stored under:

```text
project-v-camera-wall-v1
```

Because this key begins with `project-v-`, it is automatically included in Project V configuration and full backups.

## Assistant scrolling repair

The separate Command Assistant window now has a properly bounded conversation area with its own visible vertical scrollbar. Long Ollama responses remain inside the message region instead of extending beyond the bottom of the window.

The prompt rail and message history scroll independently, while the composer remains available at the bottom of the Assistant window.

## Running Phase Fifteen

For the full desktop experience:

```powershell
npm install
npm run desktop:dev
```

For browser development:

```powershell
npm run dev
```

## Stream compatibility

Provider behavior varies:

- YouTube sources use the existing Project V local embed route in desktop mode.
- HLS support depends on the codecs and playback support available in WebView2 or the browser.
- Some websites block iframe embedding through their own security headers.
- Project V does not bypass sign-in requirements, stream ownership rules, paywalls, or provider access controls.
- Only public streams and sources the analyst is authorized to view should be added.

RTSP ingestion, local recording, motion detection, video archiving, and evidence-frame capture are not included in this phase. They can be considered as later Camera Wall expansions.

## Validation performed

- Camera registry persistence simulation
- YouTube URL and video-ID normalization
- Custom stream creation and removal
- Stream-group creation and removal
- TypeScript syntax validation for modified files
- Workspace layout collision review
- JSON parsing
- HTML entry-point checks
- CSS brace and selector checks
- Tauri command-registration checks
- ZIP archive-integrity testing

A complete Windows Tauri build must still be compiled and exercised locally because the packaging environment does not include Rust/Tauri tooling or the complete project dependency installation.
