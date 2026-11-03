import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

export type Delegate = 'GPU' | 'CPU';

/** The fields of a MediaPipe result the page reads. They survive `postMessage` as plain data. */
export type RawHands = Pick<HandLandmarkerResult, 'landmarks' | 'handedness'>;

/** Absolute URLs: the worker runs from a blob: URL, so relative paths would not resolve. */
export type LoadRequest = { type: 'load'; wasmLoaderPath: string; wasmBinaryPath: string; modelAssetPath: string };

export type TrackerRequest = LoadRequest | { type: 'detect'; frame: ImageBitmap; time: number };

export type TrackerReply =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'failed'; message: string }
  | { type: 'hands'; hands: RawHands; time: number };
