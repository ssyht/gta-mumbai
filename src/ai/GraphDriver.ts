import * as THREE from 'three/webgpu';
import type { VehicleDriverAI } from '../actors/vehicles/Vehicle';
import type { VehiclePhysics } from '../physics/VehiclePhysics';
import { CLASS_SPEED, type LaneGraph } from '../world/roads/LaneGraph';

export interface GraphDriverOptions {
  cruise: number;
  halfWidth: number;
  halfLength: number;
  obstacles: () => THREE.Vector3[];
  rnd: () => number;
}

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Ambient traffic driver: wanders the lane graph keeping LEFT (India), slows
 * for turns and junctions, brakes and leans on the horn when something is in
 * the way, and reports when it is hopelessly stuck so the traffic system can
 * recycle it.
 */
export class GraphDriver implements VehicleDriverAI {
  wantHorn = false;
  prev = -1;
  cur = -1;
  next = -1;
  stuckTime = 0;
  private hornTimer = 0;
  private blockedTime = 0;
  private speedLimit = 8;
  private laneOff = 2;

  constructor(
    private readonly vehicle: VehiclePhysics,
    private readonly graph: LaneGraph,
    private readonly opts: GraphDriverOptions,
  ) {}

  /** Start on the segment prev → cur. */
  start(prev: number, cur: number): void {
    this.prev = prev;
    this.cur = cur;
    this.next = this.graph.pickNext(prev, cur, this.opts.rnd)?.to ?? prev;
    this.updateSegment();
    this.stuckTime = 0;
  }

  private updateSegment(): void {
    const link = this.graph.linkBetween(this.prev, this.cur);
    const w = link?.width ?? 8;
    this.laneOff = Math.max(1.2, Math.min(3.6, w / 4));
    this.speedLimit = Math.min(this.opts.cruise, CLASS_SPEED[link?.cls ?? 'residential'] ?? 8);
  }

  /** Lane point near node `at` on the segment from → to (offset left of travel). */
  private lanePoint(from: number, to: number, at: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.graph.nodes[from]!.p;
    const b = this.graph.nodes[to]!.p;
    _a.subVectors(b, a).setY(0).normalize();
    const n = this.graph.nodes[at]!.p;
    return out.set(n.x + _a.z * this.laneOff, 0, n.z - _a.x * this.laneOff);
  }

  fixedUpdate(dt: number): void {
    const v = this.vehicle;
    const c = v.controls;
    this.hornTimer = Math.max(0, this.hornTimer - dt);
    this.wantHorn = this.hornTimer > 0.2;
    if (this.cur < 0) {
      c.throttle = 0;
      c.brake = 1;
      return;
    }
    const p = v.getPosition(_p);
    const f = v.forward(_f).setY(0).normalize();
    const target = this.lanePoint(this.prev, this.cur, this.cur, _b);
    const dist = Math.hypot(target.x - p.x, target.z - p.z);
    const toT = _a.set(target.x - p.x, 0, target.z - p.z);
    if (dist < 4.5 || (dist < 12 && toT.dot(f) < 0)) {
      this.prev = this.cur;
      this.cur = this.next;
      this.next = this.graph.pickNext(this.prev, this.cur, this.opts.rnd)?.to ?? this.prev;
      this.updateSegment();
      return;
    }
    // Aim a little past the node toward the next segment for smooth turns.
    const aim = this.lanePoint(this.prev, this.cur, this.cur, _b);
    if (dist < 14 && this.next >= 0 && this.next !== this.cur) {
      const after = this.lanePoint(this.cur, this.next, this.cur, new THREE.Vector3());
      aim.lerp(after, 1 - dist / 14);
    }
    aim.sub(p).setY(0);
    const crossY = f.z * aim.x - f.x * aim.z;
    const angle = Math.atan2(Math.abs(crossY), f.dot(aim)) * Math.sign(crossY);
    c.steer = Math.max(-1, Math.min(1, (angle / v.tuning.steering.maxAngle) * 1.25));

    // Slow for the turn coming up at the next node.
    let desired = this.speedLimit * Math.max(0.35, 1 - Math.abs(angle) / 1.2);
    if (this.next >= 0) {
      const a = this.graph.nodes[this.prev]!.p;
      const b = this.graph.nodes[this.cur]!.p;
      const n2 = this.graph.nodes[this.next]!.p;
      const d1 = _a.subVectors(b, a).setY(0).normalize();
      const d2 = new THREE.Vector3().subVectors(n2, b).setY(0).normalize();
      const turn = Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
      if (dist < 25) desired = Math.min(desired, this.speedLimit * Math.max(0.3, 1 - turn / 1.6));
    }

    if (this.blocked(p, f)) {
      desired = 0;
      this.blockedTime += dt;
      if (this.hornTimer === 0 && this.blockedTime > 0.6 && this.opts.rnd() < 0.08)
        this.hornTimer = 0.3 + this.opts.rnd() * 0.5;
    } else {
      this.blockedTime = 0;
    }

    const speed = v.speed;
    const err = desired - speed;
    c.handbrake = false;
    if (desired < 0.1 && speed < 0.5) {
      c.throttle = 0;
      c.brake = 0.6;
    } else if (err > 0) {
      c.throttle = Math.min(1, err * 0.4 + 0.15);
      c.brake = 0;
    } else {
      c.throttle = 0;
      c.brake = Math.min(1, -err * 0.3);
    }
    if (Math.abs(speed) < 0.4 && this.blockedTime === 0) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
  }

  private blocked(p: THREE.Vector3, fwd: THREE.Vector3): boolean {
    const lx = fwd.z;
    const lz = -fwd.x;
    const reach = this.opts.halfLength + 2.5 + Math.max(0, this.vehicle.speed) * 1.0;
    for (const o of this.opts.obstacles()) {
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const ahead = dx * fwd.x + dz * fwd.z;
      if (ahead < this.opts.halfLength * 0.6 || ahead > reach) continue;
      const side = dx * lx + dz * lz;
      if (Math.abs(side) < this.opts.halfWidth + 0.8) return true;
    }
    return false;
  }
}
