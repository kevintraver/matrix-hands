import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  TubeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { reportDebug } from '../debug';
import type { Flow } from './flow';
import type { Layout } from './layout';
import { PULSES, PULSE_TEXELS, countPulses, createPulseField, spawnPulses } from './pulses';
import { mulberry32 } from './rng';
import { routeCables } from './cableRoutes';

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
  // MSAA can extrapolate the normal past unit length; a negative pow base is NaN, which bloom spreads into a white orb.
  float rim = pow(max(1.0 - abs(vNormal.z), 0.0), 3.0);
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

const TUBE_SEGMENT = 0.06;

function buildCables(layout: Layout, count: number) {
  const routes = routeCables(layout, count);
  const tubes = routes.map(({ curve, radius }, i) => {
    const length = curve.getLength();
    const tube = new TubeGeometry(curve, Math.ceil(length / TUBE_SEGMENT), radius, 5, false);
    const vertices = tube.getAttribute('position').count;
    tube.setAttribute('aCable', new BufferAttribute(new Float32Array(vertices).fill(i), 1));
    tube.setAttribute('aLength', new BufferAttribute(new Float32Array(vertices).fill(length), 1));
    return { tube, length };
  });
  return { geometry: mergeGeometries(tubes.map((t) => t.tube)), lengths: tubes.map((t) => t.length) };
}

export function Cables({ layout, count, flow }: { layout: Layout; count: number; flow: Flow }) {
  const { geometry, material, field, texture } = useMemo(() => {
    const { geometry, lengths } = buildCables(layout, count);
    const field = createPulseField(lengths);
    const texture = new DataTexture(field.data, PULSE_TEXELS, lengths.length, RGBAFormat, FloatType);
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
