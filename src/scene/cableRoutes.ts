import { CatmullRomCurve3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { PORT_FACES, UNITS } from './computers';
import { TREE_CENTER_Z, type Layout } from './layout';
import { mulberry32, range, type Rng } from './rng';

export type CableRoute = {
  /** Starts at the plug, so t = 0 is the computer end and t = 1 the tip of the floor root. */
  readonly curve: CatmullRomCurve3;
  readonly radius: number;
  /** Index into `layout.placements` of the unit this cable is plugged into. */
  readonly unit: number;
};

const ROUTING = {
  /** Straight run out of the socket before the cable may bend. */
  stub: 0.3,
  /** Air kept between a cable's surface and every computer it passes. */
  margin: 0.05,
  /** Spacing of the polyline the cable is relaxed as. */
  spacing: 0.08,
  iterations: 24,
  /** Spacing of the final pass that pushes the smooth curve, not just its control points, clear. */
  fineSpacing: 0.04,
  /** Air every sample of a finished curve must keep; below `margin` so escaped points pass first time. */
  minClearance: 0.02,
  /** Share of the way each point moves toward its neighbours' midpoint per iteration. */
  smoothing: 0.3,
  radius: [0.014, 0.03] as const,
  /** Depth of air in front of a screen unit's face that cables keep out of, so none hangs across a monitor. */
  screenKeepOut: 0.5,
};

/** Where the bundle runs down: an ellipse around the two stacking layers. */
const TRUNK = {
  centerZ: TREE_CENTER_Z,
  radiusZ: 1.0,
  /** Descent angles from +x toward the back, per side. Never the front, where the trunk's screens face. */
  arcs: { right: [-0.6, Math.PI / 2], left: [Math.PI / 2, Math.PI + 0.6] },
} as const;

/**
 * A box cables must clear, in a frame where it spans x in ±w/2, y in [0, h] and z in ±d/2: a unit's size
 * box as `Cluster` places it, or the air in front of a screen unit's face.
 */
type Obstacle = {
  readonly unit: number;
  readonly toLocal: Matrix4;
  readonly toWorld: Matrix4;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  /** Bounding sphere, so far-away boxes cost one subtraction. */
  readonly center: Vector3;
  readonly reach: number;
};

type Plug = { readonly unit: number; readonly at: Vector3; readonly out: Vector3 };

function obstacle(unit: number, toWorld: Matrix4, [w, h, d]: readonly [number, number, number]): Obstacle {
  const center = new Vector3(0, h / 2, 0).applyMatrix4(toWorld);
  return { unit, toWorld, toLocal: toWorld.clone().invert(), w, h, d, center, reach: Math.hypot(w, h, d) / 2 };
}

/** One box per unit, then a keep-out in front of the face of each unit with a screen. Index `i < placements.length` is unit `i`. */
function obstacles(layout: Layout): Obstacle[] {
  const units = layout.placements.map((p, unit) => {
    const toWorld = new Matrix4().compose(
      new Vector3(...p.position),
      new Quaternion().setFromEuler(new Euler(...p.rotation)),
      new Vector3(1, 1, 1),
    );
    return obstacle(unit, toWorld, UNITS[p.kind].size);
  });
  const faces = layout.placements.flatMap((p, unit) => {
    const { screen, size } = UNITS[p.kind];
    if (!screen) return [];
    const [w, h, d] = size;
    const depth = ROUTING.screenKeepOut;
    const toWorld = units[unit]!.toWorld.clone().multiply(new Matrix4().makeTranslation(0, 0, d / 2 + depth / 2));
    return [obstacle(unit, toWorld, [w, h, depth])];
  });
  return [...units, ...faces];
}

/**
 * The largest clearance this file tests: a plug's run out of its socket and `escape` both keep
 * `margin` plus the cable's radius, and `isClear` asks for less. An obstacle farther away can
 * never fail a check, so leaving it out changes no route.
 */
const NEAR = ROUTING.margin + ROUTING.radius[1];
const CELL = 0.5;
const NONE: readonly Obstacle[] = [];

/**
 * The obstacles that could be within `NEAR` of a point, in their original order. Routing asks this
 * hundreds of thousands of times, and most points sit near none or one of the boxes.
 */
type Obstacles = { readonly all: readonly Obstacle[]; near(point: Vector3): readonly Obstacle[] };

const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

function index(all: readonly Obstacle[]): Obstacles {
  const cells = new Map<number, Obstacle[]>();
  for (const o of all) {
    const r = o.reach + NEAR;
    const lo = [o.center.x - r, o.center.y - r, o.center.z - r].map((v) => Math.floor(v / CELL));
    const hi = [o.center.x + r, o.center.y + r, o.center.z + r].map((v) => Math.floor(v / CELL));
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const key = cellKey(x, y, z);
          const cell = cells.get(key);
          if (cell) cell.push(o);
          else cells.set(key, [o]);
        }
  }
  return {
    all,
    near: (p) => cells.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL))) ?? NONE,
  };
}

