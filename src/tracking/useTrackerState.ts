import { useSyncExternalStore } from 'react';
import type { TrackerState } from '../types';
import type { HandTracker } from './handTracker';

export function useTrackerState(tracker: HandTracker): TrackerState {
  return useSyncExternalStore(tracker.subscribe, tracker.getState);
}
