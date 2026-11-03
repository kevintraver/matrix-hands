import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { reportDebug } from '../debug';
import { ORBIT, frameTree } from './framing';
import type { Layout } from './layout';

/** Whether the viewer is steering, has let go, or has left the camera alone long enough for it to drift. */
type Drift = { kind: 'held' } | { kind: 'idle'; since: number } | { kind: 'drifting' };

/** Drag to circle the tree, pinch or scroll to zoom; left alone, the camera slowly drifts around it. */
export function CameraRig({ layout }: { layout: Layout }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const domElement = useThree((s) => s.gl.domElement);
  const size = useThree((s) => s.size);
  const controls = useMemo(() => new OrbitControls(camera, domElement), [camera, domElement]);
  const drift = useRef<Drift>({ kind: 'idle', since: performance.now() });
  const aspect = useRef(size.width / size.height);
  aspect.current = size.width / size.height;

  useEffect(() => {
    const framing = frameTree(layout, aspect.current, camera.fov);
    controls.target.copy(framing.target);
    camera.position.set(framing.target.x, framing.target.y, framing.target.z + framing.distance);
    Object.assign(controls, {
      enablePan: false,
      enableDamping: true,
      rotateSpeed: ORBIT.rotateSpeed,
      zoomSpeed: ORBIT.zoomSpeed,
      minDistance: framing.minDistance,
      maxDistance: framing.maxDistance,
      minPolarAngle: framing.minPolar,
      maxPolarAngle: framing.maxPolar,
      autoRotateSpeed: ORBIT.idleDrift?.speed ?? 0,
    });
    controls.update();
    const hold = () => {
      drift.current = { kind: 'held' };
      controls.autoRotate = false;
    };
    const release = () => {
      drift.current = { kind: 'idle', since: performance.now() };
    };
    controls.addEventListener('start', hold);
    controls.addEventListener('end', release);
    return () => {
      controls.removeEventListener('start', hold);
      controls.removeEventListener('end', release);
    };
  }, [controls, camera, layout]);

  useEffect(() => () => controls.dispose(), [controls]);

  useFrame((_, delta) => {
    const d = drift.current;
    if (ORBIT.idleDrift && d.kind === 'idle' && performance.now() - d.since >= ORBIT.idleDrift.afterMs) {
      drift.current = { kind: 'drifting' };
      controls.autoRotate = true;
    }
    controls.dampingFactor = 1 - Math.exp(-delta * ORBIT.damping);
    // The drift steps through at most `maxStep` per frame, so after a stall (a hidden tab) it resumes instead of leaping.
    controls.update(Math.min(delta, ORBIT.maxStep));
    reportDebug({
      camera: {
        azimuth: Number(MathUtils.radToDeg(controls.getAzimuthalAngle()).toFixed(2)),
        polar: Number(MathUtils.radToDeg(controls.getPolarAngle()).toFixed(2)),
        distance: Number(controls.getDistance().toFixed(3)),
        minDistance: Number(controls.minDistance.toFixed(3)),
        maxDistance: Number(controls.maxDistance.toFixed(3)),
        minPolar: Number(MathUtils.radToDeg(controls.minPolarAngle).toFixed(2)),
        maxPolar: Number(MathUtils.radToDeg(controls.maxPolarAngle).toFixed(2)),
        drifting: drift.current.kind === 'drifting',
      },
    });
  });
  return null;
}
