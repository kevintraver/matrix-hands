import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, CatmullRomCurve3, ShaderMaterial, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout } from './layout';
import { mulberry32, range } from './rng';

const vertexShader = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying vec3 vNormal;
void main() {
  float light = 0.35 + 0.65 * max(dot(vNormal, normalize(vec3(-0.4, 0.8, 0.5))), 0.0);
  float rim = pow(1.0 - abs(vNormal.z), 3.0);
  vec3 base = vec3(0.025, 0.03, 0.028) * light + vec3(0.02, 0.12, 0.05) * rim;
  float enabled = step(0.35, vSeed);
  float p = fract(vUv.x * 1.5 - uTime * mix(0.12, 0.35, vSeed) + vSeed * 7.0);
  float pulse = smoothstep(0.0, 0.015, p) * (1.0 - smoothstep(0.015, 0.07, p)) * enabled;
  gl_FragColor = vec4(base + vec3(0.25, 1.8, 0.6) * pulse, 1.0);
}
`;

/**
 * Cables gather under the crown, run down around the trunk as one tangled bundle, and spread
 * across the floor like roots. Every cable starts at the top, so uv.x runs from crown to floor.
 */
function buildCables(layout: Layout, count: number) {
  const rng = mulberry32(4242);
  const near = [...layout.cableAnchors].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
  const anchors = near.slice(0, Math.max(3, Math.ceil(near.length * 0.6)));
  const crownBase = anchors.length > 0 ? Math.min(...anchors.map((a) => a[1])) : layout.height * 0.45;
  const trunkHalf = Math.min(1.1, layout.width * 0.12);
  const tubes = Array.from({ length: count }, (_, i) => {
    const anchor = anchors[i % Math.max(1, anchors.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const start = anchor
      ? new Vector3(anchor[0] + range(rng, -0.4, 0.4), anchor[1], anchor[2] + range(rng, -0.3, 0.3))
      : new Vector3(side * trunkHalf, crownBase, range(rng, -0.8, 0.2));
    const hugX = () => side * trunkHalf * range(rng, 0.85, 1.35);
    const hugZ = () => range(rng, -1.1, 0.45);
    const angle = range(rng, -Math.PI * 0.95, Math.PI * 0.05) + (side > 0 ? 0 : -Math.PI * 0.1);
    const reach = range(rng, 0.9, 3.8);
    const land = new Vector3(Math.cos(angle) * reach * 1.25 + side * trunkHalf, 0.03, -Math.sin(angle) * reach * 0.8 + 0.3);
    const curve = new CatmullRomCurve3([
      start,
      new Vector3((start.x + hugX()) / 2, start.y - 0.4, start.z + 0.05),
      new Vector3(hugX(), crownBase * 0.62, hugZ()),
      new Vector3(hugX(), crownBase * 0.28, hugZ()),
      new Vector3(side * trunkHalf * range(rng, 1.1, 1.6), 0.08, range(rng, -0.6, 0.8)),
      land,
      new Vector3(land.x * range(rng, 1.15, 1.45), 0.03, land.z * range(rng, 1.1, 1.4) + 0.2),
    ]);
    const tube = new TubeGeometry(curve, 72, range(rng, 0.014, 0.03), 5, false);
    const seed = rng();
    tube.setAttribute('aSeed', new BufferAttribute(new Float32Array(tube.getAttribute('position').count).fill(seed), 1));
    return tube;
  });
  return mergeGeometries(tubes);
}

export function Cables({ layout, count }: { layout: Layout; count: number }) {
  const geometry = useMemo(() => buildCables(layout, count), [layout, count]);
  const material = useMemo(
    () => new ShaderMaterial({ vertexShader, fragmentShader, toneMapped: false, uniforms: { uTime: { value: 0 } } }),
    [],
  );
  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} />;
}
