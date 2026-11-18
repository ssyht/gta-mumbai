import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vec3 } from 'three/tsl';
import { lightUniforms } from '../../render/lightUniforms';
import { mulberry32 } from '../../render/materials/textures';
import { muralTexture } from '../../render/materials/streetTextures';
import type { StreetDressing } from '../buildings/StreetBuildings';

/**
 * Instanced street dressing (CLAUDE.md §3 props list): AC units, rooftop
 * Sintex tanks, satellite dishes, TV antennas, laundry, goods crates, potted
 * plants, fairy lights, gully murals, litter, puddles and manhole covers.
 */
function instanced(
  scene: THREE.Scene,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  mats: THREE.Matrix4[],
  colors?: THREE.Color[],
  shadow = true,
): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  colors?.forEach((c, i) => im.setColorAt(i, c));
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.frustumCulled = false;
  scene.add(im);
  return im;
}

export interface GroundScatterArea {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
}

export function buildStreetDressing(
  scene: THREE.Scene,
  d: StreetDressing,
  ground: GroundScatterArea[],
): void {
  const rnd = mulberry32(88);

  // AC units: box with a dark fan grille on the front.
  const acGeo = mergeGeometries([
    new THREE.BoxGeometry(0.85, 0.58, 0.32),
    new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14).rotateX(Math.PI / 2).translate(0.15, 0, 0.17),
  ])!;
  instanced(scene, acGeo, new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.6 }), d.acUnits);
  instanced(
    scene,
    new THREE.CylinderGeometry(0.6, 0.6, 1.25, 14),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 }),
    d.tanks,
  );
  const dishGeo = new THREE.SphereGeometry(0.45, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.32).rotateX(
    Math.PI / 2,
  );
  instanced(
    scene,
    dishGeo,
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, side: THREE.DoubleSide }),
    d.dishes,
  );
  instanced(
    scene,
    new THREE.PlaneGeometry(1, 1).translate(0, 0, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }),
    d.laundry.map((l) => l.m),
    d.laundry.map((l) => l.color),
  );
  instanced(
    scene,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    d.crates.map((c) => c.m),
    d.crates.map((c) => c.color),
  );
  const plantGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.18, 0.14, 0.3, 8).toNonIndexed(),
    new THREE.IcosahedronGeometry(0.32, 0).translate(0, 0.4, 0).toNonIndexed(),
  ])!;
  instanced(scene, plantGeo, new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 0.8 }), d.plants);

  // TV antennas: thin mast + cross bars as line segments (one draw call).
  const ant: number[] = [];
  for (let i = 0; i < d.antennas.length; i += 3) {
    const x = d.antennas[i]!;
    const y = d.antennas[i + 1]!;
    const z = d.antennas[i + 2]!;
    ant.push(x, y, z, x, y + 2.2, z);
    for (let k = 0; k < 4; k++) {
      const h = y + 1.3 + k * 0.25;
      const w = 0.6 - k * 0.1;
      ant.push(x - w, h, z, x + w, h, z);
    }
  }
  if (ant.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ant, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x222222 })));
  }

  // Fairy lights: tiny emissive bulbs along sagging strings, glow at night.
  const bulbs: THREE.Matrix4[] = [];
  const bulbCols: THREE.Color[] = [];
  const fairyPalette = [0xffd36b, 0xff6bd5, 0x6be3ff, 0xfff1c9, 0x9dff6b];
  for (const [a, b] of d.fairy) {
    const n = Math.floor(a.distanceTo(b) / 0.35);
    const sag = 0.25 + rnd() * 0.2;
    const col = fairyPalette[Math.floor(rnd() * fairyPalette.length)]!;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= sag * Math.abs(Math.sin(t * Math.PI * 4));
      bulbs.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      bulbCols.push(new THREE.Color(col));
    }
  }
  const bulbMat = new THREE.MeshStandardNodeMaterial({ color: 0x222222 });
  bulbMat.emissiveNode = vec3(1, 0.85, 0.6).mul(lightUniforms.street.mul(4));
  const fairy = instanced(scene, new THREE.SphereGeometry(0.035, 6, 4), bulbMat, bulbs, bulbCols, false);
  if (fairy) {
    // Tint the glow per bulb by mixing instance colour into diffuse (emissive stays warm-white).
    fairy.renderOrder = 2;
  }

  // Murals on some gully walls.
  const muralTex = [muralTexture(5), muralTexture(17), muralTexture(41)];
  d.gullyWalls.forEach((w, i) => {
    if (rnd() > 0.45) return;
    const mat = new THREE.MeshStandardMaterial({
      map: muralTex[i % muralTex.length]!,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w.width, w.height), mat);
    m.position.copy(w.center).addScaledVector(w.normal, 0.03);
    m.lookAt(m.position.clone().add(w.normal));
    m.receiveShadow = true;
    scene.add(m);
  });

  // Ground clutter: litter, puddles (glossy), manholes.
  const litter: THREE.Matrix4[] = [];
  const litterCols: THREE.Color[] = [];
  const puddles: THREE.Matrix4[] = [];
  const manholes: THREE.Matrix4[] = [];
  const LITTER = [0xd8d4cc, 0xbdb6aa, 0x8d6e63, 0x6d5d4b, 0x9e9e9e, 0x5d4037, 0x7c8a6e];
  for (const area of ground) {
    const size = (area.x1 - area.x0) * (area.z1 - area.z0);
    const nLitter = Math.floor(size * 0.07);
    for (let i = 0; i < nLitter; i++) {
      const s = 0.05 + rnd() * 0.1;
      litter.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(
            area.x0 + rnd() * (area.x1 - area.x0),
            area.y + 0.012,
            area.z0 + rnd() * (area.z1 - area.z0),
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rnd() * 6)),
          new THREE.Vector3(s, s * (0.5 + rnd()), 1),
        ),
      );
      litterCols.push(new THREE.Color(LITTER[Math.floor(rnd() * LITTER.length)]!));
    }
    const nPud = Math.floor(size * 0.004);
    for (let i = 0; i < nPud; i++) {
      const s = 0.8 + rnd() * 1.8;
      puddles.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(
            area.x0 + rnd() * (area.x1 - area.x0),
            area.y + 0.014,
            area.z0 + rnd() * (area.z1 - area.z0),
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rnd() * 6)),
          new THREE.Vector3(s, s * (0.5 + rnd() * 0.4), 1),
        ),
      );
    }
    if (area.z1 - area.z0 > 6) {
      for (let x = area.x0 + 8; x < area.x1; x += 28 + rnd() * 10) {
        manholes.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, area.y + 0.016, (area.z0 + area.z1) / 2 + (rnd() - 0.5) * 3),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
  }
  instanced(
    scene,
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    }),
    litter,
    litterCols,
    false,
  );
  instanced(
    scene,
    new THREE.CircleGeometry(0.5, 16),
    new THREE.MeshStandardMaterial({
      color: 0x15171a,
      roughness: 0.12,
      metalness: 0,
      envMapIntensity: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      transparent: true,
      opacity: 0.75,
    }),
    puddles,
    undefined,
    false,
  );
  instanced(
    scene,
    new THREE.CircleGeometry(0.42, 18),
    new THREE.MeshStandardMaterial({
      color: 0x3a3836,
      roughness: 0.5,
      metalness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    manholes,
    undefined,
    false,
  );
}
