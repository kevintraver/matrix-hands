import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  CatmullRomCurve3,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { reportDebug } from '../debug';
import type { Flow } from './flow';
import type { Layout } from './layout';
import { PULSES, PULSE_TEXELS, countPulses, createPulseField, spawnPulses } from './pulses';
import { mulberry32, range } from './rng';

const vertexShader = /* glsl */ `
attribute float aCable;
attribute float aLength;
varying vec2 vUv;
varying float vCable;
varying float vLength;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vCable = aCable;
  vLength = aLength;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uPulses;
uniform float uTime;
uniform float uSpeed;
uniform float uPulseLength;
uniform float uFlowUp;
varying vec2 vUv;
varying float vCable;
varying float vLength;
varying vec3 vNormal;

float pulse(float birth, float gain, float along) {
  float travelled = (uTime - birth) * uSpeed;
  if (travelled < 0.0 || travelled > vLength + uPulseLength) return 0.0;
  float d = (along - travelled) / uPulseLength;
  return gain * exp(-d * d);
}

void main() {
  float light = 0.35 + 0.65 * max(dot(vNormal, normalize(vec3(-0.4, 0.8, 0.5))), 0.0);
  float rim = pow(1.0 - abs(vNormal.z), 3.0);
  vec3 base = vec3(0.025, 0.03, 0.028) * light + vec3(0.02, 0.1, 0.045) * rim;
  float along = (uFlowUp > 0.5 ? 1.0 - vUv.x : vUv.x) * vLength;
  int row = int(vCable + 0.5);
  float glow = 0.0;
  for (int t = 0; t < TEXELS; t++) {
    vec4 s = texelFetch(uPulses, ivec2(t, row), 0);
    glow += pulse(s.r, s.g, along) + pulse(s.b, s.a, along);
  }
  gl_FragColor = vec4(base + vec3(0.25, 1.7, 0.6) * min(glow, 1.5), 1.0);
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
  const lengths: number[] = [];
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
    const length = curve.getLength();
    lengths.push(length);
    const vertices = tube.getAttribute('position').count;
    tube.setAttribute('aCable', new BufferAttribute(new Float32Array(vertices).fill(i), 1));
    tube.setAttribute('aLength', new BufferAttribute(new Float32Array(vertices).fill(length), 1));
    return tube;
  });
  return { geometry: mergeGeometries(tubes), lengths };
}

export function Cables({ layout, count, flow }: { layout: Layout; count: number; flow: Flow }) {
  const { geometry, material, field, texture } = useMemo(() => {
    const { geometry, lengths } = buildCables(layout, count);
    const field = createPulseField(lengths);
    const texture = new DataTexture(field.data, PULSE_TEXELS, count, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      toneMapped: false,
      defines: { TEXELS: PULSE_TEXELS },
      uniforms: {
        uPulses: { value: texture },
        uTime: { value: 0 },
        uSpeed: { value: PULSES.speed },
        uPulseLength: { value: PULSES.length },
        uFlowUp: { value: PULSES.direction === 'up' ? 1 : 0 },
      },
    });
    return { geometry, material, field, texture };
  }, [layout, count]);
  const rng = useMemo(() => mulberry32(99), []);
  const spawned = useRef(0);

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    material.uniforms.uTime!.value = now;
    const started = spawnPulses(field, flow.motion, now, delta, rng);
    if (started > 0) texture.needsUpdate = true;
    spawned.current += started;
    reportDebug({ pulses: countPulses(field, now), pulsesSpawned: spawned.current });
  });
  return <mesh geometry={geometry} material={material} />;
}
