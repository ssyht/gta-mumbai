import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleProfile } from './VehicleProfile';
import { mulberry32, signTexture } from '../../render/materials/textures';

/**
 * Procedural greybox vehicle meshes, built in the vehicle frame
 * (+Z forward, +X left, origin = chassis box centre). Real GLBs replace these
 * later (CLAUDE.md §8); the returned handles (wheels, lights) stay the same.
 */
export interface VehicleVisual {
  root: THREE.Group;
  /** Steering pivots, one per profile wheel (same order). */
  wheelPivots: THREE.Object3D[];
  /** Spinning wheel meshes inside each pivot. */
  wheelSpinners: THREE.Object3D[];
  headMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  /** Local positions of the headlight(s), for the night spotlight. */
  headlightAnchor: THREE.Vector3;
}

const shared = new Map<string, THREE.MeshStandardMaterial>();
function paint(
  color: number | string,
  roughness = 0.5,
  metalness = 0.1,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  let m = shared.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    shared.set(key, m);
  }
  return m;
}
const GLASS = (): THREE.MeshStandardMaterial =>
  paint(0x1a2630, 0.08, 0.4, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
const TYRE = (): THREE.MeshStandardMaterial => paint(0x161616, 0.9, 0);
const RIM = (): THREE.MeshStandardMaterial => paint(0x9a9a9a, 0.35, 0.8);
const BLACK = (): THREE.MeshStandardMaterial => paint(0x1b1b1b, 0.7, 0.1);
const CHROME = (): THREE.MeshStandardMaterial => paint(0xcfcfcf, 0.2, 0.9);

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(
  parent: THREE.Object3D,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
function rod(
  parent: THREE.Object3D,
  mat: THREE.Material,
  r: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
): THREE.Mesh {
  const m = new THREE.Mesh(cylGeo, mat);
  const len = a.distanceTo(b);
  m.scale.set(r, len, r);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

function plane(
  parent: THREE.Object3D,
  tex: THREE.Texture,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  ry: number,
  emissive = 0,
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.7,
    emissive: emissive > 0 ? 0xffffff : 0x000000,
    emissiveMap: emissive > 0 ? tex : null,
    emissiveIntensity: emissive,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

function wheel(
  radius: number,
  width: number,
  hubColor = 0x9a9a9a,
): { pivot: THREE.Object3D; spinner: THREE.Object3D } {
  const pivot = new THREE.Object3D();
  const spinner = new THREE.Object3D();
  pivot.add(spinner);
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), TYRE());
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  spinner.add(tyre);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.04, 8),
    hubColor === 0x9a9a9a ? RIM() : paint(hubColor, 0.4, 0.5),
  );
  hub.rotation.z = Math.PI / 2;
  spinner.add(hub);
  // Spoke bar so rotation reads.
  const bar = new THREE.Mesh(boxGeo, BLACK());
  bar.scale.set(width * 1.08, radius * 0.9, radius * 0.12);
  spinner.add(bar);
  return { pivot, spinner };
}

function lights(): { headMat: THREE.MeshStandardMaterial; tailMat: THREE.MeshStandardMaterial } {
  return {
    headMat: new THREE.MeshStandardMaterial({
      color: 0xfff6dd,
      emissive: 0xfff1cc,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    }),
    tailMat: new THREE.MeshStandardMaterial({
      color: 0x7a0a0a,
      emissive: 0xff1a0a,
      emissiveIntensity: 0.3,
      roughness: 0.3,
    }),
  };
}

const CAR_COLORS = [0xf2f2ee, 0xb9bcc0, 0xa3161a, 0x1f3f8a, 0x2d2d2d, 0x8a8f94, 0x6b1520, 0xe8e2cf];

