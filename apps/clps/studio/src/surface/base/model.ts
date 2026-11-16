import * as THREE from 'three';
import { MaterialSet, Parts, type SurfaceName } from './parts';

const RAD = Math.PI / 180;

/** A work light: where it sits and where it points, in its model's frame (+Z is the model's front). */
export interface LampMount {
  position: THREE.Vector3;
  direction: THREE.Vector3;
}

/** A model whose legs reach down to whatever ground is under each pad: they are rebuilt when the ground changes. */
export interface LeggedModel {
  group: THREE.Group;
  /** Pad centres in the model's frame (x, z); y is supplied to `rebuildLegs`. */
  pads: [number, number][];
  /** Where the ladder or steps meet the ground (x, z), when the model has one. */
  foot: [number, number] | null;
  lamp: LampMount;
  /** Ground under each pad and under the foot, relative to the model's origin (<= 0). */
  rebuildLegs(padY: number[], footY: number): void;
  materials: MaterialSet;
  dispose(): void;
}

export interface MastModel {
  group: THREE.Group;
  /** Turns about the mast to face the Sun. */
  panel: THREE.Group;
  materials: MaterialSet;
  dispose(): void;
}

function lampDirection(pitchDownDeg: number): THREE.Vector3 {
  return new THREE.Vector3(0, -Math.sin(pitchDownDeg * RAD), Math.cos(pitchDownDeg * RAD));
}

/** A lamp housing facing `direction`, drawn with a lens disc whose brightness the work-light code sets. */
function addLampHousing(parts: Parts, mount: LampMount): void {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), mount.direction);
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  parts.cylinder('black', 0.17, 0.17, 0.16, [mount.position.x, mount.position.y, mount.position.z], [euler.x, euler.y, euler.z], 18);
  const bracket = mount.position.clone().addScaledVector(mount.direction, -0.14);
  parts.box('grey', [0.14, 0.14, 0.14], [bracket.x, bracket.y, bracket.z]);
}

export function lensMesh(mount: LampMount, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 18), material);
  mesh.position.copy(mount.position).addScaledVector(mount.direction, 0.085);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mount.direction);
  return mesh;
}

const LEG_ANGLES = [45, 135, 225, 315].map((degrees) => degrees * RAD);
const LANDER_PAD_RADIUS = 4.6;

/**
 * A crewed lander of the 2030s class: octagonal descent stage in gold foil on four legs, a cylindrical ascent and cabin
 * module with windows and a hatch, an engine bell, a ladder to the surface, a dish antenna. About 8.5 m to the top of
 * the antenna. The model's origin is on the ground level of its highest footpad.
 */
