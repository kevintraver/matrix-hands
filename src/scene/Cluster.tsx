import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Euler,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type ShaderMaterial,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { screenModifier } from '../screen/modifiers';
import { applyModification, createScreenMaterial } from '../screen/screenMaterial';
import { UNITS } from './computers';
import type { Layout } from './layout';
import { createPartBuilder } from './partBuilder';
import { mulberry32 } from './rng';

type Screen = { matrix: Matrix4; geometry: PlaneGeometry; material: ShaderMaterial };

const bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
const glowMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

function buildCluster(layout: Layout, hand: Texture) {
  const b = createPartBuilder();
  const screens: Screen[] = [];
  for (const p of layout.placements) {
    const spec = UNITS[p.kind];
    const unit = new Matrix4().compose(
      new Vector3(...p.position),
      new Quaternion().setFromEuler(new Euler(...p.rotation)),
      new Vector3(1, 1, 1),
    );
    b.group(unit, () => spec.build(b, mulberry32(p.seed)));
    if (spec.screen) {
      const { w, h, offset } = spec.screen;
      screens.push({
        matrix: unit.clone().multiply(new Matrix4().makeTranslation(...offset)),
        geometry: new PlaneGeometry(w, h),
        material: createScreenMaterial(hand, (p.seed % 1000) / 1000),
      });
    }
  }
  return { body: mergeGeometries(b.solid), glow: mergeGeometries(b.glowing), screens };
}

export function Cluster({ layout, hand }: { layout: Layout; hand: Texture }) {
  const { body, glow, screens } = useMemo(() => buildCluster(layout, hand), [layout, hand]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    screens.forEach((s, i) => applyModification(s.material, screenModifier(i, t), t));
  });
  return (
    <group>
      <mesh geometry={body} material={bodyMaterial} />
      <mesh geometry={glow} material={glowMaterial} />
      {screens.map((s, i) => (
        <mesh key={i} geometry={s.geometry} material={s.material} matrix={s.matrix} matrixAutoUpdate={false} />
      ))}
    </group>
  );
}
