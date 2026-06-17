// Render the 30 Tripdocks reel covers (1080×1920) to PNGs via headless Chromium —
// native render of the design's ReelCover component (real fonts, pixel-perfect).
//   node render-covers.mjs <coversProjectDir> <outDir>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.argv[2];
const OUT = process.argv[3];
if (!ROOT || !OUT) { console.error('usage: node render-covers.mjs <coversProjectDir> <outDir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.jsx':'application/javascript; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.json':'application/json' };

const server = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    try {
      const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const port = server.address().port;

async function launch() {
  for (const opts of [{ channel:'chromium' }, { channel:'chrome' }, {}]) {
    try { return await chromium.launch(opts); } catch (e) {}
  }
  throw new Error('no chromium');
}
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// Discover days from the COVERS dataset (works for Day-31+); optional --days 31,32 override.
const kitSrc = fs.readFileSync(path.join(ROOT, 'covers', 'cover-kit.jsx'), 'utf8');
let DAYS = [...new Set([...kitSrc.matchAll(/\{\s*day:\s*(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
const di = process.argv.indexOf('--days');
if (di >= 0) DAYS = process.argv[di + 1].split(',').map(Number);
if (!DAYS.length) { console.error('no COVERS entries found in covers/cover-kit.jsx'); process.exit(1); }

let ok = 0;
for (const day of DAYS) {
  const url = `http://127.0.0.1:${port}/covers_render.html?day=${day}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  try {
    await page.waitForFunction(() => window.__coverReady === true && document.querySelector('.artboard'), { timeout: 30000 });
  } catch { console.log(`Day-${String(day).padStart(2,'0')}  ✗ not ready`); continue; }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(450);
  const out = path.join(OUT, `cover-${String(day).padStart(2,'0')}.png`);
  await page.screenshot({ path: out, clip: { x:0, y:0, width:1080, height:1920 } });
  ok++; console.log(`Day-${String(day).padStart(2,'0')}  ✓ ${path.basename(out)}`);
}
await browser.close(); server.close();
console.log(`\nrendered ${ok}/${DAYS.length} → ${OUT}`);
