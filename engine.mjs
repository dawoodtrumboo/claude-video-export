// Export engine: serve a Stage-based project, drive its timeline frame-by-frame
// in headless Chromium (2× supersample), and encode an H.264 MP4 with ffmpeg.
//
// Works on any project whose animation is a pure function of time (the
// animations.jsx <Stage> starter). The project's animations.jsx is transparently
// swapped for the export-ready one (adds ?__render=1 + window.__seek/__videoMeta),
// so existing projects need no edits.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENHANCED_ANIMATIONS = path.join(__dirname, 'starter', 'animations.jsx');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

// Static file server rooted at the directory holding the main HTML.
// Any request for a file named `animations.jsx` is served the export-ready version.
function startServer(rootDir, { upgradeAnimations = true } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (upgradeAnimations && path.basename(urlPath) === 'animations.jsx' && fs.existsSync(ENHANCED_ANIMATIONS)) {
          res.writeHead(200, { 'Content-Type': MIME['.jsx'] });
          fs.createReadStream(ENHANCED_ANIMATIONS).pipe(res);
          return;
        }
        const fp = path.join(rootDir, urlPath);
        if (!fp.startsWith(rootDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Find the project's main HTML: prefer one that mounts <Stage> / loads animations.jsx,
// excluding obvious non-entrypoints (standalone bundles, our render harness).
export function findMainHtml(rootDir) {
  const htmls = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) { if (!/node_modules|__export|\.git/.test(name)) walk(fp); }
      else if (/\.html?$/i.test(name)) htmls.push(fp);
    }
  })(rootDir);
  if (!htmls.length) return null;
  const scored = htmls.map((fp) => {
    const txt = fs.readFileSync(fp, 'utf8');
    let s = 0;
    if (/<Stage[\s>]/.test(txt)) s += 5;
    if (/animations\.jsx/.test(txt)) s += 3;
    if (/__render|__seek/.test(txt)) s += 1;
    if (/standalone/i.test(path.basename(fp))) s -= 4;
    if (/render|harness/i.test(path.basename(fp))) s -= 2;
    s -= path.relative(rootDir, fp).split(path.sep).length * 0.1; // prefer shallow
    return { fp, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].fp;
}

// Score a single HTML file for "is this a Stage entrypoint" (shared by findProjects).
function scoreStageHtml(fp) {
  let txt = '';
  try { txt = fs.readFileSync(fp, 'utf8'); } catch { return -99; }
  let s = 0;
  if (/<Stage[\s>]/.test(txt)) s += 5;
  if (/animations\.jsx/.test(txt)) s += 3;
  if (/__render|__seek/.test(txt)) s += 1;
  if (/standalone/i.test(path.basename(fp))) s -= 4;
  if (/render|harness/i.test(path.basename(fp))) s -= 2;
  return s;
}

// Detect every Stage-based project under a dropped folder (for batch export).
// A "project" = a directory that DIRECTLY contains a <Stage> HTML; once found we
// record it and stop descending, so its own assets aren't counted as more projects.
export function findProjects(rootDir) {
  const projects = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let best = null, bestScore = 2;            // require a real Stage/animations HTML (score >= 3)
    for (const e of entries) {
      if (e.isFile() && /\.html?$/i.test(e.name)) {
        const sc = scoreStageHtml(path.join(dir, e.name));
        if (sc > bestScore) { bestScore = sc; best = e.name; }
      }
    }
    if (best) { projects.push({ dir, html: best, name: path.basename(dir) }); return; } // project root — don't descend
    for (const e of entries) {
      if (e.isDirectory() && !/node_modules|__export|\.git|frames|__vo/i.test(e.name)) walk(path.join(dir, e.name));
    }
  })(rootDir);
  return projects;
}

// Find a finished voiceover/audio track to bake in (named voiceover/narration/mix…,
// else the single audio file present). Output mp4s and frame dirs are ignored.
export function findAudio(rootDir) {
  const audios = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) { if (!/node_modules|__export|\.git|frames/i.test(name)) walk(fp); }
      else if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) audios.push(fp);
    }
  })(rootDir);
  if (!audios.length) return null;
  const score = (fp) => {
    const n = path.basename(fp).toLowerCase(); let s = 0;
    if (/voice[\s_-]?over|narration|soundtrack|final|mix|\bvo\b/.test(n)) s += 5;
    if (/audio|sound|music/.test(n)) s += 2;
    s -= path.relative(rootDir, fp).split(path.sep).length * 0.1;
    return s;
  };
  return audios.sort((a, b) => score(b) - score(a))[0];
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const ff = spawn(ffmpegPath, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    ff.stderr.on('data', (d) => { s += d.toString(); });
    ff.on('close', () => { const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0); });
    ff.on('error', () => resolve(0));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Launch a browser that renders correctly. Playwright's default bundled
