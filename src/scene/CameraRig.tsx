import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type PerspectiveCamera } from 'three';
import { listenPointer, parallax } from '../input/parallax';
import type { Layout } from './layout';

/** Frames the whole tree for the viewport aspect, then adds a slow drift and viewer parallax. */
export function CameraRig({ layout }: { layout: Layout }) {
  const size = useThree((s) => s.size);
  const smoothed = useRef({ x: 0, y: 0 });
  const target = useRef(new Vector3());
  useEffect(listenPointer, []);
  useFrame(({ camera, clock }, delta) => {
    const cam = camera as PerspectiveCamera;
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    const aspect = size.width / size.height;
    const dist = Math.max((layout.height * 0.72) / tan, (layout.width * 0.66) / (tan * aspect)) + 1.2;
    const centerY = layout.height * 0.47;
    const t = clock.elapsedTime;
    const s = smoothed.current;
    const k = 1 - Math.exp(-delta * 2.5);
    s.x += (parallax.x - s.x) * k;
    s.y += (parallax.y - s.y) * k;
    const swing = dist * 0.09;
    cam.position.set(
      Math.sin(t * 0.07) * swing * 0.6 + s.x * swing,
      centerY + Math.sin(t * 0.05) * swing * 0.25 - s.y * swing * 0.5,
      dist + Math.sin(t * 0.04) * 0.4,
    );
    cam.lookAt(target.current.set(s.x * 0.3, centerY, 0));
  });
  return null;
}
