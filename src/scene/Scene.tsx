import { useMemo } from 'react';
import { PerformanceMonitor, Stats } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { DEBUG } from '../debug';
import type { Quality } from '../quality';
import type { HandTexture } from '../screen/handTexture';
import type { HandTracker } from '../tracking/handTracker';
import { Cables } from './Cables';
import { CameraRig } from './CameraRig';
import { Cluster } from './Cluster';
import { FpsMeter } from './FpsMeter';
import type { Flow } from './flow';
import { HandFrameReader } from './HandFrameReader';
import { Effects } from './Effects';
import { Floor } from './Floor';
import { createLayout } from './layout';
import { MatrixRain } from './MatrixRain';

type Props = { tracker: HandTracker; hand: HandTexture; quality: Quality; seed: number };

export function Scene({ tracker, hand, quality, seed }: Props) {
  const layout = useMemo(() => createLayout(quality.units, quality.tree, seed), [quality, seed]);
  const flow = useMemo<Flow>(() => ({ motion: 0 }), []);
  const setDpr = useThree((s) => s.setDpr);
  const [minDpr, maxDpr] = quality.dpr;
  return (
    <>
      <fog attach="fog" args={['#000', 18, 45]} />
      {quality.adaptiveDpr && (
        <PerformanceMonitor
          flipflops={3}
          onChange={({ factor }) => setDpr(minDpr + (maxDpr - minDpr) * factor)}
          onFallback={() => setDpr(minDpr)}
        />
      )}
      <HandFrameReader tracker={tracker} hand={hand} flow={flow} />
      <CameraRig layout={layout} />
      <hemisphereLight args={['#9fb8a4', '#020402', 0.35]} />
      <directionalLight position={[-5, 9, 8]} intensity={1.1} color="#fff1dc" />
      <directionalLight position={[2, 6, -8]} intensity={1.6} color="#3dff7a" />
      <pointLight position={[0, layout.height * 0.6, 3]} intensity={6} distance={14} color="#4dff88" />
      <Cluster layout={layout} hand={hand.texture} />
      <Cables layout={layout} count={quality.cables} flow={flow} />
      <MatrixRain width={70} height={44} z={-14} />
      <Floor radius={Math.max(layout.width, layout.height) * 2.5} />
      <Effects quality={quality} />
      {DEBUG && <FpsMeter />}
      {DEBUG && <Stats className="stats-panel" />}
    </>
  );
}
