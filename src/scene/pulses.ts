import type { Rng } from './rng';

/** Light pulses that hand movement sends along the cables. */
export const PULSES = {
  /** Pulses in flight per cable at most; two share one RGBA texel. */
  slots: 8,
  /** World units per second along a cable. Constant, so faster hands mean more pulses, not faster ones. */
  speed: 3,
  /** Gaussian half-width of one pulse, in world units. */
  length: 0.5,
  /** New pulses per cable per second at full motion. */
  maxRatePerCable: 1.1,
  /** 'up' runs from the floor into the computers: the hand's data feeding the machine. */
  direction: 'up' as 'up' | 'down',
  /** Brightness at motion 0 and 1. */
  gain: [0.6, 1.0] as const,
};

export const PULSE_TEXELS = PULSES.slots / 2;

/**
 * Per cable, `slots` (birth time, gain) pairs, laid out as a cables x PULSE_TEXELS RGBA float
 * texture so the shader can read them directly.
 */
export type PulseField = { readonly data: Float32Array; readonly lengths: readonly number[] };

const NEVER = -1e6;

export function createPulseField(lengths: readonly number[]): PulseField {
  const data = new Float32Array(lengths.length * PULSES.slots * 2);
  for (let i = 0; i < data.length; i += 2) data[i] = NEVER;
  return { data, lengths };
}

const inFlight = (birth: number, length: number, now: number) =>
  now >= birth && (now - birth) * PULSES.speed <= length + PULSES.length;

/** Starts new pulses at a rate proportional to `motion`. Returns how many started. */
export function spawnPulses(field: PulseField, motion: number, now: number, dt: number, rng: Rng): number {
  if (motion <= 0) return 0;
  const chance = Math.min(1, PULSES.maxRatePerCable * motion * Math.min(dt, 0.1));
  const gain = PULSES.gain[0] + (PULSES.gain[1] - PULSES.gain[0]) * motion;
  let started = 0;
  field.lengths.forEach((length, cable) => {
    if (rng() >= chance) return;
    for (let s = 0; s < PULSES.slots; s++) {
      const i = (cable * PULSES.slots + s) * 2;
      if (inFlight(field.data[i]!, length, now)) continue;
      field.data[i] = now;
      field.data[i + 1] = gain;
      started += 1;
      return;
    }
  });
  return started;
}

export function countPulses(field: PulseField, now: number): number {
  let n = 0;
  field.lengths.forEach((length, cable) => {
    for (let s = 0; s < PULSES.slots; s++) if (inFlight(field.data[(cable * PULSES.slots + s) * 2]!, length, now)) n++;
  });
  return n;
}
