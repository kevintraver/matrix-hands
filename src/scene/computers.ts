import { Matrix4 } from 'three';
import { range, type Rng } from './rng';
import type { Finish } from './finishes';
import type { PartBuilder, Vec3 } from './partBuilder';

export type UnitKind = 'crtLarge' | 'crtSmall' | 'terminal' | 'desktop' | 'tower' | 'keyboard';

/** Screen face centre in unit-local space (origin at the bottom centre, front facing +z). Always 4:3. */
export type ScreenSpec = { readonly w: number; readonly h: number; readonly offset: Vec3 };

export type PortFace = 'back' | 'under';

/** A socket a cable can plug into, on the unit's back or underside, never its screen face. `at` lies on the size box. */
export type Port = { readonly face: PortFace; readonly at: Vec3 };

/** Per face: the unit-local direction a plugged cable leaves in, and the socket drawn there. */
export const PORT_FACES: Record<PortFace, { readonly out: Vec3; readonly socket: Vec3 }> = {
  back: { out: [0, 0, -1], socket: [0.08, 0.06, 0.03] },
  under: { out: [0, -1, 0], socket: [0.08, 0.03, 0.06] },
};

export type UnitSpec = {
  /** Footprint used for stacking: width, height, depth. */
  readonly size: Vec3;
  /** Relative frequency in the layout. */
  readonly weight: number;
  readonly screen?: ScreenSpec;
  readonly ports: readonly Port[];
  build(b: PartBuilder, rng: Rng, p: Finish): void;
};

const LED_GREEN = [0.5, 3.2, 0.9] as const;
const LED_AMBER = [3.0, 1.6, 0.2] as const;
const GLASS = '#060807';

type CrtParams = { w: number; h: number; d: number; stand: number; screenW: number };

function crt({ w, h, d, stand, screenW }: CrtParams): UnitSpec {
  const bodyH = h - stand;
  const bodyY = stand + bodyH / 2;
  const screenH = (screenW * 3) / 4;
  const screenY = bodyY + bodyH * 0.03;
  const bezelD = d * 0.2;
  const bellD = (d - bezelD) * 0.72;
  const neckD = d - bezelD - bellD;
  const neckW = w * 0.94 * 0.62 * 0.82;
  const neckH = bodyH * 0.94 * 0.66 * 0.85;
  const neckY = bodyY - bodyH * 0.04;
  const portY = bodyY - bodyH * 0.12;
  return {
    size: [w, h, d],
    weight: 0,
    screen: { w: screenW, h: screenH, offset: [0, screenY, d / 2 + 0.036] },
    ports: [
      { face: 'back', at: [-w * 0.1, portY, -d / 2] },
      { face: 'back', at: [w * 0.1, portY, -d / 2] },
      // Under the stand, or under the bezel when there is none: the only parts that reach y = 0.
      { face: 'under', at: [0, 0, stand > 0 ? -d * 0.12 : d * 0.4] },
    ],
    build(b, rng, p) {
      if (stand > 0) {
        b.box([w * 0.5, stand * 0.55, d * 0.5], [0, stand * 0.275, 0], p.trim);
        b.box([w * 0.3, stand * 0.5, d * 0.3], [0, stand * 0.75, 0], p.trim);
      }
      b.box([w, bodyH, bezelD], [0, bodyY, d / 2 - bezelD / 2], p.shell);
      b.taper([w * 0.94, bodyH * 0.94, bellD], [0, bodyY, d / 2 - bezelD - bellD / 2], [0.62, 0.66], p.shell);
      b.box([neckW, neckH, neckD], [0, neckY, -d / 2 + neckD / 2], p.shell);
      for (let i = 0; i < 5; i++) b.box([neckW * 0.8, 0.012, 0.022], [0, neckY + neckH / 2 + 0.004, -d / 2 + neckD * (0.18 + i * 0.15)], p.dark);
      for (let i = 0; i < 4; i++) b.box([neckW * 0.66, 0.012, 0.01], [0, neckY + neckH * 0.16 + i * 0.026, -d / 2 - 0.004], p.dark);
      b.box([0.05, 0.04, 0.014], [-neckW * 0.36, portY, -d / 2 - 0.005], p.dark);
      b.box([screenW * 1.1, screenH * 1.12, 0.03], [0, screenY, d / 2 + 0.01], p.dark);
      b.box([screenW * 1.02, screenH * 1.03, 0.03], [0, screenY, d / 2 + 0.018], GLASS);
      const ledX = w * 0.4;
      const ledY = stand + bodyH * 0.07;
      b.box([0.05, 0.035, 0.02], [ledX - 0.08, ledY, d / 2 + 0.01], p.dark);
      b.glow([0.025, 0.014, 0.012], [ledX, ledY, d / 2 + 0.008], rng() < 0.7 ? LED_GREEN : LED_AMBER);
      b.box([w * 0.18, 0.02, 0.012], [-w * 0.3, ledY, d / 2 + 0.006], p.trim);
    },
  };
}