// "headless shell" mis-composites backdrop-filter / blur under transforms; the
// full chromium (new headless) and system Chrome render them like a real browser.
// Prefer full chromium → system Chrome → plain bundled (last resort).
async function launchBrowser() {
  const args = ['--force-color-profile=srgb'];
  const attempts = [{ channel: 'chromium', args }, { channel: 'chrome', args }, { args }];
  let lastErr;
  for (const opts of attempts) {
    try { return await chromium.launch(opts); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function targetDims(meta, res) {
  if (res && typeof res === 'object' && res.width && res.height) return { w: res.width, h: res.height };
  const even = (n) => Math.round(n / 2) * 2;
  const aspect = meta.width / meta.height;
  if (res === '1080p') { const h = 1080; return { w: even(h * aspect), h }; }
  // '4k' (default): target 2160 tall, width by aspect (3840×2160 for 16:9)
  const h = 2160; return { w: even(h * aspect), h };
}

export async function exportVideo(opts) {
  const {
    projectDir, htmlFile, outPath,
    res = '4k', fps: fpsOverride, workers = 6,
    jpegQuality = 95, crf = 17, superSample = 2,
    audio = true,             // true = auto-detect a voiceover file; false = silent; or a relative path
    onProgress = () => {},
  } = opts;

  const mainHtml = htmlFile ? path.join(projectDir, htmlFile) : findMainHtml(projectDir);
  if (!mainHtml || !fs.existsSync(mainHtml)) throw new Error('No HTML entry file found in the project.');
  const rootDir = path.dirname(mainHtml);
  const htmlName = path.basename(mainHtml);

  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found — run `npm install`.');

  onProgress({ stage: 'launch', message: 'Starting headless browser…' });
  const server = await startServer(rootDir);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/${encodeURIComponent(htmlName)}?__render=1`;
  const browser = await launchBrowser();

  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cve-frames-'));
  let meta, dims, fps, total;
  try {
    // probe meta on one page
    const probe = await browser.newPage();
    probe.on('pageerror', (e) => onProgress({ stage: 'warn', message: 'page error: ' + e.message }));
    await probe.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    try {
      await probe.waitForFunction(() => window.__ready === true && window.__videoMeta && typeof window.__seek === 'function', { timeout: 30000 });
    } catch {
      throw new Error('Project is not export-ready: no <Stage> with window.__videoMeta detected. Make sure it uses the animations.jsx Stage starter.');
    }
    meta = await probe.evaluate(() => window.__videoMeta);
    await probe.close();

    fps = fpsOverride || meta.fps || 60;
    dims = targetDims(meta, res);
    total = Math.round(meta.duration * fps);
    onProgress({ stage: 'meta', message: `${meta.width}×${meta.height} · ${meta.duration}s · ${fps}fps → ${dims.w}×${dims.h}`, meta, dims, fps, total });

    // parallel capture
    const t0 = Date.now();
    let done = 0;
    const per = Math.ceil(total / workers);
    const ranges = [];
    for (let s = 0; s < total; s += per) ranges.push([s, Math.min(s + per, total)]);

    await Promise.all(ranges.map(async ([start, end]) => {
      const ctx = await browser.newContext({ viewport: { width: meta.width, height: meta.height }, deviceScaleFactor: superSample });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => window.__ready === true && typeof window.__seek === 'function', { timeout: 30000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.waitForTimeout(400);
      for (let i = start; i < end; i++) {
        const f = path.join(framesDir, `f_${String(i).padStart(6, '0')}.jpg`);
        await page.evaluate((sec) => new Promise((r) => { window.__seek(sec); requestAnimationFrame(() => requestAnimationFrame(() => r())); }), i / fps);
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: meta.width, height: meta.height }, type: 'jpeg', quality: jpegQuality });
        fs.writeFileSync(f, buf);
        done++;
        if (done % 30 === 0 || done === total) {
          const cfps = done / ((Date.now() - t0) / 1000);
          onProgress({ stage: 'capture', done, total, fps: +cfps.toFixed(2), eta: +(((total - done) / cfps) || 0).toFixed(0) });
        }
      }
      await page.close(); await ctx.close();
    }));
  } finally {
    await browser.close();
    server.close();
  }

  // detect a finished voiceover/audio track to bake in
  let audioPath = null, audioDur = 0;
  if (audio !== false) {
    audioPath = (typeof audio === 'string' && audio) ? path.join(rootDir, audio) : findAudio(rootDir);
    if (audioPath && fs.existsSync(audioPath)) {
      audioDur = await probeDuration(audioPath);
      onProgress({ stage: 'audio', message: `Including audio: ${path.basename(audioPath)} (${audioDur.toFixed(1)}s)`, audio: path.basename(audioPath) });
    } else audioPath = null;
  }
  const videoDur = total / fps;
  const pad = audioPath ? Math.max(0, audioDur - videoDur) : 0; // hold last frame so the audio finishes

  // encode (frames → H.264, muxing audio in the same pass if present)
  onProgress({ stage: 'encode', message: audioPath ? 'Encoding MP4 with audio…' : 'Encoding MP4…' });
  await new Promise((resolve, reject) => {
    const scale = `scale=${dims.w}:${dims.h}:flags=lanczos`;
    const args = ['-y', '-framerate', String(fps), '-start_number', '0', '-i', path.join(framesDir, 'f_%06d.jpg')];
    if (audioPath) args.push('-i', audioPath);
    if (audioPath && pad > 0.04) {
      args.push('-filter_complex', `[0:v]${scale},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[v]`, '-map', '[v]', '-map', '1:a');
    } else if (audioPath) {
      args.push('-vf', scale, '-map', '0:v', '-map', '1:a');
    } else {
      args.push('-vf', scale);
    }
    args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps));
    if (audioPath) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart', outPath);
    const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    ff.stderr.on('data', () => {});
    ff.on('close', (c) => c === 0 ? resolve() : reject(new Error('ffmpeg exited ' + c)));
    ff.on('error', reject);
  });

  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
  const size = fs.statSync(outPath).size;
  // 'encoded' (not 'done') — the server owns the final 'done' event that carries the download URL.
  const result = { outPath, width: dims.w, height: dims.h, fps, frames: total, duration: meta.duration, size, audio: audioPath ? path.basename(audioPath) : null };
  onProgress({ stage: 'encoded', ...result });
  return result;
}

// Batch: render one MP4 per Stage-based project found under rootDir. Projects run
// sequentially (each still uses `workers` parallel pages internally). A failing
// project is recorded and skipped — it never aborts the rest. Wraps exportVideo;
// does not alter single-export behavior.
export async function exportBatch(opts) {
  const {
    rootDir, outDir,
    res = '4k', fps, workers = 6, audio = true,
    onProgress = () => {},
  } = opts;

  const projects = findProjects(rootDir);
  if (!projects.length) throw new Error('No Stage-based projects found in the upload (each project needs its own .html + animations.jsx).');
  fs.mkdirSync(outDir, { recursive: true });

  const count = projects.length;
  onProgress({ stage: 'batch-start', count, names: projects.map((p) => p.name) });

  const results = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const p = projects[i];
    let safe = (p.name || `project-${i + 1}`).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || `project-${i + 1}`;
    while (used.has(safe.toLowerCase())) safe = `${safe}-${i + 1}`;
    used.add(safe.toLowerCase());
    const outPath = path.join(outDir, `${safe}.mp4`);
    const file = path.basename(outPath);
    onProgress({ stage: 'project-start', index: i, count, name: p.name });
    try {
      const r = await exportVideo({
        projectDir: p.dir, htmlFile: p.html, outPath, res, fps, workers, audio,
        onProgress: (ev) => onProgress({ ...ev, index: i, count, name: p.name, batch: true }),
      });
      results.push({ index: i, name: p.name, file, outPath, ok: true, size: r.size, width: r.width, height: r.height, fps: r.fps, duration: r.duration, audio: r.audio });
      onProgress({ stage: 'project-done', index: i, count, name: p.name, file, size: r.size, width: r.width, height: r.height, fps: r.fps });
    } catch (e) {
      results.push({ index: i, name: p.name, ok: false, error: String((e && e.message) || e) });
      onProgress({ stage: 'project-error', index: i, count, name: p.name, message: String((e && e.message) || e) });
    }
  }

  onProgress({ stage: 'batch-done', count, results });
  return { outDir, results };
}
