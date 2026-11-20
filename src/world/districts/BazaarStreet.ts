import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import { asphaltTexture, kerbTexture, mulberry32, paverTexture } from '../../render/materials/textures';
import { posterTexture, SignAtlas, type SignSpec } from '../../render/materials/streetTextures';
import { StreetBuildings, type FacadeStyle } from '../buildings/StreetBuildings';
import { buildStreetDressing } from '../props/StreetProps';
import type { StreetLights } from '../props/StreetLights';
import { Vegetation } from '../props/Vegetation';
import type { CrowdArea } from '../../actors/npcs/Crowd';

/**
 * The hero bazaar street: a dense, lived-in Mumbai road running east from the
 * spawn. Colonial/chawl/shophouse facades, shops with shutters and boards,
 * food carts, umbrellas, plastic chairs, bunting, wires, palms and shade
 * trees, hoardings, litter and puddles, parked taxis and autos, and a crowd.
 * Street frame: carriageway along X centred on z = 0.
 */
export const STREET = {
  x0: 6,
  x1: 214,
  roadHalf: 6,
  kerb: 0.25,
  pavement: 3.25,
  curbH: 0.18,
} as const;
const FACE_Z = STREET.roadHalf + STREET.kerb + STREET.pavement; // 9.5

export interface ParkedSpot {
  profile: string;
  id: string;
  pos: THREE.Vector3;
  yaw: number;
}

export interface BazaarStreet {
  spawn: { pos: THREE.Vector3; yaw: number };
  parked: ParkedSpot[];
  crowdArea: CrowdArea;
  idleSpots: THREE.Vector3[];
  shopFronts: Array<{ pos: THREE.Vector3; name: string; restaurant: boolean }>;
}

const SHOPS: SignSpec[] = [
  { dev: 'वडा पाव सेंटर', text: 'VADA PAV CENTRE', bg: '#f9a825', fg: '#3e2723', accent: '#b71c1c' },
  { dev: 'श्री गणेश चहा', text: 'SHREE GANESH CHAI', bg: '#2e7d32' },
  { dev: 'मेडिकल', text: 'NEW LIFE MEDICAL · 24 HRS', bg: '#1565c0' },
  { dev: 'झेरॉक्स', text: 'XEROX · STD · ISD', bg: '#6a1b9a' },
  { dev: 'खाना खजाना', text: 'KHANA KHAZANA', bg: '#c62828' },
  { dev: 'मोबाईल रिपेअर', text: 'MOBILE REPAIRING', bg: '#00838f' },
  { dev: 'साडी महल', text: 'SAREE MAHAL', bg: '#ad1457' },
  { dev: 'किराणा स्टोअर', text: 'PATIL KIRANA STORES', bg: '#ef6c00' },
  { dev: 'हेअर कटिंग सलून', text: 'STYLE HAIR CUTTING SALOON', bg: '#283593' },
  { dev: 'सोने चांदी', text: 'LAXMI JEWELLERS', bg: '#bf9000', fg: '#3e2723' },
  { dev: 'बेकरी', text: 'IRANI BAKERY & CAFE', bg: '#4e342e' },
  { dev: 'हार्डवेअर', text: 'BOMBAY HARDWARE', bg: '#455a64' },
  { dev: 'फुल भंडार', text: 'GULAB FLOWER MART', bg: '#d81b60' },
  { dev: 'पान शॉप', text: 'BANARASI PAAN', bg: '#33691e' },
  { dev: 'टेलर्स', text: 'FAMOUS TAILORS', bg: '#5d4037' },
  { dev: 'चष्मा घर', text: 'OPTICIANS', bg: '#0277bd' },
  { dev: 'स्वीट मार्ट', text: 'MATHURA SWEET MART', bg: '#e65100' },
  { dev: 'ज्यूस सेंटर', text: 'FRESH JUICE CENTRE', bg: '#7cb342', fg: '#1b5e20' },
];
const UPPER: SignSpec[] = [
  { dev: 'डॉ. मेहता क्लिनिक', text: 'DR. MEHTA CLINIC', bg: '#ffffff', fg: '#0d47a1', accent: '#0d47a1' },
  { dev: 'शिकवणी वर्ग', text: 'TUITION CLASSES · STD 8-12', bg: '#fff59d', fg: '#1a237e', accent: '#1a237e' },
  { dev: 'वकील', text: 'ADV. R. DESAI · LAWYER', bg: '#eceff1', fg: '#263238', accent: '#263238' },
  { dev: 'योग केंद्र', text: 'SHANTI YOGA KENDRA', bg: '#ffe0b2', fg: '#bf360c', accent: '#bf360c' },
];
const MENUS: SignSpec[] = [
  {
    dev: 'भेळ · पाणीपुरी',
    text: 'BHEL · PANI PURI · SEV PURI',
    bg: '#fff8e1',
    fg: '#2e7d32',
    accent: '#c62828',
  },
  { dev: 'वडा पाव', text: 'VADA PAV · SAMOSA PAV', bg: '#ffecb3', fg: '#bf360c', accent: '#bf360c' },
  { dev: 'पाव भाजी', text: 'PAV BHAJI · TAWA PULAO', bg: '#e3f2fd', fg: '#0d47a1', accent: '#0d47a1' },
  { dev: 'ऊस रस', text: 'SUGARCANE JUICE ₹20', bg: '#f1f8e9', fg: '#33691e', accent: '#33691e' },
  { dev: 'कुल्फी', text: 'MATKA KULFI · FALOODA', bg: '#fce4ec', fg: '#880e4f', accent: '#880e4f' },
];
const PLASTERS = [
  0xe8d9b5, 0xd9a6a0, 0xa9c4c9, 0xc9d6a3, 0xf0e8d8, 0xe2b77a, 0xb8b2d6, 0x9fd3c7, 0xf4c27a, 0x8fb8de,
  0xe6a3b5, 0xdcdcdc,
];
const TRIMS = [0xf2efe8, 0xe9e2d0, 0xd7d2c8, 0xfaf6ee];

