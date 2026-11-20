import * as THREE from 'three/webgpu';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { Groups } from '../../physics/layers';
import { asphaltTexture, concreteTexture, mulberry32, paverTexture } from '../../render/materials/textures';
import { roofTileTexture } from '../../render/materials/streetTextures';
import { createSea } from '../../render/Water';
import { Bucket, createPlasterMaterial, FACADE_CELL } from '../buildings/StreetBuildings';
import type { StreetLights } from '../props/StreetLights';
import { Vegetation } from '../props/Vegetation';
import type { RoadPolyline } from '../roads/LaneGraph';

/**
 * M2 Colaba / Apollo Bunder from real OpenStreetMap data (CLAUDE.md §2, §9).
 * `public/data/colaba.json` is produced by tools/osm-fetch.ts + osm-to-world.ts.
 * Local frame: Gateway of India at (0, 0), +X east, -Z north, metres (1:1).
 * Landmarks are scenery only: no 26/11 content anywhere (CLAUDE.md §2).
 */
type Pt = [number, number];
interface DistrictData {
  attribution: string;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  grid: { cell: number; cols: number; rows: number; minX: number; minZ: number; mask: number[][] };
  roads: Array<{ cls: string; w: number; pts: Pt[]; name?: string }>;
  buildings: Array<{ pts: Pt[]; h: number; levels: number; kind?: string; name?: string }>;
  coast: Pt[][];
}

export interface ColabaDistrict {
  /** World position of the Gateway of India. */
  gateway: THREE.Vector3;
  offset: THREE.Vector3;
  bounds: THREE.Box2;
  parked: Array<{ profile: string; id: string; pos: THREE.Vector3; yaw: number }>;
  attribution: string;
  /** Road centre lines in world space, for the lane graph. */
  roads: RoadPolyline[];
}

/** Collision height of Colaba land; roads are drawn in a thin band around it. */
const LAND_Y = 0.045;
const ROAD_Y: Record<string, number> = {
  primary: 0.052,
  primary_link: 0.0515,
  secondary: 0.051,
  secondary_link: 0.0505,
  tertiary: 0.05,
  residential: 0.0495,
  living_street: 0.049,
  pedestrian: 0.0485,
  service: 0.048,
  footway: 0.0475,
  path: 0.047,
  steps: 0.047,
};
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian']);
const PLASTERS = [
  0xe8d9b5, 0xd8cdb8, 0xc9c4b8, 0xe0d6c2, 0xbfc6c4, 0xf0e8d8, 0xe2b77a, 0xd9a6a0, 0xa9c4c9, 0xc9d6a3,
  0xf4c27a,
];
const FLOOR = 3.4;
const BAY = 3.3;

