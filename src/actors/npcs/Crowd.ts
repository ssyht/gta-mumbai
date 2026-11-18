import * as THREE from 'three/webgpu';
import { HumanoidRig, type Outfit } from '../rig/HumanoidRig';
import * as P from '../rig/poses';
import type { RigInstancer } from '../rig/RigInstancer';
import { mulberry32 } from '../../render/materials/textures';

/**
 * Street crowd for the bazaar (precursor to the M3 recast/Detour crowd):
 * pavement walkers, idle groups at stalls, jaywalkers. People dodge fast
 * vehicles, get knocked down when hit, and thin out late at night.
 */
export interface CrowdArea {
  x0: number;
  x1: number;
  /** Pavement centre lines (z) people walk along. */
  lanes: number[];
  /** Street centre z (jaywalkers cross it). */
  streetZ: number;
  /** Half-width of the carriageway; outside it people stand on the raised pavement. */
  roadHalf: number;
  groundY: number;
}

export interface CrowdHazard {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Rough radius of the vehicle footprint. */
  radius: number;
}

type Mode = 'walk' | 'idle' | 'cross' | 'dodge' | 'down';

interface Person {
  rig: HumanoidRig;
  pose: Float32Array;
  target: Float32Array;
  pos: THREE.Vector3;
  yaw: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  phase: number;
  mode: Mode;
  timer: number;
  crossTo: number;
  t: number;
  /** Share of the day-time crowd this person belongs to (0..1); hidden when density is lower. */
  rank: number;
}

const SKIN = [0x5c3a1e, 0x7a4a24, 0x8d5524, 0x9c6339, 0xa86b3c, 0xb07646, 0xc58c5a];
const HAIR = [0x0b0b0b, 0x141414, 0x1d1712, 0x2a2018, 0x6b6b6b];
const TOPS = [
  0xf3ead8, 0xdfe8f2, 0xd81b60, 0x1e88e5, 0x43a047, 0xfdd835, 0xff7043, 0x8e24aa, 0x546e7a, 0xffffff,
  0xc62828, 0x00897b, 0xf06292,
];
const BOTTOMS = [0x2b2f3a, 0x37474f, 0x3e2723, 0x1a237e, 0x5d4037, 0xf3ead8, 0x212121, 0x6d6d6d];
const DRAPES = [0xe64a19, 0xd81b60, 0x7b1fa2, 0x00897b, 0xffb300, 0x3949ab, 0xc2185b];

