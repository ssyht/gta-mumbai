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
/** Arm segment lengths: shoulder→elbow and elbow→palm centre. */
export const ARM = { upper: 0.29, lower: 0.27 } as const;

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

export const RIG_GEO = {
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

export type RigGeoKey = keyof typeof RIG_GEO;

export class HumanoidRig {
  readonly root = new THREE.Group();
  readonly joints: Record<(typeof POSE_JOINTS)[number], THREE.Object3D>;
  /** Inner group that receives body offset/pitch/roll so the root can follow physics. */
  private readonly body = new THREE.Group();

  /** Hand anchors (centre of the palm) for attaching props and IK targets (SCENARIOS.md A4). */
  readonly handL = new THREE.Object3D();
  readonly handR = new THREE.Object3D();
  /** Proxy part nodes (instanced mode): geometry key + colour per node. */
  readonly proxies: Array<{ node: THREE.Object3D; geo: RigGeoKey; color: number }> = [];

  /**
   * @param instanced when true, parts are empty nodes drawn by a shared
   *   RigInstancer (crowds: ~14 draw calls total instead of ~17 per person).
   */
  constructor(outfit: Outfit, instanced = false) {
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
    ): THREE.Object3D => {
      if (instanced) {
        const node = new THREE.Object3D();
        node.position.set(x, y, z);
        node.scale.set(sx, sy, sz);
        parent.add(node);
        const key = (Object.keys(RIG_GEO) as RigGeoKey[]).find((k) => RIG_GEO[k] === g)!;
        this.proxies.push({ node, geo: key, color });
        return node;
      }
      const m = new THREE.Mesh(g, mat(color));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    const hips = j('hips', 0, HIP_HEIGHT, 0, this.body);
    part(RIG_GEO.pelvis, outfit.bottom, hips, 0, 0, 0);
    const spine = j('spine', 0, 0.08, 0, hips);
    part(RIG_GEO.torso, outfit.top, spine, 0, 0.22, 0, 1.15, 1, 0.72);
    if (outfit.belt !== undefined) part(RIG_GEO.belt, outfit.belt, spine, 0, -0.03, 0, 1, 1, 0.72);
    const neck = j('neck', 0, 0.44, 0, spine);
    part(RIG_GEO.neck, outfit.skin, neck, 0, 0.03, 0);
    const head = j('head', 0, 0.08, 0, neck);
    part(RIG_GEO.head, outfit.skin, head, 0, 0.1, 0.005, 0.92, 1.06, 1);
    part(RIG_GEO.hair, outfit.hair, head, 0, 0.12, -0.012);
    part(RIG_GEO.nose, outfit.skin, head, 0, 0.09, 0.1);
    if (outfit.cap !== undefined) {
      part(RIG_GEO.cap, outfit.cap, head, 0, 0.19, 0);
      part(RIG_GEO.capBrim, outfit.cap, head, 0, 0.16, 0.1);
    }

    const shoulderL = j('shoulderL', 0.205, 0.4, 0, spine);
    const shoulderR = j('shoulderR', -0.205, 0.4, 0, spine);
    const elbowL = j('elbowL', 0, -0.29, 0, shoulderL);
    const elbowR = j('elbowR', 0, -0.29, 0, shoulderR);
    for (const [s, e] of [
      [shoulderL, elbowL],
      [shoulderR, elbowR],
    ] as const) {
      part(RIG_GEO.limbUpper, outfit.top, s, 0, -0.145, 0);
      part(RIG_GEO.limbLower, outfit.skin, e, 0, -0.13, 0);
      part(RIG_GEO.hand, outfit.skin, e, 0, -0.27, 0.005);
    }

    const hipL = j('hipL', 0.1, -0.05, 0, hips);
    const hipR = j('hipR', -0.1, -0.05, 0, hips);
    const kneeL = j('kneeL', 0, -0.43, 0, hipL);
    const kneeR = j('kneeR', 0, -0.43, 0, hipR);
    for (const [h, k] of [
      [hipL, kneeL],
      [hipR, kneeR],
    ] as const) {
      part(RIG_GEO.thigh, outfit.bottom, h, 0, -0.21, 0);
      part(RIG_GEO.shin, outfit.bottom, k, 0, -0.2, 0);
      part(RIG_GEO.foot, outfit.shoes, k, 0, -0.42, 0.05);
    }
    if (outfit.drape !== undefined) {
      const d = part(RIG_GEO.drape, outfit.drape, hips, 0, -0.32, 0);
      if (d instanceof THREE.Mesh) (d.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }

    this.joints = { hips, spine, neck, head, shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, hipR, kneeR };
    this.handL.name = 'handL';
    this.handR.name = 'handR';
    this.handL.position.set(0, -ARM.lower, 0);
    this.handR.position.set(0, -ARM.lower, 0);
    elbowL.add(this.handL);
    elbowR.add(this.handR);
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