export function buildBazaarStreet(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  lights: StreetLights,
): BazaarStreet {
  const rnd = mulberry32(1947);
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  const len = STREET.x1 - STREET.x0;
  const cx = (STREET.x0 + STREET.x1) / 2;

  // --- Surfaces -------------------------------------------------------------
  const asphalt = asphaltTexture();
  asphalt.repeat.set(len / 7, 12 / 7);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(len, STREET.roadHalf * 2),
    new THREE.MeshStandardMaterial({
      map: asphalt,
      color: 0xcabca6,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(cx, 0.016, 0);
  road.receiveShadow = true;
  scene.add(road);
  const pav = paverTexture();
  pav.repeat.set(len / 2, STREET.pavement / 2);
  const kerbTex = kerbTexture();
  kerbTex.repeat.set(len / 2, 1);
  for (const side of [-1, 1]) {
    const zPav = side * (STREET.roadHalf + STREET.kerb + STREET.pavement / 2);
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(len, STREET.curbH, STREET.pavement),
      new THREE.MeshStandardMaterial({ map: pav, color: 0xf0dcc4, roughness: 0.85 }),
    );
    p.position.set(cx, STREET.curbH / 2, zPav);
    p.receiveShadow = true;
    scene.add(p);
    physics.addStaticBox(
      { x: cx, y: STREET.curbH / 2, z: zPav },
      { x: len / 2, y: STREET.curbH / 2, z: STREET.pavement / 2 },
    );
    const zK = side * (STREET.roadHalf + STREET.kerb / 2);
    const k = new THREE.Mesh(
      new THREE.BoxGeometry(len, STREET.curbH + 0.02, STREET.kerb),
      new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.8 }),
    );
    k.position.set(cx, (STREET.curbH + 0.02) / 2, zK);
    k.receiveShadow = true;
    scene.add(k);
    physics.addStaticBox(
      { x: cx, y: (STREET.curbH + 0.02) / 2, z: zK },
      { x: len / 2, y: (STREET.curbH + 0.02) / 2, z: STREET.kerb / 2 },
    );
  }

  // --- Facades -------------------------------------------------------------
  const atlas = new SignAtlas();
  const kit = new StreetBuildings(physics, atlas);
  const gullies: number[] = [];
  for (const side of [-1, 1] as const) {
    let x = STREET.x0 + 6;
    let i = 0;
    while (x < STREET.x1 - 14) {
      const style: FacadeStyle = rnd() < 0.22 ? 'colonial' : rnd() < 0.45 ? 'chawl' : 'shophouse';
      const width = style === 'colonial' ? 20 + rnd() * 10 : 9 + rnd() * 9;
      const floors =
        style === 'colonial'
          ? 3 + Math.floor(rnd() * 2)
          : style === 'chawl'
            ? 3 + Math.floor(rnd() * 2)
            : 2 + Math.floor(rnd() * 3);
      const shops = Array.from({ length: 8 }, () => pick(SHOPS));
      kit.add({
        x0: x,
        width,
        side,
        faceZ: FACE_Z,
        depth: 13 + rnd() * 4,
        floors,
        style,
        plaster: style === 'colonial' ? pick([0xd8d3c8, 0xc9c4b8, 0xe0d6c2, 0xbfc6c4]) : pick(PLASTERS),
        trim: pick(TRIMS),
        tower: style === 'colonial' && rnd() < 0.7,
        shops,
        ...(style === 'shophouse' && rnd() < 0.5 ? { upperSign: pick(UPPER) } : {}),
      });
      x += width;
      // Narrow gullies between some buildings.
      if (rnd() < 0.35) {
        gullies.push(x + 1.2);
        x += 2.4;
      }
      i++;
    }
    void i;
  }

  // --- Street furniture ------------------------------------------------------
  const idleSpots: THREE.Vector3[] = [];
  const veg = new Vegetation();
  const pavY = STREET.curbH;
  const zPavEdge = STREET.roadHalf + STREET.kerb + 1.0;
  let cartSide = -1;
  for (let x = STREET.x0 + 16; x < STREET.x1 - 10; x += 22 + rnd() * 10) {
    const z = cartSide * zPavEdge;
    kit.addCart(x, z, cartSide === -1 ? 0 : Math.PI, pick(MENUS), pavY);
    kit.addUmbrella(x + 2.6, cartSide * (FACE_Z - 1.4), pavY);
    for (let c = 0; c < 3; c++) {
      kit.addChair(
        x - 1.5 + c * 1.2 + rnd() * 0.3,
        cartSide * (FACE_Z - 1.0 - rnd() * 0.8),
        rnd() * 6,
        pick([0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825]),
        pavY,
      );
    }
    for (let k = 0; k < 3; k++)
      idleSpots.push(new THREE.Vector3(x - 1 + rnd() * 2, pavY, cartSide * (zPavEdge + 1.1 + rnd() * 0.5)));
    cartSide *= -1;
  }
  // Shade trees and palms on the pavements.
  for (let x = STREET.x0 + 10; x < STREET.x1 - 6; x += 26 + rnd() * 8) {
    const side = rnd() < 0.5 ? -1 : 1;
    if (rnd() < 0.55)
      veg.addTree(
        new THREE.Vector3(x, pavY, side * (STREET.roadHalf + STREET.kerb + 0.7)),
        0.9 + rnd() * 0.35,
      );
    else
      veg.addPalm(new THREE.Vector3(x, pavY, side * (STREET.roadHalf + STREET.kerb + 0.7)), 10 + rnd() * 5);
  }
  // A grove of palms framing the far end, like a colonial square.
  for (let k = 0; k < 6; k++)
    veg.addPalm(new THREE.Vector3(STREET.x1 - 2 + rnd() * 2, 0, -18 + k * 7 + rnd() * 2), 12 + rnd() * 5);
  veg.build(scene, physics);

  // Bunting across the street (festival season).
  const palettes = [
    [0xffd600, 0xffd600, 0xfff176],
    [0xff4081, 0xffd600, 0x40c4ff, 0x69f0ae, 0xff6e40],
    [0xff9100, 0xffffff, 0x00c853],
  ];
  for (let x = STREET.x0 + 12; x < STREET.x1 - 8; x += 9 + rnd() * 6) {
    const pal = palettes[Math.floor(rnd() * palettes.length)]!;
    kit.addBunting(
      new THREE.Vector3(x, 7.0 + rnd(), -FACE_Z + 0.2),
      new THREE.Vector3(x + (rnd() - 0.5) * 8, 7.0 + rnd(), FACE_Z - 0.2),
      pal,
    );
  }
  kit.build(scene);

  // Overhead wires: across the street and along the facades.
  const wires: number[] = [];
  const catenary = (a: THREE.Vector3, b: THREE.Vector3, sag: number): void => {
    const segs = 12;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const p0 = a.clone().lerp(b, t0);
      const p1 = a.clone().lerp(b, t1);
      p0.y -= sag * 4 * t0 * (1 - t0);
      p1.y -= sag * 4 * t1 * (1 - t1);
      wires.push(...p0.toArray(), ...p1.toArray());
    }
  };
  for (let x = STREET.x0 + 8; x < STREET.x1; x += 5 + rnd() * 7) {
    catenary(
      new THREE.Vector3(x, 6 + rnd() * 2, -FACE_Z + 0.3),
      new THREE.Vector3(x + (rnd() - 0.5) * 10, 6 + rnd() * 2, FACE_Z - 0.3),
      0.6 + rnd() * 1.2,
    );
  }
  for (const side of [-1, 1]) {
    for (let w = 0; w < 4; w++) {
      const y = 5 + w * 0.5 + rnd() * 0.3;
      for (let x = STREET.x0 + 6; x < STREET.x1 - 10; x += 14) {
        catenary(
          new THREE.Vector3(x, y, side * (FACE_Z - 0.6 - w * 0.15)),
          new THREE.Vector3(x + 14, y + (rnd() - 0.5) * 0.4, side * (FACE_Z - 0.6 - w * 0.15)),
          0.3 + rnd() * 0.5,
        );
      }
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  const wireMesh = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x111111 }));
  wireMesh.frustumCulled = false;
  scene.add(wireMesh);

  // Hand-painted film hoardings on rooftops (original films, original art).
  const posters = [
    posterTexture('ZINDAGI EXPRESS', 'ज़िंदगी एक्सप्रेस', ['#0b4f6c', '#01baef', '#ff7f11'], 3),
    posterTexture('BAMBAI KI RAAT', 'बम्बई की रात', ['#3a0ca3', '#f72585', '#ffd60a'], 9),
    posterTexture('PHIR MILENGE', 'फिर मिलेंगे', ['#014f43', '#2ec4b6', '#ffbf69'], 21),
  ];
  const hoardingSpots: Array<[number, number, number, number]> = [
    [60, 13.8, FACE_Z + 2, Math.PI],
    [128, 15.2, -FACE_Z - 2, 0],
    [180, 13.5, FACE_Z + 2, Math.PI],
  ];
  hoardingSpots.forEach(([hx, hy, hz, ry], i) => {
    const tex = posters[i % posters.length]!;
    const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.75 });
    mat.emissiveNode = texture(tex, uv()).rgb.mul(lightUniforms.street.mul(1.4));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.25), mat);
    board.position.set(hx, hy, hz);
    board.rotation.y = ry;
    board.castShadow = true;
    scene.add(board);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(16.4, 6.6, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.5 }),
    );
    frame.position.set(hx, hy, hz - Math.cos(ry) * 0.15);
    frame.rotation.y = ry;
    frame.castShadow = true;
    scene.add(frame);
    // Steel legs down to the roof.
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.6 });
    for (const dx of [-6, 0, 6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, hy - 3, 0.2), legMat);
      leg.position.set(hx + dx, (hy - 3) / 2, hz + (ry === 0 ? -0.6 : 0.6));
      leg.castShadow = true;
      scene.add(leg);
    }
  });

  // Street lamps on both pavements.
  for (let x = STREET.x0 + 14; x < STREET.x1 - 4; x += 30) {
    lights.add({
      position: new THREE.Vector3(x, pavY, -(STREET.roadHalf + STREET.kerb + 0.35)),
      facing: new THREE.Vector3(0, 0, 1),
      kind: 'sodium',
    });
    lights.add({
      position: new THREE.Vector3(x + 15, pavY, STREET.roadHalf + STREET.kerb + 0.35),
      facing: new THREE.Vector3(0, 0, -1),
      kind: 'sodium',
    });
  }
  for (const p of kit.dressing.practicals)
    lights.add({ position: p.pos, facing: new THREE.Vector3(0, 0, 1), kind: p.kind });

  buildStreetDressing(scene, kit.dressing, [
    { x0: STREET.x0 + 2, x1: STREET.x1, z0: -STREET.roadHalf, z1: STREET.roadHalf, y: 0.016 },
    { x0: STREET.x0 + 2, x1: STREET.x1, z0: -FACE_Z, z1: -STREET.roadHalf - STREET.kerb, y: pavY },
    { x0: STREET.x0 + 2, x1: STREET.x1, z0: STREET.roadHalf + STREET.kerb, z1: FACE_Z, y: pavY },
  ]);

  // Parked vehicles along the kerbs (eastbound park north, westbound south: India drives on the left).
  const kerbLane = STREET.roadHalf - 1.5;
  const parked: ParkedSpot[] = [];
  const lineup: Array<[string, number, number]> = [
    ['taxi', 30, -1],
    ['auto-rickshaw', 40, -1],
    ['hatchback', 58, 1],
    ['taxi', 74, 1],
    ['scooter', 86, -1],
    ['auto-rickshaw', 96, 1],
    ['taxi', 112, -1],
    ['scooter', 124, 1],
    ['auto-rickshaw', 140, -1],
  ];
  lineup.forEach(([profile, x, side], i) => {
    parked.push({
      profile,
      id: `${profile}-${i}`,
      pos: new THREE.Vector3(x, 0, side * kerbLane),
      yaw: side === -1 ? Math.PI / 2 : -Math.PI / 2,
    });
  });

  return {
    spawn: {
      pos: new THREE.Vector3(14, pavY + 0.05, -(STREET.roadHalf + STREET.kerb + 1.6)),
      yaw: Math.PI / 2,
    },
    parked,
    crowdArea: {
      x0: STREET.x0 + 8,
      x1: STREET.x1 - 8,
      lanes: [-(STREET.roadHalf + STREET.kerb + 1.9), STREET.roadHalf + STREET.kerb + 1.9],
      streetZ: 0,
      roadHalf: STREET.roadHalf + STREET.kerb,
      groundY: pavY,
    },
    idleSpots,
    shopFronts: kit.dressing.shopFronts,
  };
}
