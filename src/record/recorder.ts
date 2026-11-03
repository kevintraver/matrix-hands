export type Recording =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'recording';
      readonly recorder: MediaRecorder;
      readonly chunks: Blob[];
      readonly startedAt: number;
      readonly format: Format;
    }
  | { readonly kind: 'finalizing' }
  | {
      readonly kind: 'ready';
      readonly url: string;
      readonly blob: Blob;
      readonly file: string;
      readonly sizeBytes: number;
      readonly durationMs: number;
    };

type Format = { readonly mimeType: string; readonly ext: 'mp4' | 'webm' };

/** In order of preference: MP4 plays everywhere, WebM is the fallback for browsers that can't write it. No audio: the piece is silent. */
const FORMATS: readonly Format[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
  { mimeType: 'video/mp4', ext: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
];

const TIMESLICE_MS = 1000;
const VIDEO_BITS_PER_SECOND = 12_000_000;
const CAPTURE_FPS = 60;

/** The first format this browser can record, or null where recording is unsupported. */
export function recordingFormat(): Format | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mimeType)) ?? null;
}

export type Recorder = {
  current(): Recording;
  subscribe(listener: () => void): () => void;
  /** Records whatever the canvas draws: the WebGL scene with its bloom, nothing from the DOM. */
  start(canvas: HTMLCanvasElement): void;
  stop(): void;
  /** Drops a finished video and frees its memory. */
  discard(): void;
};

export function createRecorder(format: Format): Recorder {
  let recording: Recording = { kind: 'idle' };
  const listeners = new Set<() => void>();
  const set = (next: Recording) => {
    recording = next;
    listeners.forEach((l) => l());
  };
  return {
    current: () => recording,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(canvas) {
      if (recording.kind !== 'idle') return;
      const stream = canvas.captureStream(CAPTURE_FPS);
      const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.start(TIMESLICE_MS);
      set({ kind: 'recording', recorder, chunks, startedAt: Date.now(), format });
    },
    stop() {
      if (recording.kind !== 'recording') return;
      const { recorder, chunks, startedAt } = recording;
      const durationMs = Date.now() - startedAt;
      recorder.onstop = () => {
        for (const track of recorder.stream.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: format.mimeType });
        const url = URL.createObjectURL(blob);
        set({ kind: 'ready', url, blob, file: fileName(new Date(startedAt), format), sizeBytes: blob.size, durationMs });
      };
      recorder.stop();
      set({ kind: 'finalizing' });
    },
    discard() {
      if (recording.kind !== 'ready') return;
      URL.revokeObjectURL(recording.url);
      set({ kind: 'idle' });
    },
  };
}

function fileName(at: Date, format: Format): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `matrix-hands-${day}-${pad(at.getHours())}${pad(at.getMinutes())}.${format.ext}`;
}

/**
 * iOS Safari ignores or mangles download links for blobs, so there the share sheet ("Save Video") is the
 * way out. Returns the file to share, or null when the download link works. Synchronous, so a click
 * handler can still cancel the link and call `navigator.share` within the same tap.
 */
export function shareableFile(ready: Extract<Recording, { kind: 'ready' }>): File | null {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || typeof navigator.canShare !== 'function') return null;
  const file = new File([ready.blob], ready.file, { type: ready.blob.type });
  return navigator.canShare({ files: [file] }) ? file : null;
}