export async function loadColabaData(url = '/data/colaba.json'): Promise<DistrictData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Colaba data ${res.status}`);
  return (await res.json()) as DistrictData;
}

/** Outward wall normal for a map-CCW ring edge a→b (world XZ). */
function outward(a: Pt, b: Pt): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function buildColaba(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  data: DistrictData,
  offset: THREE.Vector3,
  lights: StreetLights,
): ColabaDistrict {
  const rnd = mulberry32(1911);
  const O = offset;
  const W = (p: Pt, y = 0): THREE.Vector3 => new THREE.Vector3(p[0] + O.x, y, p[1] + O.z);
  const b = data.bounds;
  const id = new THREE.Matrix4();
  const inm = new THREE.Matrix3();

  // --- Harbour water + sea floor under the whole district -----------------------
  const sea = createSea(b.maxX - b.minX + 3000, b.maxZ - b.minZ + 3000);
  sea.position.set(O.x + (b.minX + b.maxX) / 2 + 1200, -1.4, O.z + (b.minZ + b.maxZ) / 2 + 1200);
  scene.add(sea);
  physics.addStaticBox(
    { x: O.x + (b.minX + b.maxX) / 2, y: -7.5, z: O.z + (b.minZ + b.maxZ) / 2 },
    { x: 2500, y: 0.5, z: 2500 },
  );

  // --- Land from the mask (rows merged vertically into rectangles) ---------------
  const g = data.grid;
  const ground = new Bucket();
  const rects: Array<{ c0: number; c1: number; r0: number; r1: number }> = [];
  const open = new Map<string, { c0: number; c1: number; r0: number; r1: number }>();
  for (let r = 0; r <= g.rows; r++) {
    const runs = g.mask[r] ?? [];
    const keys = new Set<string>();
    for (let i = 0; i < runs.length; i += 2) {
      const key = `${runs[i]}:${runs[i + 1]}`;
      keys.add(key);
      const o = open.get(key);
      if (o) o.r1 = r + 1;
      else open.set(key, { c0: runs[i]!, c1: runs[i]! + runs[i + 1]!, r0: r, r1: r + 1 });
    }
    for (const [key, o] of open) {
      if (!keys.has(key)) {
        rects.push(o);
        open.delete(key);
      }
    }
  }
  for (const o of open.values()) rects.push(o);
  const white = new THREE.Color(1, 1, 1);
  for (const rc of rects) {
    const x0 = g.minX + rc.c0 * g.cell + O.x;
    const x1 = g.minX + rc.c1 * g.cell + O.x;
    const z0 = g.minZ + rc.r0 * g.cell + O.z;
    const z1 = g.minZ + rc.r1 * g.cell + O.z;
    ground.quad(
      id,
      inm,
      [
        [x0, LAND_Y - 0.015, z1],
        [x1, LAND_Y - 0.015, z1],
        [x1, LAND_Y - 0.015, z0],
        [x0, LAND_Y - 0.015, z0],
      ],
      [0, 1, 0],
      [x0 / 6, z1 / 6, x1 / 6, z0 / 6],
      white,
    );
  }
  // One seamless heightfield for all land (hundreds of adjacent boxes made the
  // character controller snag on their seams). Land sits at road level; sea
  // cells drop away under the sea wall.
  {
    const nr = g.rows + 1;
    const nc = g.cols + 1;
    const isLand = (r: number, c: number): boolean => {
      const runs = g.mask[r];
      if (!runs || c < 0) return false;
      for (let i = 0; i < runs.length; i += 2) if (c >= runs[i]! && c < runs[i]! + runs[i + 1]!) return true;
      return false;
    };
    const heights = new Float32Array(nr * nc);
    for (let c = 0; c < nc; c++) {
      for (let r = 0; r < nr; r++) {
        const land = isLand(r, c) || isLand(r - 1, c) || isLand(r, c - 1) || isLand(r - 1, c - 1);
        heights[c * nr + r] = land ? LAND_Y : -3;
      }
    }
    const R = physics.R;
    physics.world.createCollider(
      R.ColliderDesc.heightfield(g.rows, g.cols, heights, { x: g.cols * g.cell, y: 1, z: g.rows * g.cell })
        .setTranslation(g.minX + (g.cols * g.cell) / 2 + O.x, 0, g.minZ + (g.rows * g.cell) / 2 + O.z)
        .setCollisionGroups(Groups.STATIC)
        .setFriction(0.9),
      physics.ground,
    );
  }
  const pav = paverTexture();
  const groundMesh = new THREE.Mesh(
    ground.geometry()!,
    new THREE.MeshStandardMaterial({ map: pav, color: 0xd8ccb8, roughness: 0.9 }),
  );
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // --- Sea wall along the real coastline -----------------------------------------------
  const wall = new Bucket();
  const stone = new THREE.Color(0xa59c8c);
  const inside = (p: Pt, m = 30): boolean =>
    p[0] > b.minX - m && p[0] < b.maxX + m && p[1] > b.minZ - m && p[1] < b.maxZ + m;
  for (const line of data.coast) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const c = line[i + 1]!;
      if (!inside(a) || !inside(c)) continue;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.5) continue;
      const mid: Pt = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const yaw = Math.atan2(c[0] - a[0], c[1] - a[1]);
      const m = new THREE.Matrix4().compose(
        W(mid, -0.5),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1, 1, 1),
      );
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      wall.box(m, nm, 0, 0, 0, 0.9, 2.4, len + 0.6, stone, 2);
      physics.addStaticBox(
        W(mid, -0.4),
        { x: 0.45, y: 1.3, z: len / 2 + 0.3 },
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      );
    }
  }
  const conc = concreteTexture();
  const wallGeo = wall.geometry();
  if (wallGeo) {
    const wm = new THREE.Mesh(
      wallGeo,
      new THREE.MeshStandardMaterial({ map: conc, vertexColors: true, roughness: 0.9 }),
    );
    wm.castShadow = true;
    wm.receiveShadow = true;
    scene.add(wm);
  }

  // --- Roads ------------------------------------------------------------------------------
  const roadB = new Bucket();
  const footB = new Bucket();
  for (const rd of data.roads) {
    const pts = rd.pts;
    const half = rd.w / 2;
    const y = ROAD_Y[rd.cls] ?? 0.04;
    const bucket = FOOT.has(rd.cls) ? footB : roadB;
    let v = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const c = pts[i + 1]!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.01) continue;
      // Per-vertex miter normals so segments join without gaps.
      const nrm = (k: number): Pt => {
        const p0 = pts[Math.max(0, k - 1)]!;
        const p1 = pts[Math.min(pts.length - 1, k + 1)]!;
        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const l = Math.hypot(dx, dz) || 1;
        return [dz / l, -dx / l];
      };
      const na = nrm(i);
      const nc = nrm(i + 1);
      const ax0 = a[0] + na[0] * half + O.x;
      const az0 = a[1] + na[1] * half + O.z;
      const ax1 = a[0] - na[0] * half + O.x;
      const az1 = a[1] - na[1] * half + O.z;
      const cx0 = c[0] + nc[0] * half + O.x;
      const cz0 = c[1] + nc[1] * half + O.z;
      const cx1 = c[0] - nc[0] * half + O.x;
      const cz1 = c[1] - nc[1] * half + O.z;
      // Wind so the quad faces up: (a1, c1, c0, a0).
      const corners: [number, number, number][] = [
        [ax1, y, az1],
        [cx1, y, cz1],
        [cx0, y, cz0],
        [ax0, y, az0],
      ];
      const e1 = new THREE.Vector3(cx1 - ax1, 0, cz1 - az1);
      const e2 = new THREE.Vector3(ax0 - ax1, 0, az0 - az1);
      if (new THREE.Vector3().crossVectors(e1, e2).y < 0) corners.reverse();
      bucket.quad(id, inm, corners, [0, 1, 0], [v / 6, 0, (v + len) / 6, rd.w / 6], white);
      v += len;
    }
    // Round caps at junctions hide gaps where roads meet at angles.
    for (const p of [pts[0]!, pts.at(-1)!]) {
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        const cx = p[0] + O.x;
        const cz = p[1] + O.z;
        bucket.quad(
          id,
          inm,
          [
            [cx, y - 0.001, cz],
            [cx + Math.cos(a1) * half, y - 0.001, cz + Math.sin(a1) * half],
            [cx + Math.cos(a0) * half, y - 0.001, cz + Math.sin(a0) * half],
            [cx, y - 0.001, cz],
          ],
          [0, 1, 0],
          [0, 0, 0.1, 0.1],
          white,
        );
      }
    }
  }
  const asphalt = asphaltTexture();
  const roadMesh = new THREE.Mesh(
    roadB.geometry()!,
    new THREE.MeshStandardMaterial({
      map: asphalt,
      color: 0xb8ae9f,
      roughness: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);
  const footGeo = footB.geometry();
  if (footGeo) {
    const fm = new THREE.Mesh(
      footGeo,
      new THREE.MeshStandardMaterial({
        map: paverTexture(),
        color: 0xe6d6c0,
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    fm.receiveShadow = true;
    scene.add(fm);
  }

  // --- Buildings from footprints ------------------------------------------------------
  const plaster = new Bucket();
  const trim = new Bucket();
  const roofs = new Bucket();
  const colVerts: number[] = [];
  const colIdx: number[] = [];
  const tanks: THREE.Matrix4[] = [];
  let band = 0;
  const tajTowerPt: Pt = [-138, -65];
  const gatewayB = data.buildings.find((x) => x.kind === 'gateway');
  const tajB = data.buildings.find((x) => x.kind === 'taj');

  // OSM merges the 1972 Taj Mahal Tower into the palace footprint: add it as its own block.
  const extra: DistrictData['buildings'] = [];
  if (tajB && pointInPoly(tajTowerPt, tajB.pts)) {
    const [tx, tz] = tajTowerPt;
    extra.push({
      pts: [
        [tx - 13, tz + 8],
        [tx + 13, tz + 8],
        [tx + 13, tz - 8],
        [tx - 13, tz - 8],
      ],
      h: 0,
      levels: 21,
      kind: 'tajTower',
    });
  }
  for (const bd of [...data.buildings, ...extra]) {
    if (bd.kind === 'gateway') continue;
    let h = bd.h;
    let levels = Math.max(1, bd.levels);
    let cell: keyof typeof FACADE_CELL =
      levels >= 3 && rnd() < 0.45 ? 'arch' : rnd() < 0.7 ? 'grille' : 'small';
    let color = new THREE.Color(PLASTERS[Math.floor(rnd() * PLASTERS.length)]!);
    if (bd.kind === 'taj') {
      cell = 'arch';
      color = new THREE.Color(0xd9ccb4);
    } else if (bd.kind === 'tajTower' || pointInPoly(tajTowerPt, bd.pts)) {
      // The 1972 Taj Mahal Tower.
      levels = 21;
      h = levels * FLOOR + 2;
      cell = 'grille';
      color = new THREE.Color(0xc8c2b6);
    }
    const ring = bd.pts;
    const off = (band++ % 97) * 3;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const c = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.2) continue;
      const [nx, nz] = outward(a, c);
      const bays = Math.max(1, Math.round(len / BAY));
      const shade = 0.85 + 0.15 * Math.abs(nx);
      plaster.quad(
        id,
        inm,
        [
          [a[0] + O.x, 0, a[1] + O.z],
          [c[0] + O.x, 0, c[1] + O.z],
          [c[0] + O.x, h, c[1] + O.z],
          [a[0] + O.x, h, a[1] + O.z],
        ],
        [nx, 0, nz],
        [off + i * 5, 0.002, off + i * 5 + bays, levels - 0.002],
        color.clone().multiplyScalar(shade),
        FACADE_CELL[cell],
      );
      // Parapet.
      trim.quad(
        id,
        inm,
        [
          [a[0] + O.x, h, a[1] + O.z],
          [c[0] + O.x, h, c[1] + O.z],
          [c[0] + O.x, h + 0.8, c[1] + O.z],
          [a[0] + O.x, h + 0.8, a[1] + O.z],
        ],
        [nx, 0, nz],
        [0, 0, len / 2, 0.4],
        color.clone().lerp(white, 0.5),
      );
      // Collision walls.
      const base = colVerts.length / 3;
      colVerts.push(
        a[0] + O.x,
        0,
        a[1] + O.z,
        c[0] + O.x,
        0,
        c[1] + O.z,
        c[0] + O.x,
        h,
        c[1] + O.z,
        a[0] + O.x,
        h,
        a[1] + O.z,
      );
      colIdx.push(
        base,
        base + 1,
        base + 2,
        base,
        base + 2,
        base + 3,
        base,
        base + 2,
        base + 1,
        base,
        base + 3,
        base + 2,
      );
    }
    // Roof slab (triangulated footprint).
    const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const roofCol = color.clone().multiplyScalar(0.62);
    for (const [i0, i1, i2] of tris) {
      const p0 = ring[i0!]!;
      const p1 = ring[i1!]!;
      const p2 = ring[i2!]!;
      const corners: [number, number, number][] = [
        [p0[0] + O.x, h, p0[1] + O.z],
        [p1[0] + O.x, h, p1[1] + O.z],
        [p2[0] + O.x, h, p2[1] + O.z],
        [p2[0] + O.x, h, p2[1] + O.z],
      ];
      const e1 = new THREE.Vector3(p1[0] - p0[0], 0, p1[1] - p0[1]);
      const e2 = new THREE.Vector3(p2[0] - p0[0], 0, p2[1] - p0[1]);
      const ok = new THREE.Vector3().crossVectors(e1, e2).y >= 0;
      const tri: [number, number, number][] = ok
        ? corners
        : [corners[0]!, corners[2]!, corners[1]!, corners[1]!];
      trim.quad(id, inm, tri, [0, 1, 0], [p0[0] / 4, p0[1] / 4, p1[0] / 4, p2[1] / 4], roofCol);
    }
    if (h < 30 && rnd() < 0.7) {
      const [cx, cz] = centroid(ring);
      tanks.push(
        new THREE.Matrix4().makeTranslation(
          cx + O.x + (rnd() - 0.5) * 3,
          h + 0.62,
          cz + O.z + (rnd() - 0.5) * 3,
        ),
      );
    }
  }
  const plasterMesh = new THREE.Mesh(plaster.geometry()!, createPlasterMaterial());
  plasterMesh.castShadow = true;
  plasterMesh.receiveShadow = true;
  scene.add(plasterMesh);
  const trimMesh = new THREE.Mesh(
    trim.geometry()!,
    new THREE.MeshStandardMaterial({
      map: conc,
      vertexColors: true,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  trimMesh.castShadow = true;
  trimMesh.receiveShadow = true;
  scene.add(trimMesh);
  if (tanks.length) {
    const tm = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.6, 1.25, 12),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }),
      tanks.length,
    );
    tanks.forEach((m, i) => tm.setMatrixAt(i, m));
    tm.castShadow = true;
    tm.frustumCulled = false;
    scene.add(tm);
  }
  const R = physics.R;
  physics.world.createCollider(
    R.ColliderDesc.trimesh(new Float32Array(colVerts), new Uint32Array(colIdx)).setCollisionGroups(
      Groups.STATIC,
    ),
    physics.ground,
  );

  // --- Landmarks --------------------------------------------------------------------------
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xc9a46b, roughness: 0.85, map: conc });
  const domeRed = new THREE.MeshStandardMaterial({ color: 0xb24a2c, roughness: 0.55 });
  const gw = gatewayB ? centroid(gatewayB.pts) : ([0, 0] as Pt);
  const gateway = W(gw);
  buildGateway(scene, physics, gateway, stoneMat);
  if (tajB) addTajDomes(scene, tajB, O, domeRed, stoneMat);
  void roofs;
  void roofTileTexture;

  // --- Street lights along the bigger roads + palms on the Apollo Bunder promenade -------
  for (const rd of data.roads) {
    if (!['primary', 'secondary', 'tertiary'].includes(rd.cls)) continue;
    let acc = 12;
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i]!;
      const c = rd.pts[i + 1]!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const dx = (c[0] - a[0]) / (len || 1);
      const dz = (c[1] - a[1]) / (len || 1);
      while (acc < len) {
        const side = Math.floor(acc / 17) % 2 ? 1 : -1;
        const px = a[0] + dx * acc + dz * side * (rd.w / 2 + 1.2);
        const pz = a[1] + dz * acc - dx * side * (rd.w / 2 + 1.2);
        lights.add({
          position: W([px, pz], 0),
          facing: new THREE.Vector3(-dz * side, 0, dx * side),
          kind: 'sodium',
        });
        acc += 34;
      }
      acc -= len;
    }
  }
  const veg = new Vegetation();
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const p: Pt = [gw[0] - 40 + Math.cos(a) * 26, gw[1] + Math.sin(a) * 30];
    veg.addPalm(W(p, 0), 11 + rnd() * 4);
  }
  veg.build(scene, physics);

  // Taxis waiting at the Gateway.
  const parked = [0, 1, 2].map((i) => ({
    profile: i === 1 ? 'auto-rickshaw' : 'taxi',
    id: `colaba-${i}`,
    pos: W([gw[0] - 70, gw[1] - 12 + i * 7], 0),
    yaw: Math.PI / 2,
  }));

  return {
    gateway,
    offset: O.clone(),
    bounds: new THREE.Box2(
      new THREE.Vector2(b.minX + O.x, b.minZ + O.z),
      new THREE.Vector2(b.maxX + O.x, b.maxZ + O.z),
    ),
    parked,
    attribution: data.attribution,
    roads: data.roads.map((r) => ({ pts: r.pts.map((p) => W(p, LAND_Y)), width: r.w, cls: r.cls })),
  };
}

/** Greybox Gateway of India (basalt, ~26 m): central arch facing the harbour, four turrets, side wings. */
function buildGateway(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  at: THREE.Vector3,
  mat: THREE.Material,
): void {
  const g = new THREE.Group();
  g.position.copy(at);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, collide = true): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (collide)
      physics.addStaticBox({ x: at.x + x, y: at.y + y, z: at.z + z }, { x: w / 2, y: h / 2, z: d / 2 });
  };
  // The arch passage runs east-west (sea to the east). Central block 15 m deep (x) × 24 m wide (z).
  box(15, 17, 8, 0, 8.5, -8); // north pier
  box(15, 17, 8, 0, 8.5, 8); // south pier
  box(15, 4.5, 8.2, 0, 14.75, 0); // lintel above the arch
  // Arch curve: a half-cylinder carved look via a dark half-disc on both faces.
  const archShape = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 15.2, 24, 1, true, 0, Math.PI), mat);
  archShape.rotation.set(0, 0, Math.PI / 2);
  archShape.rotation.x = Math.PI / 2;
  archShape.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  archShape.position.set(0, 12.5, 0);
  g.add(archShape);
  box(16, 1.2, 25, 0, 17.6, 0, false); // cornice
  box(15, 2.2, 23, 0, 19.3, 0, false); // attic storey
  // Four corner turrets with small domes.
  for (const [x, z] of [
    [6.5, 10.5],
    [6.5, -10.5],
    [-6.5, 10.5],
    [-6.5, -10.5],
  ] as const) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 24, 12), mat);
    t.position.set(x, 12, z);
    t.castShadow = true;
    g.add(t);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    d.position.set(x, 24, z);
    g.add(d);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 8), mat);
    tip.position.set(x, 25.9, z);
    g.add(tip);
  }
  // Side halls with smaller arches.
  box(12, 10, 7, 0, 5, -16);
  box(12, 10, 7, 0, 5, 16);
  for (const z of [-16, 16]) {
    const a = new THREE.Mesh(
      new THREE.BoxGeometry(12.2, 5, 3),
      new THREE.MeshStandardMaterial({ color: 0x2d241b, roughness: 1 }),
    );
    a.position.set(0, 2.5, z);
    g.add(a);
  }
  // Steps down to the water on the east.
  for (let s = 0; s < 4; s++) box(3, 0.3, 30, 9 + s * 1.2, -0.15 - s * 0.3, 0, false);
  scene.add(g);
}

/** Red onion domes on the Taj Mahal Palace roof: a big central dome and smaller corner domes. */
function addTajDomes(
  scene: THREE.Scene,
  taj: { pts: Pt[]; h: number },
  O: THREE.Vector3,
  red: THREE.Material,
  stone: THREE.Material,
): void {
  const [cx, cz] = centroid(taj.pts);
  const dome = (x: number, z: number, r: number, drumH: number): void => {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, drumH, 16), stone);
    drum.position.set(x + O.x, taj.h + drumH / 2, z + O.z);
    drum.castShadow = true;
    scene.add(drum);
    const onion = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), red);
    onion.scale.set(1, 1.15, 1);
    onion.position.set(x + O.x, taj.h + drumH + r * 0.7, z + O.z);
    onion.castShadow = true;
    scene.add(onion);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.25, r * 1.1, 10), red);
    tip.position.set(x + O.x, taj.h + drumH + r * 1.9, z + O.z);
    scene.add(tip);
  };
  dome(cx, cz, 8, 6);
  // Smaller domes at the four extreme corners of the footprint, pulled inward.
  const corners = [
    (p: Pt) => p[0] + p[1],
    (p: Pt) => p[0] - p[1],
    (p: Pt) => -p[0] + p[1],
    (p: Pt) => -p[0] - p[1],
  ].map((f) => taj.pts.reduce((best, p) => (f(p) > f(best) ? p : best)));
  for (const p of corners) {
    const x = p[0] + (cx - p[0]) * 0.12;
    const z = p[1] + (cz - p[1]) * 0.12;
    dome(x, z, 3, 3);
  }
}

/** A road linking the test track to the nearest real Colaba street. */
export function buildConnector(
  scene: THREE.Scene,
  data: DistrictData,
  offset: THREE.Vector3,
  from: THREE.Vector3,
): THREE.Vector3 {
  let best: THREE.Vector3 | null = null;
  let bd = Infinity;
  for (const rd of data.roads) {
    if (FOOT.has(rd.cls) || rd.cls === 'service') continue;
    for (const p of rd.pts) {
      const w = new THREE.Vector3(p[0] + offset.x, 0, p[1] + offset.z);
      const d = w.distanceToSquared(new THREE.Vector3(from.x, 0, from.z + 300));
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
  }
  const to = best ?? new THREE.Vector3(from.x, 0, from.z + 300);
  const mid = new THREE.Vector3(from.x, 0, Math.max(from.z + 20, to.z - 40));
  const bucket = new Bucket();
  const id = new THREE.Matrix4();
  const inm = new THREE.Matrix3();
  const half = 5;
  const seg = (a: THREE.Vector3, c: THREE.Vector3): void => {
    const d = c.clone().sub(a).setY(0).normalize();
    const n = new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(half);
    const y = 0.022;
    const corners: [number, number, number][] = [
      [a.x - n.x, y, a.z - n.z],
      [c.x - n.x, y, c.z - n.z],
      [c.x + n.x, y, c.z + n.z],
      [a.x + n.x, y, a.z + n.z],
    ];
    const e1 = new THREE.Vector3(corners[1]![0] - corners[0]![0], 0, corners[1]![2] - corners[0]![2]);
    const e2 = new THREE.Vector3(corners[3]![0] - corners[0]![0], 0, corners[3]![2] - corners[0]![2]);
    if (new THREE.Vector3().crossVectors(e1, e2).y < 0) corners.reverse();
    bucket.quad(id, inm, corners, [0, 1, 0], [0, 0, 2, a.distanceTo(c) / 6], new THREE.Color(1, 1, 1));
  };
  seg(from, mid);
  seg(mid, to);
  const tex = asphaltTexture();
  const mesh = new THREE.Mesh(
    bucket.geometry()!,
    new THREE.MeshStandardMaterial({ map: tex, color: 0xb8ae9f, roughness: 0.92, side: THREE.DoubleSide }),
  );
  mesh.receiveShadow = true;
  scene.add(mesh);
  return to;
}
