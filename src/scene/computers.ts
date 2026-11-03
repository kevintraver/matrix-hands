import { Matrix4 } from 'three';
import { range, type Rng } from './rng';
import type { PartBuilder, Vec3 } from './partBuilder';

export type UnitKind = 'crtLarge' | 'crtSmall' | 'terminal' | 'desktop' | 'tower' | 'keyboard';

/** Screen face centre in unit-local space (origin at the bottom centre, front facing +z). Always 4:3. */
export type ScreenSpec = { readonly w: number; readonly h: number; readonly offset: Vec3 };

export type UnitSpec = {
  /** Footprint used for stacking: width, height, depth. */
  readonly size: Vec3;
  /** Relative frequency in the layout. */
  readonly weight: number;
  readonly screen?: ScreenSpec;
  build(b: PartBuilder, rng: Rng): void;
};

type Palette = { shell: string; trim: string; dark: string };

const BEIGE: readonly Palette[] = [
  { shell: '#cdc3a6', trim: '#b8ad8f', dark: '#3a372f' },
  { shell: '#d6ceb5', trim: '#c2b99c', dark: '#34312b' },
  { shell: '#c4b48a', trim: '#ad9e76', dark: '#38342a' },
];
const BLACK: readonly Palette[] = [
  { shell: '#232325', trim: '#2e2e31', dark: '#0c0c0d' },
  { shell: '#3a3b3d', trim: '#2a2b2d', dark: '#101011' },
];

const pickPalette = (rng: Rng): Palette => {
  const pool = rng() < 0.62 ? BEIGE : BLACK;
  return pool[Math.floor(rng() * pool.length)]!;
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
  return {
    size: [w, h, d],
    weight: 0,
    screen: { w: screenW, h: screenH, offset: [0, screenY, d / 2 + 0.036] },
    build(b, rng) {
      const p = pickPalette(rng);
      if (stand > 0) {
        b.box([w * 0.5, stand * 0.55, d * 0.5], [0, stand * 0.275, 0], p.trim);
        b.box([w * 0.3, stand * 0.5, d * 0.3], [0, stand * 0.75, 0], p.trim);
      }
      b.box([w, bodyH, bezelD], [0, bodyY, d / 2 - bezelD / 2], p.shell);
      b.taper([w * 0.94, bodyH * 0.94, d - bezelD], [0, bodyY, -bezelD / 2], [0.55, 0.6], p.shell);
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
  build(b, rng) {
    const p = pickPalette(rng);
    b.box([0.78, 1.0, 0.62], [0, 0.5, 0.14], p.shell);
    b.taper([0.74, 0.92, 0.28], [0, 0.52, -0.31], [0.8, 0.85], p.trim);
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
  build(b, rng) {
    const p = pickPalette(rng);
    b.box([1.3, 0.3, 1.08], [0, 0.16, 0], p.shell);
    b.box([1.32, 0.03, 1.1], [0, 0.015, 0], p.trim);
    for (const x of [-0.3, 0.1]) {
      b.box([0.34, 0.11, 0.02], [x, 0.17, 0.545], p.trim);
      b.box([0.26, 0.016, 0.02], [x, 0.17, 0.552], p.dark);
    }
    for (let i = 0; i < 6; i++) b.box([0.012, 0.14, 0.012], [-0.58 + i * 0.03, 0.16, 0.546], p.dark);
    b.box([0.06, 0.06, 0.02], [0.52, 0.17, 0.548], p.trim);
    b.glow([0.025, 0.012, 0.012], [0.42, 0.12, 0.548], rng() < 0.5 ? LED_GREEN : LED_AMBER);
  },
};

const tower: UnitSpec = {
  size: [0.5, 1.25, 1.05],
  weight: 0,
  build(b, rng) {
    const p = pickPalette(rng);
    b.box([0.5, 1.22, 1.03], [0, 0.62, 0], p.shell);
    b.box([0.54, 0.04, 1.05], [0, 0.02, 0], p.trim);
    for (let i = 0; i < 3; i++) b.box([0.4, 0.13, 0.02], [0, 1.08 - i * 0.16, 0.522], p.trim);
    b.box([0.3, 0.018, 0.02], [0, 0.6, 0.522], p.dark);
    for (let i = 0; i < 7; i++) b.box([0.34, 0.012, 0.012], [0, 0.12 + i * 0.04, 0.518], p.dark);
    b.box([0.07, 0.07, 0.02], [0, 0.46, 0.522], p.dark);
    b.glow([0.02, 0.02, 0.012], [0.12, 0.46, 0.522], LED_GREEN);
    b.glow([0.02, 0.012, 0.012], [-0.12, 0.46, 0.522], LED_AMBER);
  },
};

const KEYBOARD_TILT = -1.15;

/** Leans on its back edge with the keys toward the viewer. */
const keyboard: UnitSpec = {
  size: [1.2, 0.46, 0.5],
  weight: 0,
  build(b, rng) {
    const p = pickPalette(rng);
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