const local = new Vector3();

/** Exact near the box; outside its bounding sphere a lower bound, which is all the threshold checks need. */
function distance(o: Obstacle, point: Vector3): number {
  const far = point.distanceTo(o.center) - o.reach;
  if (far > 0.2) return far;
  local.copy(point).applyMatrix4(o.toLocal);
  return Math.hypot(
    Math.max(Math.abs(local.x) - o.w / 2, 0),
    Math.max(local.y - o.h, -local.y, 0),
    Math.max(Math.abs(local.z) - o.d / 2, 0),
  );
}

const candidate = new Vector3();
const best = new Vector3();
const hits: Obstacle[] = [];

/** Moves `point` to the nearest spot at least `margin` from every obstacle, never below `floor`. */
function escape(point: Vector3, obstacles: Obstacles, margin: number, floor: number): void {
  for (let pass = 0; pass < 4; pass++) {
    hits.length = 0;
    for (const o of obstacles.near(point)) if (distance(o, point) < margin) hits.push(o);
    if (hits.length === 0) return;
    let bestScore = Infinity;
    for (const o of hits) {
      const origin = point.clone().applyMatrix4(o.toLocal);
      const faces: [axis: 'x' | 'y' | 'z', value: number][] = [
        ['x', o.w / 2 + margin],
        ['x', -o.w / 2 - margin],
        ['y', o.h + margin],
        ['y', -margin],
        ['z', o.d / 2 + margin],
        ['z', -o.d / 2 - margin],
      ];
      for (const [axis, value] of faces) {
        candidate.copy(origin).setComponent('xyz'.indexOf(axis), value).applyMatrix4(o.toWorld);
        if (candidate.y < floor) continue;
        const blocked = obstacles.near(candidate).some((other) => other !== o && distance(other, candidate) < margin);
        const score = candidate.distanceTo(point) + (blocked ? 1000 : 0);
        if (score < bestScore) {
          bestScore = score;
          best.copy(candidate);
        }
      }
    }
    if (bestScore === Infinity) return;
    point.copy(best);
  }
}

/** A port is open when its straight run out of the socket clears every other computer and the floor. */
function openPlugs(layout: Layout, obstacles: Obstacles): Plug[] {
  const clearance = ROUTING.margin + ROUTING.radius[1];
  return layout.placements.flatMap((p, unit) =>
    UNITS[p.kind].ports.flatMap((port) => {
      const o = obstacles.all[unit]!;
      const at = new Vector3(...port.at).applyMatrix4(o.toWorld);
      const out = new Vector3(...PORT_FACES[port.face].out).transformDirection(o.toWorld);
      const reach = ROUTING.stub + 0.3;
      for (let s = 0.05; s <= reach; s += 0.05) {
        const point = at.clone().addScaledVector(out, s);
        if (point.y < 0.15) return [];
        if (obstacles.near(point).some((other) => other.unit !== unit && distance(other, point) < clearance)) return [];
      }
      return [{ unit, at, out }];
    }),
  );
}

/** Lowest base of the units that hang out past the trunk: where the canopy starts. */
function canopyFloor(layout: Layout, trunkHalf: number): number {
  const bases = layout.placements.filter((p) => Math.abs(p.position[0]) > trunkHalf + 0.6).map((p) => p.position[1]);
  return bases.length > 0 ? Math.max(1, Math.min(...bases)) : layout.height * 0.45;
}

/** Rough path: out of the socket, sagging toward the trunk, down its side or back, then outward across the floor as a root. */
function waypoints(plug: Plug, layout: Layout, rng: Rng): Vector3[] {
  const trunkHalf = Math.min(1.1, layout.width * 0.12);
  const crown = canopyFloor(layout, trunkHalf);
  const right = Math.abs(plug.at.x) < 0.3 ? rng() < 0.5 : plug.at.x > 0;
  const [from, to] = TRUNK.arcs[right ? 'right' : 'left'];
  const descent = range(rng, from, to);
  const around = (angle: number, scale: number, y: number) =>
    new Vector3(Math.cos(angle) * trunkHalf * scale, y, TRUNK.centerZ - Math.sin(angle) * TRUNK.radiusZ * scale);
  const start = plug.at.clone().addScaledVector(plug.out, 0.02);
  const stubEnd = plug.at.clone().addScaledVector(plug.out, ROUTING.stub);
  const sag = stubEnd.clone().addScaledVector(plug.out, 0.2).add(new Vector3(0, -0.35, 0));
  const trunk = [0.8, 0.5, 0.22]
    .map((f) => around(descent + range(rng, -0.25, 0.25), range(rng, 0.9, 1.3), crown * f))
    .filter((p) => p.y < sag.y - 0.3);
  const spread = descent + range(rng, -0.5, 0.5);
  const reach = range(rng, 0.9, 3.8);
  const land = around(spread, 1.3, 0.03).add(new Vector3(Math.cos(spread) * reach * 1.25, 0, -Math.sin(spread) * reach * 0.8));
  const tip = land.clone().add(new Vector3(Math.cos(spread) * range(rng, 0.4, 1.4), 0, -Math.sin(spread) * range(rng, 0.3, 1)));
  return [start, stubEnd, sag, ...trunk, around(descent, range(rng, 1.2, 1.6), 0.08), land, tip];
}

