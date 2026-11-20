import * as THREE from 'three/webgpu';
import { HumanoidRig, type Outfit } from '../rig/HumanoidRig';
import * as P from '../rig/poses';
import type { RigInstancer } from '../rig/RigInstancer';
import { mulberry32 } from '../../render/materials/textures';
import type { LaneGraph } from '../../world/roads/LaneGraph';
import type { CrowdHazard } from './Crowd';

/**
 * City-wide pedestrians that walk the pavements of the OSM road graph (the
 * bazaar has its own hand-placed Crowd). Walkers stroll along a road edge,
 * pick a new street at every junction, sometimes cross mid-block, dodge or
 * get knocked down by fast vehicles, and are recycled around the player.
 * M3's recast navmesh crowd will replace the path walking.
 */
interface Walker {
  rig: HumanoidRig;
  pose: Float32Array;
  target: Float32Array;
  from: number;
  to: number;
  t: number;
  side: 1 | -1;
  speed: number;
  phase: number;
  down: number;
  flee: number;
  pos: THREE.Vector3;
  yaw: number;
  active: boolean;
  time: number;
}

const SKIN = [0x5c3a1e, 0x7a4a24, 0x8d5524, 0x9c6339, 0xa86b3c, 0xb07646, 0xc58c5a];
const TOPS = [
  0xf3ead8, 0xdfe8f2, 0xd81b60, 0x1e88e5, 0x43a047, 0xfdd835, 0xff7043, 0x8e24aa, 0x546e7a, 0xffffff,
  0xc62828,
];
const BOTTOMS = [0x2b2f3a, 0x37474f, 0x3e2723, 0x1a237e, 0x5d4037, 0xf3ead8, 0x212121];
const DRAPES = [0xe64a19, 0xd81b60, 0x7b1fa2, 0x00897b, 0xffb300, 0x3949ab];
const UP = new THREE.Vector3(0, 1, 0);

