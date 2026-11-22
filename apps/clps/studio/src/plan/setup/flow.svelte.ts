import { loadedFrom } from '../../lib/mission/store.svelte';

export const SETUP_STEPS = ['Sites', 'Date and stay', 'Power'] as const;

const SEEN_KEY = 'lml-plan-setup-seen';

function seenBefore(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * The guided setup that opens before the Plan workbench.
 * A first visit starts in the guided setup; a saved plan or a shared link goes straight to the workbench.
 */
export const setup = $state({
  open: loadedFrom === 'none' && !seenBefore(),
  step: 0,
});

export function openSetup(step = 0): void {
  setup.step = step;
  setup.open = true;
}

export function closeSetup(): void {
  setup.open = false;
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Without storage the setup simply opens again on the next first visit.
  }
}