/**
 * Pulls the rough path taut a little at a time while pushing it out of every computer, so it wraps
 * around units instead of through them. The socket run stays straight and the root tip stays put.
 */
function relax(rough: Vector3[], obstacles: Obstacles, radius: number): Vector3[] {
  const guide = new CatmullRomCurve3(rough, false, 'centripetal');
  const points = guide.getSpacedPoints(Math.ceil(guide.getLength() / ROUTING.spacing));
  const fixed = Math.ceil(ROUTING.stub / ROUTING.spacing);
  const margin = radius + ROUTING.margin;
  const mid = new Vector3();
  for (let it = 0; it <= ROUTING.iterations; it++) {
    for (let i = fixed; i < points.length - 1; i++) {
      if (it > 0) {
        mid.addVectors(points[i - 1]!, points[i + 1]!).multiplyScalar(0.5);
        points[i]!.lerp(mid, ROUTING.smoothing);
      }
      escape(points[i]!, obstacles, margin, radius);
    }
  }
  return points;
}

/** Every sample of the curve keeps `minClearance`, except right at the plug where it leaves its own unit. */
function isClear(curve: CatmullRomCurve3, obstacles: Obstacles, radius: number, unit: number): boolean {
  const length = curve.getLength();
  const samples = curve.getSpacedPoints(Math.ceil(length / 0.01));
  const ownSlack = 0.1;
  return samples.every((point, i) =>
    obstacles.near(point).every((o) => (o.unit === unit && (i / samples.length) * length <= ownSlack) || distance(o, point) >= radius + ROUTING.minClearance),
  );
}

/**
 * A smooth curve through clear points can still cut a box corner between them, so resample it finely,
 * push the samples out again, and repeat until the curve itself is clear.
 */
function tighten(points: Vector3[], obstacles: Obstacles, radius: number, unit: number): CatmullRomCurve3 | null {
  const margin = radius + ROUTING.margin;
  for (let round = 0; round < 6; round++) {
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    if (isClear(curve, obstacles, radius, unit)) return curve;
    const length = curve.getLength();
    const n = Math.ceil(length / ROUTING.fineSpacing);
    points = curve.getSpacedPoints(n);
    points.forEach((point, i) => (i / n) * length > ROUTING.stub && i < n && escape(point, obstacles, margin, radius));
  }
  return null;
}

/** Routes `count` cables from the computers' back and underside ports into the trunk and out across the floor. */
export function routeCables(layout: Layout, count: number): CableRoute[] {
  const router = cableRouter(layout, count);
  for (;;) {
    const step = router.next();
    if (step.done) return step.value;
  }
}

/** `routeCables` one cable at a time, so a caller on the page's thread can yield between cables. */
export function* cableRouter(layout: Layout, count: number): Generator<void, CableRoute[]> {
  const rng = mulberry32(4242);
  const boxes = index(obstacles(layout));
  const plugs = openPlugs(layout, boxes).sort((a, b) => Math.abs(a.at.x) - Math.abs(b.at.x));
  const used = plugs.slice(0, Math.max(Math.min(3, plugs.length), Math.ceil(plugs.length * 0.8)));
  const routes: CableRoute[] = [];
  // A route that cannot be made clear is dropped and the next plug takes its place.
  for (let i = 0; routes.length < count && i < count * 3 && used.length > 0; i++) {
    const plug = used[i % used.length]!;
    // A second cable in the same socket sits beside the first rather than inside it.
    const shared = Math.floor(i / used.length);
    const across = new Vector3(1, 0, 0).transformDirection(boxes.all[plug.unit]!.toWorld);
    const at = plug.at.clone().addScaledVector(across, shared === 0 ? 0 : (shared % 2 ? -1 : 1) * 0.03);
    const radius = range(rng, ...ROUTING.radius);
    const curve = tighten(relax(waypoints({ ...plug, at }, layout, rng), boxes, radius), boxes, radius, plug.unit);
    if (curve) routes.push({ curve, radius, unit: plug.unit });
    yield;
  }
  return routes;
}