export function buildLander(): LeggedModel {
  const materials = new MaterialSet();
  const group = new THREE.Group();
  group.name = 'lander';
  const body = new Parts();
  // Descent stage.
  body.cylinder('gold', 2.0, 2.0, 1.7, [0, 2.55, 0], undefined, 8);
  body.cylinder('grey', 2.06, 2.06, 0.1, [0, 1.72, 0], undefined, 8);
  body.cylinder('grey', 2.06, 2.06, 0.1, [0, 3.38, 0], undefined, 8);
  for (let k = 0; k < 4; k += 1) {
    const angle = k * 90 * RAD + 22.5 * RAD;
    body.box('white', [0.9, 1.0, 0.5], [Math.sin(angle) * 2.15, 2.5, Math.cos(angle) * 2.15], [0, angle, 0]);
  }
  // Engine bell under the descent stage.
  body.cylinder('anodised', 0.3, 0.95, 1.1, [0, 1.3, 0], undefined, 24);
  body.cylinder('black', 0.9, 0.9, 0.02, [0, 0.76, 0], undefined, 24);
  // Ascent and cabin module.
  body.cylinder('white', 1.45, 1.45, 2.3, [0, 4.55, 0], undefined, 24);
  body.cylinder('white', 0.85, 1.45, 0.7, [0, 6.05, 0], undefined, 24);
  body.cylinder('silver', 1.47, 1.47, 0.35, [0, 3.62, 0], undefined, 24);
  body.cylinder('silver', 0.87, 0.87, 0.2, [0, 6.5, 0], undefined, 24);
  for (const side of [-1, 1]) body.box('glass', [0.5, 0.38, 0.06], [side * 0.55, 5.2, 1.37], [0, side * -0.4, 0]);
  body.box('grey', [0.95, 1.3, 0.07], [0, 4.2, 1.46]);
  body.box('silver', [1.05, 1.4, 0.04], [0, 4.2, 1.44]);
  // Hatch platform.
  body.box('grey', [1.3, 0.08, 0.95], [0, 3.45, 2.1]);
  for (const side of [-1, 1]) body.rod('anodised', 0.02, new THREE.Vector3(side * 0.62, 3.5, 2.55), new THREE.Vector3(side * 0.62, 4.3, 2.55));
  body.rod('anodised', 0.02, new THREE.Vector3(-0.62, 4.3, 2.55), new THREE.Vector3(0.62, 4.3, 2.55));
  // Attitude thrusters around the cabin's base.
  for (let k = 0; k < 4; k += 1) {
    const angle = k * 90 * RAD;
    body.box('black', [0.3, 0.3, 0.3], [Math.sin(angle) * 1.5, 3.85, Math.cos(angle) * 1.5], [0, angle, 0]);
  }
  // Dish and whip antenna on the cabin roof.
  body.rod('anodised', 0.04, new THREE.Vector3(0.5, 6.4, -0.3), new THREE.Vector3(0.5, 7.7, -0.3));
  const dish = new THREE.SphereGeometry(0.55, 28, 8, 0, Math.PI * 2, 0, 0.9);
  body.add('radiator', dish, new THREE.Matrix4().compose(new THREE.Vector3(0.5, 7.75, -0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.7, 0.5, 0)), new THREE.Vector3(1, 0.3, 1)));
  body.rod('black', 0.012, new THREE.Vector3(-0.5, 6.5, 0.2), new THREE.Vector3(-0.5, 8.4, 0.2));
  const lamp: LampMount = { position: new THREE.Vector3(-1.0, 3.05, 1.8), direction: lampDirection(52) };
  addLampHousing(body, lamp);
  body.build(group, materials);

  const legMeshes = new Map<SurfaceName, THREE.Mesh>();
  const pads: [number, number][] = LEG_ANGLES.map((angle) => [Math.sin(angle) * LANDER_PAD_RADIUS, Math.cos(angle) * LANDER_PAD_RADIUS]);
  const foot: [number, number] = [0, 2.95];
  const lens = lensMesh(lamp, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  group.add(lens);

  const rebuildLegs = (padY: number[], footY: number): void => {
    const legs = new Parts();
    LEG_ANGLES.forEach((angle, k) => {
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const attach = new THREE.Vector3(sin * 1.9, 2.05, cos * 1.9);
      const pad = new THREE.Vector3(pads[k]![0], (padY[k] as number) + 0.12, pads[k]![1]);
      legs.rod('aluminium', 0.09, attach, pad);
      const high = new THREE.Vector3(sin * 1.25, 1.75, cos * 1.25);
      legs.rod('anodised', 0.05, high, attach.clone().lerp(pad, 0.62));
      legs.cylinder('aluminium', 0.5, 0.62, 0.12, [pads[k]![0], (padY[k] as number) + 0.06, pads[k]![1]], undefined, 20);
      legs.cylinder('anodised', 0.1, 0.1, 0.12, [pad.x, pad.y, pad.z], undefined, 8);
    });
    // Ladder: two rails and rungs from the platform to the ground.
    const top = 3.45;
    const bottom = footY + 0.05;
    for (const side of [-1, 1]) legs.rod('anodised', 0.03, new THREE.Vector3(side * 0.34, top, 2.4), new THREE.Vector3(side * 0.34, bottom, foot[1]));
    const rungs = Math.max(2, Math.round((top - bottom) / 0.3));
    for (let r = 1; r < rungs; r += 1) {
      const t = r / rungs;
      const y = top + (bottom - top) * t;
      const z = 2.4 + (foot[1] - 2.4) * t;
      legs.cylinder('aluminium', 0.015, 0.015, 0.68, [0, y, z], [0, 0, Math.PI / 2], 6);
    }
    legs.build(group, materials, legMeshes);
  };
  rebuildLegs([0, 0, 0, 0], 0);

  return {
    group,
    pads,
    foot,
    lamp,
    rebuildLegs,
    materials,
    dispose() {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      (lens.material as THREE.Material).dispose();
      materials.dispose();
    },
  };
}