const terminal: UnitSpec = {
  size: [0.78, 1.02, 0.9],
  weight: 0,
  screen: { w: 0.5, h: 0.375, offset: [0, 0.66, 0.488] },
  ports: [
    { face: 'back', at: [-0.14, 0.42, -0.45] },
    { face: 'back', at: [0.14, 0.42, -0.45] },
    { face: 'under', at: [0.2, 0, 0.1] },
  ],
  build(b, _rng, p) {
    b.box([0.78, 1.0, 0.62], [0, 0.5, 0.14], p.shell);
    b.taper([0.74, 0.92, 0.28], [0, 0.52, -0.31], [0.8, 0.85], p.trim);
    for (let i = 0; i < 5; i++) b.box([0.4, 0.014, 0.012], [0, 0.66 + i * 0.035, -0.455], p.dark);
    b.box([0.6, 0.48, 0.03], [0, 0.66, 0.46], p.dark);
    b.box([0.52, 0.39, 0.03], [0, 0.66, 0.468], GLASS);
    b.box([0.26, 0.022, 0.02], [0.12, 0.3, 0.455], p.dark);
    b.box([0.1, 0.06, 0.012], [-0.24, 0.16, 0.452], p.trim);
    b.glow([0.02, 0.012, 0.01], [-0.3, 0.3, 0.452], LED_GREEN);
    b.box([0.82, 0.03, 0.66], [0, 0.015, 0.14], p.trim);
  },
};

const desktop: UnitSpec = {
  size: [1.3, 0.32, 1.1],
  weight: 0,
  ports: [
    { face: 'back', at: [-0.38, 0.17, -0.55] },
    { face: 'back', at: [0, 0.17, -0.55] },
    { face: 'back', at: [0.38, 0.17, -0.55] },
    { face: 'under', at: [0.4, 0, -0.2] },
  ],
  build(b, rng, p) {
    b.box([1.3, 0.3, 1.08], [0, 0.16, 0], p.shell);
    b.box([1.32, 0.03, 1.1], [0, 0.015, 0], p.trim);
    for (const x of [-0.3, 0.1]) {
      b.box([0.34, 0.11, 0.02], [x, 0.17, 0.545], p.trim);
      b.box([0.26, 0.016, 0.02], [x, 0.17, 0.552], p.dark);
    }
    for (let i = 0; i < 6; i++) b.box([0.012, 0.14, 0.012], [-0.58 + i * 0.03, 0.16, 0.546], p.dark);
    b.box([0.06, 0.06, 0.02], [0.52, 0.17, 0.548], p.trim);
    b.glow([0.025, 0.012, 0.012], [0.42, 0.12, 0.548], rng() < 0.5 ? LED_GREEN : LED_AMBER);
    b.box([0.17, 0.22, 0.01], [0.56, 0.16, -0.545], p.trim);
    for (let i = 0; i < 5; i++) b.box([0.012, 0.18, 0.014], [0.5 + i * 0.03, 0.16, -0.55], p.dark);
    for (let i = 0; i < 4; i++) b.box([0.026, 0.2, 0.012], [-0.6 + i * 0.045, 0.16, -0.548], p.trim);
  },
};

