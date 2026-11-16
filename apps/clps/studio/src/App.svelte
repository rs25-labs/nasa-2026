<script lang="ts">
  import TopBar from './TopBar.svelte';
  import Landing from './home/Landing.svelte';
  import PlanScreen from './plan/PlanScreen.svelte';
  import SurfaceScreen from './surface/SurfaceScreen.svelte';
  import LandingsScreen from './landings/LandingsScreen.svelte';
  import CompareScreen from './plan/CompareScreen.svelte';
  import { route } from './lib/router.svelte';
  import TourBar from './tour/TourBar.svelte';
  import TourLayer from './tour/TourLayer.svelte';
  import { recoverInterruptedTour, tour } from './tour/tour.svelte';

  recoverInterruptedTour();
</script>

<div class="flex h-dvh flex-col">
  <TopBar mode={route.mode} />
  <main class="min-h-0 flex-1">
    {#if route.mode === 'home'}
      <Landing />
    {:else if route.mode === 'surface'}
      <SurfaceScreen />
    {:else if route.mode === 'landings'}
      <LandingsScreen />
    {:else if route.mode === 'compare'}
      <CompareScreen />
    {:else}
      <PlanScreen />
    {/if}
  </main>
  {#if tour.active}
    <TourBar />
  {/if}
</div>
{#if tour.active}
  <TourLayer />
{/if}