function buildHatchback(p: VehicleProfile, rnd: () => number, v: VehicleVisual): void {
  const r = v.root;
  const body = paint(CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]!, 0.32, 0.35);
  box(r, body, 1.62, 0.5, 3.72, 0, 0.02, 0);
  box(r, body, 1.6, 0.18, 1.05, 0, 0.32, 1.25); // bonnet
  box(r, GLASS(), 1.42, 0.5, 1.95, 0, 0.53, -0.2);
  box(r, body, 1.44, 0.07, 1.7, 0, 0.8, -0.3); // roof
  box(r, body, 0.08, 0.5, 0.09, 0.7, 0.53, 0.72);
  box(r, body, 0.08, 0.5, 0.09, -0.7, 0.53, 0.72);
  box(r, body, 0.08, 0.5, 0.09, 0.7, 0.53, -1.12);
  box(r, body, 0.08, 0.5, 0.09, -0.7, 0.53, -1.12);
  box(r, BLACK(), 1.66, 0.16, 0.12, 0, -0.17, 1.86);
  box(r, BLACK(), 1.66, 0.16, 0.12, 0, -0.17, -1.86);
  box(r, BLACK(), 0.6, 0.12, 0.04, 0, 0.05, 1.87); // grille
  box(r, v.headMat, 0.36, 0.12, 0.05, 0.58, 0.1, 1.86, false);
  box(r, v.headMat, 0.36, 0.12, 0.05, -0.58, 0.1, 1.86, false);
  box(r, v.tailMat, 0.26, 0.16, 0.05, 0.64, 0.14, -1.86, false);
  box(r, v.tailMat, 0.26, 0.16, 0.05, -0.64, 0.14, -1.86, false);
  box(r, BLACK(), 0.12, 0.08, 0.16, 0.86, 0.38, 0.62); // mirrors
  box(r, BLACK(), 0.12, 0.08, 0.16, -0.86, 0.38, 0.62);
  const plate = signTexture(
    [{ text: 'MH 01 AB 2701', size: 46, color: '#111', weight: 700 }],
    '#f4f1e6',
    256,
    64,
    { grime: false },
  );
  plane(r, plate, 0.5, 0.12, 0, -0.06, 1.93, 0);
  plane(r, plate, 0.5, 0.12, 0, -0.06, -1.93, Math.PI);
  v.headlightAnchor.set(0, 0.1, 1.9);
  void p;
}

function buildAuto(_p: VehicleProfile, v: VehicleVisual): void {
  const r = v.root;
  const yellow = paint(0xf2c200, 0.55, 0.05);
  const black = paint(0x161616, 0.45, 0.2);
  const green = paint(0x1f5d2c, 0.5, 0.1);
  // Lower tub and floor.
  box(r, black, 1.22, 0.42, 2.0, 0, -0.18, -0.25);
  box(r, green, 1.24, 0.06, 2.02, 0, 0.04, -0.25); // stripe
  // Front cowl with the single headlight.
  box(r, black, 0.86, 0.8, 0.42, 0, 0.12, 1.02);
  box(r, black, 0.6, 0.3, 0.3, 0, -0.32, 1.12);
  box(r, v.headMat, 0.2, 0.2, 0.06, 0, 0.28, 1.24, false);
  // Windscreen.
  const ws = box(r, GLASS(), 0.95, 0.55, 0.03, 0, 0.78, 0.82, false);
  ws.rotation.x = -0.12;
  // Canopy: yellow roof, curved back, canvas sides open.
  box(r, yellow, 1.3, 0.07, 2.05, 0, 1.24, -0.2);
  box(r, yellow, 1.3, 0.75, 0.07, 0, 0.88, -1.22);
  box(r, black, 1.3, 0.08, 0.1, 0, 1.2, 0.84);
  for (const x of [0.6, -0.6]) {
    rod(r, CHROME(), 0.022, new THREE.Vector3(x, 0.05, 0.75), new THREE.Vector3(x, 1.2, 0.8));
    rod(r, CHROME(), 0.02, new THREE.Vector3(x, 0.05, -0.2), new THREE.Vector3(x, 1.2, -0.2));
  }
  // Rear bench and backrest, driver seat, handlebar, meter.
  box(r, paint(0x3a2a20, 0.8, 0), 1.1, 0.14, 0.48, 0, -0.12, -0.6);
  box(r, paint(0x3a2a20, 0.8, 0), 1.1, 0.45, 0.1, 0, 0.12, -0.9);
  box(r, paint(0x3a2a20, 0.8, 0), 0.4, 0.1, 0.36, 0, -0.02, 0.38);
  rod(r, CHROME(), 0.02, new THREE.Vector3(-0.32, 0.5, 0.72), new THREE.Vector3(0.32, 0.5, 0.72));
  rod(r, CHROME(), 0.025, new THREE.Vector3(0, 0.2, 0.86), new THREE.Vector3(0, 0.5, 0.74));
  box(r, paint(0x111111, 0.4, 0.3), 0.14, 0.16, 0.08, -0.5, 0.95, 0.78); // fare meter
  box(r, v.tailMat, 0.14, 0.08, 0.04, 0.5, -0.2, -1.26, false);
  box(r, v.tailMat, 0.14, 0.08, 0.04, -0.5, -0.2, -1.26, false);
  const back = signTexture(
    [
      { text: 'HORN PLEASE', size: 42, color: '#f2c200', font: 'display' },
      { text: 'आई चा आशीर्वाद', size: 30, color: '#fff' },
    ],
    '#161616',
    256,
    128,
    { seed: 4 },
  );
  plane(r, back, 0.9, 0.45, 0, 0.75, -1.262, Math.PI);
  v.headlightAnchor.set(0, 0.28, 1.27);
}

