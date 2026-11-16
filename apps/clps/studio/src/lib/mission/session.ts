import { getContext, setContext } from 'svelte';
import { clock, type MissionClock } from './clock.svelte';
import { estimates, type EstimateState } from './estimates.svelte';
import { actions, mission, type CoreActions, type MissionState } from './store.svelte';

/** Everything the shared sky, key-number and time-strip panels read and edit. */
export interface MissionSession {
  mission: MissionState;
  actions: CoreActions;
  estimates: EstimateState;
  clock: MissionClock;
}

const KEY = Symbol('mission-session');

const planSession: MissionSession = { mission, actions, estimates, clock };

/** Give the panels below a mission of their own instead of the plan. */
export function provideSession(session: MissionSession): void {
  setContext(KEY, session);
}

/** The mission this panel shows: the one provided above it, else the plan. */
export function useSession(): MissionSession {
  return getContext<MissionSession | undefined>(KEY) ?? planSession;
}