const tower: UnitSpec = {
  size: [0.5, 1.25, 1.05],
  weight: 0,
  ports: [
    { face: 'back', at: [0.13, 0.95, -0.525] },
    { face: 'back', at: [0.13, 0.7, -0.525] },
    { face: 'under', at: [0, 0, -0.3] },
  ],
  build(b, _rng, p) {
    b.box([0.5, 1.22, 1.03], [0, 0.62, 0], p.shell);
    b.box([0.54, 0.04, 1.05], [0, 0.02, 0], p.trim);
    for (let i = 0; i < 3; i++) b.box([0.4, 0.13, 0.02], [0, 1.08 - i * 0.16, 0.522], p.trim);
    b.box([0.3, 0.018, 0.02], [0, 0.6, 0.522], p.dark);
    for (let i = 0; i < 7; i++) b.box([0.34, 0.012, 0.012], [0, 0.12 + i * 0.04, 0.518], p.dark);
    b.box([0.07, 0.07, 0.02], [0, 0.46, 0.522], p.dark);
    b.glow([0.02, 0.02, 0.012], [0.12, 0.46, 0.522], LED_GREEN);
    b.glow([0.02, 0.012, 0.012], [-0.12, 0.46, 0.522], LED_AMBER);
    b.box([0.26, 0.24, 0.01], [-0.07, 1.04, -0.522], p.trim);
    for (let i = 0; i < 5; i++) b.box([0.22, 0.012, 0.014], [-0.07, 0.96 + i * 0.04, -0.527], p.dark);
    for (let i = 0; i < 6; i++) b.box([0.3, 0.024, 0.012], [-0.03, 0.22 + i * 0.045, -0.524], p.dark);
  },
};

const KEYBOARD_TILT = -1.15;

/** Leans on its back edge with the keys toward the viewer. */
const keyboard: UnitSpec = {
  size: [1.2, 0.46, 0.5],
  weight: 0,
  ports: [],
  build(b, rng, p) {
    const lean = new Matrix4().makeTranslation(0, 0.02, 0.1).multiply(new Matrix4().makeRotationX(KEYBOARD_TILT));
    b.group(lean, () => {
      b.box([1.2, 0.05, 0.45], [0, 0.025, -0.225], p.shell);
      for (let row = 0; row < 5; row++) {
        const keys = 14 - (row === 4 ? 6 : 0);
        const keyW = row === 4 ? 0.1 : 0.068;
        const start = -0.55 + (row === 4 ? 0.22 : 0);
        for (let k = 0; k < keys; k++) {
          const tone = rng() < 0.12 ? p.trim : p.shell;
          b.box([row === 4 && k === 3 ? 0.42 : keyW * 0.88, 0.03, 0.065], [start + k * (keyW + 0.008) + (row === 4 && k > 3 ? 0.32 : 0), 0.065, -0.4 + row * 0.075], tone);
        }
      }
      b.glow([0.015, 0.01, 0.01], [0.5, 0.052, -0.42], LED_GREEN);
    });
  },
};

const crtLarge = crt({ w: 1.2, h: 1.08, d: 1.15, stand: 0.1, screenW: 0.86 });
const crtSmall = crt({ w: 0.92, h: 0.8, d: 0.92, stand: 0, screenW: 0.68 });

export const UNITS: Record<UnitKind, UnitSpec> = {
  crtLarge: { ...crtLarge, weight: 0.34 },
  crtSmall: { ...crtSmall, weight: 0.28 },
  terminal: { ...terminal, weight: 0.12 },
  desktop: { ...desktop, weight: 0.11 },
  tower: { ...tower, weight: 0.08 },
  keyboard: { ...keyboard, weight: 0.07 },
};

const KINDS = Object.keys(UNITS) as UnitKind[];
const TOTAL_WEIGHT = KINDS.reduce((sum, k) => sum + UNITS[k].weight, 0);

export function pickKind(rng: Rng): UnitKind {
  let r = rng() * TOTAL_WEIGHT;
  for (const kind of KINDS) {
    r -= UNITS[kind].weight;
    if (r <= 0) return kind;
  }
  return KINDS[0]!;
}

export const jitter = (rng: Rng, amount: number) => range(rng, -amount, amount);
