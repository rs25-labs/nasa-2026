<script lang="ts">
  import { CHARGE_EFFICIENCY, DISCHARGE_EFFICIENCY, MAX_CHARGE_KW, MAX_DISCHARGE_KW, okResult } from '../../lib/mission/derive';
  import { estimates } from '../../lib/mission/estimates.svelte';

  let dialog: HTMLDialogElement | undefined = $state();

  export function show(): void {
    dialog?.showModal();
  }

  const identifiers = $derived.by(() => {
    const models = new Set<string>();
    const terrains = new Set<string>();
    for (const result of Object.values(estimates.bySiteId)) {
      const ok = okResult(result);
      if (!ok) continue;
      models.add(ok.model);
      terrains.add(ok.terrain);
    }
    return { models: [...models], terrains: [...terrains] };
  });

  const percent = (value: number): string => `${Math.round(value * 100)}%`;
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="methods-title"
  class="m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-auto border border-rule bg-panel p-0 text-left text-ink backdrop:bg-black/70"
  onclick={(event) => {
    if (event.target === dialog) dialog?.close();
  }}
>
  <div class="flex items-center justify-between border-b border-rule px-4 py-2">
    <h2 id="methods-title" class="text-sm font-semibold">Data and methods</h2>
    <button
      type="button"
      onclick={() => dialog?.close()}
      class="rounded-sm border border-rule bg-ground px-2.5 py-1 text-xs hover:border-muted"
    >Close</button>
  </div>
  <div class="flex flex-col gap-3 px-4 py-3 text-xs leading-[18px]">
    <section>
      <h3 class="font-semibold">Estimates</h3>
      <p class="m-0 text-muted">
        Every number is an estimate, not a certified bound. For each site and each hour of the stay, the Sun and Earth
        discs are tested against a terrain horizon sampled every 2° of azimuth out to 150 km. The visible fraction is
        the share of the disc above that horizon.
      </p>
    </section>
    <section>
      <h3 class="font-semibold">Horizon, Sun and Earth</h3>
      <p class="m-0 text-muted">
        The Moon has no atmosphere, so there is no refraction: the skyline is the terrain plus the curve of the Moon as
        seen from the mast, and a body is up only when its disc clears that skyline. Sun and Earth directions come from
        JPL's DE421 ephemeris and the Moon's orientation model through NAIF SPICE, corrected for light time and
        aberration. That includes the Moon's libration, which makes Earth wobble around one patch of sky, and the
        changing shape of the Moon's orbit across the year.
      </p>
    </section>
    <section>
      <h3 class="font-semibold">Terrain</h3>
      <p class="m-0 text-muted">
        Sites south of 85°S use LOLA polar terrain: 10 m within about 6 km of the site and 40 m beyond, out to 150 km.
        With a low mast (about 2 m) the skyline depends on metre-scale relief within tens of metres of the site, which
        is at the limit of what 10 m data resolves. Rise and set times at a 2 m mast can be uncertain by hours
        (skyline uncertainty about ±0.5°). At 5 m and above the result is much less sensitive. The 3D Surface view
        uses the same terrain. Other sites use coarse global terrain, so their horizons are much less detailed.
      </p>
    </section>
    <section>
      <h3 class="font-semibold">Rise and set</h3>
      <p class="m-0 text-muted">Rise and set times are found by bisection to about a minute.</p>
    </section>
    <section>
      <h3 class="font-semibold">Earth in view</h3>
      <p class="m-0 text-muted">Earth in view is geometry. It is not a radio link.</p>
    </section>
    <section>
      <h3 class="font-semibold">Battery line</h3>
      <p class="m-0 text-muted">
        Each hour, solar power is the array size times the Sun's visible fraction, minus the load. The battery starts
        full. It charges at up to {MAX_CHARGE_KW} kW with {percent(CHARGE_EFFICIENCY)} efficiency and discharges at up
        to {MAX_DISCHARGE_KW} kW with {percent(DISCHARGE_EFFICIENCY)} efficiency. An hour counts as flat when the
        battery is at zero and the load goes unmet.
      </p>
    </section>
    <section>
      <h3 class="font-semibold">Map sunlight</h3>
      <p class="m-0 text-muted">
        The sunlight shading on the map is a map-scale visual aid. It can differ from the per-site estimate within a
        few hundred metres of a shadow edge.
      </p>
    </section>
    <p class="m-0 border-t border-rule pt-2 text-[11px] leading-4 text-muted">
      <span class="font-semibold">Model identifiers</span>
      Model: {identifiers.models.length ? identifiers.models.join(', ') : 'not loaded'}.
      Terrain: {identifiers.terrains.length ? identifiers.terrains.join(', ') : 'not loaded'}.
    </p>
  </div>
</dialog>
