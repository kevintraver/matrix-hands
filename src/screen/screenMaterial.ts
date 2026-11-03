import { ShaderMaterial, Vector2, type Texture } from 'three';
import type { ScreenModification } from './modifiers';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uHand;
uniform vec2 uOffset;
uniform float uGain;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  c *= 1.0 + 0.07 * dot(c, c);
  float tube = pow(pow(abs(c.x), 8.0) + pow(abs(c.y), 8.0), 0.125);
  float mask = 1.0 - smoothstep(0.97, 1.0, tube);

  vec2 uv = c * 0.5 + 0.5 + uOffset;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec3 hand = texture2D(uHand, uv).rgb * inside;

  float scan = 0.7 + 0.3 * sin(uv.y * 6.2832 * 110.0);
  float flicker = 0.94 + 0.04 * sin(uTime * 53.0 + uSeed * 6.2832) + 0.02 * sin(uTime * 7.1 + uSeed * 19.0);
  float vignette = 1.0 - 0.3 * dot(c, c);
  gl_FragColor = vec4(hand * 3.2 * scan * flicker * vignette * mask * uGain, 1.0);
}
`;

export function createScreenMaterial(hand: Texture, seed: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    toneMapped: false,
    uniforms: {
      uHand: { value: hand },
      uOffset: { value: new Vector2() },
      uGain: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
  });
}

export function applyModification(material: ShaderMaterial, mod: ScreenModification, t: number): void {
  const u = material.uniforms;
  (u.uOffset!.value as Vector2).set(mod.offset[0], mod.offset[1]);
  u.uGain!.value = mod.gain;
  u.uTime!.value = t;
}
