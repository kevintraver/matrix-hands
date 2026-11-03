import type { TrackerState } from '../types';

type Props = { state: TrackerState; onEnter: () => void };

const COPY: Record<TrackerState['kind'], { line: string; button: string | null }> = {
  idle: { line: 'Your hands, on every screen. Camera stays on this device.', button: 'ENTER' },
  starting: { line: 'Waking up the machines', button: null },
  running: { line: '', button: null },
  denied: { line: 'Camera access was blocked. Allow it in your browser settings, then try again.', button: 'RETRY' },
  error: { line: '', button: 'RETRY' },
};

export function StartOverlay({ state, onEnter }: Props) {
  if (state.kind === 'running') return null;
  const copy = COPY[state.kind];
  const line = state.kind === 'error' ? `Something broke: ${state.message}` : copy.line;
  return (
    <div className="overlay">
      <div>
        <p className={copy.button ? undefined : 'cursor'}>{line}</p>
        {copy.button && (
          <button type="button" onClick={onEnter} autoFocus>
            {copy.button}
          </button>
        )}
      </div>
    </div>
  );
}
