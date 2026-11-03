import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUALITY } from '../src/quality.ts';
import { assignFinishes, type Finish } from '../src/scene/finishes.ts';
import { createLayout, type Layout } from '../src/scene/layout.ts';
import { mulberry32 } from '../src/scene/rng.ts';

const LAYOUT_SEEDS = [1987, 42, 31337];
const COLOR_SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const isDark = (f: Finish) => luminance(f.shell) < 0.15;
const share = (finishes: Finish[], pick: (i: number) => boolean) => {
  const ids = finishes.map((_, i) => i).filter(pick);
  return ids.filter((i) => isDark(finishes[i]!)).length / ids.length;
};

function halves(layout: Layout) {
  const ys = layout.placements.map((p) => p.position[1]).sort((a, b) => a - b);
  const midY = ys[Math.floor(ys.length / 2)]!;
  const at = (i: number) => layout.placements[i]!.position;
  return {
    left: (i: number) => at(i)[0] < 0,
    right: (i: number) => at(i)[0] >= 0,
    bottom: (i: number) => at(i)[1] < midY,
    top: (i: number) => at(i)[1] >= midY,
  };
}

for (const tier of ['desktop', 'mobile'] as const) {
  for (const layoutSeed of LAYOUT_SEEDS) {
    const quality = QUALITY[tier];
    const layout = createLayout(quality.units, quality.tree, layoutSeed);

    test(`${tier} layout ${layoutSeed}: every unit gets its own shade, 15-25% dark, scattered across the tree`, () => {
      const problems: string[] = [];
      for (const colorSeed of COLOR_SEEDS) {
        const finishes = assignFinishes(layout, mulberry32(colorSeed));
        assert.equal(finishes.length, layout.placements.length);
        const distinct = new Set(finishes.map((f) => f.shell)).size;
        if (distinct < finishes.length * 0.8) problems.push(`${colorSeed}: only ${distinct} distinct shells`);
        const overall = share(finishes, () => true);
        if (overall < 0.15 || overall > 0.25) problems.push(`${colorSeed}: dark share ${overall.toFixed(2)}`);
        for (const [name, pick] of Object.entries(halves(layout))) {
          const s = share(finishes, pick);
          if (Math.abs(s - overall) > 0.15) problems.push(`${colorSeed}: ${name} half dark share ${s.toFixed(2)} vs ${overall.toFixed(2)}`);
        }
      }
      assert.deepEqual(problems, []);
    });
  }
}

test('the same colour seed repeats its colours and another seed repaints them, without moving any unit', () => {
  const quality = QUALITY.desktop;
  const layout = createLayout(quality.units, quality.tree, 1987);
  const a = assignFinishes(layout, mulberry32(5));
  assert.deepEqual(assignFinishes(layout, mulberry32(5)), a);
  const b = assignFinishes(layout, mulberry32(6));
  assert.ok(b.filter((f, i) => f.shell !== a[i]!.shell).length > a.length * 0.8);
  assert.deepEqual(createLayout(quality.units, quality.tree, 1987), layout);
});
