import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  TubeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { reportDebug } from '../debug';
import type { Flow } from './flow';
import type { Layout } from './layout';
import { PULSES, PULSE_TEXELS, countPulses, createPulseField, spawnPulses, type PulseField } from './pulses';
import { mulberry32 } from './rng';
import { cableRouter, type CableRoute } from './cableRoutes';

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
/** Routing work per slice before yielding to the browser; one cable takes a few milliseconds. */
const SLICE_MS = 8;

type Built = { geometry: BufferGeometry; field: PulseField; texture: DataTexture };

/** Routing a whole tree takes hundreds of milliseconds on a phone, so it runs a cable at a time between frames. */
async function routeInSlices(layout: Layout, count: number, cancelled: () => boolean): Promise<CableRoute[] | null> {
  const router = cableRouter(layout, count);
  let deadline = performance.now() + SLICE_MS;
  for (;;) {
    const step = router.next();
    if (step.done) return step.value;
    if (performance.now() < deadline) continue;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancelled()) return null;
    deadline = performance.now() + SLICE_MS;
  }
}

function buildCables(routes: readonly CableRoute[]): Built {
  const tubes = routes.map(({ curve, radius }, i) => {
    const length = curve.getLength();
    const tube = new TubeGeometry(curve, Math.ceil(length / TUBE_SEGMENT), radius, 5, false);
    const vertices = tube.getAttribute('position').count;
    tube.setAttribute('aCable', new BufferAttribute(new Float32Array(vertices).fill(i), 1));
    tube.setAttribute('aLength', new BufferAttribute(new Float32Array(vertices).fill(length), 1));
    return { tube, length };
  });
  const lengths = tubes.map((t) => t.length);
  const field = createPulseField(lengths);
  const texture = new DataTexture(field.data, PULSE_TEXELS, lengths.length, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return { geometry: mergeGeometries(tubes.map((t) => t.tube)), field, texture };
}

/**
 * Stands in until routing finishes. It carries the tube's position and normal attributes, because a mesh's
 * attributes select its shader variant, and the precompiled variant has to be the one the cables draw with.
 */
function createPlaceholder(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  geometry.boundingSphere = new Sphere();
  return geometry;
}

/** Exists before the cables do, so the shader compiles with the rest of the scene. */
function createCableMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    toneMapped: false,
    defines: { TEXELS: PULSE_TEXELS },
    uniforms: {
      uPulses: { value: null },
      uTime: { value: 0 },
      uSpeed: { value: PULSES.speed },
      uPulseLength: { value: PULSES.length },
      uFlowUp: { value: PULSES.direction === 'up' ? 1 : 0 },
    },
  });
}

export function Cables({ layout, count, flow }: { layout: Layout; count: number; flow: Flow }) {
  const material = useMemo(createCableMaterial, []);
  const placeholder = useMemo(createPlaceholder, []);
  const [built, setBuilt] = useState<Built | null>(null);
  useEffect(() => {
    let cancelled = false;
    void routeInSlices(layout, count, () => cancelled).then((routes) => {
      if (routes && !cancelled) setBuilt(buildCables(routes));
    });
    return () => {
      cancelled = true;
    };
  }, [layout, count]);
  const rng = useMemo(() => mulberry32(99), []);
  const spawned = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!built) return;
    const now = clock.elapsedTime;
    material.uniforms.uPulses!.value = built.texture;
    material.uniforms.uTime!.value = now;
    const started = spawnPulses(built.field, flow.motion, now, delta, rng);
    if (started > 0) built.texture.needsUpdate = true;
    spawned.current += started;
    reportDebug({ pulses: countPulses(built.field, now), pulsesSpawned: spawned.current });
  });
  return <mesh geometry={built?.geometry ?? placeholder} material={material} />;
}
