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
    // Pans as far as the hands stay fully in frame: about 0.2 frame widths per second.
    filter: 'scale=640:-2,pad=730:600:(ow-iw)/2:(oh-ih)/2:white,crop=640:480:45+40*sin(t*3.1)+5*sin(t*7.3):60+55*sin(t*2.3)',
  },
  still: { image: 'right_hands.jpg', filter: 'scale=640:-2,pad=640:480:(ow-iw)/2:(oh-ih)/2:white' },
  nohand: { image: 'wall.jpg', filter: 'crop=170:128:0:0,scale=640:480' },
};

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const IPHONE = { ...devices['iPhone 14'], deviceScaleFactor: 2 };

// Detection runs once per rendered frame, and headless software GL renders a 2x page at about
// 0.5 fps, too slow to measure hand motion. The flow check therefore runs on a small 1x page.
const FLOW = { viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 };

// flow: 'moving' requires cable pulses, 'still' and 'none' require dark cables, 'report' only logs.
const SCENARIOS = [
  { name: 'desktop-hand', fixture: 'hand', context: DESKTOP, expectHands: true, flow: 'report' },
  { name: 'desktop-nohand', fixture: 'nohand', context: DESKTOP, expectHands: false, flow: 'none' },
  { name: 'iphone14-hand', fixture: 'hand', context: IPHONE, expectHands: true, flow: 'report' },
  { name: 'flow-moving', fixture: 'hand', context: FLOW, expectHands: true, flow: 'moving' },
  { name: 'flow-still', fixture: 'still', context: FLOW, expectHands: true, flow: 'still' },
];

/** Headless renders at about 1 fps, so in-flight counts are tiny; `spawned` counts pulses started in the window. */
async function sampleFlow(page, ms) {
  const first = await stats(page);
  let maxPulses = first.pulses;
  let maxMotion = first.motion;
  let last = first;
  for (const end = Date.now() + ms; Date.now() < end; ) {
    await page.waitForTimeout(250);
    last = await stats(page);
    maxPulses = Math.max(maxPulses, last.pulses);
    maxMotion = Math.max(maxMotion, last.motion);
  }
  return { maxPulses, maxMotion, spawned: last.pulsesSpawned - first.pulsesSpawned, endPulses: last.pulses };
}

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
  const blockedByPolicy = [];
  const foreign = new Set();
  const isForeign = (raw) => {
    const url = new URL(raw);
    return !['localhost', '127.0.0.1'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol);
  };
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // MediaPipe's usage logger is expected to be refused by the page's Content-Security-Policy.
    if (/odml\.pa\.googleapis\.com/.test(m.text()) && /Content Security Policy/.test(m.text())) blockedByPolicy.push(m.text());
    else errors.push(m.text());
  });
  page.on('response', (r) => isForeign(r.url()) && foreign.add(r.url()));

  await page.goto(`${BASE}?debug`);
  await page.getByRole('button', { name: 'ENTER' }).click();
  await page.waitForFunction(() => window.__matrixHands?.state === 'running', null, { timeout: 90_000 });
  if (scenario.expectHands) {
    await page.waitForFunction(() => (window.__matrixHands?.framesWithHands ?? 0) >= 3, null, { timeout: 60_000 });
  } else {
    await page.waitForFunction(() => (window.__matrixHands?.detections ?? 0) >= 10, null, { timeout: 60_000 });
  }
  let flow;
  if (scenario.flow === 'moving') {
    await page.waitForFunction(() => (window.__matrixHands?.pulsesSpawned ?? 0) >= 3, null, { timeout: 120_000 });
    flow = await sampleFlow(page, 3000);
    await page.waitForFunction(() => (window.__matrixHands?.pulses ?? 0) >= 2, null, { timeout: 120_000 });
  } else if (scenario.flow === 'report') {
    flow = await sampleFlow(page, 4000);
  } else {
    await page.waitForTimeout(2000);
    flow = await sampleFlow(page, 6000);
  }
  const s = await stats(page);
  const telemetryProbe = await page.evaluate(() =>
    fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'probe' }).then(() => 'sent', () => 'refused'),
  );
  const hideDebug = await page.addStyleTag({ content: '.debug-video, .stats-panel { display: none !important; }' });
  const png = await page.screenshot({ path: path.join(OUT, `${scenario.name}.png`) });
  const pulsesAtScreenshot = (await stats(page)).pulses;
  await hideDebug.evaluate((el) => el.remove());
  await page.screenshot({ path: path.join(OUT, `${scenario.name}-debug.png`) });
  const green = await brightGreenShare(page, png);
  await browser.close();

  const checks = [
    ['tracker running', s.state === 'running'],
    scenario.expectHands
      ? ['detected >= 1 hand', s.framesWithHands >= 1 && s.hands >= 1]
      : ['no hands detected', s.framesWithHands === 0 && s.hands === 0],
    ...[{
      moving: ['moving hand starts pulses, with two in flight before the screenshot', flow.spawned > 0 && flow.maxMotion > 0],
      still: [
        'still hand: from 2 s after detection, motion < 0.05 and no pulses start or fly',
        flow.spawned === 0 && flow.maxPulses === 0 && flow.maxMotion < 0.05,
      ],
      none: ['no hand: no pulses start or fly', flow.spawned === 0 && flow.maxPulses === 0],
    }[scenario.flow]].filter(Boolean),
    ['no page errors', errors.length === 0],
    ['no response from another origin', foreign.size === 0],
    ['page cannot reach the telemetry endpoint', telemetryProbe === 'refused'],
  ];
  return {
    name: scenario.name,
    stats: s,
    brightGreenShare: Number(green.toFixed(5)),
    flow: { ...flow, pulsesAtScreenshot },
    errors,
    foreign: [...foreign],
    blockedByPolicy: blockedByPolicy.length,
    checks,
  };
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
      `fps(headless, software GL)=${r.stats.fps} brightGreenShare=${r.brightGreenShare} ` +
      `maxMotion=${r.flow.maxMotion} pulsesStarted=${r.flow.spawned} maxPulsesInFlight=${r.flow.maxPulses} ` +
      `pulsesAtScreenshot=${r.flow.pulsesAtScreenshot}`);
    for (const [label, ok] of r.checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (r.errors.length) console.log('  errors:', r.errors.slice(0, 5));
    if (r.foreign.length) console.log('  responses from other origins:', r.foreign);
    if (r.blockedByPolicy) console.log(`  telemetry attempts refused by CSP: ${r.blockedByPolicy}`);
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
