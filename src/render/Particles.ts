import * as THREE from 'three/webgpu';

/**
 * Pooled particles (GAME_SPEC §13.1: GPU-instanced smoke, fire, sparks, dust)
 * and skid-mark decals. Particles are instanced puffs that grow and sink out
 * of sight instead of fading, so one draw call per kind covers the city.
 */
type Kind = 'smoke' | 'fire' | 'spark';

interface P {
  kind: Kind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
}

const CAP: Record<Kind, number> = { smoke: 260, fire: 160, spark: 120 };
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Particles {
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private readonly pool: Record<Kind, P[]> = { smoke: [], fire: [], spark: [] };
  private readonly skid: THREE.InstancedMesh;
  private skidNext = 0;
  private readonly SKIDS = 500;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x4a4744,
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff7a1a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const mk = (mat: THREE.Material, n: number): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) im.setMatrixAt(i, HIDDEN);
      im.frustumCulled = false;
      scene.add(im);
      return im;
    };
    this.meshes = {
      smoke: mk(smokeMat, CAP.smoke),
      fire: mk(fireMat, CAP.fire),
      spark: mk(sparkMat, CAP.spark),
    };
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x0c0c0c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.skid = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.24, 0.55).rotateX(-Math.PI / 2),
      skidMat,
      this.SKIDS,
    );
    for (let i = 0; i < this.SKIDS; i++) this.skid.setMatrixAt(i, HIDDEN);
    this.skid.frustumCulled = false;
    this.skid.renderOrder = 1;
    scene.add(this.skid);
  }

  emit(
    kind: Kind,
    at: THREE.Vector3,
    opts: { vel?: THREE.Vector3; size?: number; life?: number; spread?: number } = {},
  ): void {
    const list = this.pool[kind];
    if (list.length >= CAP[kind]) list.shift();
    const spread = opts.spread ?? 0.3;
    list.push({
      kind,
      pos: at
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)),
      vel: (opts.vel ?? new THREE.Vector3(0, kind === 'spark' ? 3 : 1.2, 0))
        .clone()
        .add(
          new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8),
        ),
      life: 0,
      max: opts.life ?? (kind === 'smoke' ? 2.6 : kind === 'fire' ? 0.7 : 0.5),
      size: opts.size ?? (kind === 'smoke' ? 0.35 : kind === 'fire' ? 0.3 : 0.05),
      grow: kind === 'smoke' ? 0.7 : kind === 'fire' ? -0.2 : 0,
    });
  }

  /** Big fireball + smoke column + sparks. */
  explosion(at: THREE.Vector3): void {
    for (let i = 0; i < 40; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9 + 0.1,
        Math.random() - 0.5,
      ).normalize();
      this.emit('fire', at, {
        vel: dir.multiplyScalar(4 + Math.random() * 6),
        size: 0.6 + Math.random() * 0.7,
        life: 0.6 + Math.random() * 0.4,
        spread: 1.2,
      });
    }
    for (let i = 0; i < 30; i++)
      this.emit('smoke', at, {
        vel: new THREE.Vector3(0, 2 + Math.random() * 2, 0),
        size: 0.8,
        life: 4,
        spread: 2,
      });
    for (let i = 0; i < 40; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
      this.emit('spark', at, { vel: dir.multiplyScalar(8 + Math.random() * 10), life: 0.8 });
    }
  }

  /** Lay a skid-mark segment under a sliding tyre. */
  skidMark(at: THREE.Vector3, yaw: number): void {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    _m.compose(at, _q, _s.set(1, 1, 1));
    this.skid.setMatrixAt(this.skidNext, _m);
    this.skidNext = (this.skidNext + 1) % this.SKIDS;
    this.skid.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const kind of ['smoke', 'fire', 'spark'] as Kind[]) {
      const list = this.pool[kind];
      const im = this.meshes[kind];
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        p.life += dt;
        if (p.life >= p.max) {
          list.splice(i, 1);
          continue;
        }
        if (kind === 'spark') p.vel.y -= 14 * dt;
        else p.vel.multiplyScalar(1 - dt * 0.8);
        p.pos.addScaledVector(p.vel, dt);
        p.size = Math.max(0.02, p.size + p.grow * dt);
      }
      for (let i = 0; i < CAP[kind]; i++) {
        const p = list[i];
        if (!p) {
          im.setMatrixAt(i, HIDDEN);
          continue;
        }
        const t = p.life / p.max;
        const sc = p.size * (kind === 'smoke' ? 1 : 1 - t * 0.7);
        _m.compose(p.pos, _q.identity(), _s.set(sc, sc, sc));
        im.setMatrixAt(i, _m);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
