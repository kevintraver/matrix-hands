import type { TrackerState } from './types';

export const DEBUG = new URLSearchParams(window.location.search).has('debug');

export type DebugStats = {
  state: TrackerState['kind'];
  delegate: 'GPU' | 'CPU' | null;
  hands: number;
  detections: number;
  framesWithHands: number;
  fps: number;
  tier: string;
  /** Seeds the unit colours; differs per load unless ?seed= is set. */
  colorSeed: number;
  motion: number;
  /** In flight right now. */
  pulses: number;
  /** Started since load. */
  pulsesSpawned: number;
};

declare global {
  interface Window {
    __matrixHands?: DebugStats;
  }
}

/** Only writes under `?debug`, so the global never exists in normal use. */
export function reportDebug(patch: Partial<DebugStats>): void {
  if (!DEBUG) return;
  window.__matrixHands = {
    ...(window.__matrixHands ?? {
      state: 'idle',
      delegate: null,
      hands: 0,
      detections: 0,
      framesWithHands: 0,
      fps: 0,
      tier: '',
      colorSeed: 0,
      motion: 0,
      pulses: 0,
      pulsesSpawned: 0,
    }),
    ...patch,
  };
}
