<script lang="ts">
  import SiteMap from './map/Map.svelte';
  import SitesTable from './table/SitesTable.svelte';
  import Sky from './sky/Sky.svelte';
  import KeyNumbers from './sky/KeyNumbers.svelte';
  import TimeStrip from './timeline/TimeStrip.svelte';
  import YearStrip from './calendar/YearStrip.svelte';

  const sectionBar = 'm-0 flex items-center justify-center bg-ink text-xs font-semibold leading-none text-ground';
</script>

<!-- Supported from 1280 x 720 up. Smaller windows let each panel scroll on its own. -->
<div
  class="grid h-full gap-px bg-rule"
  style="grid-template-columns: minmax(300px, 24%) minmax(0, 1fr) minmax(320px, 27%); grid-template-rows: 22px auto 22px minmax(0, 290fr) minmax(0, 205fr) 22px minmax(0, 302fr);"
>
  <!-- Order follows the decision: landing date first, then the sites it applies to, then the strips over time.
       A titled bar opens each section. -->
  <h2 class="{sectionBar} [grid-area:1/1/2/4]">Choose Landing Date</h2>
  <YearStrip class="[grid-area:2/1/3/4]" />
  <h2 class="{sectionBar} [grid-area:3/1/4/4]">Compare Landing Sites</h2>
  <SiteMap class="[grid-area:4/1/6/2]" />
  <SitesTable class="[grid-area:4/2/5/4]" />
  <Sky class="[grid-area:5/2/6/3]" />
  <KeyNumbers class="[grid-area:5/3/6/4]" />
  <h2 class="{sectionBar} [grid-area:6/1/7/4]">Review Sun/Earth Visibility and Battery</h2>
  <TimeStrip class="[grid-area:7/1/8/4]" />
</div>