const HAB_PADS: [number, number][] = [
  [-2.5, -1.9],
  [2.5, -1.9],
  [-2.5, 1.9],
  [2.5, 1.9],
];

/**
 * A small pressurised habitat: a horizontal cylinder with domed ends on four legs, a hatch with a porch and steps, windows,
 * radiator panels and a pair of tanks. The origin is on the ground level of its highest footpad.
 */
export function buildHabitat(): LeggedModel {
  const materials = new MaterialSet();
  const group = new THREE.Group();
  group.name = 'habitat';
  const body = new Parts();
  body.cylinder('white', 1.7, 1.7, 5.4, [0, 2.9, 0], [0, 0, Math.PI / 2], 28);
  for (const side of [-1, 1]) {
    const dome = new THREE.SphereGeometry(1.7, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    body.add('white', dome, placement3([side * 2.7, 2.9, 0], [0, 0, -side * Math.PI / 2]));
    body.cylinder('silver', 1.73, 1.73, 0.55, [side * 2.35, 2.9, 0], [0, 0, Math.PI / 2], 28);
  }
  for (let k = 0; k < 4; k += 1) body.box('glass', [0.5, 0.32, 0.06], [-1.8 + k * 1.2, 3.55, 1.5], [0.5, 0, 0]);
  // Skids under the shell, and the tunnel stub on the back.
  for (const side of [-1, 1]) body.box('grey', [5.4, 0.18, 0.3], [0, 1.15, side * 1.15]);
  body.cylinder('grey', 0.55, 0.55, 0.9, [0, 2.6, -2.0], [Math.PI / 2, 0, 0], 16);
  // Hatch, porch and steps.
  body.box('silver', [1.1, 1.75, 0.05], [0.5, 2.25, 1.57], [-0.12, 0, 0]);
  body.box('grey', [0.9, 1.6, 0.07], [0.5, 2.25, 1.6], [-0.12, 0, 0]);
  body.box('grey', [2.0, 0.1, 1.5], [0.5, 1.45, 2.3]);
  body.box('grey', [1.4, 0.08, 0.45], [0.5, 1.0, 3.25]);
  body.box('grey', [1.4, 0.08, 0.45], [0.5, 0.55, 3.7]);
  for (const side of [-1, 1]) {
    const x = 0.5 + side * 0.95;
    body.rod('anodised', 0.025, new THREE.Vector3(x, 1.5, 1.6), new THREE.Vector3(x, 2.4, 1.6));
    body.rod('anodised', 0.025, new THREE.Vector3(x, 2.4, 1.6), new THREE.Vector3(x, 2.4, 3.0));
    body.rod('anodised', 0.025, new THREE.Vector3(x, 1.5, 3.0), new THREE.Vector3(x, 2.4, 3.0));
  }
  // Radiator panels, tanks and a dish.
  for (const side of [-1, 1]) body.box('radiator', [2.0, 0.05, 1.1], [side * 1.4, 4.78, 0.15], [0, 0, side * 0.12]);
  for (const side of [-1, 1]) {
    body.add('aluminium', new THREE.SphereGeometry(0.5, 20, 12), placement3([side * 1.2, 1.9, -2.2]));
    body.rod('anodised', 0.03, new THREE.Vector3(side * 1.2, 1.9, -2.0), new THREE.Vector3(side * 0.9, 2.2, -1.65));
  }
  body.rod('anodised', 0.03, new THREE.Vector3(-1.4, 4.55, -0.4), new THREE.Vector3(-1.4, 5.3, -0.4));
  body.add('radiator', new THREE.SphereGeometry(0.4, 24, 8, 0, Math.PI * 2, 0, 0.9), new THREE.Matrix4().compose(new THREE.Vector3(-1.4, 5.35, -0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.2, 0)), new THREE.Vector3(1, 0.3, 1)));
  const lamp: LampMount = { position: new THREE.Vector3(-0.4, 3.45, 1.65), direction: lampDirection(48) };
  addLampHousing(body, lamp);
  body.build(group, materials);

  const legMeshes = new Map<SurfaceName, THREE.Mesh>();
  const lens = lensMesh(lamp, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  group.add(lens);
  const foot: [number, number] = [0.5, 3.7];
  const rebuildLegs = (padY: number[]): void => {
    const legs = new Parts();
    HAB_PADS.forEach(([x, z], k) => {
      const y = padY[k] as number;
      legs.rod('anodised', 0.08, new THREE.Vector3(x * 0.82, 1.1, z * 0.6), new THREE.Vector3(x, y + 0.1, z));
      legs.cylinder('aluminium', 0.42, 0.5, 0.1, [x, y + 0.05, z], undefined, 18);
    });
    legs.build(group, materials, legMeshes);
  };
  rebuildLegs([0, 0, 0, 0]);
  return {
    group,
    pads: HAB_PADS,
    foot,
    lamp,
    rebuildLegs: (padY) => rebuildLegs(padY),
    materials,
    dispose() {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      (lens.material as THREE.Material).dispose();
      materials.dispose();
    },
  };
}

function placement3(at: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1));
}

