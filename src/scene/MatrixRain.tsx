import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, LinearFilter, ShaderMaterial, Vector2 } from 'three';

const ATLAS_CELLS = 8;
const CELL_PX = 64;
const GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>¦';
const GLYPH_SIZE = 0.42;

/** Drawn once: an 8x8 grid of mirrored half-width katakana and digits, white on transparent. */
function createAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_CELLS * CELL_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${CELL_PX * 0.78}px "MS Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "IPAGothic", monospace`;
  [...GLYPHS].slice(0, ATLAS_CELLS * ATLAS_CELLS).forEach((glyph, i) => {
    const cx = (i % ATLAS_CELLS) * CELL_PX + CELL_PX / 2;
    const cy = Math.floor(i / ATLAS_CELLS) * CELL_PX + CELL_PX / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  });
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  return texture;
}

const fragmentShader = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform vec2 uGrid;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 g = vUv * uGrid;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float row = uGrid.y - 1.0 - cell.y;
  float trail = 0.0;
  float head = 0.0;
  for (int k = 0; k < 2; k++) {
    float s = float(k) * 11.0;
    float speed = mix(3.5, 11.0, hash(vec2(cell.x, 1.0 + s)));
    float len = mix(7.0, 26.0, hash(vec2(cell.x, 2.0 + s)));
    float period = uGrid.y + len + mix(0.0, 50.0, hash(vec2(cell.x, 3.0 + s)));
    float pos = mod(uTime * speed + hash(vec2(cell.x, 4.0 + s)) * period, period);
    float d = floor(pos) - row;
    trail = max(trail, d >= 0.0 && d < len ? pow(1.0 - d / len, 1.5) : 0.0);
    head = max(head, d >= 0.0 && d < 1.0 ? 1.0 : 0.0);
  }
  float swap = floor(uTime * mix(0.5, 6.0, hash(cell + 0.37)));
  float index = floor(hash(cell + swap * 0.731) * 64.0);
  vec2 atlasUv = (vec2(mod(index, 8.0), floor(index / 8.0)) + mix(vec2(0.1), vec2(0.9), f)) / 8.0;
  float glyph = texture2D(uAtlas, atlasUv).a;
  float depth = mix(0.55, 1.0, hash(vec2(cell.x, 9.0)));
  vec3 color = vec3(0.1, 0.85, 0.32) * trail * 0.55 * depth + vec3(0.7, 1.0, 0.8) * head * 0.95;
  float base = smoothstep(0.03, 0.2, vUv.y);
  gl_FragColor = vec4(color * glyph * base, 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Background only: a single plane far behind the tree, so the rain never reaches a screen. */
export function MatrixRain({ width, height, z }: { width: number; height: number; z: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        toneMapped: false,
        uniforms: {
          uAtlas: { value: createAtlas() },
          uTime: { value: 0 },
          uGrid: { value: new Vector2(Math.round(width / GLYPH_SIZE), Math.round(height / GLYPH_SIZE)) },
        },
      }),
    [width, height],
  );
  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
  });
  return (
    <mesh position={[0, height / 2 - 2, z]} material={material}>
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}
