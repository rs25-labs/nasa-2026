import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRoverMaterial, type RoverSurface } from './roverMaterial';

/**
 * Rover dimensions, metres. The frame: +X right, +Y up, forward is -Z. The origin is the axle plane at the middle of
 * the wheelbase; the ground is WHEEL_RADIUS below it when the suspension is at its nominal position.
 */
export const ROVER = {
  wheelRadius: 0.45,
  wheelWidth: 0.38,
  /** Wheel centres: half track, half wheelbase. */
  halfTrack: 1.12,
  halfBase: 1.25,
  /** Suspension arm: pivot offset toward the middle of the wheelbase, and the arm's length along Z. */
  armLength: 0.6,
  armPivotX: 0.78,
  /** Largest wheel travel either way from nominal. */
  travel: 0.2,
  /** Height of the body's lowest point above the ground at nominal ride height. */
  clearance: 0.6,
  /** Camera position for the driver and mast views: ahead of the canopy, over the nose. */
  mastHeadHeight: 1.3,
  mastX: 0,
  mastZ: -1.9,
  /** Array pedestal on the roof and the fixed elevation of the array's normal above the horizon (the array turns in azimuth only). */
  arrayX: 0,
  arrayZ: 1.0,
  arrayNormalElevationDeg: 20,
} as const;

const RAD = Math.PI / 180;

const SURFACES = {
  hull: { base: [0.62, 0.62, 0.6], metal: 0, roughness: 0.42, dust: 0.16 },
  accent: { base: [0.75, 0.2, 0.02], metal: 0, roughness: 0.4, dust: 0.12 },
  visor: { base: [0, 0, 0], metal: 1, roughness: 0.1, f0: [0.85, 0.62, 0.28], dust: 0.03 },
  white: { base: [0.5, 0.5, 0.48], metal: 0, roughness: 0.55, kind: 'blanket', dust: 0.25 },
  grey: { base: [0.16, 0.16, 0.17], metal: 0, roughness: 0.5, dust: 0.3 },
  anodised: { base: [0, 0, 0], metal: 1, roughness: 0.42, f0: [0.34, 0.34, 0.36], dust: 0.2 },
  aluminium: { base: [0, 0, 0], metal: 1, roughness: 0.38, f0: [0.9, 0.9, 0.88], kind: 'mesh', dust: 0.35 },
  gold: { base: [0, 0, 0], metal: 1, roughness: 0.42, f0: [0.9, 0.66, 0.3], kind: 'foil', dust: 0.2 },
  silver: { base: [0, 0, 0], metal: 1, roughness: 0.38, f0: [0.9, 0.89, 0.86], kind: 'foil', dust: 0.2 },
  black: { base: [0.012, 0.012, 0.013], metal: 0, roughness: 0.6, dust: 0.1 },
  cells: { base: [0.008, 0.013, 0.045], metal: 0, roughness: 0.14, kind: 'cells', cells: [10, 7], dust: 0.04 },
  cellsDeck: { base: [0.008, 0.013, 0.045], metal: 0, roughness: 0.14, kind: 'cells', cells: [14, 8], dust: 0.12 },
  radiator: { base: [0.72, 0.72, 0.7], metal: 0, roughness: 0.65, dust: 0.5 },
  glass: { base: [0.004, 0.004, 0.006], metal: 0, roughness: 0.05 },
  lens: { base: [0.01, 0.01, 0.01], metal: 0, roughness: 0.05, kind: 'lens' },
} satisfies Record<string, RoverSurface>;

type SurfaceName = keyof typeof SURFACES;

export interface WheelRig {
  /** Wheel centre in the axle frame (x, z); y is set each frame. */
  x: number;
  z: number;
  /** Arm that swings about X at its pivot; the hub is at the arm's end. */
  arm: THREE.Group;
  /** Length of the arm along Z (negative toward the front). */
  armDz: number;
  armDx: number;
  steer: THREE.Group;
  spin: THREE.Group;
}

export interface RoverModel {
  root: THREE.Group;
  wheels: WheelRig[];
  /** Turns about the vertical to face the Sun. */
  array: THREE.Group;
  /** Where the mast camera sits, in the root's frame. */
  mastHead: THREE.Object3D;
  /** Pan and tilt of the camera head (set by the mast camera). */
  lampAnchors: [THREE.Object3D, THREE.Object3D];
  materials: THREE.ShaderMaterial[];
  dispose(): void;
}

class PartBuilder {
  private readonly parts = new Map<SurfaceName, THREE.BufferGeometry[]>();

  add(surface: SurfaceName, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) copy.applyMatrix4(matrix);
    for (const name of Object.keys(copy.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') copy.deleteAttribute(name);
    }
    const list = this.parts.get(surface) ?? [];
    list.push(copy);
    this.parts.set(surface, list);
  }

