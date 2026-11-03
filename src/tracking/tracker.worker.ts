/**
 * Runs MediaPipe off the page's thread. The first detection on the GPU delegate compiles dozens of
 * shaders, which blocks for several seconds on a phone; here that blocks only this worker.
 */
import { HandLandmarker } from '@mediapipe/tasks-vision';
import type { Delegate, LoadRequest, TrackerReply, TrackerRequest } from './trackerProtocol';

const post = (reply: TrackerReply) => self.postMessage(reply);

let landmarker: HandLandmarker | null = null;
/** VIDEO mode needs strictly increasing timestamps, and the warm-up runs before any page frame. */
let lastTime = 0;
const nextTime = (time: number) => (lastTime = Math.max(time, lastTime + 1));

/** One detection on a blank frame, so its shader compile happens now rather than on the first camera frame. */
function warmUp(candidate: HandLandmarker): void {
  const canvas = new OffscreenCanvas(640, 480);
  canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
  const frame = canvas.transferToImageBitmap();
  try {
    candidate.detectForVideo(frame, nextTime(0));
  } finally {
    frame.close();
  }
}

async function create(request: LoadRequest, delegate: Delegate): Promise<HandLandmarker> {
  const candidate = await HandLandmarker.createFromOptions(
    { wasmLoaderPath: request.wasmLoaderPath, wasmBinaryPath: request.wasmBinaryPath },
    { baseOptions: { modelAssetPath: request.modelAssetPath, delegate }, runningMode: 'VIDEO', numHands: 2 },
  );
  try {
    warmUp(candidate);
  } catch (err) {
    candidate.close();
    throw err;
  }
  return candidate;
}

async function load(request: LoadRequest): Promise<void> {
  try {
    landmarker = await create(request, 'GPU');
    post({ type: 'ready', delegate: 'GPU' });
  } catch {
    try {
      landmarker = await create(request, 'CPU');
      post({ type: 'ready', delegate: 'CPU' });
    } catch (err) {
      post({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

self.onmessage = (event: MessageEvent<TrackerRequest>) => {
  const request = event.data;
  if (request.type === 'load') {
    void load(request);
    return;
  }
  const { frame, time } = request;
  try {
    const result = landmarker!.detectForVideo(frame, nextTime(time));
    post({ type: 'hands', hands: { landmarks: result.landmarks, handedness: result.handedness }, time });
  } finally {
    frame.close();
  }
};
