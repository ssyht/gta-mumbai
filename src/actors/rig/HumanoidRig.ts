import * as THREE from 'three/webgpu';
import { POSE_JOINTS, POSE_LEN, type Pose } from './poses';

/**
 * Greybox humanoid on one shared joint layout (CLAUDE.md §8: "greybox first",
 * "one shared rig"). Every character, player and NPC, uses this skeleton, so
 * the M3+ swap to a skinned Quaternius/Mixamo mesh only replaces the meshes.
 *
 * Root = feet, facing +Z. Hips joint sits HIP_HEIGHT above the root.
 */
export const HIP_HEIGHT = 0.92;

export interface Outfit {
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  hair: number;
  /** Long garment (saree/kurta) drawn as a skirt over the hips. */
  drape?: number;
  cap?: number;
  /** Uniform-style belt (khaki police/auto drivers). */
  belt?: number;
}

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(roughness * 9);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness });
    matCache.set(key, m);
  }
  return m;
}

const geo = {
  limbUpper: new THREE.CapsuleGeometry(0.052, 0.2, 4, 8),
  limbLower: new THREE.CapsuleGeometry(0.044, 0.2, 4, 8),
  thigh: new THREE.CapsuleGeometry(0.075, 0.28, 4, 8),
  shin: new THREE.CapsuleGeometry(0.058, 0.3, 4, 8),
  torso: new THREE.CapsuleGeometry(0.15, 0.3, 4, 10),
  pelvis: new THREE.BoxGeometry(0.32, 0.17, 0.2),
  head: new THREE.SphereGeometry(0.105, 14, 10),
  hair: new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hand: new THREE.SphereGeometry(0.045, 8, 6),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.25),
  neck: new THREE.CylinderGeometry(0.048, 0.052, 0.1, 8),
  nose: new THREE.BoxGeometry(0.028, 0.04, 0.03),
  drape: new THREE.CylinderGeometry(0.2, 0.3, 0.75, 12, 1, true),
  cap: new THREE.CylinderGeometry(0.115, 0.118, 0.07, 14),
  capBrim: new THREE.BoxGeometry(0.2, 0.012, 0.12),
  belt: new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12),
};

export class HumanoidRig {
  readonly root = new THREE.Group();
  readonly joints: Record<(typeof POSE_JOINTS)[number], THREE.Object3D>;
  /** Inner group that receives body offset/pitch/roll so the root can follow physics. */
  private readonly body = new THREE.Group();

  constructor(outfit: Outfit) {
    const j = (name: string, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const part = (
      g: THREE.BufferGeometry,
      color: number,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(g, mat(color));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    const hips = j('hips', 0, HIP_HEIGHT, 0, this.body);
    part(geo.pelvis, outfit.bottom, hips, 0, 0, 0);
    const spine = j('spine', 0, 0.08, 0, hips);
    part(geo.torso, outfit.top, spine, 0, 0.22, 0, 1.15, 1, 0.72);
    if (outfit.belt !== undefined) part(geo.belt, outfit.belt, spine, 0, -0.03, 0, 1, 1, 0.72);
    const neck = j('neck', 0, 0.44, 0, spine);
    part(geo.neck, outfit.skin, neck, 0, 0.03, 0);
    const head = j('head', 0, 0.08, 0, neck);
    part(geo.head, outfit.skin, head, 0, 0.1, 0.005, 0.92, 1.06, 1);
    part(geo.hair, outfit.hair, head, 0, 0.12, -0.012);
    part(geo.nose, outfit.skin, head, 0, 0.09, 0.1);
    if (outfit.cap !== undefined) {
      part(geo.cap, outfit.cap, head, 0, 0.19, 0);
      part(geo.capBrim, outfit.cap, head, 0, 0.16, 0.1);
    }

    const shoulderL = j('shoulderL', 0.205, 0.4, 0, spine);
    const shoulderR = j('shoulderR', -0.205, 0.4, 0, spine);
    const elbowL = j('elbowL', 0, -0.29, 0, shoulderL);
    const elbowR = j('elbowR', 0, -0.29, 0, shoulderR);
    for (const [s, e] of [
      [shoulderL, elbowL],
      [shoulderR, elbowR],
    ] as const) {
      part(geo.limbUpper, outfit.top, s, 0, -0.145, 0);
      part(geo.limbLower, outfit.skin, e, 0, -0.13, 0);
      part(geo.hand, outfit.skin, e, 0, -0.27, 0.005);
    }

    const hipL = j('hipL', 0.1, -0.05, 0, hips);
    const hipR = j('hipR', -0.1, -0.05, 0, hips);
    const kneeL = j('kneeL', 0, -0.43, 0, hipL);
    const kneeR = j('kneeR', 0, -0.43, 0, hipR);
    for (const [h, k] of [
      [hipL, kneeL],
      [hipR, kneeR],
    ] as const) {
      part(geo.thigh, outfit.bottom, h, 0, -0.21, 0);
      part(geo.shin, outfit.bottom, k, 0, -0.2, 0);
      part(geo.foot, outfit.shoes, k, 0, -0.42, 0.05);
    }
    if (outfit.drape !== undefined) {
      const d = part(geo.drape, outfit.drape, hips, 0, -0.32, 0);
      (d.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }

    this.joints = { hips, spine, neck, head, shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, hipR, kneeR };
  }

  applyPose(p: Pose): void {
    for (let i = 0; i < POSE_JOINTS.length; i++) {
      const o = this.joints[POSE_JOINTS[i]!];
      o.rotation.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
    }
    const b = POSE_JOINTS.length * 3;
    this.body.position.y = p[b]!;
    this.body.rotation.set(p[b + 1]!, 0, p[b + 2]!);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}

export { POSE_LEN };
