import * as THREE from 'three/webgpu';
import {
  attribute,
  dot,
  floor,
  fract,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  step,
  texture,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import { concreteTexture, mulberry32 } from '../../render/materials/textures';
import {
  facadeAtlas,
  shopInteriorTexture,
  roofTileTexture,
  shutterTexture,
  type SignAtlas,
  type SignSpec,
} from '../../render/materials/streetTextures';

/**
 * Procedural Mumbai street facades (CLAUDE.md §8.2 facade generator, first
 * pass): colonial (arched windows, pilasters, cornices, balustraded tower,
 * Mangalore-tile roofs), chawl (continuous balconies with railings and
 * laundry) and shophouse (chajjas, projecting balconies, AC units). Ground
 * floors are shops: rolling shutters, lit interiors, signboards, awnings and
 * tube lights. Everything merges into ~9 draw calls for the whole street.
 */
export type FacadeStyle = 'colonial' | 'chawl' | 'shophouse';

export interface StreetBuildingSpec {
  /** Start of the facade along the street (world X). */
  x0: number;
  width: number;
  /** -1: north side (facade faces +Z), +1: south side (faces -Z). */
  side: 1 | -1;
  /** Distance of the facade plane from the street centre line. */
  faceZ: number;
  depth: number;
  floors: number;
  style: FacadeStyle;
  plaster: number;
  trim: number;
  tower?: boolean;
  shops: SignSpec[];
  upperSign?: SignSpec;
}

export interface StreetDressing {
  acUnits: THREE.Matrix4[];
  tanks: THREE.Matrix4[];
  dishes: THREE.Matrix4[];
  laundry: Array<{ m: THREE.Matrix4; color: THREE.Color }>;
  crates: Array<{ m: THREE.Matrix4; color: THREE.Color }>;
  plants: THREE.Matrix4[];
  /** Night practicals for the light pool. */
  practicals: Array<{ pos: THREE.Vector3; kind: 'tube' | 'bulb' }>;
  /** Shop-front fairy-light runs (world endpoints, sag applied later). */
  fairy: Array<[THREE.Vector3, THREE.Vector3]>;
  /** Side walls facing gullies, for murals. */
  gullyWalls: Array<{ center: THREE.Vector3; normal: THREE.Vector3; width: number; height: number }>;
  antennas: number[];
}

const GROUND_H = 4.0;
const FLOOR_H = 3.2;
const BAY_TARGET = 3.3;
// Atlas cell offsets (u, v) for the 2×2 facade atlas.
const CELL = {
  grille: [0, 0.5],
  arch: [0.5, 0.5],
  door: [0, 0],
  small: [0.5, 0],
} as const;
type CellKey = keyof typeof CELL;

export class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  atl: number[] = [];
  idx: number[] = [];

  quad(
    m: THREE.Matrix4,
    nm: THREE.Matrix3,
    corners: [number, number, number][],
    n: [number, number, number],
    uv: [number, number, number, number],
    c: THREE.Color,
    atlas: readonly [number, number] = [0, 0],
  ): void {
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const nn = new THREE.Vector3(...n).applyMatrix3(nm).normalize();
    for (const k of corners) {
      v.set(...k).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(nn.x, nn.y, nn.z);
      this.col.push(c.r, c.g, c.b);
      this.atl.push(atlas[0], atlas[1]);
    }
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box in the building frame; UVs in metres / tile. */
  box(
    m: THREE.Matrix4,
    nm: THREE.Matrix3,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    c: THREE.Color,
    tile = 2,
  ): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const U = (a: number): number => a / tile;
    this.quad(
      m,
      nm,
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      [0, 0, U(sx), U(sy)],
      c,
    );
    this.quad(
      m,
      nm,
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      [0, 0, -1],
      [0, 0, U(sx), U(sy)],
      c,
    );
    this.quad(
      m,
      nm,
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
      [1, 0, 0],
      [0, 0, U(sz), U(sy)],
      c,
    );
    this.quad(
      m,
      nm,
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      [0, 0, U(sz), U(sy)],
      c,
    );
    this.quad(
      m,
      nm,
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 1, 0],
      [0, 0, U(sx), U(sz)],
      c,
    );
    this.quad(
      m,
      nm,
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
      [0, 0, U(sx), U(sz)],
      c,
    );
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('atlas', new THREE.Float32BufferAttribute(this.atl, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const TARPS = [0x1f6fd0, 0xe8711c, 0x2e7d32, 0xc62828, 0xfbc02d, 0x00838f];
const SHUTTERS = [0x6f8fa6, 0x3f6e5a, 0x9e9e9e, 0x5c6bc0, 0x8d6e63, 0x26a69a];
const LAUNDRY = [0xe53935, 0x1e88e5, 0xfdd835, 0xffffff, 0x8e24aa, 0x43a047, 0xff7043, 0x00acc1, 0xf48fb1];
const GOODS = [0xa1887f, 0x8d6e63, 0xbcaaa4, 0xd7ccc8, 0xff9800, 0x8bc34a, 0xe53935, 0x6d4c41];

export class StreetBuildings {
  private readonly b = {
    plaster: new Bucket(),
    trim: new Bucket(),
    metal: new Bucket(),
    shutter: new Bucket(),
    dark: new Bucket(),
    signs: new Bucket(),
    tarp: new Bucket(),
    light: new Bucket(),
    roof: new Bucket(),
  };
  readonly dressing: StreetDressing = {
    acUnits: [],
    tanks: [],
    dishes: [],
    laundry: [],
    crates: [],
    plants: [],
    practicals: [],
    fairy: [],
    gullyWalls: [],
    antennas: [],
  };
  private readonly rnd = mulberry32(2019);
  private band = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly atlas: SignAtlas,
  ) {}

  add(s: StreetBuildingSpec): void {
    const rnd = this.rnd;
    const W = s.width;
    const D = s.depth;
    const m = new THREE.Matrix4();
    if (s.side === -1) m.makeTranslation(s.x0, 0, -s.faceZ);
    else m.makeTranslation(s.x0 + W, 0, s.faceZ).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3(x, y, z).applyMatrix4(m);
    const plaster = new THREE.Color(s.plaster);
    const trim = new THREE.Color(s.trim);
    const metal = new THREE.Color(0x2a2a2a);
    const bodyTop = GROUND_H + (s.floors - 1) * FLOOR_H;
    const bays = Math.max(1, Math.round(W / BAY_TARGET));
    const bayW = W / bays;
    const P = this.b;

    // Side, back walls + roof slab.
    const plain: [number, number, number, number] = [0.03, 0.03, 0.04, 0.04];
    P.plaster.quad(
      m,
      nm,
      [
        [W, 0, 0],
        [W, 0, -D],
        [W, bodyTop, -D],
        [W, bodyTop, 0],
      ],
      [1, 0, 0],
      plain,
      plaster.clone().multiplyScalar(0.9),
    );
    P.plaster.quad(
      m,
      nm,
      [
        [0, 0, -D],
        [0, 0, 0],
        [0, bodyTop, 0],
        [0, bodyTop, -D],
      ],
      [-1, 0, 0],
      plain,
      plaster.clone().multiplyScalar(0.86),
    );
    P.plaster.quad(
      m,
      nm,
      [
        [W, 0, -D],
        [0, 0, -D],
        [0, bodyTop, -D],
        [W, bodyTop, -D],
      ],
      [0, 0, -1],
      plain,
      plaster.clone().multiplyScalar(0.8),
    );
    P.trim.box(m, nm, W / 2, bodyTop + 0.05, -D / 2, W, 0.1, D, trim.clone().multiplyScalar(0.7));
    this.physics.addStaticBox(toWorld(W / 2, bodyTop / 2, -D / 2), { x: W / 2, y: bodyTop / 2, z: D / 2 });
    for (const xSide of [0, W]) {
      this.dressing.gullyWalls.push({
        center: toWorld(xSide, Math.min(bodyTop, 8) / 2 + 0.3, -Math.min(D, 6) / 2 - 0.5),
        normal: new THREE.Vector3(xSide === 0 ? -1 : 1, 0, 0).applyMatrix3(nm).normalize(),
        width: Math.min(D, 6),
        height: Math.min(bodyTop, 8) - 0.8,
      });
    }

    // --- Ground floor: shops --------------------------------------------------
    for (let i = 0; i <= bays; i++)
      P.trim.box(m, nm, i * bayW, GROUND_H / 2, 0.12, 0.34, GROUND_H, 0.3, trim);
    P.trim.box(m, nm, W / 2, GROUND_H - 0.1, 0.18, W + 0.1, 0.22, 0.42, trim);
    for (let i = 0; i < bays; i++) {
      const x0 = i * bayW + 0.17;
      const x1 = (i + 1) * bayW - 0.17;
      const w = x1 - x0;
      const xc = (x0 + x1) / 2;
      const shop = s.shops[i % Math.max(1, s.shops.length)];
      const closed = rnd() < 0.18;
      // Interior recess.
      const warm = new THREE.Color().setHSL(0.08 + rnd() * 0.05, 0.5, 0.18 + rnd() * 0.12);
      P.dark.quad(
        m,
        nm,
        [
          [x0, 0, -1.2],
          [x1, 0, -1.2],
          [x1, 3.3, -1.2],
          [x0, 3.3, -1.2],
        ],
        [0, 0, 1],
        [0, 0, 1, 1],
        warm,
      );
      P.dark.quad(
        m,
        nm,
        [
          [x0, 3.3, 0],
          [x1, 3.3, 0],
          [x1, 3.3, -1.2],
          [x0, 3.3, -1.2],
        ],
        [0, -1, 0],
        [0, 0, 1, 1],
        warm.clone().multiplyScalar(0.6),
      );
      P.dark.quad(
        m,
        nm,
        [
          [x0, 0, -1.2],
          [x0, 0, 0],
          [x0, 3.3, 0],
          [x0, 3.3, -1.2],
        ],
        [1, 0, 0],
        [0, 0, 1, 1],
        warm.clone().multiplyScalar(0.7),
      );
      P.dark.quad(
        m,
        nm,
        [
          [x1, 0, 0],
          [x1, 0, -1.2],
          [x1, 3.3, -1.2],
          [x1, 3.3, 0],
        ],
        [-1, 0, 0],
        [0, 0, 1, 1],
        warm.clone().multiplyScalar(0.7),
      );
      // Rolling shutter: rolled up (a drum at the top) or pulled down.
      const shCol = new THREE.Color(SHUTTERS[Math.floor(rnd() * SHUTTERS.length)]!);
      const shBottom = closed ? 0 : 2.75 + rnd() * 0.35;
      P.shutter.quad(
        m,
        nm,
        [
          [x0, shBottom, 0.02],
          [x1, shBottom, 0.02],
          [x1, 3.32, 0.02],
          [x0, 3.32, 0.02],
        ],
        [0, 0, 1],
        [0, shBottom / 2, w / 2, 3.32 / 2],
        shCol,
      );
      P.metal.box(m, nm, xc, 3.36, 0.1, w, 0.16, 0.2, metal);
      if (!closed) {
        // Goods spilling onto the pavement.
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const gx = x0 + 0.4 + rnd() * (w - 0.8);
          const sz = 0.25 + rnd() * 0.25;
          this.dressing.crates.push({
            m: new THREE.Matrix4().compose(
              toWorld(gx, sz / 2 + 0.18, 0.55 + rnd() * 0.4),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd()),
              new THREE.Vector3(sz * 1.3, sz, sz),
            ),
            color: new THREE.Color(GOODS[Math.floor(rnd() * GOODS.length)]!),
          });
        }
        if (rnd() < 0.5) this.dressing.practicals.push({ pos: toWorld(xc, 3.0, -0.4), kind: 'bulb' });
      }
      // Signboard.
      if (shop) {
        const r = this.atlas.add(shop, Math.floor(rnd() * 1e6));
        P.signs.quad(
          m,
          nm,
          [
            [x0 - 0.1, 3.42, 0.32],
            [x1 + 0.1, 3.42, 0.32],
            [x1 + 0.1, 4.0, 0.32],
            [x0 - 0.1, 4.0, 0.32],
          ],
          [0, 0, 1],
          r,
          new THREE.Color(1, 1, 1),
        );
        P.metal.box(m, nm, xc, 3.71, 0.26, w + 0.2, 0.62, 0.08, metal);
      }
      // Tube light under the sign.
      if (rnd() < 0.7) {
        P.light.box(
          m,
          nm,
          xc,
          3.36,
          0.36,
          Math.min(1.2, w * 0.6),
          0.05,
          0.05,
          new THREE.Color(0.85, 0.95, 1),
        );
        this.dressing.practicals.push({ pos: toWorld(xc, 3.3, 0.6), kind: 'tube' });
      }
      // Awning.
      if (rnd() < 0.55) {
        const c = new THREE.Color(TARPS[Math.floor(rnd() * TARPS.length)]!);
        const out = 1.2 + rnd() * 0.6;
        P.tarp.quad(
          m,
          nm,
          [
            [x0, 3.2, 0.36],
            [x1, 3.2, 0.36],
            [x1, 2.75, out],
            [x0, 2.75, out],
          ],
          [0, 0.94, 0.33],
          [0, 0, 1, 1],
          c,
        );
        P.metal.box(m, nm, x0 + 0.05, 1.4, out - 0.05, 0.04, 2.8, 0.04, metal);
        P.metal.box(m, nm, x1 - 0.05, 1.4, out - 0.05, 0.04, 2.8, 0.04, metal);
      }
    }
    // Fairy lights along the shop fronts.
    this.dressing.fairy.push([toWorld(0, 4.05, 0.45), toWorld(W, 4.05, 0.45)]);

    // --- Upper floors -------------------------------------------------------
    const bandCell = (): CellKey => {
      if (s.style === 'colonial') return 'arch';
      if (s.style === 'chawl') return 'door';
      return (rnd() < 0.6 ? 'grille' : 'small') as CellKey;
    };
    for (let f = 1; f < s.floors; f++) {
      const y0 = GROUND_H + (f - 1) * FLOOR_H;
      const cell = bandCell();
      const off = (this.band++ % 97) * 3;
      P.plaster.quad(
        m,
        nm,
        [
          [0, y0, 0],
          [W, y0, 0],
          [W, y0 + FLOOR_H, 0],
          [0, y0 + FLOOR_H, 0],
        ],
        [0, 0, 1],
        [off, f + 0.002, off + bays, f + 0.998],
        plaster.clone().multiplyScalar(0.94 + rnd() * 0.1),
        CELL[cell],
      );
      // String course at the floor line.
      P.trim.box(m, nm, W / 2, y0 + 0.08, 0.1, W + 0.12, 0.16, 0.22, trim);
      if (s.style === 'colonial') {
        for (let i = 0; i <= bays; i++)
          P.trim.box(m, nm, i * bayW, y0 + FLOOR_H / 2, 0.08, 0.3, FLOOR_H, 0.16, trim);
        if (f === 1) P.trim.box(m, nm, W / 2, y0 + 0.25, 0.25, W + 0.2, 0.18, 0.5, trim);
      } else if (s.style === 'chawl') {
        // Continuous gallery balcony with railings and laundry.
        P.trim.box(m, nm, W / 2, y0 + 0.07, 0.65, W, 0.14, 1.3, trim);
        P.metal.box(m, nm, W / 2, y0 + 1.05, 1.27, W, 0.05, 0.05, metal);
        P.metal.box(m, nm, W / 2, y0 + 0.55, 1.27, W, 0.03, 0.03, metal);
        for (let x = 0.1; x < W; x += 0.16) P.metal.box(m, nm, x, y0 + 0.6, 1.27, 0.022, 0.9, 0.022, metal);
        let lx = 0.3 + rnd();
        while (lx < W - 0.4) {
          if (rnd() < 0.55) {
            const cw = 0.4 + rnd() * 0.5;
            const ch = 0.5 + rnd() * 0.6;
            this.dressing.laundry.push({
              m: new THREE.Matrix4().compose(
                toWorld(lx, y0 + 1.05 - ch / 2, 1.33),
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  s.side === 1 ? Math.PI : 0,
                ),
                new THREE.Vector3(cw, ch, 1),
              ),
              color: new THREE.Color(LAUNDRY[Math.floor(rnd() * LAUNDRY.length)]!),
            });
          }
          lx += 0.5 + rnd() * 0.6;
        }
        for (let i = 0; i < bays; i++)
          if (rnd() < 0.35)
            this.dressing.plants.push(
              new THREE.Matrix4().makeTranslation(...toWorld(i * bayW + 0.5, y0 + 0.35, 1.05).toArray()),
            );
      } else {
        for (let i = 0; i < bays; i++) {
          const xc = (i + 0.5) * bayW;
          P.trim.box(m, nm, xc, y0 + 2.62, 0.3, bayW * 0.82, 0.08, 0.6, trim);
          if (rnd() < 0.3) {
            // Projecting box balcony.
            P.trim.box(m, nm, xc, y0 + 0.08, 0.5, bayW * 0.9, 0.14, 1.0, trim);
            P.metal.box(m, nm, xc, y0 + 1.0, 0.98, bayW * 0.9, 0.05, 0.05, metal);
            for (let x = -bayW * 0.43; x < bayW * 0.45; x += 0.14)
              P.metal.box(m, nm, xc + x, y0 + 0.55, 0.98, 0.02, 0.9, 0.02, metal);
            if (rnd() < 0.6)
              this.dressing.plants.push(
                new THREE.Matrix4().makeTranslation(...toWorld(xc - 0.4, y0 + 0.35, 0.8).toArray()),
              );
          } else if (rnd() < 0.35) {
            const ax = xc + (rnd() - 0.5) * bayW * 0.4;
            this.dressing.acUnits.push(
              new THREE.Matrix4().compose(
                toWorld(ax, y0 + 0.7, 0.2),
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  s.side === 1 ? Math.PI : 0,
                ),
                new THREE.Vector3(1, 1, 1),
              ),
            );
          }
        }
        if (f === 1 && s.upperSign) {
          const r = this.atlas.add(s.upperSign, Math.floor(rnd() * 1e6));
          const sw = Math.min(W - 1, 5);
          P.signs.quad(
            m,
            nm,
            [
              [W / 2 - sw / 2, y0 + 2.75, 0.62],
              [W / 2 + sw / 2, y0 + 2.75, 0.62],
              [W / 2 + sw / 2, y0 + 3.15, 0.62],
              [W / 2 - sw / 2, y0 + 3.15, 0.62],
            ],
            [0, 0, 1],
            r,
            new THREE.Color(1, 1, 1),
          );
        }
      }
    }

    // --- Roofline ----------------------------------------------------------------
    P.trim.box(m, nm, W / 2, bodyTop - 0.12, 0.2, W + 0.3, 0.26, 0.45, trim);
    P.trim.box(m, nm, W / 2, bodyTop + 0.45, 0.0, W, 0.9, 0.22, trim.clone().multiplyScalar(0.92));
    P.trim.box(m, nm, 0.11, bodyTop + 0.45, -D / 2, 0.22, 0.9, D, trim.clone().multiplyScalar(0.85));
    P.trim.box(m, nm, W - 0.11, bodyTop + 0.45, -D / 2, 0.22, 0.9, D, trim.clone().multiplyScalar(0.85));
    if (s.style === 'colonial') {
      // Balustrade posts on the parapet.
      for (let x = 0.4; x < W - 0.3; x += 0.45)
        P.trim.box(m, nm, x, bodyTop + 0.45, 0.14, 0.12, 0.7, 0.12, trim);
      // Mangalore-tile gable roof behind the parapet.
      const rh = 2.2;
      P.roof.quad(
        m,
        nm,
        [
          [0.2, bodyTop, -0.4],
          [W - 0.2, bodyTop, -0.4],
          [W - 0.2, bodyTop + rh, -D / 2],
          [0.2, bodyTop + rh, -D / 2],
        ],
        [0, 0.8, 0.6],
        [0, 0, W / 3, 2],
        new THREE.Color(1, 1, 1),
      );
      P.roof.quad(
        m,
        nm,
        [
          [W - 0.2, bodyTop, -D + 0.3],
          [0.2, bodyTop, -D + 0.3],
          [0.2, bodyTop + rh, -D / 2],
          [W - 0.2, bodyTop + rh, -D / 2],
        ],
        [0, 0.8, -0.6],
        [0, 0, W / 3, 2],
        new THREE.Color(0.9, 0.9, 0.9),
      );
      if (s.tower) {
        const tw = Math.min(W * 0.32, 7);
        const tx = W / 2 - tw / 2;
        const th = FLOOR_H * 1.6;
        const td = 5;
        const tm = new THREE.Matrix4().multiplyMatrices(
          m,
          new THREE.Matrix4().makeTranslation(tx, bodyTop, 0.6),
        );
        const tnm = new THREE.Matrix3().getNormalMatrix(tm);
        const toff = (this.band++ % 97) * 3;
        P.plaster.quad(
          tm,
          tnm,
          [
            [0, 0, 0],
            [tw, 0, 0],
            [tw, th, 0],
            [0, th, 0],
          ],
          [0, 0, 1],
          [toff, 0.002, toff + 2, 0.998],
          plaster,
          CELL.arch,
        );
        P.plaster.quad(
          tm,
          tnm,
          [
            [tw, 0, 0],
            [tw, 0, -td],
            [tw, th, -td],
            [tw, th, 0],
          ],
          [1, 0, 0],
          plain,
          plaster.clone().multiplyScalar(0.88),
        );
        P.plaster.quad(
          tm,
          tnm,
          [
            [0, 0, -td],
            [0, 0, 0],
            [0, th, 0],
            [0, th, -td],
          ],
          [-1, 0, 0],
          plain,
          plaster.clone().multiplyScalar(0.84),
        );
        P.trim.box(tm, tnm, tw / 2, th + 0.1, -td / 2, tw + 0.5, 0.25, td + 0.5, trim);
        for (let x = 0.2; x < tw; x += 0.4) P.trim.box(tm, tnm, x, th + 0.6, 0.15, 0.12, 0.8, 0.12, trim);
        P.trim.box(tm, tnm, tw / 2, th + 1.05, 0.15, tw + 0.3, 0.12, 0.3, trim);
        this.dressing.dishes.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(tw * 0.75, th + 0.6, -1.5).applyMatrix4(tm),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, s.side === 1 ? 0 : Math.PI, 0)),
            new THREE.Vector3(1, 1, 1),
          ),
        );
        this.dressing.antennas.push(...new THREE.Vector3(tw * 0.3, th + 0.25, -2).applyMatrix4(tm).toArray());
      }
    }
    // Rooftop clutter.
    const roofY = bodyTop + 0.1;
    const nTanks = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nTanks; i++)
      this.dressing.tanks.push(
        new THREE.Matrix4().makeTranslation(
          ...toWorld(1 + rnd() * (W - 2), roofY + 0.62, -2 - rnd() * (D - 4)).toArray(),
        ),
      );
    if (rnd() < 0.7)
      this.dressing.dishes.push(
        new THREE.Matrix4().compose(
          toWorld(0.8 + rnd() * (W - 1.6), roofY + 0.9, -0.8),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, s.side === 1 ? 0 : Math.PI, 0)),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    if (rnd() < 0.8)
      this.dressing.antennas.push(...toWorld(1 + rnd() * (W - 2), roofY, -1.5 - rnd() * 3).toArray());
  }

  private frame(x: number, z: number, yaw: number): [THREE.Matrix4, THREE.Matrix3] {
    const m = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(yaw));
    return [m, new THREE.Matrix3().getNormalMatrix(m)];
  }

  /** Street-food cart (thela) with striped poles, canopy, painted menu board, food heaps and a bulb. */
  addCart(x: number, z: number, yaw: number, menu: SignSpec, groundY = 0.18): void {
    const rnd = this.rnd;
    const [m, nm] = this.frame(x, z, yaw);
    const P = this.b;
    const y = groundY;
    const body = new THREE.Color().setHSL(0.5 + rnd() * 0.15, 0.45, 0.45);
    const canopy = new THREE.Color(TARPS[Math.floor(rnd() * TARPS.length)]!);
    const metal = new THREE.Color(0x333333);
    P.trim.box(m, nm, 0, y + 0.8, 0, 1.9, 0.12, 0.9, body);
    P.trim.box(m, nm, 0, y + 0.55, 0.44, 1.9, 0.45, 0.04, body.clone().multiplyScalar(0.8));
    P.trim.box(m, nm, 0, y + 0.55, -0.44, 1.9, 0.45, 0.04, body.clone().multiplyScalar(0.8));
    for (const sx of [-0.95, 0.95]) {
      // Bicycle-style wheels as thin rings of boxes.
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        P.metal.box(
          m,
          nm,
          sx * 0.55,
          y + 0.38 + Math.sin(ang) * 0.36,
          sx > 0 ? 0.5 : -0.5,
          0.2,
          0.05,
          0.03,
          metal,
        );
        void ang;
      }
    }
    for (const [px, pz] of [
      [-0.88, 0.4],
      [0.88, 0.4],
      [-0.88, -0.4],
      [0.88, -0.4],
    ] as const) {
      for (let k = 0; k < 6; k++) {
        const c = new THREE.Color(k % 2 ? 0xd84315 : 0x1e88e5);
        P.trim.box(m, nm, px, y + 0.95 + k * 0.27 + 0.135, pz, 0.06, 0.27, 0.06, c);
      }
    }
    P.tarp.quad(
      m,
      nm,
      [
        [-1.15, y + 2.55, 0.75],
        [1.15, y + 2.55, 0.75],
        [1.15, y + 2.75, -0.75],
        [-1.15, y + 2.75, -0.75],
      ],
      [0, 1, 0.1],
      [0, 0, 1, 1],
      canopy,
    );
    P.tarp.quad(
      m,
      nm,
      [
        [-1.15, y + 2.35, 0.76],
        [1.15, y + 2.35, 0.76],
        [1.15, y + 2.55, 0.76],
        [-1.15, y + 2.55, 0.76],
      ],
      [0, 0, 1],
      [0, 0, 1, 1],
      canopy.clone().multiplyScalar(0.8),
    );
    const r = this.atlas.add(menu, Math.floor(rnd() * 1e6));
    P.signs.quad(
      m,
      nm,
      [
        [-0.9, y + 0.38, 0.47],
        [0.9, y + 0.38, 0.47],
        [0.9, y + 0.76, 0.47],
        [-0.9, y + 0.76, 0.47],
      ],
      [0, 0, 1],
      r,
      new THREE.Color(1, 1, 1),
    );
    P.signs.quad(
      m,
      nm,
      [
        [-1.1, y + 2.36, 0.77],
        [1.1, y + 2.36, 0.77],
        [1.1, y + 2.54, 0.77],
        [-1.1, y + 2.54, 0.77],
      ],
      [0, 0, 1],
      r,
      new THREE.Color(1, 1, 1),
    );
    // Food heaps and steel vessels.
    for (let k = 0; k < 5; k++) {
      const c = new THREE.Color(GOODS[Math.floor(rnd() * GOODS.length)]!);
      P.tarp.box(m, nm, -0.7 + k * 0.35, y + 0.92, (rnd() - 0.5) * 0.4, 0.28, 0.12 + rnd() * 0.1, 0.28, c);
    }
    P.metal.box(m, nm, 0.6, y + 0.98, -0.2, 0.32, 0.24, 0.32, new THREE.Color(0xb0b0b0));
    P.light.box(m, nm, 0, y + 2.2, 0, 0.08, 0.12, 0.08, new THREE.Color(1, 0.8, 0.5));
    this.dressing.practicals.push({ pos: new THREE.Vector3(0, y + 2.1, 0).applyMatrix4(m), kind: 'bulb' });
    this.physics.addStaticBox(
      new THREE.Vector3(0, y + 0.5, 0).applyMatrix4(m),
      { x: 0.95, y: 0.5, z: 0.5 },
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    );
  }

  /** Big stall umbrella. */
  addUmbrella(x: number, z: number, groundY = 0.18): void {
    const rnd = this.rnd;
    const [m, nm] = this.frame(x, z, rnd() * 6);
    const c = new THREE.Color(TARPS[Math.floor(rnd() * TARPS.length)]!);
    const P = this.b;
    P.metal.box(m, nm, 0, groundY + 1.2, 0, 0.05, 2.4, 0.05, new THREE.Color(0xdddddd));
    const R = 1.6;
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const top: [number, number, number] = [0, groundY + 2.65, 0];
      const p0: [number, number, number] = [Math.cos(a0) * R, groundY + 2.15, Math.sin(a0) * R];
      const p1: [number, number, number] = [Math.cos(a1) * R, groundY + 2.15, Math.sin(a1) * R];
      P.tarp.quad(
        m,
        nm,
        [p0, p1, top, top],
        [0, 1, 0],
        [0, 0, 1, 1],
        i % 2 ? c : c.clone().multiplyScalar(0.85),
      );
    }
  }

  /** Stackable plastic chair (very Mumbai). */
  addChair(x: number, z: number, yaw: number, color: number, groundY = 0.18): void {
    const [m, nm] = this.frame(x, z, yaw);
    const c = new THREE.Color(color);
    const P = this.b;
    P.tarp.box(m, nm, 0, groundY + 0.45, 0, 0.44, 0.04, 0.42, c);
    P.tarp.box(m, nm, 0, groundY + 0.72, -0.2, 0.44, 0.5, 0.04, c);
    for (const [lx, lz] of [
      [-0.2, 0.18],
      [0.2, 0.18],
      [-0.2, -0.18],
      [0.2, -0.18],
    ] as const)
      P.tarp.box(m, nm, lx, groundY + 0.22, lz, 0.04, 0.45, 0.04, c);
  }

  /** A string of triangular festival flags between two points. */
  addBunting(a: THREE.Vector3, b: THREE.Vector3, palette: number[]): void {
    const P = this.b;
    const id = new THREE.Matrix4();
    const inm = new THREE.Matrix3();
    const len = a.distanceTo(b);
    const n = Math.floor(len / 0.32);
    const sag = 0.6 + this.rnd() * 0.6;
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 0.8) / n;
      const p0 = a.clone().lerp(b, t0);
      const p1 = a.clone().lerp(b, t1);
      p0.y -= sag * 4 * t0 * (1 - t0);
      p1.y -= sag * 4 * t1 * (1 - t1);
      const tip = p0.clone().lerp(p1, 0.5);
      tip.y -= 0.28;
      const c = new THREE.Color(palette[i % palette.length]!);
      P.tarp.quad(
        id,
        inm,
        [p0.toArray(), p1.toArray(), tip.toArray(), tip.toArray()] as [number, number, number][],
        side.toArray() as [number, number, number],
        [0, 0, 1, 1],
        c,
      );
    }
  }

  build(scene: THREE.Scene): void {
    const plasterMat = createPlasterMaterial();

    const conc = concreteTexture();
    const trimMat = new THREE.MeshStandardMaterial({ map: conc, vertexColors: true, roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 });
    const shutterMat = new THREE.MeshStandardMaterial({
      map: shutterTexture(),
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.4,
    });
    const darkMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    const shelves = texture(shopInteriorTexture(), uv());
    darkMat.colorNode = shelves.rgb.mul(vertexColor().mul(1.1));
    darkMat.emissiveNode = shelves.rgb.mul(lightUniforms.street.mul(0.4).add(0.02));
    const signMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    signMat.colorNode = texture(this.atlas.texture, uv()).rgb;
    signMat.emissiveNode = texture(this.atlas.texture, uv()).rgb.mul(lightUniforms.street.mul(0.7));
    const tarpMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const lightMat = new THREE.MeshStandardNodeMaterial({ color: 0xeef6ff });
    lightMat.emissiveNode = vec3(0.85, 0.95, 1).mul(lightUniforms.street.mul(3).add(0.3));
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofTileTexture(),
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });

    const pairs: Array<[Bucket, THREE.Material]> = [
      [this.b.plaster, plasterMat],
      [this.b.trim, trimMat],
      [this.b.metal, metalMat],
      [this.b.shutter, shutterMat],
      [this.b.dark, darkMat],
      [this.b.signs, signMat],
      [this.b.tarp, tarpMat],
      [this.b.light, lightMat],
      [this.b.roof, roofMat],
    ];
    for (const [bucket, mat] of pairs) {
      const g = bucket.geometry();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = bucket !== this.b.light && bucket !== this.b.dark;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

let plasterShared: THREE.MeshStandardNodeMaterial | null = null;
/**
 * Facade plaster: 2×2 window atlas tiled one cell per bay × floor (uv in cell
 * units, `atlas` attribute picks the cell), vertex-colour tint, world-space
 * damp grime, and night windows that switch on one by one.
 */
export function createPlasterMaterial(): THREE.MeshStandardNodeMaterial {
  if (plasterShared) return plasterShared;
  const { map, mask } = facadeAtlas();
  const cellUv = fract(uv()).mul(0.5).add(attribute('atlas', 'vec2'));
  const plasterMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
  // World-space grime: large damp patches + darker base where splashes hit.
  const n = mx_noise_float(positionWorld.mul(vec3(0.12, 0.35, 0.12)));
  const base = step(positionWorld.y, 1.2).mul(0.15);
  plasterMat.colorNode = texture(map, cellUv).rgb.mul(vertexColor()).mul(n.mul(0.18).add(0.9).sub(base));
  const cell = floor(uv());
  const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
  const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453));
  const lit = step(h1, lightUniforms.windows.mul(0.88));
  const tint = mix(vec3(0.72, 0.88, 1.0), vec3(1.0, 0.64, 0.3), step(0.4, h2));
  plasterMat.emissiveNode = texture(mask, cellUv).r.mul(lit).mul(tint).mul(0.9);
  plasterShared = plasterMat;
  return plasterMat;
}

export const FACADE_CELL = CELL;
