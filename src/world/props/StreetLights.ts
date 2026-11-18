import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uv, vec3 } from 'three/tsl';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';

export interface LampSpec {
  position: THREE.Vector3;
  /** Direction the arm reaches (unit, XZ). */
  facing: THREE.Vector3;
  kind: 'sodium' | 'led';
}

const SODIUM = new THREE.Color(1.0, 0.56, 0.2);
const LED = new THREE.Color(0.85, 0.92, 1.0);

/**
 * Instanced street lamps (one draw call per part) with emissive heads that
 * switch on with TimeOfDay, cheap ground "light cards" under every lamp, and
 * a small pool of real point lights that follows the camera (CLAUDE.md §4A.3:
 * "a limited pool of real point/spot lights nearest the camera").
 */
export class StreetLights {
  readonly lamps: LampSpec[] = [];
  private pool: THREE.PointLight[] = [];
  private poolTimer = 0;
  private readonly group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly poolSize: number,
  ) {
    scene.add(this.group);
  }

  add(spec: LampSpec): void {
    this.lamps.push(spec);
  }

  build(): void {
    const n = this.lamps.length;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5b6266, roughness: 0.6, metalness: 0.6 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 8, 8), poleMat, n);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.8), poleMat, n);
    const headGeo = new THREE.BoxGeometry(0.35, 0.12, 0.7);
    const headFor = (c: THREE.Color, count: number): THREE.InstancedMesh => {
      const mat = new THREE.MeshStandardNodeMaterial({ color: 0x222222, roughness: 0.4 });
      mat.emissiveNode = vec3(c.r, c.g, c.b).mul(lightUniforms.street.mul(9));
      return new THREE.InstancedMesh(headGeo, mat, Math.max(1, count));
    };
    const sodiumCount = this.lamps.filter((l) => l.kind === 'sodium').length;
    const heads = { sodium: headFor(SODIUM, sodiumCount), led: headFor(LED, n - sodiumCount) };
    const headIdx = { sodium: 0, led: 0 };
    heads.sodium.count = sodiumCount;
    heads.led.count = n - sodiumCount;
    const cardMat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const d = length(uv().sub(0.5)).mul(2);
    cardMat.opacityNode = smoothstep(float(1), float(0), d).pow(2).mul(lightUniforms.street).mul(0.55);
    const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cardMat, n);
    cards.renderOrder = 1;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    this.lamps.forEach((l, i) => {
      const yaw = Math.atan2(l.facing.x, l.facing.z);
      q.setFromAxisAngle(up, yaw);
      m.compose(p.copy(l.position).setY(l.position.y + 4), q, s);
      pole.setMatrixAt(i, m);
      m.compose(
        p
          .copy(l.position)
          .addScaledVector(l.facing, 0.85)
          .setY(l.position.y + 7.9),
        q,
        s,
      );
      arm.setMatrixAt(i, m);
      m.compose(
        p
          .copy(l.position)
          .addScaledVector(l.facing, 1.6)
          .setY(l.position.y + 7.82),
        q,
        s,
      );
      heads[l.kind].setMatrixAt(headIdx[l.kind]++, m);
      const c = l.kind === 'sodium' ? SODIUM : LED;
      m.compose(
        p
          .copy(l.position)
          .addScaledVector(l.facing, 2.2)
          .setY(l.position.y + 0.04),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
        new THREE.Vector3(13, 13, 1),
      );
      cards.setMatrixAt(i, m);
      cards.setColorAt(i, c);
      this.physics.addStaticCylinder({ x: l.position.x, y: l.position.y + 4, z: l.position.z }, 4, 0.13);
    });
    for (const im of [pole, arm, heads.sodium, heads.led, cards]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
    }
    pole.castShadow = true;
    arm.castShadow = true;
    this.group.add(pole, arm, heads.sodium, heads.led, cards);

    for (let i = 0; i < this.poolSize; i++) {
      const light = new THREE.PointLight(SODIUM, 0, 26, 1.6);
      light.castShadow = false;
      this.pool.push(light);
      this.group.add(light);
    }
  }

  /** Move the light pool to the lamps nearest the camera (cheap, a few times a second). */
  update(dt: number, camPos: THREE.Vector3): void {
    const on = lightUniforms.street.value;
    this.poolTimer -= dt;
    if (this.poolTimer <= 0 && on > 0.01) {
      this.poolTimer = 0.25;
      const ranked = this.lamps
        .map((l) => ({ l, d: l.position.distanceToSquared(camPos) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.pool.length);
      ranked.forEach(({ l }, i) => {
        const light = this.pool[i]!;
        light.position
          .copy(l.position)
          .addScaledVector(l.facing, 1.6)
          .setY(l.position.y + 7.4);
        light.color.copy(l.kind === 'sodium' ? SODIUM : LED);
      });
    }
    for (const light of this.pool) light.intensity = on * 160;
  }
}
