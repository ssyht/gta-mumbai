import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PhysicsWorld, Q4, V3 } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import {
  asphaltTexture,
  concreteTexture,
  kerbTexture,
  mulberry32,
  paverTexture,
  roadTexture,
  signTexture,
} from '../../render/materials/textures';
import { createSea } from '../../render/Water';
import type { Route } from '../../ai/WaypointDriver';
import { GreyboxBuildings } from '../buildings/GreyboxBuildings';
import { StreetLights } from '../props/StreetLights';

/**
 * M1 test track: a road loop on reclaimed land with the Arabian Sea to the
 * west (+X east, -Z north), a Marine-Drive-style promenade, BEST bus stops,
 * ramps, kerbs, speed breakers, a parkour corner and greybox chawls.
 * M2 replaces this with OSM-driven Colaba.
 */
export interface Spot {
  pos: THREE.Vector3;
  yaw: number;
}

export interface TestTrack {
  spawn: Spot;
  route: Route;
  parking: Record<'hatchback' | 'scooter' | 'lorry' | 'auto' | 'bus', Spot>;
  lights: StreetLights;
  buildingCount: number;
}

const ROAD_HALF = 6;
const LANE = 4.2; // kerb-lane offset from the centreline (India drives on the left)
const SEA_X = -40;
const SEA_LEVEL = -1.4;

interface PathPoint {
  p: THREE.Vector3;
  t: THREE.Vector3;
  s: number;
}

/** Rounded-rectangle loop, sampled every `step` m, traversed south on the west side. */
export function loopCenterline(step = 2): PathPoint[] {
  const R = 35;
  const pts: THREE.Vector3[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number): void => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step);
    for (let i = 0; i < n; i++)
      pts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n));
  };
  const arc = (cx: number, cz: number, a0: number, a1: number): void => {
    const n = Math.ceil((R * Math.abs(a1 - a0)) / step);
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector3(cx + R * Math.cos(a), 0, cz + R * Math.sin(a)));
    }
  };
  line(0, -115, 0, 115);
  arc(35, 115, Math.PI, Math.PI / 2);
  line(35, 150, 185, 150);
  arc(185, 115, Math.PI / 2, 0);
  line(220, 115, 220, -115);
  arc(185, -115, 0, -Math.PI / 2);
  line(185, -150, 35, -150);
  arc(35, -115, -Math.PI / 2, -Math.PI);
  let s = 0;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    if (i > 0) s += p.distanceTo(prev);
    return { p, t: next.clone().sub(prev).normalize(), s };
  });
}

const leftOf = (t: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(t.z, 0, -t.x);

function ribbon(
  path: PathPoint[],
  inner: number,
  outer: number,
  y: number,
  vScale: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const total = path[path.length - 1]!.s + path[path.length - 1]!.p.distanceTo(path[0]!.p);
  for (let i = 0; i <= path.length; i++) {
    const pp = path[i % path.length]!;
    const s = i === path.length ? total : pp.s;
    const l = leftOf(pp.t);
    const a = pp.p.clone().addScaledVector(l, inner);
    const b = pp.p.clone().addScaledVector(l, outer);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    uvs.push(0, s / vScale, 1, s / vScale);
    if (i < path.length) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // (inner, next inner, outer) winds counter-clockwise from above when inner < outer: faces up.
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Collects many static boxes per material into one InstancedMesh each. */
class BoxBatch {
  private readonly items: THREE.Matrix4[] = [];
  constructor(private readonly material: THREE.Material) {}
  add(physics: PhysicsWorld, center: V3, size: V3, rot?: THREE.Euler, collide = true): void {
    const q = rot ? new THREE.Quaternion().setFromEuler(rot) : new THREE.Quaternion();
    this.items.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(center.x, center.y, center.z),
        q,
        new THREE.Vector3(size.x, size.y, size.z),
      ),
    );
    if (collide) {
      physics.addStaticBox(center, { x: size.x / 2, y: size.y / 2, z: size.z / 2 }, {
        x: q.x,
        y: q.y,
        z: q.z,
        w: q.w,
      } as Q4);
    }
  }
  build(scene: THREE.Scene): void {
    if (!this.items.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, this.items.length);
    this.items.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
  }
}

const signBackMat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.8 });

