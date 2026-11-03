import { useEffect, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react';
import { shareableFile, type Recorder, type Recording } from '../record/recorder';

const LABEL: Record<Recording['kind'], string> = { idle: 'Record', recording: 'Stop', finalizing: 'Finishing…', ready: 'Record' };

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** The Record button, the `r` shortcut, and the popover that previews a finished video. */
export function RecordControls({ recorder, canvas }: { recorder: Recorder; canvas: RefObject<HTMLCanvasElement | null> }) {
  const recording = useSyncExternalStore(recorder.subscribe, recorder.current);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (recording.kind === 'ready') setPopoverOpen(true);
    if (recording.kind !== 'recording') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const toggle = () => {
    const current = recorder.current();
    switch (current.kind) {
      case 'recording':
        return recorder.stop();
      case 'finalizing':
        return;
      case 'ready':
        if (!confirm('Start a new recording? The last video is discarded unless you saved it.')) return setPopoverOpen(true);
        recorder.discard();
    }
    if (canvas.current) recorder.start(canvas.current);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'r' && !typing && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = (e: MouseEvent<HTMLAnchorElement>) => {
    if (recording.kind !== 'ready') return;
    const file = shareableFile(recording);
    if (!file) return;
    e.preventDefault();
    navigator.share({ files: [file] }).catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        className="record"
        aria-pressed={recording.kind === 'recording'}
        disabled={recording.kind === 'finalizing'}
        onClick={toggle}
      >
        <span className="record-dot" aria-hidden="true" />
        <span>{LABEL[recording.kind]}</span>
        {recording.kind === 'recording' && <span className="record-time">{clock(Math.max(0, now - recording.startedAt))}</span>}
      </button>
      {recording.kind === 'ready' && popoverOpen && (
        <section className="popover video" role="dialog" aria-label="Your video">
          <div className="popover-head">
            <h2>Video ready</h2>
            <span className="video-meta">
              {clock(recording.durationMs)} · {(recording.sizeBytes / 1e6).toFixed(1)} MB
            </span>
            <button type="button" className="close" aria-label="Close" onClick={() => setPopoverOpen(false)}>
              ×
            </button>
          </div>
          <video src={recording.url} controls muted playsInline loop />
          <div className="video-actions">
            <button type="button" onClick={() => recorder.discard()}>
              Discard
            </button>
            <a className="save" href={recording.url} download={recording.file} title={recording.file} onClick={save}>
              Save
            </a>
          </div>
        </section>
      )}
    </>
  );
}
