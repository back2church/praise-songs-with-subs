# Praise Songs with Subs

A small web app that turns a song (audio or video file) plus its lyrics into a
distraction-free sing-along worship video: calm moving background, one line at a
time, and the lyrics appear **1–2 seconds ahead** of the singing so the
congregation can sing along.

Everything runs in the browser. The song never leaves the device.

## How it works

1. **Song** – choose an audio or video file (MP3, M4A, WAV, MP4, …).
2. **Lyrics** – paste the text (one line per screen, written out as sung) or load a
   `.txt`, `.lrc`, `.srt` or `.vtt` file. Timestamps are used if present.
3. **Timing** – three ways:
   - *Tap along*: play the song and press <kbd>Space</kbd> when each line starts
     (<kbd>B</kbd> = empty screen for instrumentals, <kbd>⌫</kbd> = step back).
   - *Auto-sync (AI)*: Whisper speech recognition runs in the browser and matches
     your lyrics to the recording. Without lyrics it writes them from what it hears
     (proofread!). The model (~40–250 MB) is downloaded once and cached.
   - Edit any time by hand, or shift everything by ±0.1 / ±0.5 s.
4. **Look** – lead time (0–3 s, default 1.5 s), animated background and colours,
   font, size, position, optional next-line preview, or your own background
   image / video.
5. **Show & export** – present fullscreen, or export a video file
   (MP4 where the browser supports it, otherwise WebM; recorded in real time).
   Timing can be saved as `.lrc` (reload it later) or as `.srt` subtitles that
   already include the lead time.

## Run it

Needs [Node.js](https://nodejs.org) or Python installed, and a current Chrome or Edge
(Firefox works, Safari has limited export support). No build step.

- **Windows:** double-click `start.bat`
- **macOS:** double-click `start.command` (first time: right-click → Open)
- **Linux:** run `./start.sh`

This starts a local server and opens the app in your browser. Close the window to stop it.

Alternatively: `npm start` (then open http://localhost:8080) and `npm test`
for the unit tests (Node 20+). Don't open `index.html` directly from disk – the
speech worker needs `http://`.

## Design

| File | Role |
| --- | --- |
| `js/lyrics.js` | Cue model, LRC/SRT/VTT/plain parsing, export, lyrics-to-speech alignment |
| `js/backgrounds.js` | Procedural animated backgrounds (pure functions of time) |
| `js/renderer.js` | Draws one frame: background + lyrics shown `lead` seconds early |
| `js/transcribe-worker.js` | Whisper (transformers.js) in a web worker |
| `js/app.js` | UI, tap-sync, fullscreen, recording via `MediaRecorder` |

Preview, fullscreen and export all draw the same canvas, so the exported video
is exactly what you see.

## Copyright note

Most worship songs and lyrics are protected. Make sure your church licence
(e.g. CCLI, including a streaming licence for online use) covers how you show
or publish the videos. The subtitle field is meant for author / copyright / licence
number.
