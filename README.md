# Praise Songs with Subs

A small web app that turns a song (audio or video file) plus its lyrics into a
distraction-free sing-along worship video: calm moving background, one line at a
time, and the lyrics appear **1–2 seconds ahead** of the singing so the
congregation can sing along.

Everything runs in the browser. The song never leaves the device.

## How it works

1. **Song** – choose an audio or video file (MP3, M4A, WAV, MP4, …).
2. **Lyrics** – paste the text (one line per screen) or load a
   `.txt`, `.lrc`, `.srt` or `.vtt` file. Timestamps are used if present.
3. **Timing** – three ways:
   - *Tap along*: play the song and press <kbd>Space</kbd> when each line starts
     (<kbd>B</kbd> = empty screen for instrumentals, <kbd>⌫</kbd> = step back).
   - *Auto-sync (AI)*: Whisper speech recognition runs in the browser and matches
     your lyrics to the recording. Without lyrics it writes them from what it hears
     (proofread!). The model (~40–250 MB) is downloaded once and cached.
   - Edit any time by hand, or shift everything by ±0.1 / ±0.5 s.
4. **Look** – lead time (0–3 s, default 1.5 s), animated background and colours,
   font, size, position, or your own background image / video.
5. **Show & export** – present fullscreen, or export a video file
   (MP4 where the browser supports it, otherwise WebM; recorded in real time).
   Timing can be saved as `.lrc` (reload it later) or as `.srt` subtitles.

### Repeated sections

Lyric sheets usually print the chorus once. Two ways to get the repeats:

- **Labels in the text.** A label line (`Chorus`, `[Chorus]`, `Verse 2:`, `Bridge`,
  `Refrain`, `Strophe 1`, or anything in `[brackets]`) names the lines below it and is
  not shown. The same label again, with nothing under it, repeats that section.
  `x2` / `(2x)` after a label or at the end of a line repeats it.

  ```
  Verse 1
  Holy, holy, holy
  LORD GOD Almighty

  Chorus
  Worthy is the Lamb x2

  Verse 2
  …

  Chorus x2
  ```

- **Auto-sync** finds repeats by itself: when the singer returns to lines that the
  sheet lists only once, those lines are added again at the right time.

### When lines are shown

A line is on screen for as long as it is sung – until the next line starts. The
lead time only controls how early the *next* line appears: below the current
line, smaller and dimmer, then it moves up when it is sung. After a break the
next line appears in the main position, slightly dimmed until it is sung.

A line followed by more than 15 s without lyrics leaves by itself after a few
seconds. For exact control add a **Break** (empty cue) where the line should
disappear.

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

## Online

After merging to `main`, a GitHub Actions workflow runs the tests and publishes the app with
GitHub Pages (`https://<owner>.github.io/praise-songs-with-subs/`). If the first deploy fails, enable
*Settings → Pages → Source: GitHub Actions* once. The published site is public.

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
