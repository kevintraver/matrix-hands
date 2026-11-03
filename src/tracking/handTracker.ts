import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import { reportDebug } from '../debug';
import { EMPTY_FRAME, type HandFrame, type HandSide, type TrackerState } from '../types';
import TrackerWorker from './tracker.worker?worker&inline';
import type { Delegate, RawHands, TrackerReply, TrackerRequest } from './trackerProtocol';

const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
/** Weight of the newest sample in the landmark EMA. */
const SMOOTHING = 0.6;

export type HandTracker = {
  readonly video: HTMLVideoElement;
  getState(): TrackerState;
  subscribe(listener: () => void): () => void;
  /** The tracker is the only writer of this frame. */
  latest(): HandFrame;
  /** Loads MediaPipe and compiles its shaders in the worker. Safe to call more than once. */
  preload(): void;
  /** True while `preload` is compiling. Drawing then stalls on the busy GPU, so the scene pauses. */
  isLoading(): boolean;
  start(): void;
};

type Loaded = { worker: Worker; delegate: Delegate };

/**
 * The worker is built inline and started from a blob: URL, so it inherits the page's
 * Content-Security-Policy, which keeps MediaPipe's usage logger from reaching Google.
 */
function loadWorker(): Promise<Loaded> {
  const worker = new TrackerWorker();
  const absolute = (path: string) => new URL(path, document.baseURI).href;
  const request: TrackerRequest = {
    type: 'load',
    wasmLoaderPath: absolute(wasmLoaderPath),
    wasmBinaryPath: absolute(wasmBinaryPath),
    modelAssetPath: absolute(MODEL_URL),
  };
  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      worker.terminate();
      reject(new Error(message));
    };
    worker.onerror = (event) => fail(event.message || 'hand tracker failed to start.');
    worker.onmessage = (event: MessageEvent<TrackerReply>) => {
      const reply = event.data;
      if (reply.type === 'ready') resolve({ worker, delegate: reply.delegate });
      else if (reply.type === 'failed') fail(reply.message);
    };
    worker.postMessage(request);
  });
}

/** The MediaPipe boundary: raw results in, mirrored and smoothed domain frame out. */
export function parseResult(result: RawHands, prev: HandFrame, time: number, aspect: number): HandFrame {
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
  let loading: Promise<Loaded> | null = null;
  let busy = false;
  let detections = 0;
  let framesWithHands = 0;
  const listeners = new Set<() => void>();

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
  document.body.appendChild(video);

  const notify = () => listeners.forEach((l) => l());
  const setState = (next: TrackerState) => {
    state = next;
    reportDebug({ state: next.kind });
    notify();
  };

  const preload = () => {
    if (loading) return;
    const current = loadWorker();
    loading = current;
    busy = true;
    notify();
    current.then(
      () => {
        busy = false;
        notify();
      },
      () => {
        loading = null;
        busy = false;
        notify();
      },
    );
  };

  /** Sends one camera frame at a time; the next waits until the worker answers, so frames never queue up. */
  const runLoop = (worker: Worker) => {
    const minGap = 1000 / detectHz - 2;
    let lastVideoTime = -1;
    let lastDetect = -Infinity;
    let inFlight = false;
    worker.onmessage = (event: MessageEvent<TrackerReply>) => {
      const reply = event.data;
      if (reply.type !== 'hands') return;
      inFlight = false;
      frame = parseResult(reply.hands, frame, reply.time, video.videoWidth / video.videoHeight || 4 / 3);
      detections += 1;
      if (frame.hands.length > 0) framesWithHands += 1;
      reportDebug({ hands: frame.hands.length, detections, framesWithHands });
    };
    worker.onerror = (event) => setState({ kind: 'error', message: event.message || 'hand tracking stopped.' });
    const tick = (now: number) => {
      if (state.kind !== 'running') return;
      requestAnimationFrame(tick);
      if (inFlight || video.readyState < 2 || video.currentTime === lastVideoTime || now - lastDetect < minGap) return;
      inFlight = true;
      lastVideoTime = video.currentTime;
      lastDetect = now;
      createImageBitmap(video).then(
        (bitmap) => {
          const request: TrackerRequest = { type: 'detect', frame: bitmap, time: now };
          worker.postMessage(request, [bitmap]);
        },
        () => {
          inFlight = false;
        },
      );
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
      const { worker, delegate } = await loading!;
      reportDebug({ delegate });
      setState({ kind: 'running' });
      runLoop(worker);
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
    isLoading: () => busy,
    start: () => void start(),
  };
}