export class Crowd {
  private readonly people: Person[] = [];
  private density = 1;
  private readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    scene: THREE.Scene,
    instancer: RigInstancer,
    private readonly area: CrowdArea,
    count: number,
    idleSpots: THREE.Vector3[],
    seed = 26,
  ) {
    const rnd = mulberry32(seed);
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    for (let i = 0; i < count; i++) {
      const woman = rnd() < 0.42;
      const outfit: Outfit = {
        skin: pick(SKIN),
        top: pick(TOPS),
        bottom: woman ? pick(DRAPES) : pick(BOTTOMS),
        shoes: rnd() < 0.5 ? 0x3e2723 : 0x1a1a1a,
        hair: pick(HAIR),
        ...(woman && rnd() < 0.75 ? { drape: pick(DRAPES) } : {}),
        ...(!woman && rnd() < 0.08 ? { cap: 0xf5f5f5 } : {}),
      };
      const rig = new HumanoidRig(outfit, true);
      const s = 0.9 + rnd() * 0.15 - (woman ? 0.05 : 0);
      rig.root.scale.setScalar(s);
      scene.add(rig.root);
      instancer.add(rig);
      const idle = i < idleSpots.length;
      const lane = pick(area.lanes) + (rnd() - 0.5) * 1.2;
      const spot = idle ? idleSpots[i]! : null;
      const p: Person = {
        rig,
        pose: P.newPose(),
        target: P.newPose(),
        pos: spot
          ? spot.clone()
          : new THREE.Vector3(area.x0 + rnd() * (area.x1 - area.x0), area.groundY, lane),
        yaw: 0,
        dir: rnd() < 0.5 ? 1 : -1,
        lane,
        speed: 1.0 + rnd() * 0.6,
        phase: rnd() * 10,
        mode: idle ? 'idle' : 'walk',
        timer: rnd() * 10,
        crossTo: lane,
        t: rnd() * 100,
        rank: idle ? rnd() * 0.5 : rnd(),
      };
      p.yaw = idle ? rnd() * Math.PI * 2 : p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.people.push(p);
    }
  }

  /** 0..1 from the city rhythm (rush hour vs 3 AM). */
  setDensity(d: number): void {
    this.density = d;
  }

  get activeCount(): number {
    return this.people.filter((p) => p.rig.root.visible).length;
  }

  update(dt: number, player: THREE.Vector3, hazards: CrowdHazard[]): void {
    const a = this.area;
    const k = 1 - Math.exp(-dt * 10);
    for (const p of this.people) {
      const visible = p.rank <= this.density;
      p.rig.root.visible = visible;
      if (!visible) continue;
      p.t += dt;
      p.timer -= dt;

      // Danger: a vehicle coming at us.
      if (p.mode !== 'down') {
        for (const h of hazards) {
          const dx = p.pos.x - h.position.x;
          const dz = p.pos.z - h.position.z;
          const dist = Math.hypot(dx, dz);
          const speed = h.velocity.length();
          if (speed > 4 && dist < h.radius + 0.35) {
            p.mode = 'down';
            p.timer = 2.8;
            p.yaw = Math.atan2(h.velocity.x, h.velocity.z) + Math.PI;
            p.pos.x += (h.velocity.x / speed) * 1.5;
            p.pos.z += (h.velocity.z / speed) * 1.5;
            P.lying(p.pose);
            break;
          }
          if (speed > 3 && dist < h.radius + 4) {
            const approaching = -(dx * h.velocity.x + dz * h.velocity.z) / Math.max(0.01, dist);
            if (approaching > 2) {
              p.mode = 'dodge';
              p.timer = 0.8;
              // Leap sideways, away from the vehicle's path.
              const side = Math.sign(dx * -h.velocity.z + dz * h.velocity.x) || 1;
              p.crossTo = p.pos.z + side * (h.velocity.x / speed) * 2.5;
            }
          }
        }
      }

      switch (p.mode) {
        case 'walk': {
          p.pos.x += p.dir * p.speed * dt;
          p.pos.z += (p.lane - p.pos.z) * Math.min(1, dt * 2);
          if (p.pos.x > a.x1) p.dir = -1;
          if (p.pos.x < a.x0) p.dir = 1;
          // Step around the player.
          const pdx = p.pos.x - player.x;
          const pdz = p.pos.z - player.z;
          if (Math.abs(pdx) < 1.2 && Math.abs(pdz) < 0.8) p.pos.z += Math.sign(pdz || 1) * dt * 1.5;
          p.yaw = Math.atan2(p.dir, 0);
          P.locomotion(p.target, (p.phase += dt * 5.6 * p.speed), p.speed);
          if (p.timer < 0) {
            p.timer = 8 + Math.random() * 20;
            if (Math.random() < 0.25) {
              // Jaywalk across to the other pavement (Mumbai rules).
              p.mode = 'cross';
              p.crossTo = a.lanes.reduce(
                (best, l) => (Math.abs(l - p.pos.z) > Math.abs(best - p.pos.z) ? l : best),
                p.lane,
              );
            } else if (Math.random() < 0.2) {
              p.mode = 'idle';
              p.timer = 3 + Math.random() * 6;
            }
          }
          break;
        }
        case 'cross': {
          const dz = p.crossTo - p.pos.z;
          const step = Math.sign(dz) * Math.min(Math.abs(dz), p.speed * dt);
          p.pos.z += step;
          p.pos.x += p.dir * p.speed * 0.3 * dt;
          p.yaw = Math.atan2(p.dir * 0.3, Math.sign(dz) || 1);
          P.locomotion(p.target, (p.phase += dt * 5.6 * p.speed), p.speed);
          if (Math.abs(dz) < 0.05) {
            p.lane = p.crossTo;
            p.mode = 'walk';
          }
          break;
        }
        case 'dodge': {
          p.pos.z += (p.crossTo - p.pos.z) * Math.min(1, dt * 6);
          P.airborne(p.target, true, p.t);
          if (p.timer < 0) p.mode = 'walk';
          break;
        }
        case 'idle': {
          P.idle(p.target, p.t);
          if (p.timer < 0 && p.rank > 0.5) {
            p.mode = 'walk';
            p.timer = 10 + Math.random() * 20;
          } else if (p.timer < 0) {
            p.timer = 5 + Math.random() * 10;
            p.yaw += (Math.random() - 0.5) * 1.2; // look around
          }
          break;
        }
        case 'down': {
          if (p.timer > 1.0) P.lying(p.target);
          else P.idle(p.target, p.t);
          if (p.timer < 0) {
            p.mode = 'walk';
            p.timer = 5;
          }
          break;
        }
      }
      P.blendPose(p.pose, p.target, p.mode === 'down' ? 1 - Math.exp(-dt * 4) : k);
      p.pos.y = Math.abs(p.pos.z - a.streetZ) > a.roadHalf ? a.groundY : 0.02;
      p.rig.root.position.copy(p.pos);
      p.rig.root.quaternion.setFromAxisAngle(this.UP, p.yaw);
      p.rig.applyPose(p.pose);
    }
  }
}
