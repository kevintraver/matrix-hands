import { Color } from 'three';
import { UNITS } from './computers';
import type { Layout } from './layout';
import { range, type Rng } from './rng';

/** The colours one unit is built from: housing, trim, and the near-black of bezels, slots and sockets. */
export type Finish = { readonly shell: string; readonly trim: string; readonly dark: string };

type Plastic = { readonly tone: 'light' | 'dark'; readonly shell: string; readonly trim: string; readonly dark: string };

/** Period housings. */
const PLASTICS: readonly Plastic[] = [
  { tone: 'light', shell: '#d6ceb5', trim: '#c2b99c', dark: '#34312b' },
  { tone: 'light', shell: '#cdc3a6', trim: '#b8ad8f', dark: '#3a372f' },
  { tone: 'light', shell: '#e3ddc9', trim: '#cfc8b0', dark: '#36342e' },
  { tone: 'light', shell: '#c4b48a', trim: '#ad9e76', dark: '#38342a' },
  { tone: 'light', shell: '#e4e2da', trim: '#cfcdc4', dark: '#2f2f2c' },
  { tone: 'light', shell: '#bfc0bb', trim: '#a8a9a3', dark: '#2b2c2b' },
  { tone: 'dark', shell: '#28282a', trim: '#333336', dark: '#0c0c0d' },
  { tone: 'dark', shell: '#3a3b3e', trim: '#2a2b2d', dark: '#101011' },
];

const FINISHES = {
  /** Share of units in dark plastic, drawn per tree. */
  darkShare: [0.17, 0.23] as const,
  /** Dark units start this far apart (as a share of the spacing an even spread would give) and close in only if they must. */
  spread: 0.75,
  hueJitter: 0.01,
  lightJitter: 0.035,
  /** Light plastic yellows toward this with age; at most this share of the way. */
  aged: '#d8c27e',
  maxAge: 0.4,
};

const LIGHT = PLASTICS.filter((p) => p.tone === 'light');
const DARK = PLASTICS.filter((p) => p.tone === 'dark');

/**
 * Picks which units are dark so they scatter instead of clumping: each quadrant of the tree's front view
 * gets an equal share, and within that, picks keep a minimum spacing that shrinks only if it must.
 */
function scatterDark(centres: readonly (readonly [number, number, number])[], count: number, rng: Rng, width: number, height: number): Set<number> {
  const shuffle = <T,>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  const ys = centres.map((c) => c[1]).sort((a, b) => a - b);
  const midY = ys[Math.floor(ys.length / 2)] ?? 0;
  const quadrant = ([x, y]: readonly [number, number, number]) => (x < 0 ? 0 : 1) + (y < midY ? 0 : 2);
  const sizes = [0, 0, 0, 0];
  for (const c of centres) sizes[quadrant(c)]! += 1;
  const quota = sizes.map((size) => Math.min(size, Math.floor(count / 4)));
  for (const q of shuffle([0, 1, 2, 3]).slice(0, count % 4)) if (quota[q]! < sizes[q]!) quota[q]! += 1;
  const target = quota.reduce((a, b) => a + b, 0);

  const order = shuffle(centres.map((_, i) => i));
  const dark = new Set<number>();
  let spacing = Math.sqrt((width * height) / Math.max(1, count)) * FINISHES.spread;
  while (dark.size < target) {
    for (const i of order) {
      const c = centres[i]!;
      const q = quadrant(c);
      if (dark.has(i) || quota[q] === 0) continue;
      if (![...dark].every((j) => Math.hypot(c[0] - centres[j]![0], c[1] - centres[j]![1], c[2] - centres[j]![2]) >= spacing)) continue;
      dark.add(i);
      quota[q]! -= 1;
    }
    spacing *= 0.85;
  }
  return dark;
}

const aged = new Color(FINISHES.aged);

function tint(hex: string, age: number, hue: number, light: number): string {
  return `#${new Color(hex).lerp(aged, age).offsetHSL(hue, 0, light).getHexString()}`;
}

/** One finish per placement. Draws only from `rng`, so a separate stream can vary colours without moving the layout. */
export function assignFinishes(layout: Layout, rng: Rng): Finish[] {
  const { placements } = layout;
  const centres = placements.map((p): [number, number, number] => [p.position[0], p.position[1] + UNITS[p.kind].size[1] / 2, p.position[2]]);
  const count = Math.round(placements.length * range(rng, ...FINISHES.darkShare));
  const dark = scatterDark(centres, count, rng, layout.width, layout.height);
  return placements.map((_, i) => {
    const pool = dark.has(i) ? DARK : LIGHT;
    const plastic = pool[Math.floor(rng() * pool.length)]!;
    const age = plastic.tone === 'light' ? FINISHES.maxAge * rng() ** 2 : 0;
    const hue = range(rng, -FINISHES.hueJitter, FINISHES.hueJitter);
    const light = range(rng, -FINISHES.lightJitter, FINISHES.lightJitter);
    return {
      shell: tint(plastic.shell, age, hue, light),
      trim: tint(plastic.trim, age, hue, light),
      dark: tint(plastic.dark, 0, 0, light * 0.3),
    };
  });
}
