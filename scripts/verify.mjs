#!/usr/bin/env node
// Drives the built app in Chromium with a fake webcam fed from real-hand video.
// Usage: npm run build && npm run verify [-- scenario-name ...]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'verification');
const FIXTURES_DIR = path.join(OUT, 'fixtures');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

// Sources: MediaPipe test assets, https://storage.googleapis.com/mediapipe-assets/right_hands.jpg
// and https://storage.googleapis.com/mediapipe-assets/thumb_up.jpg (the wall crop has no hand).
const FIXTURES = {
  hand: {
    image: 'right_hands.jpg',
    filter: 'scale=640:-2,pad=720:540:(ow-iw)/2:(oh-ih)/2:white,crop=640:480:40+5*sin(t*1.3):30+4*sin(t*0.9)',
  },
  nohand: { image: 'wall.jpg', filter: 'crop=170:128:0:0,scale=640:480' },
};

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const IPHONE = { ...devices['iPhone 14'], deviceScaleFactor: 2 };

const SCENARIOS = [
  { name: 'desktop-hand', fixture: 'hand', context: DESKTOP, expectHands: true },
  { name: 'desktop-nohand', fixture: 'nohand', context: DESKTOP, expectHands: false },
  { name: 'iphone14-hand', fixture: 'hand', context: IPHONE, expectHands: true },
];

function buildFixture(name) {
  const { image, filter } = FIXTURES[name];
  const out = path.join(FIXTURES_DIR, `${name}.y4m`);
  if (existsSync(out)) return out;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-loop', '1', '-framerate', '15', '-i', path.join(FIXTURES_DIR, image),
    '-t', '4', '-vf', filter, '-pix_fmt', 'yuv420p', out,
  ]);
  return out;
}

async function startServer() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ missing: run `npm run build` first');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  server.on('exit', (code) => code && console.error(`preview server exited with ${code} (port ${PORT} busy?)`));
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`preview server exited; is port ${PORT} already in use?`);
    try {
      if ((await fetch(BASE)).ok) return server;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error('preview server did not start');
}

const stats = (page) => page.evaluate(() => window.__matrixHands);

/** Share of screenshot pixels that are bright, strongly green: a proxy for lit hand outlines. */
const brightGreenShare = (page, png) =>
  page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round((480 * img.height) / img.width);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 170 && d[i + 1] > d[i] + 50 && d[i + 1] > d[i + 2] + 30) n++;
    return n / (d.length / 4);
  }, `data:image/png;base64,${png.toString('base64')}`);

async function run(scenario) {
  const video = buildFixture(scenario.fixture);
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({ ...scenario.context, permissions: ['camera'] });
  const page = await context.newPage();
  const errors = [];
  const foreign = new Set();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'data:' && url.protocol !== 'blob:') foreign.add(r.url());
  });

  await page.goto(`${BASE}?debug`);
  await page.getByRole('button', { name: 'ENTER' }).click();
  await page.waitForFunction(() => window.__matrixHands?.state === 'running', null, { timeout: 90_000 });
  if (scenario.expectHands) {
    await page.waitForFunction(() => (window.__matrixHands?.framesWithHands ?? 0) >= 3, null, { timeout: 60_000 });
  } else {
    await page.waitForFunction(() => (window.__matrixHands?.detections ?? 0) >= 10, null, { timeout: 60_000 });
  }
  await page.waitForTimeout(4000);
  const s = await stats(page);
  await page.screenshot({ path: path.join(OUT, `${scenario.name}-debug.png`) });
  await page.addStyleTag({ content: '.debug-video, .stats-panel { display: none !important; }' });
  await page.waitForTimeout(300);
  const png = await page.screenshot({ path: path.join(OUT, `${scenario.name}.png`) });
  const green = await brightGreenShare(page, png);
  await browser.close();

  const checks = [
    ['tracker running', s.state === 'running'],
    scenario.expectHands
      ? ['detected >= 1 hand', s.framesWithHands >= 1 && s.hands >= 1]
      : ['no hands detected', s.framesWithHands === 0 && s.hands === 0],
    ['no page errors', errors.length === 0],
    ['only same-origin requests', foreign.size === 0],
  ];
  return { name: scenario.name, stats: s, brightGreenShare: Number(green.toFixed(5)), errors, foreign: [...foreign], checks };
}

const only = process.argv.slice(2);
const server = await startServer();
const results = [];
try {
  for (const scenario of SCENARIOS.filter((s) => only.length === 0 || only.includes(s.name))) {
    const r = await run(scenario);
    results.push(r);
    console.log(`\n${r.name}  delegate=${r.stats.delegate} tier=${r.stats.tier} hands=${r.stats.hands} ` +
      `detections=${r.stats.detections} framesWithHands=${r.stats.framesWithHands} ` +
      `fps(headless, software GL)=${r.stats.fps} brightGreenShare=${r.brightGreenShare}`);
    for (const [label, ok] of r.checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (r.errors.length) console.log('  errors:', r.errors.slice(0, 5));
    if (r.foreign.length) console.log('  foreign requests:', r.foreign);
  }
} finally {
  server.kill();
}
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.flatMap((r) => r.checks.filter(([, ok]) => !ok).map(([label]) => `${r.name}: ${label}`));
if (failed.length) {
  console.error(`\nFAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
