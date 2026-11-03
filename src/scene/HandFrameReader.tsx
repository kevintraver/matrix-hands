import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { reportDebug } from '../debug';
import type { HandTexture } from '../screen/handTexture';
import type { HandTracker } from '../tracking/handTracker';
import { INITIAL_MOTION, stepMotion } from '../tracking/motion';
import type { Flow } from './flow';

/** Reads the tracker's latest frame once per render frame: redraws the shared texture and updates `motion`. */
export function HandFrameReader({ tracker, hand, flow }: { tracker: HandTracker; hand: HandTexture; flow: Flow }) {
  const motion = useRef(INITIAL_MOTION);
  useFrame((_, delta) => {
    const frame = tracker.latest();
    hand.update(frame);
    motion.current = stepMotion(motion.current, frame, performance.now(), delta * 1000);
    flow.motion = motion.current.level;
    reportDebug({ motion: Number(flow.motion.toFixed(3)) });
  });
  return null;
}
