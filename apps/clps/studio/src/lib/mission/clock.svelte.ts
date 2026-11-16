import { actions, mission, sampleCount, type CoreActions, type MissionState } from './store.svelte';

export const SPEED_OPTIONS = [
  { hoursPerSecond: 1, label: '1 h / s' },
  { hoursPerSecond: 6, label: '6 h / s' },
  { hoursPerSecond: 24, label: '1 d / s' },
] as const;

const DEFAULT_SPEED = 6;
const MAX_FRAME_SECONDS = 0.25;

/** Play, pause and speed for one mission's clock. */
export function createClock(target: MissionState, edit: Pick<CoreActions, 'setClock' | 'setPlaying'>) {
  let speed = $state(DEFAULT_SPEED);

  function lastIndex(): number {
    return sampleCount(target.days) - 1;
  }

  function play(): void {
    if (target.clockIndex >= lastIndex()) edit.setClock(0);
    edit.setPlaying(true);
  }

  function pause(): void {
    edit.setPlaying(false);
  }

  let frame = 0;
  let previousTime: number | null = null;

  function tick(time: number): void {
    const elapsedSeconds = previousTime === null ? 0 : Math.min(MAX_FRAME_SECONDS, (time - previousTime) / 1000);
    previousTime = time;
    const next = target.clockIndex + elapsedSeconds * speed;
    if (next >= lastIndex()) {
      edit.setClock(lastIndex());
      pause();
      return;
    }
    edit.setClock(next);
    frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    cancelAnimationFrame(frame);
    previousTime = null;
  }

  $effect.root(() => {
    $effect(() => {
      if (!target.playing) return;
      previousTime = null;
      frame = requestAnimationFrame(tick);
      return stop;
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && target.playing) pause();
  });

  return {
    get speedHoursPerSecond(): number {
      return speed;
    },
    setSpeed(hoursPerSecond: number): void {
      if (Number.isFinite(hoursPerSecond) && hoursPerSecond > 0) speed = hoursPerSecond;
    },
    play,
    pause,
    toggle(): void {
      if (target.playing) pause();
      else play();
    },
  };
}

export type MissionClock = ReturnType<typeof createClock>;

/** The plan's clock. */
export const clock: MissionClock = createClock(mission, actions);
