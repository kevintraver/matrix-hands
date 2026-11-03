import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stats } from '@react-three/drei';
import { DEBUG } from '../debug';
import type { Quality } from '../quality';
import type { HandTexture } from '../screen/handTexture';
import { screenModifier } from '../screen/modifiers';
import { applyModification, createScreenMaterial } from '../screen/screenMaterial';
import type { HandTracker } from '../tracking/handTracker';
import { FpsMeter } from './FpsMeter';
import { HandTextureDriver } from './HandTextureDriver';

type Props = { tracker: HandTracker; hand: HandTexture; quality: Quality };

export function Scene({ tracker, hand }: Props) {
  const material = useMemo(() => createScreenMaterial(hand.texture, 0), [hand]);
  useFrame(({ clock }) => applyModification(material, screenModifier(0, clock.elapsedTime), clock.elapsedTime));
  return (
    <>
      <HandTextureDriver tracker={tracker} hand={hand} />
      <mesh position={[0, 0, 0]} material={material}>
        <planeGeometry args={[8, 6]} />
      </mesh>
      {DEBUG && <FpsMeter />}
      {DEBUG && <Stats className="stats-panel" />}
    </>
  );
}
