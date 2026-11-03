import { useEffect, useRef } from 'react';
import type { HandTracker } from '../tracking/handTracker';

const HAND_COLORS = { Left: '#4dff88', Right: '#ffd24d' } as const;

/** `?debug` only: the raw webcam with tracked landmarks drawn over it. */
export function DebugVideo({ tracker }: { tracker: HandTracker }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current!;
    const canvas = canvasRef.current!;
    const { video } = tracker;
    const restore = video.style.cssText;
    video.style.cssText = '';
    box.prepend(video);
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const hand of tracker.latest().hands) {
        ctx.fillStyle = HAND_COLORS[hand.side];
        for (const p of hand.points) {
          ctx.beginPath();
          ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      video.style.cssText = restore;
      document.body.appendChild(video);
    };
  }, [tracker]);

  return (
    <div ref={boxRef} className="debug-video">
      <canvas ref={canvasRef} />
    </div>
  );
}
