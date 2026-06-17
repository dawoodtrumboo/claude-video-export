# Claude Video Export

Drag a **Stage-based** Claude design project folder in, get a silent **4K / 60fps H.264 MP4** out. No manual ffmpeg, no per-project scripting.

It renders every frame deterministically in headless Chromium at 2× (true supersampled 4K) and encodes with a bundled ffmpeg.

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
git clone https://github.com/<your-username>/claude-video-export.git
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
- **Sync is in the file:** the converter doesn't time anything — it overlays the track at t=0. Produce the VO already synced to the animation's timeline (script → ElevenLabs → mix), then drop it in.
- **Auto tail-hold:** if the audio runs longer than the animation (e.g. an end-card beat), the last frame is held so the audio finishes — no clipped CTA.
- Toggle **Voiceover: Include / Silent** in the UI (or `audio:false` / CLI default on).

### Authoring tips

- To keep an in-canvas control out of the export (a CC toggle, a debug button…), add `data-export-hide` to it.
- Avoid wall-clock motion (CSS `@keyframes`, `Math.random()`, `Date.now()`); drive everything from `useTime()` so frames are reproducible.

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