export class PathCrowd {
  private readonly walkers: Walker[] = [];
  private readonly rnd = mulberry32(777);
  private timer = 0;
  density = 1;
  onPlayerHit: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    instancer: RigInstancer,
    private readonly graph: LaneGraph,
    count: number,
  ) {
    const pick = <T>(a: T[]): T => a[Math.floor(this.rnd() * a.length)]!;
    for (let i = 0; i < count; i++) {
      const woman = this.rnd() < 0.45;
      const outfit: Outfit = {
        skin: pick(SKIN),
        top: pick(TOPS),
        bottom: woman ? pick(DRAPES) : pick(BOTTOMS),
        shoes: 0x2a2018,
        hair: 0x111111,
        ...(woman && this.rnd() < 0.7 ? { drape: pick(DRAPES) } : {}),
      };
      const rig = new HumanoidRig(outfit, true);
      rig.root.scale.setScalar(0.9 + this.rnd() * 0.15);
      rig.setVisible(false);
      scene.add(rig.root);
      instancer.add(rig);
      this.walkers.push({
        rig,
        pose: P.newPose(),
        target: P.newPose(),
        from: 0,
        to: 0,
        t: 0,
        side: 1,
        speed: 1 + this.rnd() * 0.5,
        phase: this.rnd() * 10,
        down: 0,
        flee: 0,
        pos: new THREE.Vector3(),
        yaw: 0,
        active: false,
        time: this.rnd() * 100,
      });
    }
  }

  strike(at: THREE.Vector3, dir: THREE.Vector3, range: number): number {
    let n = 0;
    for (const w of this.walkers) {
      if (!w.active || w.down > 0) continue;
      const dx = w.pos.x - at.x;
      const dz = w.pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d < range && (dx * dir.x + dz * dir.z) / Math.max(d, 0.01) > 0.4) {
        w.down = 3;
        w.yaw = Math.atan2(-dir.x, -dir.z);
        P.lying(w.pose);
        n++;
      }
    }
    return n;
  }

  shoot(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = -1;
    let hit: Walker | null = null;
    for (const w of this.walkers) {
      if (!w.active || w.down > 0) continue;
      const t =
        (w.pos.x - origin.x) * dir.x + (w.pos.y + 1 - origin.y) * dir.y + (w.pos.z - origin.z) * dir.z;
      if (t < 0 || t > maxDist || (best >= 0 && t > best)) continue;
      const cx = origin.x + dir.x * t - w.pos.x;
      const cy = origin.y + dir.y * t - (w.pos.y + 1);
      const cz = origin.z + dir.z * t - w.pos.z;
      if (cx * cx + cz * cz < 0.16 && Math.abs(cy) < 0.95) {
        best = t;
        hit = w;
      }
    }
    if (hit) {
      hit.down = 6;
      P.lying(hit.pose);
    }
    return best;
  }

  panic(at: THREE.Vector3, radius: number): void {
    for (const w of this.walkers) {
      if (w.active && w.down <= 0 && w.pos.distanceTo(at) < radius) {
        w.flee = 5 + this.rnd() * 4;
        // Turn to walk away from the danger.
        const a = this.graph.nodes[w.from]!.p;
        const b = this.graph.nodes[w.to]!.p;
        if (b.distanceTo(at) < a.distanceTo(at)) {
          const f = w.from;
          w.from = w.to;
          w.to = f;
          w.t = 1 - w.t;
        }
      }
    }
  }

  get activeCount(): number {
    return this.walkers.filter((w) => w.active).length;
  }

  private spawn(w: Walker, around: THREE.Vector3): boolean {
    const [node] = this.graph.sampleRing(around, 25, 150, 1, this.rnd, false);
    if (!node || !node.links.length) return false;
    const link = node.links[Math.floor(this.rnd() * node.links.length)]!;
    if (link.width > 15) return false;
    w.from = node.id;
    w.to = link.to;
    w.t = this.rnd();
    w.side = this.rnd() < 0.5 ? 1 : -1;
    w.active = true;
    w.down = 0;
    w.rig.setVisible(true);
    return true;
  }

  update(dt: number, player: THREE.Vector3, hazards: CrowdHazard[]): void {
    const target = Math.round(this.walkers.length * this.density);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.5;
      let active = 0;
      for (const w of this.walkers) {
        if (!w.active) continue;
        if (w.pos.distanceTo(player) > 190) {
          w.active = false;
          w.rig.setVisible(false);
        } else active++;
      }
      let budget = 4;
      for (const w of this.walkers) {
        if (active >= target || budget <= 0) break;
        if (w.active) continue;
        budget--;
        if (this.spawn(w, player)) active++;
      }
    }

    const k = 1 - Math.exp(-dt * 10);
    for (const w of this.walkers) {
      if (!w.active) continue;
      w.time += dt;
      const a = this.graph.nodes[w.from]!.p;
      const b = this.graph.nodes[w.to]!.p;
      const len = Math.max(0.1, a.distanceTo(b));
      const link = this.graph.linkBetween(w.from, w.to);
      const off = (link?.width ?? 7) / 2 + 1.5;
      if (w.down > 0) {
        w.down -= dt;
        if (w.down > 1) P.lying(w.target);
        else P.idle(w.target, w.time);
      } else {
        w.flee = Math.max(0, w.flee - dt);
        w.t += ((w.flee > 0 ? 4.2 : w.speed) * dt) / len;
        if (w.t >= 1) {
          const next = this.graph.pickNext(w.from, w.to, this.rnd, false);
          w.from = w.to;
          w.to = next?.to ?? w.from;
          w.t = 0;
          if (this.rnd() < 0.08) w.side = (w.side * -1) as 1 | -1; // cross the street
        }
        if (w.flee > 0) P.locomotion(w.target, (w.phase += dt * 9), 5.5);
        else P.locomotion(w.target, (w.phase += dt * 5.6 * w.speed), w.speed);
      }
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      w.pos.set(
        a.x + (b.x - a.x) * w.t + dz * off * w.side,
        a.y + (b.y - a.y) * w.t,
        a.z + (b.z - a.z) * w.t - dx * off * w.side,
      );
      if (w.down <= 0) w.yaw = Math.atan2(dx, dz);
      // Vehicles.
      for (const h of hazards) {
        const hx = w.pos.x - h.position.x;
        const hz = w.pos.z - h.position.z;
        const d = Math.hypot(hx, hz);
        const sp = h.velocity.length();
        if (w.down <= 0 && sp > 4 && d < h.radius + 0.35) {
          if (h.player) this.onPlayerHit?.();
          w.down = 2.8;
          P.lying(w.pose);
        }
      }
      w.rig.root.position.copy(w.pos);
      w.rig.root.quaternion.setFromAxisAngle(UP, w.yaw);
      P.blendPose(w.pose, w.target, w.down > 0 ? 1 - Math.exp(-dt * 4) : k);
      w.rig.applyPose(w.pose);
    }
  }
}
