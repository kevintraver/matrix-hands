export type Tier = 'desktop' | 'mobile';

export type Quality = {
  readonly units: number;
  readonly cables: number;
  readonly dpr: readonly [number, number];
  readonly handTexSize: number;
  readonly bloom: { readonly intensity: number; readonly levels: number };
  readonly detectHz: number;
};

export const QUALITY: Record<Tier, Quality> = {
  desktop: {
    units: 40,
    cables: 60,
    dpr: [1, 2],
    handTexSize: 512,
    bloom: { intensity: 1.1, levels: 7 },
    detectHz: 60,
  },
  mobile: {
    units: 20,
    cables: 25,
    dpr: [1, 1.5],
    handTexSize: 256,
    bloom: { intensity: 0.9, levels: 5 },
    detectHz: 30,
  },
};

export function pickTier(): Tier {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return coarse && shortSide < 820 ? 'mobile' : 'desktop';
}
