/** Viewer offset in -1..1, written only by the listeners below and read by the camera rig. */
export const parallax = { x: 0, y: 0 };

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function listenPointer(): () => void {
  const onMove = (e: PointerEvent) => {
    parallax.x = clamp((e.clientX / window.innerWidth) * 2 - 1);
    parallax.y = clamp((e.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove);
  return () => window.removeEventListener('pointermove', onMove);
}

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Must be called inside the ENTER tap: iOS only grants motion access from a user gesture.
 * If access is refused the rig keeps its slow drift.
 */
export function enableTilt(): void {
  const listen = () => {
    let rest: number | null = null;
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null || e.beta === null) return;
      rest ??= e.beta;
      parallax.x = clamp(e.gamma / 30);
      parallax.y = clamp((e.beta - rest) / 30);
    });
  };
  const request = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
  if (typeof request === 'function') {
    request()
      .then((answer) => answer === 'granted' && listen())
      .catch(() => {});
  } else {
    listen();
  }
}
