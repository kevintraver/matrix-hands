import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import type { HandFrame } from '../types';
import { drawHandOutline } from './drawHandOutline';

/** Every screen has a 4:3 face, so the shared texture is 4:3 too. */
export const SCREEN_ASPECT = 4 / 3;

export type HandTexture = { readonly texture: CanvasTexture; update(frame: HandFrame): void };

function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d')!;
}

/** One canvas texture shared by every screen, redrawn at most once per tracker frame. */
export function createHandTexture(width: number): HandTexture {
  const height = Math.round(width / SCREEN_ASPECT);
  const ctx = context2d(width, height);
  const scratch = context2d(width, height);
  const texture = new CanvasTexture(ctx.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  ctx.fillRect(0, 0, width, height);

  let drawnTime = -1;
  let blank = true;
  return {
    texture,
    update(frame) {
      if (frame.time === drawnTime) return;
      drawnTime = frame.time;
      if (blank && frame.hands.length === 0) return;
      drawHandOutline(ctx, scratch, frame);
      blank = frame.hands.length === 0;
      texture.needsUpdate = true;
    },
  };
}