  box(surface: SurfaceName, size: [number, number, number], at: [number, number, number], bevel = 0.012, rotation?: [number, number, number]): void {
    const radius = Math.min(bevel, size[0] / 2.01, size[1] / 2.01, size[2] / 2.01);
    const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius);
    this.add(surface, geometry, placement(at, rotation));
    geometry.dispose();
  }

  cylinder(surface: SurfaceName, radius: number, length: number, at: [number, number, number], axis: 'x' | 'y' | 'z' = 'y', segments = 16): void {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    const rotation: [number, number, number] = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    this.add(surface, geometry, placement(at, rotation));
    geometry.dispose();
  }

  /** A rod between two points. */
  rod(surface: SurfaceName, radius: number, from: THREE.Vector3, to: THREE.Vector3): void {
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
    const matrix = new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(surface, geometry, matrix);
    geometry.dispose();
  }

  build(group: THREE.Group, materials: Map<SurfaceName, THREE.ShaderMaterial>): void {
    for (const [name, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      group.add(new THREE.Mesh(merged, material(materials, name)));
    }
    this.parts.clear();
  }
}

function placement(at: [number, number, number], rotation?: [number, number, number]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  );
}

function material(materials: Map<SurfaceName, THREE.ShaderMaterial>, name: SurfaceName): THREE.ShaderMaterial {
  let found = materials.get(name);
  if (!found) {
    found = createRoverMaterial(SURFACES[name] as RoverSurface);
    materials.set(name, found);
  }
  return found;
}

/** A wheel: wide airless rim with flanges, chevron grousers, a dished hub and an accent ring. Axle along X. */
function buildWheel(materials: Map<SurfaceName, THREE.ShaderMaterial>): THREE.Group {
  const group = new THREE.Group();
  const radius = ROVER.wheelRadius;
  const half = ROVER.wheelWidth / 2;
  const builder = new PartBuilder();
  const profile = [
    new THREE.Vector2(radius - 0.07, -half),
    new THREE.Vector2(radius + 0.006, -half),
    new THREE.Vector2(radius + 0.006, -half + 0.02),
    new THREE.Vector2(radius - 0.01, -half + 0.02),
    new THREE.Vector2(radius - 0.01, half - 0.02),
    new THREE.Vector2(radius + 0.006, half - 0.02),
    new THREE.Vector2(radius + 0.006, half),
    new THREE.Vector2(radius - 0.07, half),
    new THREE.Vector2(radius - 0.07, -half),
  ];
  const rim = new THREE.LatheGeometry(profile, 56);
  rim.rotateZ(Math.PI / 2);
  builder.add('aluminium', rim);
  rim.dispose();
  const grouserCount = 30;
  for (let k = 0; k < grouserCount; k += 1) {
    const angle = (k / grouserCount) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const geometry = new RoundedBoxGeometry(half * 1.05, 0.045, 0.022, 1, 0.006);
      const matrix = new THREE.Matrix4()
        .makeRotationX(angle)
        .multiply(new THREE.Matrix4().makeTranslation(side * half * 0.5, radius + 0.006, 0))
        .multiply(new THREE.Matrix4().makeRotationY(side * 0.45));
      builder.add('aluminium', geometry, matrix);
      geometry.dispose();
    }
  }
  // Dished hub: a dark disc, six lightening spokes and an accent ring.
  builder.cylinder('anodised', radius - 0.07, 0.05, [0, 0, 0], 'x', 40);
  for (let k = 0; k < 6; k += 1) {
    const angle = (k / 6) * Math.PI * 2;
    const geometry = new RoundedBoxGeometry(half * 1.7, radius - 0.16, 0.05, 1, 0.012);
    const matrix = new THREE.Matrix4().makeRotationX(angle).multiply(new THREE.Matrix4().makeTranslation(0, (radius - 0.16) / 2 + 0.08, 0));
    builder.add('grey', geometry, matrix);
    geometry.dispose();
  }
  builder.cylinder('accent', 0.17, ROVER.wheelWidth * 0.96, [0, 0, 0], 'x', 28);
  builder.cylinder('black', 0.1, ROVER.wheelWidth + 0.02, [0, 0, 0], 'x', 20);
  builder.build(group, materials);
  return group;
}

