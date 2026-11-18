import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { frondTexture, leafClusterTexture } from '../../render/materials/streetTextures';
import { mulberry32 } from '../../render/materials/textures';

/**
 * Coconut palms (curved ringed trunks, drooping alpha fronds) and broadleaf
 * street trees (gulmohar/peepal-style leaf-card canopies). Everything is
 * instanced: a whole avenue of trees costs a handful of draw calls.
 */
interface PalmSpec {
  pos: THREE.Vector3;
  height: number;
  lean: number;
  yaw: number;
}
interface TreeSpec {
  pos: THREE.Vector3;
  size: number;
}

function bentFrondGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.25, 4.4, 1, 10);
  g.translate(0, 2.2, 0); // base at origin, frond along +Y
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / 4.4;
    // Arc outward then droop: frond lies along +Z after the bend.
    p.setXYZ(
      i,
      p.getX(i) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.2))),
      Math.sin(t * 1.6) * 1.5 - t * t * 2.2,
      t * 4.0,
    );
  }
  g.computeVertexNormals();
  return g;
}

function trunkGeometry(): THREE.BufferGeometry {
  // Unit-height trunk with a gentle S-curve and growth rings.
  const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => new THREE.Vector3(Math.sin(t * 2.2) * 0.08, t, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 24, 0.16, 7, false);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const ring = 1 + 0.08 * Math.max(0, Math.sin(y * 140));
    const taper = 1.25 - 0.45 * y;
    p.setX(i, (p.getX(i) - Math.sin(y * 2.2) * 0.08) * ring * taper + Math.sin(y * 2.2) * 0.08);
    p.setZ(i, p.getZ(i) * ring * taper);
  }
  g.computeVertexNormals();
  return g;
}

export class Vegetation {
  private readonly palms: PalmSpec[] = [];
  private readonly trees: TreeSpec[] = [];
  private readonly rnd = mulberry32(512);

  addPalm(pos: THREE.Vector3, height = 9 + Math.random() * 4): void {
    this.palms.push({ pos, height, lean: (this.rnd() - 0.5) * 0.35, yaw: this.rnd() * Math.PI * 2 });
  }

  addTree(pos: THREE.Vector3, size = 1): void {
    this.trees.push({ pos, size });
  }

  build(scene: THREE.Scene, physics: PhysicsWorld): void {
    const rnd = this.rnd;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();

    if (this.palms.length) {
      const FRONDS = 14;
      const trunk = new THREE.InstancedMesh(
        trunkGeometry(),
        new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.95 }),
        this.palms.length,
      );
      const frondMat = new THREE.MeshStandardMaterial({
        map: frondTexture(),
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.7,
        color: 0xc8e0a0,
      });
      const fronds = new THREE.InstancedMesh(bentFrondGeometry(), frondMat, this.palms.length * FRONDS);
      const nuts = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b7a2a, roughness: 0.6 }),
        this.palms.length * 5,
      );
      const green = new THREE.Color();
      this.palms.forEach((p, i) => {
        q.setFromEuler(e.set(p.lean * Math.cos(p.yaw), p.yaw, p.lean * Math.sin(p.yaw)));
        m.compose(p.pos, q, s.set(1, p.height, 1));
        trunk.setMatrixAt(i, m);
        const top = v.set(0, p.height, 0).applyQuaternion(q).add(p.pos).clone();
        for (let f = 0; f < FRONDS; f++) {
          const yaw = (f / FRONDS) * Math.PI * 2 + rnd() * 0.3;
          const pitch = -0.35 + rnd() * 0.5 + (f % 3 === 0 ? -0.5 : 0); // a few young fronds point up
          const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
          const sc = 0.75 + rnd() * 0.45;
          fronds.setMatrixAt(i * FRONDS + f, m.compose(top, fq, s.set(sc, sc, sc)));
          fronds.setColorAt(i * FRONDS + f, green.setHSL(0.22 + rnd() * 0.06, 0.45, 0.42 + rnd() * 0.2));
        }
        for (let n = 0; n < 5; n++) {
          const a = (n / 5) * Math.PI * 2;
          nuts.setMatrixAt(
            i * 5 + n,
            m.makeTranslation(top.x + Math.cos(a) * 0.22, top.y - 0.3, top.z + Math.sin(a) * 0.22),
          );
        }
        physics.addStaticCylinder({ x: p.pos.x, y: p.pos.y + 2.5, z: p.pos.z }, 2.5, 0.25);
      });
      for (const im of [trunk, fronds, nuts]) {
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
      }
    }

    if (this.trees.length) {
      const branches: THREE.BufferGeometry[] = [
        new THREE.CylinderGeometry(0.18, 0.3, 4, 7).translate(0, 2, 0),
      ];
      for (let b = 0; b < 4; b++) {
        const c = new THREE.CylinderGeometry(0.07, 0.14, 3, 5).translate(0, 1.5, 0);
        c.applyQuaternion(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, (b / 4) * Math.PI * 2, 0, 'YXZ')),
        );
        c.translate(0, 3.3, 0);
        branches.push(c);
      }
      const trunk = new THREE.InstancedMesh(
        mergeGeometries(branches)!,
        new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.95 }),
        this.trees.length,
      );
      const CARDS = 26;
      const leafMat = new THREE.MeshStandardMaterial({
        map: leafClusterTexture(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      const leaves = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(2.6, 2.6),
        leafMat,
        this.trees.length * CARDS,
      );
      const col = new THREE.Color();
      this.trees.forEach((t, i) => {
        trunk.setMatrixAt(
          i,
          m.compose(
            t.pos,
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6),
            s.set(t.size, t.size, t.size),
          ),
        );
        for (let c = 0; c < CARDS; c++) {
          const a = rnd() * Math.PI * 2;
          const r = Math.sqrt(rnd()) * 3.2 * t.size;
          const y = (4.4 + rnd() * 3.2) * t.size;
          const p = v.set(t.pos.x + Math.cos(a) * r, t.pos.y + y, t.pos.z + Math.sin(a) * r);
          const cq = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 6, rnd() * 3));
          const sc = (0.9 + rnd() * 0.6) * t.size;
          leaves.setMatrixAt(i * CARDS + c, m.compose(p, cq, s.set(sc, sc, sc)));
          leaves.setColorAt(i * CARDS + c, col.setHSL(0.24 + rnd() * 0.08, 0.5, 0.55 + rnd() * 0.25));
        }
        physics.addStaticCylinder({ x: t.pos.x, y: t.pos.y + 2, z: t.pos.z }, 2, 0.3);
      });
      for (const im of [trunk, leaves]) {
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
      }
    }
  }
}
