import { useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';

/** Unlit: a dim pool under the tree that fades to black well before its edge, so there is no horizon. */
function createFade(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#141a16');
  g.addColorStop(0.25, '#070a08');
  g.addColorStop(0.6, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function Floor({ radius }: { radius: number }) {
  const map = useMemo(createFade, []);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 1]}>
      <circleGeometry args={[radius, 64]} />
      <meshBasicMaterial map={map} />
    </mesh>
  );
}