function signMesh(tex: THREE.Texture, w: number, h: number, glow = 0): THREE.Mesh {
  const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7 });
  if (glow > 0) mat.emissiveNode = texture(tex, uv()).rgb.mul(lightUniforms.street.mul(glow));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.castShadow = true;
  // Plain painted back so text never reads mirrored.
  const back = new THREE.Mesh(m.geometry, signBackMat);
  back.rotation.y = Math.PI;
  back.position.z = -0.01;
  m.add(back);
  return m;
}

export function buildTestTrack(scene: THREE.Scene, physics: PhysicsWorld, maxPointLights: number): TestTrack {
  const rnd = mulberry32(1903);

  // --- Land, sea floor, sea -------------------------------------------------
  const asphalt = asphaltTexture();
  asphalt.repeat.set(144, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1440, 1600),
    new THREE.MeshStandardMaterial({ map: asphalt, color: 0xe6ddd0, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(SEA_X + 720, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  physics.addStaticBox({ x: SEA_X + 720, y: -0.5, z: 0 }, { x: 720, y: 0.5, z: 800 });
  physics.addStaticBox({ x: SEA_X - 1000, y: -7.5, z: 0 }, { x: 1000, y: 0.5, z: 800 });
  const sea = createSea(9000, 9000);
  sea.position.set(SEA_X - 4500, SEA_LEVEL, 0);
  scene.add(sea);

  // --- Road loop --------------------------------------------------------------
  const path = loopCenterline(2);
  const road = new THREE.Mesh(
    ribbon(path, -ROAD_HALF, ROAD_HALF, 0.015, 8),
    new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9 }),
  );
  road.receiveShadow = true;
  scene.add(road);
  const kerbTex = kerbTexture();
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.8 });
  for (const [a, b] of [
    [ROAD_HALF, ROAD_HALF + 0.35],
    [-ROAD_HALF - 0.35, -ROAD_HALF],
  ] as const) {
    const k = new THREE.Mesh(ribbon(path, a, b, 0.03, 2), kerbMat);
    k.receiveShadow = true;
    scene.add(k);
  }

  // Potholes (Mumbai special).
  const potholeMat = new THREE.MeshStandardMaterial({
    color: 0x1a1816,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const potholes = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10), potholeMat, 40);
  for (let i = 0; i < 40; i++) {
    const pp = path[Math.floor(rnd() * path.length)]!;
    const off = (rnd() - 0.5) * 9;
    const p = pp.p.clone().addScaledVector(leftOf(pp.t), off);
    const s = 0.3 + rnd() * 0.7;
    potholes.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, 0.024, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rnd() * 3)),
        new THREE.Vector3(s * (1 + rnd()), s, 1),
      ),
    );
  }
  potholes.receiveShadow = true;
  scene.add(potholes);

  // --- Promenade + sea wall + tetrapods --------------------------------------
  const pavers = paverTexture();
  pavers.repeat.set(16, 400);
  const promenade = new THREE.Mesh(
    new THREE.BoxGeometry(32.8, 0.15, 1600),
    new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.85 }),
  );
  promenade.position.set(-23.4, 0.075, 0);
  promenade.receiveShadow = true;
  scene.add(promenade);
  physics.addStaticBox({ x: -23.4, y: 0.075, z: 0 }, { x: 16.4, y: 0.075, z: 800 });
  const concrete = concreteTexture();
  concrete.repeat.set(1, 200);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 3.6, 1600),
    new THREE.MeshStandardMaterial({ map: concrete, color: 0xb9b3a8, roughness: 0.9 }),
  );
  wall.position.set(SEA_X - 0.35, -0.7, 0);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
  physics.addStaticBox({ x: SEA_X - 0.35, y: -0.7, z: 0 }, { x: 0.45, y: 1.8, z: 800 });

  const legs: THREE.BufferGeometry[] = [];
  const dirs = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(1, -1, -1),
  ];
  for (const d of dirs) {
    const c = new THREE.ConeGeometry(0.42, 1.25, 7);
    c.translate(0, 0.62, 0);
    c.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
    );
    legs.push(c);
  }
  const tetraGeo = mergeGeometries(legs)!;
  const tetraCount = 640;
  const tetras = new THREE.InstancedMesh(
    tetraGeo,
    new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 }),
    tetraCount,
  );
  for (let i = 0; i < tetraCount; i++) {
    const z = -400 + (i / tetraCount) * 800 + (rnd() - 0.5) * 1.5;
    const x = SEA_X - 1.6 - rnd() * 6;
    tetras.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, SEA_LEVEL - 0.3 + rnd() * 0.9, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
        new THREE.Vector3(1, 1, 1).multiplyScalar(0.9 + rnd() * 0.3),
      ),
    );
  }
  tetras.castShadow = true;
  tetras.receiveShadow = true;
  tetras.frustumCulled = false;
  scene.add(tetras);

  // Coconut palms along the promenade.
  const palmPositions: THREE.Vector3[] = [];
  for (let z = -300; z <= 300; z += 18 + rnd() * 6)
    palmPositions.push(new THREE.Vector3(-30 + rnd() * 3, 0.15, z));
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.26, 9, 7).translate(0, 4.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.95 }),
    palmPositions.length,
  );
  const frondGeo = new THREE.ConeGeometry(0.5, 3.6, 4).translate(0, 1.8, 0).scale(1, 1, 0.18);
  const fronds = new THREE.InstancedMesh(
    frondGeo,
    new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.8, side: THREE.DoubleSide }),
    palmPositions.length * 7,
  );
  palmPositions.forEach((p, i) => {
    const lean = new THREE.Euler((rnd() - 0.5) * 0.25, rnd() * 6, (rnd() - 0.5) * 0.25);
    const q = new THREE.Quaternion().setFromEuler(lean);
    trunk.setMatrixAt(i, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
    const top = new THREE.Vector3(0, 9, 0).applyQuaternion(q).add(p);
    for (let f = 0; f < 7; f++) {
      const fq = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(1.9 + rnd() * 0.4, (f / 7) * Math.PI * 2, 0, 'YXZ'),
      );
      fronds.setMatrixAt(i * 7 + f, new THREE.Matrix4().compose(top, fq, new THREE.Vector3(1, 1, 1)));
    }
    physics.addStaticCylinder({ x: p.x, y: 4.5, z: p.z }, 4.5, 0.22);
  });
  for (const im of [trunk, fronds]) {
    im.castShadow = true;
    im.frustumCulled = false;
    scene.add(im);
  }

  // --- Static props: sidewalks, ramps, walls, crates --------------------------
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 });
  const concreteBatch = new BoxBatch(concreteMat);
  const paverBatch = new BoxBatch(new THREE.MeshStandardMaterial({ map: paverTexture(), roughness: 0.85 }));
  const kerbBatch = new BoxBatch(kerbMat);
  const crateBatch = new BoxBatch(new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.85 }));

  // Inner sidewalks at the two bus stops.
  paverBatch.add(physics, { x: 7.8, y: 0.075, z: 45 }, { x: 3, y: 0.15, z: 50 });
  paverBatch.add(physics, { x: 212.2, y: 0.075, z: -45 }, { x: 3, y: 0.15, z: 50 });
  // Auto stand bay (asphalt patch, flush).
  const bay = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 16),
    new THREE.MeshStandardMaterial({
      map: roadTexture(),
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(8.4, 0.012, 6);
  bay.receiveShadow = true;
  scene.add(bay);

  // Parkour corner: vault walls, a climb wall, crates, a platform.
  concreteBatch.add(physics, { x: 24, y: 0.45, z: 56 }, { x: 4, y: 0.9, z: 0.4 });
  concreteBatch.add(physics, { x: 31, y: 0.6, z: 56 }, { x: 4, y: 1.2, z: 0.4 });
  concreteBatch.add(physics, { x: 38, y: 0.9, z: 56 }, { x: 4, y: 1.8, z: 1.4 });
  crateBatch.add(physics, { x: 24, y: 0.5, z: 64 }, { x: 1, y: 1, z: 1 });
  crateBatch.add(physics, { x: 25.1, y: 0.5, z: 64 }, { x: 1, y: 1, z: 1 });
  crateBatch.add(physics, { x: 24.5, y: 1.5, z: 64 }, { x: 1, y: 1, z: 1 });
  concreteBatch.add(physics, { x: 33, y: 0.8, z: 66 }, { x: 5, y: 1.6, z: 4 });
  concreteBatch.add(physics, { x: 33, y: 2.4, z: 70.5 }, { x: 5, y: 4.8, z: 5 });

  // Ramps (drive east to use them).
  const ramp = (cx: number, cz: number, len: number, width: number, deg: number, dir: 1 | -1): void => {
    const a = (deg * Math.PI) / 180;
    const th = 0.4;
    const y = (len / 2) * Math.sin(a) - (th / 2) * Math.cos(a) + 0.02;
    concreteBatch.add(
      physics,
      { x: cx, y, z: cz },
      { x: len, y: th, z: width },
      new THREE.Euler(0, 0, a * dir),
    );
  };
  ramp(70, -60, 9, 7, 8, 1);
  ramp(95, -60, 10, 7, 14, 1);
  ramp(125, -60, 10, 8, 19, 1);
  ramp(158, -60, 12, 8, 14, -1);
  // Banked slope.
  concreteBatch.add(
    physics,
    { x: 160, y: 1.0, z: 60 },
    { x: 14, y: 0.4, z: 24 },
    new THREE.Euler(0.17, 0, 0),
  );
  // Washboard rumble kerbs.
  for (let i = 0; i < 10; i++)
    kerbBatch.add(physics, { x: 95, y: 0.06, z: 30 + i * 3 }, { x: 8, y: 0.12, z: 0.6 });
  // Speed breakers across the north and south roads.
  for (const x of [70, 120]) {
    for (const z of [-150, 150]) {
      kerbBatch.add(physics, { x, y: 0.05, z }, { x: 0.9, y: 0.1, z: ROAD_HALF * 2 }, undefined, true);
    }
  }

  // --- Bus stops ---------------------------------------------------------------
  const stopSign = signTexture(
    [
      { text: 'BEST', size: 70, color: '#ffffff', font: 'display', weight: 400 },
      { text: 'बस थांबा · BUS STOP', size: 42, color: '#ffffff' },
      { text: '123  ·  124  ·  138  ·  C-86', size: 34, color: '#ffd54f', weight: 600 },
    ],
    '#c0151b',
    512,
    300,
    { seed: 31 },
  );
  const busStop = (x: number, z: number, facing: 1 | -1, name: string): void => {
    const g = new THREE.Group();
    g.position.set(x, 0.15, z);
    g.rotation.y = facing === 1 ? -Math.PI / 2 : Math.PI / 2;
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.4, metalness: 0.7 });
    for (const px of [-2.8, 2.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), steel);
      post.position.set(px, 1.3, -0.9);
      post.castShadow = true;
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.1, 2.3), steel);
    roof.position.set(0, 2.65, -0.3);
    roof.rotation.x = 0.06;
    roof.castShadow = true;
    g.add(roof);
    const panel = signMesh(stopSign, 3.2, 1.9, 1.2);
    panel.position.set(0, 1.45, -1.0);
    g.add(panel);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.5), steel);
    bench.position.set(0, 0.48, -0.6);
    g.add(bench);
    const nameTex = signTexture([{ text: name, size: 40, color: '#111', weight: 700 }], '#f2f2f2', 512, 64, {
      grime: false,
    });
    const nameBoard = signMesh(nameTex, 3, 0.38);
    nameBoard.position.set(0, 2.45, 0.86);
    nameBoard.rotation.y = Math.PI;
    g.add(nameBoard);
    scene.add(g);
    const back = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
    physics.addStaticBox(
      { x: x + back.x * 1.0, y: 1.45, z: z + back.z * 1.0 },
      { x: Math.abs(back.z) * 1.6 + 0.05, y: 1.3, z: Math.abs(back.x) * 1.6 + 0.05 },
    );
  };
  busStop(8.6, 45, 1, 'Apollo Bunder Test Stop');
  busStop(211.4, -45, -1, 'Kala Ghoda Test Stop');

  // --- Hoarding --------------------------------------------------------------
  const hoardingTex = signTexture(
    [
      { text: 'MUMBAI MERI JAAN', size: 96, color: '#ffd400', font: 'display', weight: 400 },
      { text: 'मुंबई · in cinemas this Friday', size: 46, color: '#ffffff' },
    ],
    '#7b1030',
    1024,
    400,
    { border: '#ffd400', seed: 77 },
  );
  const hoarding = signMesh(hoardingTex, 14, 5.5, 2.2);
  hoarding.position.set(240, 11, 60);
  hoarding.rotation.y = -Math.PI / 2;
  scene.add(hoarding);
  concreteBatch.add(physics, { x: 240.3, y: 4.5, z: 55 }, { x: 0.4, y: 9, z: 0.4 });
  concreteBatch.add(physics, { x: 240.3, y: 4.5, z: 65 }, { x: 0.4, y: 9, z: 0.4 });

  // --- Buildings -------------------------------------------------------------
  const buildings = new GreyboxBuildings(scene, physics);
  const row = (
    fixed: number,
    axis: 'x' | 'z',
    from: number,
    to: number,
    depth: number,
    floors: [number, number],
    style: 'chawl' | 'apartment' | 'tower',
    collider = true,
  ): Array<{ x: number; z: number; w: number; d: number }> => {
    const out: Array<{ x: number; z: number; w: number; d: number }> = [];
    let c = from;
    while (c < to) {
      const w = 10 + rnd() * 14;
      const f = floors[0] + Math.floor(rnd() * (floors[1] - floors[0] + 1));
      const center = c + w / 2;
      const spec =
        axis === 'z'
          ? { x: fixed, z: center, w: depth, d: w, floors: f, style, collider }
          : { x: center, z: fixed, w, d: depth, floors: f, style, collider };
      buildings.add(spec);
      out.push({ x: spec.x, z: spec.z, w: spec.w, d: spec.d });
      c += w + 2 + rnd() * 5;
    }
    return out;
  };
  const eastFront = row(244, 'z', -140, 140, 14, [3, 5], 'chawl');
  row(272, 'z', -150, 150, 16, [4, 7], 'chawl');
  row(302, 'z', -160, 160, 18, [6, 12], 'apartment');
  row(340, 'z', -200, 200, 22, [10, 18], 'apartment');
  row(-182, 'x', 10, 230, 14, [3, 5], 'chawl');
  row(-212, 'x', 0, 240, 18, [5, 10], 'apartment');
  row(182, 'x', 10, 230, 14, [3, 5], 'chawl');
  row(212, 'x', 0, 240, 18, [5, 10], 'apartment');
  row(-122, 'x', 60, 170, 12, [2, 4], 'chawl');
  row(122, 'x', 60, 170, 12, [2, 4], 'chawl');
  // Distant skyline (no colliders).
  for (let i = 0; i < 46; i++) {
    buildings.add({
      x: 480 + rnd() * 800,
      z: -900 + rnd() * 1800,
      w: 22 + rnd() * 20,
      d: 22 + rnd() * 20,
      floors: 15 + Math.floor(rnd() * 32),
      style: 'tower',
      collider: false,
    });
  }
  buildings.build();

  // Shop boards on the chawl ground floors facing the road.
  const shops = [
    { t: 'VADA PAV CENTRE', d: 'वडा पाव', bg: '#f9a825' },
    { t: 'SHREE GANESH CHAI', d: 'चहा', bg: '#2e7d32' },
    { t: 'MEDICAL & GENERAL', d: 'मेडिकल', bg: '#1565c0' },
    { t: 'XEROX · STD · ISD', d: 'झेरॉक्स', bg: '#6a1b9a' },
    { t: 'KHANA KHAZANA', d: 'खाना खजाना', bg: '#c62828' },
    { t: 'MOBILE REPAIRING', d: 'मोबाईल', bg: '#00838f' },
  ];
  eastFront.forEach((b, i) => {
    const s = shops[i % shops.length]!;
    const tex = signTexture(
      [
        { text: s.t, size: 54, color: '#ffffff', font: 'display', weight: 400 },
        { text: s.d, size: 40, color: '#fff59d' },
      ],
      s.bg,
      512,
      160,
      { seed: 100 + i },
    );
    const board = signMesh(tex, Math.min(b.d - 1, 7), 1.6, 1.6);
    board.position.set(b.x - b.w / 2 - 0.06, 3.9, b.z);
    board.rotation.y = -Math.PI / 2;
    scene.add(board);
  });

  // --- Street lights + overhead wires -----------------------------------------
  const lights = new StreetLights(scene, physics, maxPointLights);
  for (let i = 0; i < path.length; i += 14) {
    const pp = path[i]!;
    const l = leftOf(pp.t);
    for (const side of [1, -1]) {
      const pos = pp.p.clone().addScaledVector(l, side * (ROAD_HALF + 1.2));
      if (side === 1 && Math.abs(pos.x - 8.6) < 4 && Math.abs(pos.z - 45) < 5) continue; // bus stop
      lights.add({ position: pos.setY(0), facing: l.clone().multiplyScalar(-side), kind: 'sodium' });
    }
  }
  for (let z = -300; z <= 300; z += 25) {
    lights.add({
      position: new THREE.Vector3(-37.6, 0.15, z),
      facing: new THREE.Vector3(1, 0, 0),
      kind: 'led',
    });
  }
  lights.build();

  // Sagging, tangled overhead wires along the chawl row.
  const wirePts: number[] = [];
  const poleZs: number[] = [];
  for (let z = -140; z <= 140; z += 22) poleZs.push(z);
  for (let i = 0; i < poleZs.length - 1; i++) {
    const z0 = poleZs[i]!;
    const z1 = poleZs[i + 1]!;
    const wires = 3 + Math.floor(rnd() * 4);
    for (let w = 0; w < wires; w++) {
      const y0 = 6.2 + rnd() * 1.4;
      const y1 = 6.2 + rnd() * 1.4;
      const sag = 0.4 + rnd() * 1.1;
      const x0 = 235.5 + rnd() * 0.6;
      const x1 = 235.5 + rnd() * 0.6;
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const yAt = (t: number): number => y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
        wirePts.push(
          x0 + (x1 - x0) * t0,
          yAt(t0),
          z0 + (z1 - z0) * t0,
          x0 + (x1 - x0) * t1,
          yAt(t1),
          z0 + (z1 - z0) * t1,
        );
      }
    }
    // A few drops to the buildings.
    if (rnd() < 0.7) {
      const zb = z0 + rnd() * (z1 - z0);
      wirePts.push(235.8, 6.6, zb, 237, 5.4 + rnd(), zb + (rnd() - 0.5) * 3);
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wiresMesh = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x141414 }));
  wiresMesh.frustumCulled = false;
  scene.add(wiresMesh);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 });
  for (const z of poleZs) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 8, 6), woodMat);
    pole.position.set(235.8, 4, z);
    pole.castShadow = true;
    scene.add(pole);
    physics.addStaticCylinder({ x: 235.8, y: 4, z }, 4, 0.13);
  }

  concreteBatch.build(scene);
  paverBatch.build(scene);
  kerbBatch.build(scene);
  crateBatch.build(scene);

  // --- Route for AI drivers (kerb lane) --------------------------------------
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < path.length; i += 4) {
    const pp = path[i]!;
    points.push(pp.p.clone().addScaledVector(leftOf(pp.t), LANE));
  }
  const nearestIdx = (x: number, z: number): number => {
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const route: Route = {
    points,
    stops: [
      { index: nearestIdx(LANE, 45), dwell: 7, name: 'Apollo Bunder Test Stop' },
      { index: nearestIdx(220 - LANE, -45), dwell: 7, name: 'Kala Ghoda Test Stop' },
    ],
  };

  return {
    spawn: { pos: new THREE.Vector3(13, 0.2, 38), yaw: -Math.PI / 2 },
    route,
    parking: {
      hatchback: { pos: new THREE.Vector3(20, 0, 26), yaw: Math.PI },
      scooter: { pos: new THREE.Vector3(16.5, 0, 31), yaw: Math.PI },
      lorry: { pos: new THREE.Vector3(36, 0, 12), yaw: Math.PI },
      auto: { pos: new THREE.Vector3(8.6, 0, 6), yaw: 0 },
      bus: { pos: new THREE.Vector3(LANE, 0, 22), yaw: 0 },
    },
    lights,
    buildingCount: buildings.count,
  };
}
