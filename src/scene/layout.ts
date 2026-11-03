import { UNITS, jitter, pickKind, type UnitKind } from './computers';
import type { Vec3 } from './partBuilder';
import { mulberry32, range, type Rng } from './rng';

export type Placement = {
  readonly kind: UnitKind;
  /** Bottom centre of the unit. */
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly seed: number;
};

export type Layout = {
  readonly placements: readonly Placement[];
  /** Points on the underside of the canopy where cables hang from. */
  readonly cableAnchors: readonly Vec3[];
  readonly width: number;
  readonly height: number;
};

/** Front silhouette: a trunk rising into an elliptical canopy. Only the canopy scales with the unit count. */
export type TreeShape = { readonly rx: number; readonly ry: number; readonly trunkHalf: number; readonly trunkHeight: number };

const BIN = 0.05;
/** Two stacking planes so units overlap at different depths instead of forming one flat wall. */
const LAYER_Z = [0.35, -0.85] as const;

function pack(shape: TreeShape, scale: number, rng: Rng, limit: number) {
  const rx = shape.rx * scale;
  const ry = shape.ry * scale;
  const { trunkHalf, trunkHeight } = shape;
  const cy = trunkHeight + ry * 0.5;
  const inside = (x: number, y: number) =>
    (Math.abs(x) <= trunkHalf + 0.1 && y <= cy) || (x / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const canopyFloor = (x: number) => (Math.abs(x) >= rx ? Infinity : cy - ry * Math.sqrt(1 - (x / rx) ** 2));

  const bins = Math.ceil((2 * rx) / BIN);
  const binOf = (x: number) => Math.min(bins - 1, Math.max(0, Math.floor((x + rx) / BIN)));
  const floor = Array.from({ length: bins }, (_, i) => {
    const x = -rx + (i + 0.5) * BIN;
    return Math.abs(x) <= trunkHalf ? 0 : canopyFloor(x);
  });
  const skies = LAYER_Z.map(() => [...floor]);

  const placements: Placement[] = [];
  const cableAnchors: Vec3[] = [];
  let fails = 0;
  while (placements.length < limit && fails < 40) {
    const kind = pickKind(rng);
    const [w, h] = UNITS[kind].size;
    let best: { x: number; base: number; score: number; i0: number; i1: number; layer: number } | null = null;
    const trunkSlack = trunkHalf - w / 2;
    for (let c = 0; c < 24; c++) {
      // Half the candidates stay inside the trunk, which uniform sampling across the canopy rarely hits.
      const x = c % 2 === 0 && trunkSlack > 0 ? range(rng, -trunkSlack, trunkSlack) : range(rng, -rx + w / 2, rx - w / 2);
      const i0 = binOf(x - w / 2);
      const i1 = binOf(x + w / 2);
      skies.forEach((sky, layer) => {
        let base = 0;
        for (let i = i0; i <= i1; i++) base = Math.max(base, sky[i]!);
        if (!Number.isFinite(base)) return;
        const fits = [-1, 1].every(
          (side) => inside(x + side * w * 0.42, base + 0.02) && inside(x + side * w * 0.42, base + h * 0.9),
        );
        if (!fits) return;
        const score = base + rng() * 0.25 + layer * 0.12;
        if (!best || score < best.score) best = { x, base, score, i0, i1, layer };
      });
    }
    if (!best) {
      fails += 1;
      continue;
    }
    fails = 0;
    const { x, base, i0, i1, layer } = best;
    const sky = skies[layer]!;
    for (let i = i0; i <= i1; i++) sky[i] = base + h * 0.97;
    const z = LAYER_Z[layer]! + jitter(rng, 0.18);
    placements.push({
      kind,
      position: [x, base, z],
      rotation: [jitter(rng, 0.05), jitter(rng, 0.24), jitter(rng, 0.05)],
      seed: Math.floor(rng() * 2 ** 31),
    });
    let restsOnCanopyFloor = false;
    for (let i = i0; i <= i1; i++) restsOnCanopyFloor ||= floor[i]! > 0.4 && base <= floor[i]! + 0.01;
    if (restsOnCanopyFloor) cableAnchors.push([x, base + 0.05, z]);
  }
  return { placements, cableAnchors };
}

/** Seeded, so a given seed and count always produce the same tree. Scales the silhouette until `count` units fill it. */
export function createLayout(count: number, shape: TreeShape, seed: number): Layout {
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    const capacity = pack(shape, scale, mulberry32(seed), Infinity).placements.length;
    scale *= Math.min(1.5, Math.max(0.67, Math.sqrt(count / capacity)));
  }
  const { placements, cableAnchors } = pack(shape, scale, mulberry32(seed), count);
  let width = 0;
  let height = 0;
  for (const p of placements) {
    const [w, h] = UNITS[p.kind].size;
    width = Math.max(width, 2 * (Math.abs(p.position[0]) + w / 2));
    height = Math.max(height, p.position[1] + h);
  }
  return { placements, cableAnchors, width, height };
}
