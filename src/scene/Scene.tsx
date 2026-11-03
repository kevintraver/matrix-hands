import { useMemo } from 'react';
import { Stats } from '@react-three/drei';
import { DEBUG } from '../debug';
import type { Quality } from '../quality';
import type { HandTexture } from '../screen/handTexture';
import type { HandTracker } from '../tracking/handTracker';
import { CameraRig } from './CameraRig';
import { Cluster } from './Cluster';
import { FpsMeter } from './FpsMeter';
import { HandTextureDriver } from './HandTextureDriver';
import { createLayout } from './layout';

type Props = { tracker: HandTracker; hand: HandTexture; quality: Quality; seed: number };

export function Scene({ tracker, hand, quality, seed }: Props) {
  const layout = useMemo(() => createLayout(quality.units, quality.tree, seed), [quality, seed]);
  return (
    <>
      <fog attach="fog" args={['#000', 18, 45]} />
      <HandTextureDriver tracker={tracker} hand={hand} />
      <CameraRig layout={layout} />
      <hemisphereLight args={['#9fb8a4', '#020402', 0.35]} />
      <directionalLight position={[-5, 9, 8]} intensity={1.1} color="#fff1dc" />
      <directionalLight position={[2, 6, -8]} intensity={1.6} color="#3dff7a" />
      <pointLight position={[0, layout.height * 0.6, 3]} intensity={6} distance={14} color="#4dff88" />
      <Cluster layout={layout} hand={hand.texture} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#020302" roughness={1} />
      </mesh>
      {DEBUG && <FpsMeter />}
      {DEBUG && <Stats className="stats-panel" />}
    </>
  );
}