function buildScooter(rnd: () => number, v: VehicleVisual): void {
  const r = v.root;
  const colors = [0xc8102e, 0x1d4e89, 0xf5f5f0, 0x2b2b2b, 0x7f8c8d];
  const body = paint(colors[Math.floor(rnd() * colors.length)]!, 0.35, 0.3);
  box(r, body, 0.36, 0.78, 0.1, 0, 0.05, 0.5); // apron
  box(r, BLACK(), 0.34, 0.05, 0.6, 0, -0.26, 0.12); // floorboard
  const cowl = box(r, body, 0.4, 0.36, 0.78, 0, -0.06, -0.36);
  cowl.scale.y = 0.36;
  box(r, BLACK(), 0.3, 0.09, 0.62, 0, 0.17, -0.3); // seat
  box(r, body, 0.2, 0.3, 0.2, 0, -0.18, 0.62); // front mudguard
  rod(r, CHROME(), 0.025, new THREE.Vector3(0, -0.35, 0.62), new THREE.Vector3(0, 0.55, 0.52));
  rod(r, CHROME(), 0.018, new THREE.Vector3(-0.32, 0.62, 0.48), new THREE.Vector3(0.32, 0.62, 0.48));
  box(r, body, 0.24, 0.14, 0.16, 0, 0.62, 0.52);
  box(r, v.headMat, 0.12, 0.08, 0.04, 0, 0.62, 0.61, false);
  box(r, v.tailMat, 0.12, 0.05, 0.04, 0, 0.02, -0.76, false);
  for (const x of [0.22, -0.22])
    rod(r, BLACK(), 0.008, new THREE.Vector3(x, 0.62, 0.48), new THREE.Vector3(x * 1.2, 0.8, 0.46));
  v.headlightAnchor.set(0, 0.62, 0.64);
}

