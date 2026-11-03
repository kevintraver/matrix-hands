import type { HandFrame } from '../types';

/**
 * How hand movement maps to the 0..1 `motion` level that drives the cable pulses.
 * Speeds are in normalized frame widths per second, averaged over every tracked landmark.
 */
export const MOTION = {
  /** Below this the hand counts as still (tracker jitter). */
  deadZone: 0.03,
  /** At or above this the level is 1. */
  fullSpeed: 0.45,
  attackMs: 80,
  releaseMs: 400,
  /** Without a new tracker frame for this long, the hand counts as still. */
  staleMs: 1500,
  /** Levels below this snap to 0, so a still hand stops the flow instead of trickling forever. */
  floor: 0.04,
} as const;

export type MotionState = {
  readonly level: number;
  readonly target: number;
  /** The last tracker frame folded in, and when it arrived on the render clock. */
  readonly frame: HandFrame | null;
  readonly seenAt: number;
};

export const INITIAL_MOTION: MotionState = { level: 0, target: 0, frame: null, seenAt: 0 };

/** Mean landmark displacement per second between two frames, over hands present in both (matched by slot and side). */
export function handSpeed(prev: HandFrame, next: HandFrame): number {
  const dt = (next.time - prev.time) / 1000;
  if (dt <= 0) return 0;
  let total = 0;
  let count = 0;
  next.hands.forEach((hand, i) => {
    const before = prev.hands[i];
    if (!before || before.side !== hand.side) return;
    hand.points.forEach((p, j) => {
      const q = before.points[j];
      if (!q) return;
      total += Math.hypot((p.x - q.x) * next.aspect, p.y - q.y);
      count += 1;
    });
  });
  return count === 0 ? 0 : total / count / dt;
}

export function speedToLevel(speed: number): number {
  return Math.min(1, Math.max(0, (speed - MOTION.deadZone) / (MOTION.fullSpeed - MOTION.deadZone)));
}

/** Folds the tracker's latest frame into the motion state, then eases the level toward its target. */
export function stepMotion(state: MotionState, frame: HandFrame, now: number, dtMs: number): MotionState {
  let { target, seenAt } = state;
  if (frame !== state.frame) {
    target = frame.hands.length === 0 || !state.frame ? 0 : speedToLevel(handSpeed(state.frame, frame));
    seenAt = now;
  }
  if (frame.hands.length === 0 || now - seenAt > MOTION.staleMs) target = 0;
  const tau = target > state.level ? MOTION.attackMs : MOTION.releaseMs;
  const level = state.level + (target - state.level) * (1 - Math.exp(-dtMs / tau));
  return { level: level < MOTION.floor ? 0 : level, target, frame, seenAt };
}