/** A crewed, pressurised surface vehicle: low hull, cabin with a gold-tinted bubble canopy, roof array, light bar. */
export function buildRover(): RoverModel {
  const materials = new Map<SurfaceName, THREE.ShaderMaterial>();
  const root = new THREE.Group();
  root.name = 'rover';
  const body = new PartBuilder();
  const floor = ROVER.clearance - ROVER.wheelRadius;

  // Lower hull with a skid plate, a tapered nose and a tail.
  body.box('hull', [1.5, 0.5, 3.5], [0, floor + 0.27, 0], 0.16);
  body.box('grey', [1.3, 0.06, 3.1], [0, floor + 0.02, 0], 0.02);
  body.box('hull', [1.3, 0.34, 0.7], [0, floor + 0.3, -1.75], 0.15, [0.35, 0, 0]);
  body.box('anodised', [1.36, 0.12, 0.3], [0, floor + 0.12, -1.98], 0.05);
  // Cabin.
  body.box('hull', [1.86, 1.0, 2.3], [0, floor + 0.98, 0.35], 0.42);
  body.box('accent', [1.9, 0.07, 2.0], [0, floor + 0.62, 0.35], 0.03);
  // Bubble canopy over the two seats, with a frame hoop and a centre spine.
  const canopy = new THREE.SphereGeometry(1, 40, 24);
  body.add('visor', canopy, new THREE.Matrix4().compose(new THREE.Vector3(0, floor + 0.98, -0.72), new THREE.Quaternion(), new THREE.Vector3(0.86, 0.6, 1.02)));
  canopy.dispose();
  const hoop = new THREE.TorusGeometry(0.87, 0.035, 10, 40, Math.PI);
  body.add('anodised', hoop, placement([0, floor + 0.98, -0.72], [0, 0, 0]));
  hoop.dispose();
  const spine = new THREE.TorusGeometry(1.0, 0.03, 10, 40, Math.PI * 0.62);
  body.add('anodised', spine, new THREE.Matrix4().compose(new THREE.Vector3(0, floor + 0.62, -0.72), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 0.98, 1)));
  spine.dispose();
  // Side windows and a rear suit-port hatch.
  for (const side of [-1, 1]) {
    body.box('glass', [0.03, 0.34, 0.9], [side * 0.925, floor + 1.12, 0.55], 0.012);
    body.box('anodised', [0.02, 0.42, 0.98], [side * 0.918, floor + 1.12, 0.55], 0.01);
    body.box('anodised', [0.16, 0.05, 1.5], [side * 0.86, floor + 0.2, 0], 0.02);
    body.rod('anodised', 0.018, new THREE.Vector3(side * 0.95, floor + 0.75, -0.2), new THREE.Vector3(side * 0.95, floor + 0.75, 1.2));
  }
  body.cylinder('grey', 0.42, 0.1, [0, floor + 0.95, 1.52], 'z', 32);
  body.cylinder('anodised', 0.34, 0.12, [0, floor + 0.95, 1.54], 'z', 32);
  body.cylinder('accent', 0.05, 0.16, [0.2, floor + 0.95, 1.56], 'z', 12);
  // Fenders over the wheels.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      body.box('anodised', [0.5, 0.06, 1.15], [sx * ROVER.halfTrack, ROVER.wheelRadius + 0.3, sz * ROVER.halfBase], 0.025);
      body.box('anodised', [0.5, 0.06, 0.36], [sx * ROVER.halfTrack, ROVER.wheelRadius + 0.2, sz * (ROVER.halfBase + 0.66)], 0.025, [sz * 0.7, 0, 0]);
      body.box('anodised', [0.5, 0.06, 0.36], [sx * ROVER.halfTrack, ROVER.wheelRadius + 0.2, sz * (ROVER.halfBase - 0.66)], 0.025, [-sz * 0.7, 0, 0]);
      body.box('grey', [0.3, 0.07, 0.2], [sx * 0.86, ROVER.wheelRadius + 0.28, sz * ROVER.halfBase], 0.02);
    }
  }
  // Tail: radiator with louvres, two tanks, tail lamp strip.
  body.box('radiator', [1.3, 0.5, 0.05], [0, floor + 0.34, 1.78], 0.012);
  for (let k = 0; k < 9; k += 1) body.box('black', [1.26, 0.014, 0.014], [0, floor + 0.14 + k * 0.05, 1.81], 0.004);
  for (const side of [-1, 1]) body.cylinder('hull', 0.16, 0.9, [side * 0.52, floor + 0.66, 1.62], 'x', 20);
  // Roof: rack, light bar at the front, antenna dish and whip.
  const roof = floor + 1.48;
  body.box('grey', [1.3, 0.05, 1.5], [0, roof + 0.02, 0.5], 0.02);
  body.box('black', [1.5, 0.1, 0.12], [0, roof - 0.02, -0.52], 0.03);
  for (const x of [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6]) body.cylinder('lens', 0.045, 0.02, [x, roof - 0.02, -0.59], 'z', 16);
  body.rod('anodised', 0.02, new THREE.Vector3(-0.55, roof, 0.2), new THREE.Vector3(-0.55, roof + 0.5, 0.2));
  const dish = new THREE.SphereGeometry(0.3, 28, 8, 0, Math.PI * 2, 0, 0.9);
  body.add('radiator', dish, new THREE.Matrix4().compose(new THREE.Vector3(-0.55, roof + 0.52, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.4, 0)), new THREE.Vector3(1, 0.28, 1)));
  dish.dispose();
  body.rod('black', 0.008, new THREE.Vector3(0.6, roof, 0.1), new THREE.Vector3(0.6, roof + 1.1, 0.25));
  // Headlamps in the nose.
  const lampOffset = 0.48;
  const lampY = floor + 0.36;
  for (const side of [-1, 1]) {
    body.cylinder('black', 0.1, 0.1, [side * lampOffset, lampY, -2.02], 'z', 24);
    body.cylinder('lens', 0.08, 0.02, [side * lampOffset, lampY, -2.075], 'z', 24);
  }
  body.build(root, materials);

  // Sun-tracking array on the roof: a pedestal that turns about the vertical, carrying a tilted two-sided panel.
  const array = new THREE.Group();
  array.position.set(ROVER.arrayX, roof + 0.04, ROVER.arrayZ);
  const arrayBody = new PartBuilder();
  arrayBody.cylinder('anodised', 0.07, 0.12, [0, 0.06, 0], 'y', 16);
  arrayBody.rod('anodised', 0.03, new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 0.5, 0));
  const tilt = (90 - ROVER.arrayNormalElevationDeg) * RAD;
  const panel = new THREE.Group();
  panel.position.set(0, 0.72, 0);
  panel.rotation.x = -tilt;
  const panelBuilder = new PartBuilder();
  panelBuilder.box('cells', [1.5, 0.024, 0.8], [0, 0.018, 0], 0.005);
  panelBuilder.box('white', [1.52, 0.014, 0.82], [0, -0.008, 0], 0.005);
  for (const k of [-1, 0, 1]) panelBuilder.box('grey', [1.48, 0.016, 0.03], [0, -0.024, k * 0.26], 0.004);
  for (const x of [-0.56, -0.19, 0.19, 0.56]) panelBuilder.box('grey', [0.03, 0.016, 0.78], [x, -0.024, 0], 0.004);
  panelBuilder.box('anodised', [1.54, 0.03, 0.02], [0, 0, 0.41], 0.005);
  panelBuilder.box('anodised', [1.54, 0.03, 0.02], [0, 0, -0.41], 0.005);
  panelBuilder.build(panel, materials);
  arrayBody.build(array, materials);
  array.add(panel);
  root.add(array);

  const mastHead = new THREE.Object3D();
  mastHead.position.set(ROVER.mastX, ROVER.mastHeadHeight, ROVER.mastZ);
  root.add(mastHead);
  const lampAnchors: [THREE.Object3D, THREE.Object3D] = [new THREE.Object3D(), new THREE.Object3D()];
  // The beams come from the roof light bar, high enough to light the ground well ahead and around the vehicle.
  lampAnchors[0].position.set(-0.6, roof + 0.05, -0.7);
  lampAnchors[1].position.set(0.6, roof + 0.05, -0.7);
  root.add(lampAnchors[0], lampAnchors[1]);

  // Wheels on swing arms.
  const wheels: WheelRig[] = [];
  const wheelProto = buildWheel(materials);
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const armDz = sz * ROVER.armLength;
      const hubX = sx * ROVER.halfTrack;
      const pivotX = sx * ROVER.armPivotX;
      const arm = new THREE.Group();
      arm.position.set(pivotX, 0, sz * ROVER.halfBase - armDz);
      const armBuilder = new PartBuilder();
      const armDx = hubX - pivotX - sx * (ROVER.wheelWidth / 2 + 0.06);
      armBuilder.box('anodised', [0.09, 0.12, Math.abs(armDz) + 0.1], [armDx * 0.1, 0, armDz / 2], 0.02);
      armBuilder.box('anodised', [Math.abs(armDx) + 0.08, 0.1, 0.1], [armDx / 2, 0, armDz], 0.02);
      armBuilder.cylinder('black', 0.06, 0.2, [0, 0, 0], 'x', 12);
      armBuilder.build(arm, materials);
      const steer = new THREE.Group();
      steer.position.set(hubX - pivotX, 0, armDz);
      const spin = new THREE.Group();
      const wheel = wheelProto.clone();
      wheel.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry = child.geometry.clone();
      });
      spin.add(wheel);
      steer.add(spin);
      arm.add(steer);
      root.add(arm);
      wheels.push({ x: hubX, z: sz * ROVER.halfBase, arm, armDz, armDx: hubX - pivotX, steer, spin });
    }
  }
  wheelProto.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });

  return {
    root,
    wheels,
    array,
    mastHead,
    lampAnchors,
    materials: [...materials.values()],
    dispose() {
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      for (const item of materials.values()) item.dispose();
    },
  };
}