function buildBus(v: VehicleVisual): void {
  const r = v.root;
  const red = paint(0xc0151b, 0.45, 0.15);
  const cream = paint(0xeee6cf, 0.5, 0.05);
  const grey = paint(0x8c8c88, 0.6, 0.2);
  const L = 11.6;
  box(r, red, 2.56, 1.05, L, 0, -0.375, 0);
  box(r, cream, 2.58, 0.08, L + 0.02, 0, 0.15, 0);
  box(r, GLASS(), 2.48, 0.86, L - 0.25, 0, 0.6, 0, false);
  box(r, red, 2.56, 0.36, L, 0, 1.2, 0);
  box(r, grey, 2.46, 0.18, L - 0.3, 0, 1.46, 0);
  // Window pillars.
  for (let z = -5.2; z <= 5.2; z += 1.3) {
    box(r, red, 2.57, 0.86, 0.1, 0, 0.6, z);
  }
  // Interior: floor, seats, overhead rails.
  box(r, paint(0x3c3c3c, 0.9, 0), 2.4, 0.05, L - 0.4, 0, -0.75, 0, false);
  const seatMat = paint(0x4b5d73, 0.7, 0);
  for (const z of [2.9, 1.7, -1.6, -2.8]) {
    for (const x of [0.8, -0.8]) {
      box(r, seatMat, 0.85, 0.12, 0.45, x, -0.42, z, false);
      box(r, seatMat, 0.85, 0.55, 0.08, x, -0.15, z - 0.24, false);
    }
  }
  for (const x of [0.3, -0.3])
    rod(r, CHROME(), 0.022, new THREE.Vector3(x, 1.05, 5.0), new THREE.Vector3(x, 1.05, -5.4));
  // Doors on the left (+X): open, dark interior, grab rails.
  for (const z of [4.3, -4.4]) {
    box(r, paint(0x111111, 0.9, 0), 0.06, 2.0, 1.05, 1.29, -0.05, z, false);
    rod(
      r,
      paint(0xd8c25a, 0.3, 0.6),
      0.025,
      new THREE.Vector3(1.24, -0.9, z - 0.48),
      new THREE.Vector3(1.24, 1.0, z - 0.48),
    );
    rod(
      r,
      paint(0xd8c25a, 0.3, 0.6),
      0.025,
      new THREE.Vector3(1.24, -0.9, z + 0.48),
      new THREE.Vector3(1.24, 1.0, z + 0.48),
    );
    box(r, grey, 0.35, 0.08, 1.0, 1.35, -0.95, z); // step
  }
  // Front: windscreen, route board, lights, bumper.
  box(r, GLASS(), 2.3, 1.05, 0.04, 0, 0.55, L / 2 + 0.01, false);
  const board = signTexture(
    [{ text: '123  कुलाबा · COLABA', size: 56, color: '#ffb000', weight: 700 }],
    '#120c02',
    512,
    96,
    { grime: false },
  );
  plane(r, board, 2.0, 0.36, 0, 1.2, L / 2 + 0.03, 0, 2.2);
  plane(r, board, 2.0, 0.36, 0, 1.2, -L / 2 - 0.03, Math.PI, 2.2);
  box(r, BLACK(), 2.6, 0.3, 0.15, 0, -0.85, L / 2 + 0.05);
  box(r, BLACK(), 2.6, 0.3, 0.15, 0, -0.85, -L / 2 - 0.05);
  for (const x of [0.95, -0.95]) {
    box(r, v.headMat, 0.32, 0.18, 0.05, x, -0.5, L / 2 + 0.03, false);
    box(r, v.tailMat, 0.25, 0.3, 0.05, x, -0.4, -L / 2 - 0.03, false);
  }
  // BEST livery on both sides.
  const livery = signTexture(
    [
      { text: 'BEST', size: 120, color: '#ffffff', font: 'display', weight: 400 },
      { text: 'बेस्ट', size: 64, color: '#ffffff' },
    ],
    '#c0151b',
    512,
    256,
    { seed: 8, grime: true },
  );
  plane(r, livery, 1.8, 0.9, 1.285, -0.38, 0.4, Math.PI / 2);
  plane(r, livery, 1.8, 0.9, -1.285, -0.38, 0.4, -Math.PI / 2);
  v.headlightAnchor.set(0, -0.5, L / 2 + 0.1);
}

