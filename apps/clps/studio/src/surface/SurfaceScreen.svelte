<script lang="ts">
  import { untrack } from 'svelte';
  import { isOnPolarMap } from '../lib/geo/polar';
  import { okResult, sampleAt } from '../lib/mission/derive';
  import { drive } from '../lib/mission/drive.svelte';
  import { estimates } from '../lib/mission/estimates.svelte';
  import { actions, mission } from '../lib/mission/store.svelte';
  import { SurfaceEngine, type CameraMode } from './core/engine';
  import { parseHashView } from './core/reviewHooks';
  import { DriveController } from './drive/driveController.svelte';
  import DriveControls from './hud/DriveControls.svelte';
  import Hud from './hud/Hud.svelte';
  import RouteMap from './hud/RouteMap.svelte';
  import StayHud from './hud/StayHud.svelte';
  import { BaseExtension } from './base/base';
  import Menu from './hud/Menu.svelte';

  let canvas: HTMLCanvasElement | undefined = $state();
  let engine: SurfaceEngine | undefined = $state();
  let controller: DriveController | undefined = $state();
  let ready = $state(false);
  let failure: string | null = $state(null);
  let mode: CameraMode = $state('walk');
  /** The review hash places a free camera itself (cam= or orbit=): no rover, no drive controls. */
  let legacy = $state(false);
  /** The outpost in a review view with a free camera (`base=1`). */
  let legacyBase: BaseExtension | undefined;

  const site = $derived(mission.sites.find((s) => s.id === mission.selectedSiteId) ?? null);
  const supported = $derived(site !== null && isOnPolarMap(site.latitudeDeg));
  const siteKey = $derived(site ? `${site.id}|${site.latitudeDeg}|${site.longitudeDeg}` : '');
  let sunBearingDeg: number | null = $state(null);

  function applyHash(target: SurfaceEngine, driveController: DriveController | undefined): void {
    const view = parseHashView(window.location.hash);
    if (driveController) {
      void driveController.applyView(view);
      return;
    }
    if (view.clock !== null) actions.setClock(view.clock);
    target.applyView(view);
    mode = target.cameraMode;
  }

  $effect(() => {
    if (!canvas || !supported) return;
    let created: SurfaceEngine;
    try {
      created = new SurfaceEngine(canvas, (state) => {
        ready = state.ready;
        failure = state.error;
      });
    } catch {
      failure = 'WebGL is not available in this browser.';
      return;
    }
    engine = created;
    return () => {
      created.dispose();
      engine = undefined;
      controller = undefined;
      ready = false;
    };
  });

  $effect(() => {
    if (!engine || !siteKey) return;
    const target = engine;
    let owned: DriveController | undefined;
    untrack(() => {
      if (!site) return;
      target.setSite(site.latitudeDeg, site.longitudeDeg);
      const view = parseHashView(window.location.hash);
      legacy = view.cam !== null || view.orbit !== null;
      if (legacy) {
        if (view.base === true) {
          legacyBase = new BaseExtension();
          target.addExtension(legacyBase);
        }
        applyHash(target, undefined);
        return;
      }
      const created = new DriveController(target, { latitudeDeg: site.latitudeDeg, longitudeDeg: site.longitudeDeg });
      owned = created;
      controller = created;
      applyHash(target, created);
    });
    const onHash = (): void => untrack(() => applyHash(target, controller));
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      if (legacyBase) target.removeExtension(legacyBase);
      legacyBase = undefined;
      owned?.dispose();
      controller = undefined;
    };
  });

  $effect(() => {
    controller?.sync();
  });

  $effect(() => {
    engine?.setEyeHeight(mission.mastHeightM);
  });

  $effect(() => {
    if (!engine || !site) return;
    const result = okResult(estimates.bySiteId[site.id]);
    if (!result) {
      engine.setSky(null);
      return;
    }
    // Drives and the outpost time-lapse each run on their own clock; only the plain viewer follows the plan's.
    const clockIndex = controller ? (drive.stay ? drive.stayClockIndex : drive.clockIndex) : mission.clockIndex;
    const sun = sampleAt(result.series.sun, clockIndex);
    const earth = sampleAt(result.series.earth, clockIndex);
    engine.setSky({
      sunAzimuthDeg: sun.azimuthDeg,
      sunElevationDeg: sun.elevationDeg,
      sunAngularRadiusDeg: sun.angularRadiusDeg,
      earthAzimuthDeg: earth.azimuthDeg,
      earthElevationDeg: earth.elevationDeg,
      earthAngularRadiusDeg: earth.angularRadiusDeg,
      clockIndex,
    });
    sunBearingDeg = sun.azimuthDeg + site.longitudeDeg;
    controller?.setSunFraction(sun.fraction);
    legacyBase?.setSunFraction(sun.fraction);
  });

  $effect(() => {
    if (controller && sunBearingDeg !== null) {
      const bearing = sunBearingDeg;
      untrack(() => {
        if (controller) controller.sunBearingDeg = bearing;
        controller?.park(bearing);
      });
    }
  });

  /** True once the ground under the focus (the rover, the base or the free camera) has been missing its height data for over a second. */
  let groundMissing = $state(false);

  $effect(() => {
    if (!engine) return;
    const target = engine;
    let missingSince: number | null = null;
    const timer = window.setInterval(() => {
      let x = 0;
      let z = 0;
      if (controller && !legacy) {
        if (drive.stay) {
          x = controller.cameras.baseCentre.x;
          z = controller.cameras.baseCentre.z;
        } else {
          x = controller.sim.x;
          z = controller.sim.z;
        }
      } else {
        const position = window.__surfaceCamera?.position();
        if (position) {
          x = position[0];
          z = position[2];
        }
      }
      if (Number.isFinite(target.heightAt(x, z))) missingSince = null;
      else missingSince ??= performance.now();
      groundMissing = missingSince !== null && performance.now() - missingSince > 1000;
    }, 250);
    return () => {
      window.clearInterval(timer);
      groundMissing = false;
    };
  });

  function toggleMode(): void {
    if (!engine) return;
    engine.setMode(mode === 'walk' ? 'orbit' : 'walk');
    mode = engine.cameraMode;
  }

  function backToPlan(): void {
    drive.menuOpen = false;
    window.location.hash = '#/plan';
  }

  let pressAt = { x: 0, y: 0 };

  function onPointerDown(event: PointerEvent): void {
    pressAt = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: MouseEvent): void {
    if (!controller || !drive.planning) return;
    if (Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 5) return;
    controller.pickTarget(event.clientX, event.clientY);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!controller || legacy) return;
    const target = event.target;
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (drive.settingsOpen) drive.settingsOpen = false;
      else drive.menuOpen = !drive.menuOpen;
      return;
    }
    const camera = ({ '1': 'chase', '2': 'driver', '3': 'mast', '4': 'orbit' } as const)[event.key as '1'];
    if (camera) {
      if (drive.stay) drive.commands?.exitStay();
      drive.planning = false;
      drive.camera = camera;
    } else if (event.key.toLowerCase() === 'h') {
      drive.hudVisible = !drive.hudVisible;
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  $effect(() => {
    if (!canvas) return;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas?.removeEventListener('pointerdown', onPointerDown);
      canvas?.removeEventListener('click', onClick);
    };
  });
