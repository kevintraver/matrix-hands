/** Normalized 0..1 in the mirrored (selfie) frame. Mirroring happens once, at the tracker boundary. */
export type Point = { readonly x: number; readonly y: number };

export type HandSide = 'Left' | 'Right';

/** 21 points in MediaPipe landmark order. */
export type Hand = { readonly side: HandSide; readonly points: readonly Point[] };

/** `aspect` is the source video's width / height, so drawing can keep the hand's proportions. */
export type HandFrame = { readonly hands: readonly Hand[]; readonly time: number; readonly aspect: number };

export type TrackerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string };

export const EMPTY_FRAME: HandFrame = { hands: [], time: 0, aspect: 4 / 3 };
