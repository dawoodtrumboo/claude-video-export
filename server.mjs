// Local web app: drag a Stage-based project folder in, get a 4K/60 MP4 out.
// Pure Node http (no framework). Files upload one-by-one via raw PUT (relative
// path in a header), then the export engine runs and streams progress over SSE.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exportVideo, exportBatch, findMainHtml } from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const WORK = path.join(os.tmpdir(), 'claude-video-export');
fs.mkdirSync(WORK, { recursive: true });

const PORT = Number(process.env.PORT) || 4747;
const jobs = new Map(); // id -> { dir, status, progress, listeners:Set, out, error, result }

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
const safeRel = (p) => path.normalize(p).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
const pushProgress = (job, ev) => {
  job.progress = ev;
  job.history = job.history || [];
  const last = job.history[job.history.length - 1];
  // Collapse transient capture spam (keep only the most-recent capture for the
  // same project) so the replayed history stays small even on long batches.
  if (ev.stage === 'capture' && last && last.stage === 'capture' && last.index === ev.index) job.history[job.history.length - 1] = ev;
  else job.history.push(ev);
  for (const r of job.listeners) { try { r.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} }
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const parts = u.pathname.split('/').filter(Boolean);
  try {
    // --- static UI ---
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
    }

    // --- PUT /u/:job  (x-rel-path header, raw body = one file) ---
    if (req.method === 'PUT' && parts[0] === 'u' && parts[1]) {
      const job = parts[1];
      const rel = safeRel(decodeURIComponent(req.headers['x-rel-path'] || ''));
      if (!rel) return send(res, 400, { error: 'missing x-rel-path' });
      const dir = path.join(WORK, job, 'project');
      const dest = path.join(dir, rel);
      if (!dest.startsWith(dir)) return send(res, 400, { error: 'bad path' });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await readBody(req));
      return send(res, 200, { ok: true });
    }

    // --- POST /start/:job  { res, fps, html } ---
    if (req.method === 'POST' && parts[0] === 'start' && parts[1]) {
      const job = parts[1];
      const cfg = JSON.parse((await readBody(req)).toString() || '{}');
      const projectDir = path.join(WORK, job, 'project');
      if (!fs.existsSync(projectDir)) return send(res, 400, { error: 'no files uploaded' });
      const outPath = path.join(WORK, job, 'output.mp4');
      const J = { dir: projectDir, status: 'running', progress: null, listeners: new Set(), out: outPath, error: null, result: null };
      jobs.set(job, J);
      send(res, 200, { ok: true });
      exportVideo({
        projectDir, htmlFile: cfg.html || undefined, outPath,
        res: cfg.res || '4k', fps: cfg.fps ? Number(cfg.fps) : undefined,
        workers: cfg.workers ? Number(cfg.workers) : 6,
        audio: cfg.audio !== false,
        onProgress: (ev) => pushProgress(J, ev),
      }).then((result) => { J.status = 'done'; J.result = result; pushProgress(J, { stage: 'done', ...result, download: `/dl/${job}` }); })
        .catch((err) => { J.status = 'error'; J.error = String(err.message || err); pushProgress(J, { stage: 'error', message: J.error }); });
      return;
    }

    // --- POST /start-batch/:job  { res, fps, audio }  (bulk: one video per project) ---
    if (req.method === 'POST' && parts[0] === 'start-batch' && parts[1]) {
      const job = parts[1];
      const cfg = JSON.parse((await readBody(req)).toString() || '{}');
      const projectDir = path.join(WORK, job, 'project');
      if (!fs.existsSync(projectDir)) return send(res, 400, { error: 'no files uploaded' });
      const outDir = path.join(WORK, job, 'out');
      const J = { dir: projectDir, status: 'running', progress: null, listeners: new Set(), out: null, error: null, results: null, outDir };
      jobs.set(job, J);
      send(res, 200, { ok: true });
      exportBatch({
        rootDir: projectDir, outDir,
        res: cfg.res || '4k', fps: cfg.fps ? Number(cfg.fps) : undefined,
        workers: cfg.workers ? Number(cfg.workers) : 6,
        audio: cfg.audio !== false,
        onProgress: (ev) => {
          // The engine emits its own raw `batch-done` (for the CLI). We emit an
          // ENRICHED one (zip + per-file download URLs) in .then below, so drop
          // the engine's — otherwise the client receives it first, calls
          // es.close(), and never gets the enriched event (no zip / downloads).
          if (ev.stage === 'batch-done') return;
          if (ev.stage === 'project-done') {
            (J.results = J.results || [])[ev.index] = { index: ev.index, name: ev.name, ok: true, file: ev.file, outPath: path.join(outDir, ev.file), size: ev.size, width: ev.width, height: ev.height, fps: ev.fps };
            pushProgress(J, { ...ev, download: `/b/${job}/${ev.index}` });   // downloadable as soon as it's ready
          } else pushProgress(J, ev);
        },
      }).then((r) => {
        J.status = 'done'; J.results = r.results;
        const anyOk = r.results.some((x) => x.ok);
        pushProgress(J, {
          stage: 'batch-done',
          results: r.results.map((x) => ({ index: x.index, name: x.name, ok: x.ok, error: x.error || null, file: x.file || null, size: x.size || null, width: x.width || null, height: x.height || null, fps: x.fps || null, download: x.ok ? `/b/${job}/${x.index}` : null })),
          zip: anyOk ? `/zip/${job}` : null,
        });
      }).catch((err) => { J.status = 'error'; J.error = String(err.message || err); pushProgress(J, { stage: 'error', message: J.error }); });
      return;
    }

    // --- GET /b/:job/:idx  (download one batch output) ---
    if (req.method === 'GET' && parts[0] === 'b' && parts[1] && parts[2] !== undefined) {
      const J = jobs.get(parts[1]); const idx = Number(parts[2]);
      const item = J && J.results && J.results.find((x) => x.index === idx && x.ok);
      if (!item || !fs.existsSync(item.outPath)) return send(res, 404, { error: 'not ready' });
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${item.file}"`, 'Content-Length': fs.statSync(item.outPath).size });
      return fs.createReadStream(item.outPath).pipe(res);
    }

    // --- GET /zip/:job  (download all batch outputs zipped) ---
    if (req.method === 'GET' && parts[0] === 'zip' && parts[1]) {
      const J = jobs.get(parts[1]);
      const files = ((J && J.results) || []).filter((x) => x.ok && fs.existsSync(x.outPath)).map((x) => x.outPath);
      if (!files.length) return send(res, 404, { error: 'no files' });
      const zipPath = path.join(WORK, parts[1], 'videos.zip');
      try { fs.rmSync(zipPath, { force: true }); } catch {}
      const r = spawnSync('zip', ['-j', '-q', zipPath, ...files], { encoding: 'utf8' });
      if (r.error || r.status !== 0 || !fs.existsSync(zipPath)) return send(res, 500, { error: 'zip failed: ' + (r.stderr || (r.error && r.error.message) || 'zip not available') });
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="videos.zip"', 'Content-Length': fs.statSync(zipPath).size });
      return fs.createReadStream(zipPath).pipe(res);
    }

    // --- GET /progress/:job  (SSE) ---
    if (req.method === 'GET' && parts[0] === 'progress' && parts[1]) {
      const J = jobs.get(parts[1]);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('\n');
      if (!J) { res.write(`data: ${JSON.stringify({ stage: 'error', message: 'unknown job' })}\n\n`); return res.end(); }
      J.listeners.add(res);
      // Replay the FULL ordered history on every (re)connect — the client may
      // attach after batch-start, or auto-reconnect mid-run (long 4K batches).
      // Without this, late joiners miss batch-start (no rows / count=0) and
      // batch-done (no download/zip). The batch UI resets on batch-start, so
      // re-applying the whole stream is idempotent.
      if (J.history && J.history.length) { for (const ev of J.history) res.write(`data: ${JSON.stringify(ev)}\n\n`); }
      else if (J.progress) res.write(`data: ${JSON.stringify(J.progress)}\n\n`);
      req.on('close', () => J.listeners.delete(res));
      return;
    }

    // --- GET /dl/:job  (download mp4) ---
    if (req.method === 'GET' && parts[0] === 'dl' && parts[1]) {
      const J = jobs.get(parts[1]);
      if (!J || !fs.existsSync(J.out)) return send(res, 404, { error: 'not ready' });
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="export-4k60.mp4"', 'Content-Length': fs.statSync(J.out).size });
      return fs.createReadStream(J.out).pipe(res);
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  ▶ Claude Video Export  →  http://localhost:${PORT}\n    Drag a Stage-based design project folder onto the page.\n    Working dir: ${WORK}\n`);
});
