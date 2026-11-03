import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { QUALITY, type Tier } from '../src/quality.ts';
import { routeCables } from '../src/scene/cableRoutes.ts';
import { UNITS } from '../src/scene/computers.ts';
import { createLayout, type Placement } from '../src/scene/layout.ts';

const SEEDS = [1987, 1, 7, 42, 2024, 31337];
const SAMPLES_PER_CABLE = 4000;
/** Air kept between a cable's surface and any computer. */
const CLEARANCE = 0.01;
/** Arc length from the plug within which a cable may still touch its own computer. */
const PLUG_SLACK = 0.15;

/** Distance from a world point to a unit's box: origin at its bottom centre, front facing +z. */
function boxDistance(p: Placement) {
  const [w, h, d] = UNITS[p.kind].size;
  const toLocal = new Matrix4()
    .compose(new Vector3(...p.position), new Quaternion().setFromEuler(new Euler(...p.rotation)), new Vector3(1, 1, 1))
    .invert();
  const local = new Vector3();
  return (point: Vector3) => {
    local.copy(point).applyMatrix4(toLocal);
    const dx = Math.max(Math.abs(local.x) - w / 2, 0);
    const dy = Math.max(local.y - h, -local.y, 0);
    const dz = Math.max(Math.abs(local.z) - d / 2, 0);
    return Math.hypot(dx, dy, dz);
  };
}

type Clash = { cable: number; unit: number; plugged: number; clearance: number; at: string };

function clashes(tier: Tier, seed: number): { cables: number; clashes: Clash[] } {
  const quality = QUALITY[tier];
  const layout = createLayout(quality.units, quality.tree, seed);
  const distances = layout.placements.map(boxDistance);
  const routes = routeCables(layout, quality.cables);
  const found: Clash[] = [];
  routes.forEach((route, cable) => {
    const worst = new Map<number, Clash>();
    let travelled = 0;
    const prev = route.curve.getPoint(0);
    for (let i = 0; i <= SAMPLES_PER_CABLE; i++) {
      const point = route.curve.getPoint(i / SAMPLES_PER_CABLE);
      travelled += point.distanceTo(prev);
      prev.copy(point);
      distances.forEach((distance, unit) => {
        if (unit === route.unit && travelled <= PLUG_SLACK) return;
        const clearance = distance(point) - route.radius;
        if (clearance >= CLEARANCE) return;
        if ((worst.get(unit)?.clearance ?? Infinity) <= clearance) return;
        const at = point.toArray().map((v) => v.toFixed(2)).join(',');
        worst.set(unit, { cable, unit, plugged: route.unit, clearance: Number(clearance.toFixed(3)), at });
      });
    }
    found.push(...worst.values());
  });
  return { cables: routes.length, clashes: found };
}

for (const tier of ['desktop', 'mobile'] as const) {
  for (const seed of SEEDS) {
    test(`${tier} seed ${seed}: every cable stays clear of every computer except at its own plug`, () => {
      const { cables, clashes: found } = clashes(tier, seed);
      assert.equal(cables, QUALITY[tier].cables);
      assert.deepEqual(found.slice(0, 5), [], `${found.length} cable/unit clashes`);
    });
  }
}
