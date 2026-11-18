import * as THREE from 'three/webgpu';
import { dot, floor, fract, mix, sin, step, texture, uv, vec2, vec3 } from 'three/tsl';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import { facadeTextures, mulberry32 } from '../../render/materials/textures';

export type BuildingStyle = 'chawl' | 'apartment' | 'tower';

export interface BuildingSpec {
  x: number;
  z: number;
  /** Footprint along X / Z (m). */
  w: number;
  d: number;
  floors: number;
  style: BuildingStyle;
  collider?: boolean;
}

const BAY = 3.4;
const FLOOR = 3.1;
/** Faded Mumbai plaster: pastel pinks, yellows, blues, greens and tired whites. */
const PALETTE = [
  0xe8d9b5, 0xd9a6a0, 0xa9c4c9, 0xc9d6a3, 0xf0e8d8, 0xe2b77a, 0xb8b2d6, 0xd7c9b0, 0x9fb7a4, 0xeadfcf,
];

/**
 * Greybox building generator (precursor to the M4 procedural Indian facade
 * system, CLAUDE.md §8.2). All buildings merge into one draw call; windows
 * light up at night one by one with tungsten or tube-light colour.
 */
export class GreyboxBuildings {
  private readonly specs: BuildingSpec[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {}

  add(spec: BuildingSpec): void {
    this.specs.push(spec);
  }

  get count(): number {
    return this.specs.length;
  }

  build(seed = 42): void {
    const rnd = mulberry32(seed);
    const pos: number[] = [];
    const nor: number[] = [];
    const uvs: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const tanks: THREE.Matrix4[] = [];
    const tarps: Array<{ m: THREE.Matrix4; color: THREE.Color }> = [];

    const quad = (
      a: number[],
      b: number[],
      cc: number[],
      d: number[],
      n: number[],
      uv0: [number, number],
      uv1: [number, number],
      color: THREE.Color,
    ): void => {
      const base = pos.length / 3;
      pos.push(...a, ...b, ...cc, ...d);
      for (let i = 0; i < 4; i++) {
        nor.push(...n);
        col.push(color.r, color.g, color.b);
      }
      uvs.push(uv0[0], uv0[1], uv1[0], uv0[1], uv1[0], uv1[1], uv0[0], uv1[1]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    this.specs.forEach((s, bi) => {
      const h = s.floors * FLOOR + (s.style === 'tower' ? 2 : 0.6);
      const x0 = s.x - s.w / 2;
      const x1 = s.x + s.w / 2;
      const z0 = s.z - s.d / 2;
      const z1 = s.z + s.d / 2;
      c.setHex(PALETTE[Math.floor(rnd() * PALETTE.length)]!);
      if (s.style === 'tower') c.lerp(new THREE.Color(0x9aa8b4), 0.6);
      const off = bi * 37; // integer UV offset: unique window pattern per building
      const wall = (shade: number): THREE.Color => c.clone().multiplyScalar(shade);
      const vTop = h / FLOOR;
      // +Z face
      quad(
        [x0, 0, z1],
        [x1, 0, z1],
        [x1, h, z1],
        [x0, h, z1],
        [0, 0, 1],
        [off, 0],
        [off + s.w / BAY, vTop],
        wall(1),
      );
      // -Z face
      quad(
        [x1, 0, z0],
        [x0, 0, z0],
        [x0, h, z0],
        [x1, h, z0],
        [0, 0, -1],
        [off + 7, 0],
        [off + 7 + s.w / BAY, vTop],
        wall(0.92),
      );
      // +X face
      quad(
        [x1, 0, z1],
        [x1, 0, z0],
        [x1, h, z0],
        [x1, h, z1],
        [1, 0, 0],
        [off + 13, 0],
        [off + 13 + s.d / BAY, vTop],
        wall(0.96),
      );
      // -X face
      quad(
        [x0, 0, z0],
        [x0, 0, z1],
        [x0, h, z1],
        [x0, h, z0],
        [-1, 0, 0],
        [off + 19, 0],
        [off + 19 + s.d / BAY, vTop],
        wall(0.88),
      );
      // Roof: sample a window-free corner of the cell.
      quad(
        [x0, h, z1],
        [x1, h, z1],
        [x1, h, z0],
        [x0, h, z0],
        [0, 1, 0],
        [off + 0.03, 0.03],
        [off + 0.05, 0.05],
        wall(0.7),
      );

      if (s.collider !== false) {
        this.physics.addStaticBox({ x: s.x, y: h / 2, z: s.z }, { x: s.w / 2, y: h / 2, z: s.d / 2 });
      }
      if (s.style !== 'tower') {
        const nTanks = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < nTanks; i++) {
          const m = new THREE.Matrix4().makeTranslation(
            x0 + 1 + rnd() * (s.w - 2),
            h + 0.62,
            z0 + 1 + rnd() * (s.d - 2),
          );
          tanks.push(m);
        }
        if (s.style === 'chawl' && rnd() < 0.45) {
          const tw = Math.min(s.w - 1, 3 + rnd() * 4);
          const td = Math.min(s.d - 1, 3 + rnd() * 4);
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x0 + tw / 2 + rnd() * (s.w - tw), h + 0.9, z0 + td / 2 + rnd() * (s.d - td)),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25),
            ),
            new THREE.Vector3(tw, 0.04, td),
          );
          tarps.push({ m, color: new THREE.Color(rnd() < 0.75 ? 0x1f6fd0 : 0xe8711c) });
        }
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const { map, mask } = facadeTextures();
    const mat = new THREE.MeshStandardNodeMaterial({ map, vertexColors: true, roughness: 0.85 });
    const cell = floor(uv());
    const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
    const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453));
    const lit = step(h1, lightUniforms.windows.mul(0.9));
    const tint = mix(vec3(0.72, 0.88, 1.0), vec3(1.0, 0.66, 0.32), step(0.35, h2));
    mat.emissiveNode = texture(mask, uv()).r.mul(lit).mul(tint).mul(2.6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    if (tanks.length) {
      const tankMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.6, 0.6, 1.25, 12),
        new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55 }),
        tanks.length,
      );
      tanks.forEach((m, i) => tankMesh.setMatrixAt(i, m));
      tankMesh.castShadow = true;
      tankMesh.frustumCulled = false;
      this.scene.add(tankMesh);
    }
    if (tarps.length) {
      const tarpMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
        tarps.length,
      );
      tarps.forEach((t, i) => {
        tarpMesh.setMatrixAt(i, t.m);
        tarpMesh.setColorAt(i, t.color);
      });
      tarpMesh.castShadow = true;
      tarpMesh.frustumCulled = false;
      this.scene.add(tarpMesh);
    }
  }
}