export const MAST = { height: 10, panelWidth: 3, panelBottom: 1.9, panelTop: 9.5 } as const;

/**
 * A vertical solar array mast of the kind proposed for the lunar south pole: a 10 m pole with a tall two-sided panel that
 * turns about the pole to face the Sun. The origin is on the ground at the pole's foot.
 */
export function buildMast(): MastModel {
  const materials = new MaterialSet();
  const group = new THREE.Group();
  group.name = 'mast';
  const mast = new Parts();
  mast.rod('aluminium', 0.1, new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, MAST.height + 0.2, 0), 12);
  mast.box('grey', [1.4, 0.2, 1.4], [0, 0.0, 0]);
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI * 2;
    mast.box('anodised', [0.6, 0.12, 0.6], [Math.sin(angle) * 1.2, -0.02, Math.cos(angle) * 1.2], [0, angle, 0]);
    mast.rod('anodised', 0.04, new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(Math.sin(angle) * 1.2, 0.05, Math.cos(angle) * 1.2));
  }
  mast.cylinder('black', 0.2, 0.2, 0.35, [0, 1.7, 0], undefined, 14);
  mast.build(group, materials);

  const panel = new THREE.Group();
  const height = MAST.panelTop - MAST.panelBottom;
  const centre = (MAST.panelTop + MAST.panelBottom) / 2;
  const sheet = new Parts();
  sheet.box('cells', [MAST.panelWidth, height, 0.05], [0, centre, 0.2]);
  sheet.box('white', [MAST.panelWidth + 0.04, height + 0.04, 0.04], [0, centre, 0.16]);
  for (const edge of [-1, 1]) {
    sheet.box('anodised', [0.07, height + 0.1, 0.12], [edge * (MAST.panelWidth / 2 + 0.02), centre, 0.19]);
    sheet.box('anodised', [MAST.panelWidth + 0.12, 0.08, 0.12], [0, edge > 0 ? MAST.panelTop + 0.03 : MAST.panelBottom - 0.03, 0.19]);
  }
  for (const y of [2.4, 6.0, 9.0]) sheet.box('anodised', [0.14, 0.1, 0.34], [0, y, 0.1]);
  sheet.build(panel, materials);
  group.add(panel);

  return {
    group,
    panel,
    materials,
    dispose() {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      materials.dispose();
    },
  };
}
