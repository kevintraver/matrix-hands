import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import type { Layout } from './layout';

/** Frames the whole tree for the current viewport aspect, portrait or landscape. */
export function CameraRig({ layout }: { layout: Layout }) {
  const size = useThree((s) => s.size);
  useFrame(({ camera }) => {
    const cam = camera as PerspectiveCamera;
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    const aspect = size.width / size.height;
    const dist = Math.max((layout.height * 0.56) / tan, (layout.width * 0.56) / (tan * aspect)) + 1.2;
    const y = layout.height * 0.5;
    cam.position.set(0, y, dist);
    cam.lookAt(0, y, 0);
  });
  return null;
}