function buildLorry(v: VehicleVisual): void {
  const r = v.root;
  const cab = paint(0xe8701a, 0.5, 0.1);
  const wood = paint(0x9b5a2a, 0.75, 0);
  const tarp = paint(0x1f6fd0, 0.7, 0);
  box(r, BLACK(), 1.9, 0.28, 8.2, 0, -0.62, 0);
  box(r, cab, 2.36, 1.75, 2.1, 0, 0.42, 3.0);
  box(r, GLASS(), 2.1, 0.75, 0.04, 0, 0.82, 4.06, false);
  box(r, GLASS(), 0.04, 0.6, 0.9, 1.19, 0.82, 3.2, false);
  box(r, GLASS(), 0.04, 0.6, 0.9, -1.19, 0.82, 3.2, false);
  // Painted visor ("eyebrow") and tassels.
  box(r, paint(0xd21f6c, 0.5, 0.1), 2.4, 0.22, 0.4, 0, 1.36, 3.95);
  box(r, paint(0x1aa36b, 0.5, 0.1), 2.4, 0.06, 0.42, 0, 1.24, 3.96);
  const tasselColors = [0xff2d55, 0xffcc00, 0x00b894, 0x0984e3, 0xe17055];
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), paint(tasselColors[i % 5]!, 0.6, 0));
    t.position.set(-1.0 + i * 0.25, -0.62, 4.12);
    t.rotation.x = Math.PI;
    r.add(t);
  }
  box(r, BLACK(), 2.4, 0.25, 0.15, 0, -0.5, 4.1);
  for (const x of [0.85, -0.85]) box(r, v.headMat, 0.28, 0.18, 0.05, x, -0.2, 4.08, false);
  // Cargo box: wooden sides, blue tarp heap.
  box(r, wood, 2.4, 0.08, 5.7, 0, -0.42, -1.0);
  box(r, wood, 0.08, 1.1, 5.7, 1.16, 0.15, -1.0);
  box(r, wood, 0.08, 1.1, 5.7, -1.16, 0.15, -1.0);
  box(r, wood, 2.4, 1.1, 0.08, 0, 0.15, 1.85);
  const heap = box(r, tarp, 2.2, 1.0, 5.3, 0, 0.75, -1.05);
  heap.scale.set(2.2, 1.0, 5.3);
  // Side art.
  const side = signTexture(
    [
      { text: 'जय महाराष्ट्र', size: 64, color: '#ffe066' },
      { text: 'NATIONAL PERMIT', size: 40, color: '#ffffff', font: 'display', weight: 400 },
    ],
    '#b2361b',
    512,
    192,
    { border: '#ffe066', seed: 12 },
  );
  plane(r, side, 2.6, 0.9, 1.205, 0.15, -1.0, Math.PI / 2);
  plane(r, side, 2.6, 0.9, -1.205, 0.15, -1.0, -Math.PI / 2);
  // The famous back panel.
  const back = signTexture(
    [
      { text: 'HORN OK PLEASE', size: 78, color: '#ffe066', font: 'display', weight: 400 },
      { text: 'USE DIPPER AT NIGHT', size: 40, color: '#ffffff', font: 'display', weight: 400 },
      { text: 'बुरी नज़र वाले तेरा मुँह काला', size: 30, color: '#ff8fab' },
    ],
    '#7a1fa2',
    512,
    256,
    { border: '#ffe066', seed: 13 },
  );
  box(r, wood, 2.4, 1.1, 0.08, 0, 0.15, -3.86);
  plane(r, back, 2.3, 1.05, 0, 0.15, -3.905, Math.PI);
  for (const x of [1.0, -1.0]) box(r, v.tailMat, 0.2, 0.12, 0.05, x, -0.55, -3.92, false);
  v.headlightAnchor.set(0, -0.2, 4.15);
}

