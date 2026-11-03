#!/usr/bin/env node
// Drives the built app in Chromium with a fake webcam fed from real-hand video.
// Usage: npm run build && npm run verify [-- scenario-name ...]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// camera: flow 'moving' requires cable pulses, 'still' and 'none' require dark cables, 'report' only logs.
// colors: reloads the page with and without ?seed= and compares the colour seeds it reports.
// orbit: drags the camera around the tree, tests its limits and idle drift, and checks the rain behind it.
const SCENARIOS = [
  { name: 'desktop-hand', kind: 'camera', fixture: 'hand', context: DESKTOP, expectHands: true, flow: 'report' },
  { name: 'desktop-nohand', kind: 'camera', fixture: 'nohand', context: DESKTOP, expectHands: false, flow: 'none' },
  { name: 'iphone14-hand', kind: 'camera', fixture: 'hand', context: IPHONE, expectHands: true, flow: 'report' },
  { name: 'flow-moving', kind: 'camera', fixture: 'hand', context: FLOW, expectHands: true, flow: 'moving' },
  { name: 'flow-still', kind: 'camera', fixture: 'still', context: FLOW, expectHands: true, flow: 'still' },
  { name: 'colors-reload', kind: 'colors', fixture: 'nohand', context: FLOW },
  { name: 'orbit', kind: 'orbit', fixture: 'nohand', context: FLOW },
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

/**
 * White-hot clusters (every channel >= 240) in the lower part of the frame, where the trunk and
 * cables are. Lit hand outlines stay green and rain fades out near the floor, so on a still or
 * empty scene any such cluster is a static light the viewer would read as cable glow.
 */
const hotSpots = (page, png) =>
  page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = 480;
    const h = Math.round((w * img.height) / img.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const top = Math.floor(h * 0.45);
    const hot = (x, y) => y >= top && Math.min(d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]) >= 240;
    const seen = new Uint8Array(w * h);
    const spots = [];
    for (let y = top; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (seen[y * w + x] || !hot(x, y)) continue;
        const stack = [[x, y]];
        seen[y * w + x] = 1;
        let size = 0;
        while (stack.length) {
          const [px, py] = stack.pop();
          size++;
          for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !hot(nx, ny)) continue;
            seen[ny * w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        spots.push({ x: Math.round((x / w) * 100), y: Math.round((y / h) * 100), size });
      }
    return spots;
  }, `data:image/png;base64,${png.toString('base64')}`);

/** Chromium with the scenario's fixture as its webcam, recording page errors and any traffic to another origin. */
async function openSession(scenario) {
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
  return { browser, page, errors, blockedByPolicy, foreign };
}

const hideOverlay = (page) => page.addStyleTag({ content: '.overlay, .stats-panel { display: none !important; }' });

async function runCamera(scenario) {
  const { browser, page, errors, blockedByPolicy, foreign } = await openSession(scenario);
  // A fixed seed also fixes the colours, so screenshots are comparable across runs.
  await page.goto(`${BASE}?debug&seed=1987`);
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
  const setDebugVisible = (visible) =>
    page.evaluate((v) => {
      for (const el of document.querySelectorAll('.debug-video, .stats-panel')) el.style.visibility = v ? '' : 'hidden';
    }, visible);
  await setDebugVisible(false);
  const png = await page.screenshot({ path: path.join(OUT, `${scenario.name}.png`) });
  const pulsesAtScreenshot = (await stats(page)).pulses;
  await setDebugVisible(true);
  await page.screenshot({ path: path.join(OUT, `${scenario.name}-debug.png`) });
  const telemetryProbe = await page.evaluate(() =>
    fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'probe' }).then(() => 'sent', () => 'refused'),
  );
  const green = await brightGreenShare(page, png);
  const spots = await hotSpots(page, png);
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
    ...(['still', 'none'].includes(scenario.flow) ? [['no static glow in the trunk and cable region', spots.length === 0]] : []),
    ['no page errors', errors.length === 0],
    ['no response from another origin', foreign.size === 0],
    ['page cannot reach the telemetry endpoint', telemetryProbe === 'refused'],
  ];
  const summary =
    `delegate=${s.delegate} tier=${s.tier} hands=${s.hands} detections=${s.detections} framesWithHands=${s.framesWithHands} ` +
    `fps(headless, software GL)=${s.fps} brightGreenShare=${green.toFixed(5)} maxMotion=${flow.maxMotion} ` +
    `pulsesStarted=${flow.spawned} maxPulsesInFlight=${flow.maxPulses} pulsesAtScreenshot=${pulsesAtScreenshot}`;
  return {
    name: scenario.name,
    summary,
    stats: s,
    brightGreenShare: Number(green.toFixed(5)),
    flow: { ...flow, pulsesAtScreenshot },
    hotSpots: spots,
    errors,
    foreign: [...foreign],
    blockedByPolicy: blockedByPolicy.length,
    checks,
  };
}

