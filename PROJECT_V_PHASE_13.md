# Project V Watchtower — Phase Thirteen

## Voice Control and Spoken Briefings

Phase Thirteen adds an opt-in voice command channel to the Project V Watchtower command deck and extends the local Command Assistant with push-to-talk dictation and spoken replies.

The feature is intentionally **push-to-talk only**. There is no always-listening wake phrase.

## Voice Command Center

A new **VOICE** control appears in the upper operations bar.

You can also open it with:

```text
Ctrl + Shift + V
```

The Voice Command Center provides:

- Push-to-talk recognition
- A visible live transcript
- A typed-command fallback
- Command-result status
- Visible confirmation for protected actions
- A local recent-command log
- System-voice selection
- Speech rate and pitch controls
- Spoken command confirmations
- Spoken Assistant replies
- Read-last-response and stop-speaking controls

## Supported commands

Examples include:

```text
Open Watchtower
Switch to Live Ops
Open Intelligence
Show the Europe map
Show Alert Center
Show AI Insights
Open Case Desk
Open Data Desk
Open Map Desk
Open Assistant window
Open API Keys
Open Security Center
Brief the desk
Operations brief
Check AI Insights
Research brief
Cross-check archive
Ask Watchtower what changed in Iran
Read last response
Stop speaking
Lock Watchtower
```

Voice requests such as **Brief the desk** or **Ask Watchtower…** are sent to the existing local Ollama Command Assistant. They can use the current workspace, AI Insights, alerts, map operations, and Research Library according to the selected context.

## Protected actions

Voice control does not directly:

- Delete cases or workspaces
- Reset layouts
- Erase research data
- Send Discord, Google Voice, or other communications
- Place calls
- Run arbitrary programs or shell commands

Project Lock requires a visible on-screen confirmation before it is executed.

## Command Assistant voice support

Both Assistant interfaces now include push-to-talk:

- The movable **V // Command Assistant** panel
- The separate **Project V // Command Assistant** window

The Assistant can:

- Transcribe one spoken question
- Submit it automatically when auto-submit is enabled
- Display the transcript before or during submission
- Read the completed local-AI response aloud
- Use the existing **Live Refresh Before Question** option

Live refresh remains limited to data sources already configured inside Watchtower. It does not give Ollama unrestricted web browsing.

## Speech recognition behavior

### Desktop mode

Run:

```powershell
npm run desktop:dev
```

Watchtower first uses an available browser/WebView speech-recognition provider. If that provider is unavailable on Windows, the trusted desktop backend attempts a local Windows `System.Speech` dictation session through Windows PowerShell.

The Windows fallback:

- Listens for one utterance
- Uses the selected language when a matching Windows speech recognizer is installed
- Times out after approximately fifteen seconds
- Is callable only by trusted Project V windows
- Does not save microphone audio

A microphone and a matching Windows speech-language package may be required.

### Browser development mode

Run:

```powershell
npm run dev
```

Recognition depends on the browser's Web Speech API. Some browsers do not support it, and some browser providers may process speech outside the local machine. Project V does not store the microphone audio. Typed commands and spoken replies remain available when recognition is unsupported.

## Spoken output

Spoken replies use the system speech-synthesis voices exposed by Windows or the active browser/WebView.

The Voice Command Center allows you to choose:

- Language
- System voice
- Rate
- Pitch
- Whether Assistant replies are spoken
- Whether command confirmations are spoken

Long Markdown responses are converted to speech-friendly text. Source URLs and code blocks are omitted from spoken playback while remaining visible in the Assistant transcript.

## Local storage

Voice preferences are stored locally under:

```text
project-v-voice-control-v1
```

Recent command history is stored locally under:

```text
project-v-voice-command-history-v1
```

No API key is required for system speech synthesis or the Windows speech-recognition fallback.

## Validation performed

Phase Thirteen validation included:

- Strict targeted TypeScript checks for the voice service and command center
- Strict targeted checking of the separate Assistant window integration
- Syntax validation of all modified TypeScript files
- Voice-command interpretation tests
- Sensitive-command blocking tests
- Speech-friendly Markdown sanitization tests
- JSON parsing checks
- CSS delimiter checks
- ZIP archive-integrity testing

A complete Windows Tauri compile still needs to be performed locally because Rust tooling and the full dependency directory are unavailable in the packaging environment.
