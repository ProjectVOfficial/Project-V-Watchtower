# Project V Watchtower — Phase 19.7 Live Language

Phase 19.7 adds a local-first multilingual speech layer to Watchtower's Live Ops workflow.

## Pipeline

```text
Authorized audio / microphone / shared system audio
→ local 16 kHz audio chunks
→ local Whisper speech recognition
→ original transcript
→ optional local Ollama translation
→ captions + transcript
```

The remote Communications Wall security model is unchanged. Watchtower does not inject transcription code into untrusted provider webviews. Shared/system audio capture is used when audio originates in those isolated windows.

## Persistence

Live Language preferences persist locally. Transcript persistence is optional and disabled by default. Enabling it stores the most recent transcript segments in the Watchtower webview profile; EXPORT TXT creates an explicit analyst copy.

## Phase boundary

This phase establishes live transcription/translation and the UI/cross-window caption foundation. It does not yet perform OCR translation of text inside video frames; `TRANSLATE FRAME` remains a later enhancement.
