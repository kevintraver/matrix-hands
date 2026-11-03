import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_MOTION, handSpeed, stepMotion, type MotionState } from '../src/tracking/motion.ts';
import type { HandFrame } from '../src/types.ts';

const hand = (dx: number) => ({ side: 'Right' as const, points: Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01 + dx, y: 0.5 })) });
const frame = (time: number, dx: number | null): HandFrame => ({ hands: dx === null ? [] : [hand(dx)], time, aspect: 1 });

function run(frames: (number | null)[], frameEveryMs: number, renderMs = 16): MotionState {
  let state = INITIAL_MOTION;
  let now = 0;
  frames.forEach((dx, i) => {
    const f = frame(i * frameEveryMs, dx);
    for (let t = 0; t < frameEveryMs; t += renderMs) {
      state = stepMotion(state, f, now, renderMs);
      now += renderMs;
    }
  });
  return state;
}

test('speed is mean landmark displacement per second', () => {
  assert.ok(Math.abs(handSpeed(frame(0, 0), frame(500, 0.1)) - 0.2) < 1e-9);
});

test('no hands means no motion', () => {
  assert.equal(run([null, null, null], 33).level, 0);
});

test('a still hand settles to zero', () => {
  assert.equal(run([0, 0, 0, 0, 0, 0], 33).level, 0);
});

test('a moving hand raises the level', () => {
  assert.ok(run([0, 0.02, 0.04, 0.06, 0.08], 33).level > 0.9);
});

test('motion stops within 1.5 s after the hand stops', () => {
  const moving = [0, 0.02, 0.04, 0.06, 0.08];
  const still = Array.from({ length: 45 }, () => 0.08);
  assert.equal(run([...moving, ...still], 33).level, 0);
});

test('a hand that disappears stops the motion', () => {
  assert.equal(run([0, 0.02, 0.04, ...Array.from({ length: 45 }, () => null)], 33).level, 0);
});