async function runColors(scenario) {
  const { browser, page, errors } = await openSession(scenario);
  const load = async (query, shot) => {
    await page.goto(`${BASE}${query}`);
    await hideOverlay(page);
    await page.waitForFunction(() => (window.__matrixHands?.fps ?? 0) > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (shot) await page.screenshot({ path: path.join(OUT, shot) });
    return (await stats(page)).colorSeed;
  };
  const unseeded = [await load('?debug', 'colors-reload-a.png'), await load('?debug', 'colors-reload-b.png')];
  const seeded = [await load('?debug&seed=1987'), await load('?debug&seed=1987')];
  await browser.close();
  return {
    name: scenario.name,
    summary: `colour seeds without ?seed=: ${unseeded.join(', ')}; with ?seed=1987: ${seeded.join(', ')}`,
    colorSeeds: { unseeded, seeded },
    errors,
    checks: [
      ['two loads without ?seed= paint different colours', unseeded[0] !== unseeded[1]],
      ['two loads with ?seed= paint the same colours', seeded[0] === seeded[1]],
      ['no page errors', errors.length === 0],
    ],
  };
}

/** Signed change from `from` to `to` in degrees, folded into (-180, 180]. */
const turn = (from, to) => {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

/** Polls the camera until it stops moving, so damping has finished applying a drag. */
async function settledCamera(page) {
  let last = (await stats(page)).camera;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const now = (await stats(page)).camera;
    if (Math.abs(turn(last.azimuth, now.azimuth)) < 0.3 && Math.abs(now.polar - last.polar) < 0.3 && Math.abs(now.distance - last.distance) < 0.02) return now;
    last = now;
  }
  return last;
}

async function drag(page, dx, dy) {
  const box = await page.locator('canvas').first().boundingBox();
  const x = box.x + box.width / 2 - dx / 2;
  const y = box.y + box.height / 2 - dy / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/**
 * Rain glyph pixels in eight columns of the upper background. Rain is sparse, so one column can be
 * briefly empty; a rain plane that ends, or sits behind the camera, blanks several side by side.
 */
const rainColumns = (page, png) =>
  page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = 480;
    const h = Math.round((w * img.height) / img.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, Math.floor(h * 0.45)).data;
    const columns = new Array(8).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (g > 45 && g > r * 1.5 && g > b * 1.2) columns[Math.floor((((i / 4) % w) / w) * 8)]++;
    }
    return columns;
  }, `data:image/png;base64,${png.toString('base64')}`);

