import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { reportDebug } from '../debug';

/** `?debug` only: frames rendered over the last second, published to window.__matrixHands. */
export function FpsMeter() {
  const window = useRef({ start: performance.now(), frames: 0 });
  useFrame(() => {
    const w = window.current;
    w.frames += 1;
    const now = performance.now();
    if (now - w.start >= 1000) {
      reportDebug({ fps: Math.round((w.frames * 1000) / (now - w.start)) });
      w.start = now;
      w.frames = 0;
    }
  });
  return null;
}
