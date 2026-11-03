import { useFrame } from '@react-three/fiber';
import type { HandTexture } from '../screen/handTexture';
import type { HandTracker } from '../tracking/handTracker';

/** Reads the tracker's latest frame once per render frame and redraws the shared texture. */
export function HandTextureDriver({ tracker, hand }: { tracker: HandTracker; hand: HandTexture }) {
  useFrame(() => hand.update(tracker.latest()));
  return null;
}
