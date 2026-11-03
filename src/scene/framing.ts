import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { UNITS } from './computers';
import { TREE_CENTER_Z, type Layout } from './layout';

export const ORBIT = {
  /** After `afterMs` without input the camera slowly circles the tree (speed 1 = one turn a minute). null turns it off. */
  idleDrift: { afterMs: 6000, speed: 0.3 } as { readonly afterMs: number; readonly speed: number } | null,
  rotateSpeed: 0.7,
  zoomSpeed: 0.8,
  /** Per second: how fast a fling settles, independent of frame rate. */
  damping: 6,
  /** Longest frame, in seconds, the idle drift steps through at once. */
  maxStep: 0.1,
  /** Radians from straight overhead the camera may climb to. */
  minPolar: 0.55,
  /** The rain hangs on a cylinder this wide, so the camera must stay well inside it. */
  rainRadius: 40,
  /** Closest the camera's near plane may come to any unit. */
  standoff: 1.2,
};

export type Framing = {
  readonly target: Vector3;
  /** Where the camera starts: in front of the tree, the whole tree in view. */
  readonly distance: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPolar: number;
  readonly maxPolar: number;
};

/** Distances and angles that keep the camera outside every unit, above the floor and inside the rain from any side. */
export function frameTree(layout: Layout, aspect: number, fovDeg: number): Framing {
  const target = new Vector3(0, layout.height * 0.47, TREE_CENTER_Z);
  let reach = 0;
  const corner = new Vector3();
  for (const p of layout.placements) {
    const [w, h, d] = UNITS[p.kind].size;
    const toWorld = new Matrix4().compose(new Vector3(...p.position), new Quaternion().setFromEuler(new Euler(...p.rotation)), new Vector3(1, 1, 1));
    for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) {
      reach = Math.max(reach, corner.set(x, y, z).applyMatrix4(toWorld).distanceTo(target));
    }
  }
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const fit = Math.max((layout.height * 0.72) / tan, (layout.width * 0.66) / (tan * aspect)) + 1.2;
  const minDistance = reach + ORBIT.standoff;
  const maxDistance = Math.min(ORBIT.rainRadius - 6, Math.max(fit * 1.4, minDistance * 2));
  // Lowest the camera may sink while looking at the target from the farthest distance: just above the floor.
  const maxPolar = Math.PI / 2 + Math.asin(Math.min(0.15, (target.y - 0.6) / maxDistance));
  return { target, distance: Math.min(maxDistance, Math.max(minDistance, fit)), minDistance, maxDistance, minPolar: ORBIT.minPolar, maxPolar };
}
