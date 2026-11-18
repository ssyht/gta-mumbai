import * as THREE from 'three/webgpu';
import { RIG_GEO, type HumanoidRig, type RigGeoKey } from './HumanoidRig';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Draws every instanced-mode HumanoidRig with one InstancedMesh per body-part
 * geometry (CLAUDE.md §6: "Everything that spawns many copies uses
 * InstancedMesh"). Outfit colours go through instanceColor.
 */
export class RigInstancer {
  private readonly meshes = new Map<RigGeoKey, THREE.InstancedMesh>();
  private readonly slots = new Map<RigGeoKey, Array<{ rig: HumanoidRig; node: THREE.Object3D }>>();
  private readonly rigs: HumanoidRig[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly capacity = 256,
  ) {
    for (const key of Object.keys(RIG_GEO) as RigGeoKey[]) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.8,
        side: key === 'drape' ? THREE.DoubleSide : THREE.FrontSide,
      });
      const im = new THREE.InstancedMesh(RIG_GEO[key], mat, capacity);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.meshes.set(key, im);
      this.slots.set(key, []);
    }
  }

  add(rig: HumanoidRig): void {
    this.rigs.push(rig);
    for (const p of rig.proxies) {
      const list = this.slots.get(p.geo)!;
      const im = this.meshes.get(p.geo)!;
      if (list.length >= this.capacity) continue;
      im.setColorAt(list.length, _c.setHex(p.color));
      list.push({ rig, node: p.node });
      im.count = list.length;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** Copy every part's world matrix into its InstancedMesh (once per frame). */
  update(): void {
    for (const rig of this.rigs) if (rig.root.visible) rig.root.updateMatrixWorld(true);
    for (const [key, list] of this.slots) {
      const im = this.meshes.get(key)!;
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        im.setMatrixAt(i, s.rig.root.visible ? _m.copy(s.node.matrixWorld) : HIDDEN);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
