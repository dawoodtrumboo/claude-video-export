# Claude Video Export

> Export Claude Design and Claude Artifact animations to **4K / 60fps H.264 MP4** — frame-accurate, headless, zero per-project scripting.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![ffmpeg](https://img.shields.io/badge/ffmpeg-bundled-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Drag a **Stage-based** Claude design project folder in, get a silent **4K / 60fps H.264 MP4** out. No manual ffmpeg, no per-project scripting.

It renders every frame deterministically in headless Chromium at 2× (true supersampled 4K) and encodes with a bundled ffmpeg.

---

## Who this is for

- You're building **animated videos in Claude Design / Claude Artifacts** (or any React `<Stage>`-based timeline) and want to ship them as real video files instead of screen recordings.
- You need **4K / 60fps**, deterministic, frame-perfect output — no dropped frames, no jitter, no manual `ffmpeg` incantations.
- You want to **batch-export many animation projects** at once (e.g. a 30-day reel series) without writing per-project export scripts.

---

## Requirements

- **Node.js 18+** (ESM-only — `package.json` uses `"type": "module"`)
- **npm** (or your favourite Node package manager)
- ~500 MB free disk for the Chromium browser Playwright downloads on first install
- macOS, Linux, or Windows

You do **not** need a system ffmpeg — a static binary ships with `ffmpeg-static`.

---

## Local setup

```bash
git clone https://github.com/dawoodtrumboo/claude-video-export.git
cd claude-video-export
npm install
npx playwright install chromium
```

That's it. Verify the install:

```bash
npm start
```

Open <http://localhost:4747> — the drag-and-drop UI should load.

> **Why the extra `playwright install` step?** Playwright doesn't bundle the browser binary with its npm package — it downloads it on demand. If you already have Playwright's Chromium installed elsewhere, this step is a no-op.

---

## Use — drag & drop web app

```bash
npm start          # → http://localhost:4747
```

Open the page, **drop your project folder**, pick **4K/60** (or 1080p/30), and download the MP4 when it finishes. Progress (frames rendered, fps, ETA, encode) streams live.

## Use — command line

```bash
node cli.mjs "/path/to/My Project" --res 4k --fps 60 --out trailer.mp4
```

Flags: `--res 4k|1080p` · `--fps 60|30` · `--out file.mp4` · `--workers 6`

## Bulk import (many projects at once)

Flip the **Single project / Bulk import** toggle on the page, then drop a **parent folder** containing several project subfolders (or drop multiple project folders together). Each Stage-based project becomes its own MP4 — with a live per-project progress list, a download per video, and a **Download all (.zip)** button. Settings (resolution / fps / voiceover) apply to the whole batch; each project's own `voiceover.*` is auto-muxed.

Projects render **sequentially** (each still uses parallel workers internally), and one failing project never aborts the rest.

CLI equivalent:

```bash
node cli.mjs "/path/to/parent-of-projects" --batch --res 4k --fps 60 [--out <dir>] [--silent]
```

Outputs one `<project-folder>.mp4` per project into `<out>` (default `<parent>/__exports`).

---

## How it works / requirements

- The animation must be a **pure function of time** — i.e. built on the `animations.jsx` `<Stage>` starter (which all Claude "video" artifacts use). Every frame is produced by seeking the timeline, so there are **no dropped frames**.
- Your project's `animations.jsx` is **auto-upgraded** at serve time to the export-ready version in `starter/animations.jsx` (adds a chrome-free `?__render=1` mode and exposes `window.__seek` / `window.__videoMeta`). Existing projects need **no edits**.
- Canvas size, duration, and fps are read automatically from `<Stage>`.

### Voiceover / audio

Drop a finished audio track into the project folder and the export comes out **with sound** — muxed during the encode pass (no extra video re-encode).

- **Detection:** a file named `voiceover.*` / `narration.*` / `*mix*` (or the single audio file present) — `.mp3 .wav .m4a .aac .ogg .flac`. Output `.mp4`s and frame dirs are ignored.
- **Sync is in the file:** the converter doesn't time anything — it overlays the track at t=0. Produce the VO already synced to the animation's timeline, then drop it in.
- **Auto tail-hold:** if the audio runs longer than the animation (e.g. an end-card beat), the last frame is held so the audio finishes — no clipped CTA.
- Toggle **Voiceover: Include / Silent** in the UI (or `audio:false` / CLI default on).

#### Works with any TTS or recorded voiceover

The exporter is **audio-source-agnostic** — it doesn't call any TTS API. Generate the voiceover wherever you like, save it as one of the supported formats, drop it in the project folder, and the encoder will mux it.

Common upstream tools that work out of the box:

- **AI voice / TTS:** [ElevenLabs](https://elevenlabs.io), [PlayHT](https://play.ht), [Murf](https://murf.ai), [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech), [Azure Speech](https://azure.microsoft.com/en-us/products/ai-services/ai-speech), [Google Cloud TTS](https://cloud.google.com/text-to-speech), [Amazon Polly](https://aws.amazon.com/polly/), [Resemble.ai](https://www.resemble.ai), [WellSaid Labs](https://wellsaidlabs.com).
- **Hand-recorded:** any DAW that exports `.mp3` / `.wav` / `.m4a` / `.aac` / `.ogg` / `.flac` — Logic Pro, Adobe Audition, GarageBand, Reaper, Audacity, Descript.

**Recommended pipeline for AI voiceovers:**

1. Write the script timed to your animation's `<Stage>` `duration`.
2. Generate the audio in your TTS provider of choice (ElevenLabs / OpenAI / Murf / etc.).
3. (Optional) Open the rendered animation alongside the audio in a DAW, nudge for sync, export a single mix.
4. Save the file as `voiceover.mp3` (or similar) in the project folder.
5. Run the exporter — it auto-detects and muxes.

### Authoring tips

- To keep an in-canvas control out of the export (a CC toggle, a debug button…), add `data-export-hide` to it.
- Avoid wall-clock motion (CSS `@keyframes`, `Math.random()`, `Date.now()`); drive everything from `useTime()` so frames are reproducible.

---

## Generating compatible projects with Claude Design

Claude Design can produce arbitrary animations — but only **Stage-based** projects are exportable here. Use one of the prompts below to make sure the artifact it generates (or rewrites) hits the exporter's contract.

### Prompt — new animation projects

Paste this when starting an animation in Claude Design that you intend to export later:

```text
Build this as an animated video using the `animations.jsx` Stage starter.

Hard requirements (must follow for the exporter to work):
- Call `copy_starter_component` with kind: "animations.jsx" — do not hand-roll the timeline.
- Wrap the scene in a single <Stage> with explicit `width`, `height`, and `duration` (seconds). Pick fps via `fps` if you want anything other than 60.
- Drive ALL motion from `useTime()` or by wrapping content in `<Sprite start={…} end={…}>`. Use Easing + interpolate() for tweens.
- No wall-clock or non-deterministic motion anywhere:
  - No CSS `@keyframes` / `animation` / `transition` for animated elements
  - No `Date.now()`, `performance.now()`, `Math.random()` inside render
  - No `setTimeout` / `setInterval` / `requestAnimationFrame` for animation timing — read time from `useTime()` instead
- Add `data-export-hide` to any in-canvas UI (debug toggles, CC buttons, controls) so it's omitted from the export.
- Every visual element that needs timing must live inside the Stage tree.

Pure function of time = every frame must look identical on every render. If a value isn't derived from the current playhead, it can't move.
```

### Prompt — retrofit an existing project

Paste this when handing Claude Design an existing animation project that needs to be made export-compatible:

```text
Audit this project for compatibility with the claude-video-export tool and rewrite anything that breaks the contract.

Step 1 — Detect the current shape:
- Does the project already use <Stage> from `animations.jsx`? If yes and all motion is driven from `useTime()` / <Sprite>, you're done — the exporter auto-upgrades animations.jsx at serve time, no edits needed.
- If it uses raw CSS @keyframes, GSAP, Lottie, Framer Motion, plain <video>, or any time source other than the Stage timeline, it must be rebuilt on Stage.

Step 2 — Migration (only if Step 1 found violations):
- Replace the current animation root with <Stage width={…} height={…} duration={…}>.
- Convert every animated element to either:
  (a) live inside a <Sprite start end> window, or
  (b) read its current value from `useTime()` and Easing/interpolate().
- Replace CSS @keyframes rules with `useTime()`-driven inline styles or transforms.
- Replace `setTimeout` / `setInterval`-based scene transitions with <Sprite start end> windows.
- Strip `Math.random()`, `Date.now()`, `performance.now()` from render — derive any "random-looking" motion from a seeded function of time.
- Add `data-export-hide` to any UI chrome that shouldn't appear in the export.

Step 3 — Verify:
- Total duration of all <Sprite> end times ≤ Stage `duration`.
- Scrubbing the Stage playhead to any time t produces a deterministic frame (refresh = same pixels).
```

### Quick sanity check before exporting

Open the project in a browser, navigate to its HTML with `?__render=1` appended (e.g. `index.html?__render=1`), and in the devtools console run:

```js
window.__videoMeta   // → { width, height, duration, fps }  if export-ready
window.__seek(2.5)   // → jumps to t=2.5s; should land on a reproducible frame
```

If both work, the exporter will accept it. If `__videoMeta` is `undefined`, the project isn't Stage-based yet — re-run the retrofit prompt.

---

## Project layout

```
video-exporter/
├── server.mjs            local web app (upload → render → download)
├── engine.mjs            capture + encode engine (reusable)
├── cli.mjs               command-line wrapper
├── public/index.html     drag-and-drop UI
└── starter/animations.jsx  export-ready <Stage> (drop into new projects too)
```

---

## Troubleshooting

**`Project is not export-ready: no <Stage> with window.__videoMeta detected`**
The project you dropped isn't built on the `animations.jsx` `<Stage>` starter — only Stage-based Claude design projects can be exported. Anything driven by raw CSS `@keyframes`, Lottie, GSAP, plain `<video>` tags, etc. is not supported. Rebuild the animation in Stage and try again.

**`Error: listen EADDRINUSE: address already in use :::4747`**
Something else is on port 4747. Kill it (`lsof -i :4747` then `kill <pid>`) or change the port: `PORT=5000 npm start`.

**`browserType.launch: Executable doesn't exist`**
You skipped `npx playwright install chromium`. Run it now.

**Output video has skips, jitter, or random elements moving**
The project is using wall-clock motion (CSS `@keyframes`, `Date.now()`, `Math.random()`, `requestAnimationFrame` deltas) instead of `useTime()`. Frames must be a pure function of time — see *Authoring tips* above.

**Audio cuts off / isn't included**
Check the filename — it must match `voiceover.*` / `narration.*` / `*mix*` and be one of `.mp3 .wav .m4a .aac .ogg .flac`. Toggle the **Voiceover: Include** option in the UI / drop `audio:true` in the CLI flags.

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and ground rules.

## License

[MIT](LICENSE).
