<script lang="ts">
  import { ApiError } from '../../lib/api/base';
  import { actions } from '../../lib/mission/store.svelte';
  import { copyShareLink, downloadCsv, downloadJson, downloadPdfReport, type ReportParts } from './files.svelte';
  import MethodsDialog from './MethodsDialog.svelte';

  let button: HTMLButtonElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();
  let methods: MethodsDialog | undefined = $state();
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  // The menu sits in the top layer, so the table's scroll area cannot clip it.
  function place(): void {
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    menu.style.inset = 'auto';
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
    menu.style.margin = '0';
  }

  function close(): void {
    menu?.hidePopover();
  }

  async function copyLink(): Promise<void> {
    const done = await copyShareLink();
    copied = done ? 'done' : 'failed';
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = 'idle'), 2000);
  }

  let reporting = $state(false);

  async function report(include: ReportParts = 'all'): Promise<void> {
    if (reporting) return;
    reporting = true;
    actions.notify('Preparing the PDF report…');
    try {
      await downloadPdfReport(include);
      actions.notify('PDF report downloaded.');
      close();
    } catch (cause) {
      actions.notify(cause instanceof ApiError ? `Report failed: ${cause.message}` : 'Report failed. Try again in a moment.');
    } finally {
      reporting = false;
    }
  }

  function run(action: () => void): void {
    action();
    close();
  }

  const item = 'block w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-rule';
</script>

<button
  bind:this={button}
  type="button"
  popovertarget="export-menu"
  aria-haspopup="menu"
  data-tour="export"
  class="whitespace-nowrap rounded-sm border border-sun bg-panel px-4 py-1 text-[17px] font-semibold text-sun hover:bg-rule"
>Export Mission Plan ↓</button>
<span class="sr-only" role="status">{copied === 'done' ? 'Share link copied' : copied === 'failed' ? 'Copy failed' : ''}</span>

<div
  bind:this={menu}
  id="export-menu"
  popover="auto"
  role="menu"
  aria-label="Export"
  onbeforetoggle={(event) => {
    if (event.newState === 'open') place();
  }}
  class="w-64 border border-rule bg-panel p-0 text-ink"
>
  <button type="button" role="menuitem" class="{item} font-semibold text-sun disabled:opacity-60" disabled={reporting} onclick={() => void report('all')}>
    {reporting ? 'Preparing report…' : 'Full report (PDF): sites and outpost'}
  </button>
  <button type="button" role="menuitem" class="{item} disabled:opacity-60" disabled={reporting} onclick={() => void report('sites')}>Landing site plan only (PDF)</button>
  <button type="button" role="menuitem" class="{item} border-b border-rule disabled:opacity-60" disabled={reporting} onclick={() => void report('outpost')}>Outpost stay plan only (PDF)</button>
  <button type="button" role="menuitem" class={item} onclick={() => void copyLink()}>
    {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy share link'}
  </button>
  <button type="button" role="menuitem" class={item} onclick={() => run(downloadCsv)}>Download CSV</button>
  <button type="button" role="menuitem" class={item} onclick={() => run(downloadJson)}>Download JSON</button>
  <button
    type="button"
    role="menuitem"
    class="{item} border-t border-rule"
    onclick={() => run(() => methods?.show())}
  >Data and methods</button>
</div>

<MethodsDialog bind:this={methods} />
