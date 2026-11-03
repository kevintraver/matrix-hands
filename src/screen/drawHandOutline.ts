import type { HandFrame, Point } from '../types';

/** Bone chains in MediaPipe landmark order, with each finger's width relative to the palm length. */
const FINGERS: readonly { readonly chain: readonly number[]; readonly width: number }[] = [
  { chain: [1, 2, 3, 4], width: 0.27 },
  { chain: [5, 6, 7, 8], width: 0.23 },
  { chain: [9, 10, 11, 12], width: 0.235 },
  { chain: [13, 14, 15, 16], width: 0.22 },
  { chain: [17, 18, 19, 20], width: 0.19 },
];
const PALM = [0, 1, 5, 9, 13, 17] as const;
const GREEN = 'rgb(90, 255, 150)';

type Canvas2D = CanvasRenderingContext2D;

function traceHand(ctx: Canvas2D, pts: readonly Point[], palmLength: number, grow: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { chain, width } of FINGERS) {
    ctx.lineWidth = width * palmLength + grow * 2;
    ctx.beginPath();
    chain.forEach((idx, i) => (i === 0 ? ctx.moveTo(pts[idx]!.x, pts[idx]!.y) : ctx.lineTo(pts[idx]!.x, pts[idx]!.y)));
    ctx.stroke();
  }
  ctx.beginPath();
  PALM.forEach((idx, i) => (i === 0 ? ctx.moveTo(pts[idx]!.x, pts[idx]!.y) : ctx.lineTo(pts[idx]!.x, pts[idx]!.y)));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.2 * palmLength + grow * 2;
  ctx.stroke();
}

/** Maps normalized video points into canvas pixels, cover-fitted so the hand keeps its proportions. */
function toCanvas(points: readonly Point[], aspect: number, w: number, h: number): Point[] {
  const scale = Math.max(w / aspect, h);
  return points.map((p) => ({ x: (p.x - 0.5) * aspect * scale + w / 2, y: (p.y - 0.5) * scale + h / 2 }));
}

/**
 * Glowing green edge around a black hand: the hand shape grown by the edge width is drawn green
 * (with one shared glow pass), then the exact shape is painted black on top.
 */
export function drawHandOutline(ctx: Canvas2D, scratch: Canvas2D, frame: HandFrame): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (frame.hands.length === 0) return;

  const hands = frame.hands.map((hand) => {
    const pts = toCanvas(hand.points, frame.aspect, w, h);
    const palmLength = Math.hypot(pts[9]!.x - pts[0]!.x, pts[9]!.y - pts[0]!.y);
    return { pts, palmLength, edge: Math.max(2, palmLength * 0.05) };
  });

  scratch.clearRect(0, 0, w, h);
  scratch.fillStyle = scratch.strokeStyle = GREEN;
  for (const hand of hands) traceHand(scratch, hand.pts, hand.palmLength, hand.edge);

  ctx.shadowColor = GREEN;
  ctx.shadowBlur = w * 0.025;
  ctx.drawImage(scratch.canvas, 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = ctx.strokeStyle = '#000';
  for (const hand of hands) traceHand(ctx, hand.pts, hand.palmLength, 0);
}
