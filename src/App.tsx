import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { QUALITY, pickTier } from './quality';
import type { TrackerState } from './types';
import { StartOverlay } from './ui/StartOverlay';

export function App() {
  const [tier] = useState(pickTier);
  const quality = QUALITY[tier];
  const [state, setState] = useState<TrackerState>({ kind: 'idle' });
  return (
    <>
      <Canvas dpr={[...quality.dpr]} camera={{ fov: 40, position: [0, 5, 14] }} gl={{ antialias: true }}>
        <color attach="background" args={['#000']} />
      </Canvas>
      <StartOverlay state={state} onEnter={() => setState({ kind: 'starting' })} />
    </>
  );
}
