#!/usr/bin/env node
// Bonus CLI (the web app wraps the same engine):
//   single: node cli.mjs <project-folder> [--res 4k|1080p] [--fps 60] [--out file.mp4] [--workers 6]
//   bulk:   node cli.mjs <parent-folder> --batch [--res …] [--fps …] [--out <dir>] [--silent]
import path from 'node:path';
import { exportVideo, exportBatch } from './engine.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: node cli.mjs <folder> [--batch] [--res 4k|1080p] [--fps 60] [--out file-or-dir] [--workers 6]'); process.exit(1); }
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const projectDir = path.resolve(dir);

if (args.includes('--batch')) {
  // Bulk: render one MP4 per Stage-based project found under <parent-folder>.
  const outDir = path.resolve(get('out', path.join(projectDir, '__exports')));
  await exportBatch({
    rootDir: projectDir, outDir,
    res: get('res', '4k'),
    fps: get('fps') ? Number(get('fps')) : undefined,
    workers: Number(get('workers', 6)),
    audio: !args.includes('--silent'),
    onProgress: (ev) => {
      if (ev.stage === 'batch-start') console.log(`\nBatch: ${ev.count} project(s) → ${outDir}`);
      else if (ev.stage === 'project-start') process.stdout.write(`\n[${ev.index + 1}/${ev.count}] ${ev.name}\n`);
      else if (ev.stage === 'capture') process.stdout.write(`\r  frames ${ev.done}/${ev.total} (${(ev.done / ev.total * 100).toFixed(0)}%)  ${ev.fps || ''}fps   `);
      else if (ev.stage === 'encode') process.stdout.write('\n  encoding…\n');
      else if (ev.stage === 'project-done') console.log(`  ✓ ${ev.file}  (${ev.width}×${ev.height} · ${ev.fps}fps · ${(ev.size / 1048576).toFixed(1)} MB)`);
      else if (ev.stage === 'project-error') console.log(`  ✗ ${ev.name}: ${ev.message}`);
      else if (ev.stage === 'batch-done') console.log(`\nDone: ${ev.results.filter((r) => r.ok).length}/${ev.count} succeeded → ${outDir}`);
    },
  }).catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
} else {
  const outPath = path.resolve(get('out', path.join(projectDir, 'export-4k60.mp4')));
  await exportVideo({
    projectDir, outPath,
    res: get('res', '4k'),
    fps: get('fps') ? Number(get('fps')) : undefined,
    workers: Number(get('workers', 6)),
    onProgress: (ev) => {
      if (ev.stage === 'meta') console.log('  ' + ev.message);
      else if (ev.stage === 'capture') process.stdout.write(`\r  frames ${ev.done}/${ev.total} (${(ev.done / ev.total * 100).toFixed(0)}%)  ${ev.fps || ''}fps   `);
      else if (ev.stage === 'encode') process.stdout.write('\n  encoding…\n');
      else if (ev.stage === 'encoded') console.log(`  ✓ ${ev.outPath}  (${ev.width}×${ev.height} · ${ev.fps}fps · ${(ev.size / 1048576).toFixed(1)} MB)`);
    },
  }).catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
}