function buildTaxi(v: VehicleVisual): void {
  const r = v.root;
  const black = paint(0x141414, 0.35, 0.3);
  const yellow = paint(0xf6c400, 0.4, 0.15);
  const chrome = CHROME();
  // Premier Padmini-style: rounded boxy sedan, black body, yellow roof.
  box(r, black, 1.55, 0.5, 4.0, 0, 0.02, 0);
  box(r, black, 1.52, 0.14, 1.1, 0, 0.32, 1.4);
  box(r, black, 1.52, 0.14, 0.9, 0, 0.32, -1.5);
  box(r, GLASS(), 1.38, 0.46, 1.8, 0, 0.52, -0.1, false);
  box(r, yellow, 1.42, 0.08, 1.7, 0, 0.78, -0.1);
  for (const x of [0.68, -0.68]) {
    box(r, yellow, 0.08, 0.46, 0.09, x, 0.52, 0.78);
    box(r, yellow, 0.08, 0.46, 0.09, x, 0.52, -0.98);
    box(r, chrome, 0.04, 0.04, 3.9, x * 1.14, 0.18, 0);
  }
  box(r, chrome, 1.6, 0.14, 0.12, 0, -0.17, 2.02);
  box(r, chrome, 1.6, 0.14, 0.12, 0, -0.17, -2.02);
  box(r, chrome, 0.9, 0.2, 0.04, 0, 0.06, 2.01);
  for (const x of [0.55, -0.55]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), v.headMat);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(x, 0.08, 2.02);
    r.add(hl);
    box(r, v.tailMat, 0.18, 0.2, 0.05, x * 1.15, 0.12, -2.01, false);
  }
  const sign = signTexture(
    [{ text: 'TAXI', size: 56, color: '#111', font: 'display', weight: 400 }],
    '#f6c400',
    256,
    96,
    { grime: false },
  );
  const s1 = plane(r, sign, 0.6, 0.22, 0, 0.95, -0.1, 0);
  const s2 = plane(r, sign, 0.6, 0.22, 0, 0.95, -0.1, Math.PI);
  void s1;
  void s2;
  box(r, BLACK(), 0.62, 0.24, 0.05, 0, 0.95, -0.1);
  const plate = signTexture(
    [{ text: 'MH 01 T 4517', size: 46, color: '#111', weight: 700 }],
    '#f6c400',
    256,
    64,
    { grime: false },
  );
  plane(r, plate, 0.5, 0.12, 0, -0.06, 2.09, 0);
  plane(r, plate, 0.5, 0.12, 0, -0.06, -2.09, Math.PI);
  v.headlightAnchor.set(0, 0.08, 2.05);
}

/**
 * Merge every static (non-wheel, non-light) mesh of a vehicle by material:
 * a vehicle drops from ~40 draw calls to ~8.
 */
function mergeStatic(v: VehicleVisual): void {
  const keep = new Set<THREE.Object3D>(v.wheelPivots);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  v.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(v.root.matrixWorld).invert();
  for (const child of [...v.root.children]) {
    if (keep.has(child) || !(child instanceof THREE.Mesh) || child.children.length) continue;
    const mat = child.material as THREE.Material;
    if (mat === v.headMat || mat === v.tailMat || (mat as THREE.MeshStandardMaterial).map) continue;
    const g = child.geometry
      .clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld));
    const list = groups.get(mat) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    groups.set(mat, list);
    victims.push(child);
  }
  for (const m of victims) v.root.remove(m);
  for (const [mat, list] of groups) {
    const merged = mergeGeometries(
      list.map((g) => {
        for (const k of Object.keys(g.attributes))
          if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        return g;
      }),
    );
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    v.root.add(mesh);
  }
}

export function buildVehicleVisual(profile: VehicleProfile, seed: number): VehicleVisual {
  const rnd = mulberry32(seed);
  const { headMat, tailMat } = lights();
  const v: VehicleVisual = {
    root: new THREE.Group(),
    wheelPivots: [],
    wheelSpinners: [],
    headMat,
    tailMat,
    headlightAnchor: new THREE.Vector3(0, 0, profile.chassis.halfExtents[2]),
  };
  switch (profile.mesh) {
    case 'hatchback':
      buildHatchback(profile, rnd, v);
      break;
    case 'auto':
      buildAuto(profile, v);
      break;
    case 'scooter':
      buildScooter(rnd, v);
      break;
    case 'bus':
      buildBus(v);
      break;
    case 'lorry':
      buildLorry(v);
      break;
    case 'taxi':
      buildTaxi(v);
      break;
    default: {
      const [hx, hy, hz] = profile.chassis.halfExtents;
      box(v.root, paint(0x888888), hx * 2, hy * 2, hz * 2, 0, 0, 0);
    }
  }
  for (const w of profile.wheels) {
    const { pivot, spinner } = wheel(w.radius, w.width, profile.class === 'bus' ? 0xb7b7b7 : 0x9a9a9a);
    pivot.position.set(...w.position);
    v.root.add(pivot);
    v.wheelPivots.push(pivot);
    v.wheelSpinners.push(spinner);
  }
  mergeStatic(v);
  return v;
}
