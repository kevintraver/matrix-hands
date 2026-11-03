import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { DEBUG, reportDebug } from './debug';
import { QUALITY, pickTier } from './quality';
import { createRecorder, recordingFormat } from './record/recorder';
import { createHandTracker } from './tracking/handTracker';
import { Scene } from './scene/Scene';
import { createHandTexture } from './screen/handTexture';
import { useTrackerState } from './tracking/useTrackerState';
import { DebugVideo } from './ui/DebugVideo';
import { RecordControls } from './ui/RecordControls';
import { StartOverlay } from './ui/StartOverlay';

const TIER = pickTier();
const QUALITY_NOW = QUALITY[TIER];
const tracker = createHandTracker(QUALITY_NOW.detectHz);
const hand = createHandTexture(QUALITY_NOW.handTexSize);
const DEFAULT_SEED = 1987;
const PARAMS = new URLSearchParams(window.location.search);
const SEED = Number(PARAMS.get('seed')) || DEFAULT_SEED;
/** With ?seed= the colours repeat, for reproducible screenshots; without it every load repaints the tree. */
const COLOR_SEED = PARAMS.has('seed') ? (SEED ^ 0x5bd1e995) >>> 0 : Math.floor(Math.random() * 2 ** 31);
reportDebug({ tier: TIER, colorSeed: COLOR_SEED });
const FORMAT = recordingFormat();
/** Null where the browser cannot record; the Record button then never appears. */
const recorder = FORMAT ? createRecorder(FORMAT) : null;

export function App() {
  const state = useTrackerState(tracker);
  const [entered, setEntered] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => tracker.preload(), []);
  const enter = () => {
    setEntered(true);
    tracker.start();
  };
  return (
    <>
      <Canvas ref={canvas} dpr={[...QUALITY_NOW.dpr]} camera={{ fov: 40, position: [0, 5, 14] }} gl={{ antialias: true }}>
        <color attach="background" args={['#000']} />
        <Scene tracker={tracker} hand={hand} quality={QUALITY_NOW} seed={SEED} colorSeed={COLOR_SEED} />
      </Canvas>
      {DEBUG && entered && <DebugVideo tracker={tracker} handCanvas={hand.texture.image as HTMLCanvasElement} />}
      {recorder && state.kind === 'running' && <RecordControls recorder={recorder} canvas={canvas} />}
      <StartOverlay state={state} onEnter={enter} />
    </>
  );
}