async function runOrbit(scenario) {
  const { browser, page, errors } = await openSession(scenario);
  await page.goto(`${BASE}?debug&seed=1987`);
  await page.getByRole('button', { name: 'ENTER' }).click();
  await page.waitForFunction(() => window.__matrixHands?.state === 'running', null, { timeout: 90_000 });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.debug-video, .stats-panel')) el.style.visibility = 'hidden';
  });
  const height = (await page.locator('canvas').first().boundingBox()).height;
  // OrbitControls turns 2π per canvas height of drag, scaled by rotateSpeed (0.7).
  const pxPerQuarter = (height / 0.7) / 4;
  const views = [];
  const shoot = async (label, camera) => {
    const png = await page.screenshot({ path: path.join(OUT, `${scenario.name}-${label}.png`) });
    views.push({ label, azimuth: camera.azimuth, rain: await rainColumns(page, png) });
  };
  const start = await settledCamera(page);
  await shoot('0', start);
  await drag(page, pxPerQuarter, 0);
  const quarter = await settledCamera(page);
  await shoot('90', quarter);
  await drag(page, pxPerQuarter, 0);
  const half = await settledCamera(page);
  await shoot('180', half);

  // Each vertical drag spans 0.8 canvas heights, which turns ~200 deg: far past either limit.
  await drag(page, 0, height * 0.8);
  const top = await settledCamera(page);
  await drag(page, 0, -height * 0.8);
  const bottom = await settledCamera(page);
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -400);
  const near = await settledCamera(page);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
  const far = await settledCamera(page);

  await page.waitForFunction(() => window.__matrixHands?.camera?.drifting === true, null, { timeout: 60_000 });
  const driftFrom = (await stats(page)).camera.azimuth;
  await page.waitForFunction((from) => Math.abs(window.__matrixHands.camera.azimuth - from) > 0.2, driftFrom, { timeout: 60_000 }).catch(() => {});
  const drifted = Math.abs(turn(driftFrom, (await stats(page)).camera.azimuth));
  await page.mouse.down();
  // The debug hook updates once per rendered frame, so read the first frame after the press.
  const heldDrifting = await page
    .waitForFunction(() => window.__matrixHands.camera.drifting === false, null, { timeout: 15_000 })
    .then(() => false, () => true);
  await page.mouse.up();
  await browser.close();

  const q = Math.abs(turn(start.azimuth, quarter.azimuth));
  const h = Math.abs(turn(start.azimuth, half.azimuth));
  const c = far;
  return {
    name: scenario.name,
    summary:
      `azimuth start=${start.azimuth} after quarter drag=${quarter.azimuth} (turned ${q.toFixed(1)}) after second drag=${half.azimuth} ` +
      `(turned ${h.toFixed(1)}); polar range seen ${top.polar}-${bottom.polar} (limits ${c.minPolar}-${c.maxPolar}); ` +
      `distance near=${near.distance} far=${far.distance} (limits ${c.minDistance}-${c.maxDistance}); idle drift turned ${drifted.toFixed(2)} deg; ` +
      `rain pixels per column: ${views.map((v) => `${v.label}: [${v.rain.join(',')}]`).join(' ')}`,
    views,
    camera: { start, quarter, half, top, bottom, near, far },
    errors,
    checks: [
      ['a quarter-height drag turns the camera about 90 deg', Math.abs(q - 90) < 20],
      ['a second drag reaches the far side, about 180 deg from the start', h > 160],
      [
        'rain fills the background from the front, side and back: no two neighbouring columns empty',
        views.every((v) => v.rain.every((n, i) => n >= 8 || (v.rain[i + 1] ?? 8) >= 8)),
      ],
      ['dragging down tilts up to the top limit, short of straight overhead', Math.abs(top.polar - c.minPolar) < 1 && top.polar > 20],
      ['dragging up tilts down to the bottom limit, above the floor', Math.abs(bottom.polar - c.maxPolar) < 1 && bottom.polar < 100],
      ['zooming in stops at the limit outside every unit', Math.abs(near.distance - c.minDistance) < 0.01],
      ['zooming out stops at the limit inside the rain', Math.abs(far.distance - c.maxDistance) < 0.01],
      ['left alone, the camera drifts', drifted > 0],
      ['pressing the pointer stops the drift at once', heldDrifting === false],
      ['no page errors', errors.length === 0],
    ],
  };
}

const RUNNERS = { camera: runCamera, colors: runColors, orbit: runOrbit };

const only = process.argv.slice(2);
const server = await startServer();
const results = [];
try {
  for (const scenario of SCENARIOS.filter((s) => only.length === 0 || only.includes(s.name))) {
    const r = await RUNNERS[scenario.kind](scenario);
    results.push(r);
    console.log(`\n${r.name}  ${r.summary}`);
    for (const [label, ok] of r.checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (r.errors?.length) console.log('  errors:', r.errors.slice(0, 5));
    if (r.foreign?.length) console.log('  responses from other origins:', r.foreign);
    if (r.hotSpots?.length) console.log('  white-hot spots (x%, y%, px):', JSON.stringify(r.hotSpots.slice(0, 8)));
    if (r.blockedByPolicy) console.log(`  telemetry attempts refused by CSP: ${r.blockedByPolicy}`);
  }
} finally {
  server.kill();
}
// A subset run replaces only its own scenarios, so results.json always holds the latest result of each.
const resultsPath = path.join(OUT, 'results.json');
const previous = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : [];
const merged = SCENARIOS.map((s) => results.find((r) => r.name === s.name) ?? previous.find((r) => r.name === s.name)).filter(Boolean);
writeFileSync(resultsPath, JSON.stringify(merged, null, 2) + '\n');
const failed = results.flatMap((r) => r.checks.filter(([, ok]) => !ok).map(([label]) => `${r.name}: ${label}`));
if (failed.length) {
  console.error(`\nFAILED:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
