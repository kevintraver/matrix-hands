import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { DEBUG, reportDebug } from './debug';
import { QUALITY, pickTier } from './quality';
import { createHandTracker } from './tracking/handTracker';
import { Scene } from './scene/Scene';
import { createHandTexture } from './screen/handTexture';
import { useTrackerState } from './tracking/useTrackerState';
import { DebugVideo } from './ui/DebugVideo';
import { StartOverlay } from './ui/StartOverlay';

const TIER = pickTier();
const QUALITY_NOW = QUALITY[TIER];
const tracker = createHandTracker(QUALITY_NOW.detectHz);
const hand = createHandTexture(QUALITY_NOW.handTexSize);
reportDebug({ tier: TIER });

export function App() {
  const state = useTrackerState(tracker);
  const [entered, setEntered] = useState(false);
  useEffect(() => tracker.preload(), []);
  const enter = () => {
    setEntered(true);
    tracker.start();
  };
  return (
    <>
      <Canvas dpr={[...QUALITY_NOW.dpr]} camera={{ fov: 40, position: [0, 5, 14] }} gl={{ antialias: true }}>
        <color attach="background" args={['#000']} />
        <Scene tracker={tracker} hand={hand} quality={QUALITY_NOW} />
      </Canvas>
      {DEBUG && entered && <DebugVideo tracker={tracker} handCanvas={hand.texture.image as HTMLCanvasElement} />}
      <StartOverlay state={state} onEnter={enter} />
    </>
  );
}