</script>

{#snippet routeMap(size: number)}
  {#if site}<RouteMap originLatitudeDeg={site.latitudeDeg} originLongitudeDeg={site.longitudeDeg} displaySize={size} inline />{/if}
{/snippet}

{#if supported}
  <div class="relative h-full w-full select-none overflow-hidden">
    <canvas bind:this={canvas} class="block h-full w-full touch-none bg-ground {drive.planning ? 'cursor-crosshair' : ''}" aria-label="Surface view"></canvas>
    {#if legacy}
      <button
        type="button"
        class="absolute bottom-3 left-3 rounded-sm border border-rule bg-panel px-2 py-1 text-xs text-muted hover:text-ink"
        onclick={toggleMode}
        aria-label="Switch camera"
      >
        {mode === 'walk' ? 'Orbit' : 'Walk'}
      </button>
    {:else if controller && site}
      {#if drive.stay}<StayHud />{:else if drive.hudVisible}<Hud />{/if}
      <DriveControls originLatitudeDeg={site.latitudeDeg} originLongitudeDeg={site.longitudeDeg} map={drive.hudVisible ? routeMap : undefined} />
      {#if drive.menuOpen}<Menu onBackToPlan={backToPlan} />{/if}
    {/if}
    {#if failure}
      <p class="absolute right-3 top-3 text-xs text-muted">{failure}</p>
    {:else if !ready && groundMissing && !legacy}
      <p class="absolute right-3 top-3 text-xs text-muted">Loading terrain</p>
    {:else if !ready && groundMissing}
      <p class="absolute bottom-3 right-3 text-xs text-muted">Loading terrain</p>
    {/if}
  </div>
{:else}
  <p class="p-4 text-sm text-muted">Expedition needs a site south of 85°S.</p>
{/if}
