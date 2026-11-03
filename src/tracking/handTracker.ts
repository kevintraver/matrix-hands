import { HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { reportDebug } from '../debug';
import { EMPTY_FRAME, type HandFrame, type HandSide, type TrackerState } from '../types';

const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
/** Weight of the newest sample in the landmark EMA. */
const SMOOTHING = 0.6;

export type HandTracker = {
  readonly video: HTMLVideoElement;
  getState(): TrackerState;
  subscribe(listener: () => void): () => void;
  /** The tracker is the only writer of this frame. */
  latest(): HandFrame;
  preload(): void;
  start(): void;
};

type Delegate = 'GPU' | 'CPU';

async function createLandmarker(): Promise<{ landmarker: HandLandmarker; delegate: Delegate }> {
  const fileset = { wasmLoaderPath, wasmBinaryPath };
  const make = (delegate: Delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  try {
    return { landmarker: await make('GPU'), delegate: 'GPU' };
  } catch {
    return { landmarker: await make('CPU'), delegate: 'CPU' };
  }
}

/** The MediaPipe boundary: raw results in, mirrored and smoothed domain frame out. */
export function parseResult(result: HandLandmarkerResult, prev: HandFrame, time: number, aspect: number): HandFrame {
  const hands = result.landmarks.map((raw, i) => {
    const side: HandSide = result.handedness[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
    const before = prev.hands[i]?.side === side ? prev.hands[i] : undefined;
    const points = raw.map((p, j) => {
      const x = 1 - p.x;
      const q = before?.points[j];
      return q ? { x: q.x + (x - q.x) * SMOOTHING, y: q.y + (p.y - q.y) * SMOOTHING } : { x, y: p.y };
    });
    return { side, points };
  });
  return { hands, time, aspect };
}

function describeCameraError(err: unknown): TrackerState {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'error', message: 'no camera found.' };
  return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
}

export function createHandTracker(detectHz: number): HandTracker {
  let state: TrackerState = { kind: 'idle' };
  let frame: HandFrame = EMPTY_FRAME;
  let loading: ReturnType<typeof createLandmarker> | null = null;
  let detections = 0;
  let framesWithHands = 0;
  const listeners = new Set<() => void>();

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
  document.body.appendChild(video);

  const setState = (next: TrackerState) => {
    state = next;
    reportDebug({ state: next.kind });
    listeners.forEach((l) => l());
  };

  const preload = () => {
    loading ??= createLandmarker();
    loading.catch(() => {
      loading = null;
    });
  };

  const runLoop = (landmarker: HandLandmarker) => {
    const minGap = 1000 / detectHz - 2;
    let lastVideoTime = -1;
    let lastDetect = -Infinity;
    const tick = (now: number) => {
      if (state.kind !== 'running') return;
      requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === lastVideoTime || now - lastDetect < minGap) return;
      lastVideoTime = video.currentTime;
      lastDetect = now;
      const result = landmarker.detectForVideo(video, now);
      frame = parseResult(result, frame, now, video.videoWidth / video.videoHeight || 4 / 3);
      detections += 1;
      if (frame.hands.length > 0) framesWithHands += 1;
      reportDebug({ hands: frame.hands.length, detections, framesWithHands });
    };
    requestAnimationFrame(tick);
  };

  const start = async () => {
    if (state.kind === 'starting' || state.kind === 'running') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: 'error', message: 'camera needs HTTPS or localhost.' });
      return;
    }
    setState({ kind: 'starting' });
    // Request the camera before any await so the call stays inside the user gesture (iOS).
    const camera = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    preload();
    let stream: MediaStream;
    try {
      stream = await camera;
    } catch (err) {
      setState(describeCameraError(err));
      return;
    }
    try {
      video.srcObject = stream;
      await video.play();
      const { landmarker, delegate } = await loading!;
      reportDebug({ delegate });
      setState({ kind: 'running' });
      runLoop(landmarker);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    video,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    latest: () => frame,
    preload,
    start: () => void start(),
  };
}
