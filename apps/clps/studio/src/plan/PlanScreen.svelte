<script lang="ts">
  import { formatUtc } from '../lib/format';
  import { clockTimeMs } from '../lib/mission/derive';
  import { siteLabel } from '../lib/mission/labels';
  import { mission } from '../lib/mission/store.svelte';
  import { tour } from '../tour/tour.svelte';
  import YearPicker from './calendar/YearPicker.svelte';
  import YearStrip from './calendar/YearStrip.svelte';
  import YourChoice from './YourChoice.svelte';
  import OutpostSize from './OutpostSize.svelte';
  import Section from './Section.svelte';
  import { setup } from './setup/flow.svelte';
  import PlanSummary from './setup/PlanSummary.svelte';
  import SetupFlow from './setup/SetupFlow.svelte';
  import KeyNumbers from './sky/KeyNumbers.svelte';
  import Sky from './sky/Sky.svelte';
  import Recommendation from './table/Recommendation.svelte';
  import SitesTable from './table/SitesTable.svelte';
  import StayClockBar from './timeline/StayClockBar.svelte';

  const selected = $derived(mission.sites.find((site) => site.id === mission.selectedSiteId) ?? null);
  const clockText = $derived(formatUtc(clockTimeMs(mission.startUtc, mission.clockIndex)));

  // The stay clock bar repeats the selected site's numbers only while its section is off screen.
  let siteSection: HTMLElement | undefined = $state();
  let siteInView = $state(false);

  $effect(() => {
    const target = siteSection;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => (siteInView = entry?.isIntersecting ?? false), { threshold: 0.35 });
    observer.observe(target);
    return () => observer.disconnect();
  });

  function showSite(): void {
    siteSection?.scrollIntoView({ behavior: smoothness(), block: 'end' });
  }

  function smoothness(): ScrollBehavior {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  // Pressing Play brings the two sections the clock drives on screen together: the selected site's section at the
  // bottom of the window and the site rows above it. They are outlined while playing and the rest fades back.
  let wasPlaying = false;
  $effect(() => {
    const playing = mission.playing;
    if (playing && !wasPlaying) showSite();
    wasPlaying = playing;
  });

  const playFocus = $derived(mission.playing ? 'active' : 'none');
  const restFocus = $derived(mission.playing ? 'dimmed' : 'none');
</script>

{#if setup.open && !tour.active}
  <SetupFlow />
{:else}
  <!-- The plan reads top to bottom as one page: what was set, then the date, the sites, and the selected site.
       Each section has its own colour and number; the page scrolls rather than any panel hiding rows. -->
  <div class="plan-type flex h-full flex-col bg-ground">
  <div class="plan-scroll min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4">
      <div class="transition-opacity duration-300 motion-reduce:transition-none {mission.playing ? 'opacity-40' : ''}"><PlanSummary /></div>

      <Section
        focus={restFocus}
        number={1}
        tone="date"
        title="Pick a landing date"
        hint="Each column is one day for the selected site: orange when the Sun is up, blue when Earth is in view. Click a day or drag the white box to move the landing."
      >
        {#snippet tools()}<YearPicker />{/snippet}
        <YearStrip />
        <Recommendation part="date" />
      </Section>

      <Section focus={playFocus} number={2} tone="sites" title="Pick a site" hint="Compare the sites, then click a row to choose one. Click a column name to sort. The white line is the stay clock.">
        <SitesTable strips />
      </Section>

      <Section
        bind:element={siteSection}
        focus={playFocus}
        number={3}
        tone="site"
        title="Check your site{selected ? `: ${siteLabel(selected).short}` : ''}"
        hint="Sun, Earth and battery at {clockText}. Play and move the time with the stay clock at the bottom."
      >
        <div class="grid h-[400px] min-w-0 gap-px bg-rule" style="grid-template-columns: minmax(320px, 30%) minmax(0, 1fr);">
          <KeyNumbers />
          <Sky sideBySide />
        </div>
      </Section>

      <Section
        focus={restFocus}
        number={4}
        tone="outpost"
        title="Size the outpost"
        hint="What a crew needs to stay here for the whole stay: the solar array and battery to bring, and what to watch."
      >
        <OutpostSize />
      </Section>

      <Section focus={restFocus} number={5} tone="choice" title="Your choice" hint="The site and dates Expedition and the mission plan use.">
        <YourChoice />
      </Section>
    </div>
  </div>
  <StayClockBar {siteInView} onshowsite={showSite} />
  </div>
{/if}
