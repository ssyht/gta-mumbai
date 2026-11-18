import { Vector3 } from 'three/webgpu';
import type { VehicleDriverAI } from '../actors/vehicles/Vehicle';
import type { VehiclePhysics } from '../physics/VehiclePhysics';

export interface RouteStop {
  index: number;
  dwell: number;
  name: string;
}

export interface Route {
  points: Vector3[];
  stops: RouteStop[];
}

export interface WaypointDriverOptions {
  cruise: number;
  /** Bus: always runs the route. Auto: only drives while it has a fare. */
  alwaysDrive: boolean;
  halfWidth: number;
  halfLength: number;
  /** World positions the driver must not run into (player on foot, other vehicles). */
  obstacles: () => Vector3[];
  onStop?: (stop: RouteStop) => void;
}

const _pos = new Vector3();
const _fwd = new Vector3();
const _to = new Vector3();

/**
 * Minimal lane-following driver for M1: follows a looped waypoint route on the
 * left lane (India drives on the left), slows for corners, dwells at stops,
 * stops on request, and honks at anything in its way. M3 replaces the route
 * with the OSM lane graph (CLAUDE.md §4.3).
 */
export class WaypointDriver implements VehicleDriverAI {
  active: boolean;
  stopRequested = false;
  wantHorn = false;
  /** True once the vehicle has come to rest after `requestStop()`. */
  stoppedForRequest = false;
  private target: number;
  private dwell = 0;
  private servedStop = -1;
  private hornTimer = 0;
  private blockedTime = 0;

  constructor(
    private readonly vehicle: VehiclePhysics,
    private readonly route: Route,
    private readonly opts: WaypointDriverOptions,
  ) {
    this.active = opts.alwaysDrive;
    this.target = this.nearestIndexAhead();
  }

  private nearestIndexAhead(): number {
    const p = this.vehicle.getPosition(_pos);
    const f = this.vehicle.forward(_fwd);
    let best = 0;
    let bestD = Infinity;
    this.route.points.forEach((q, i) => {
      _to.subVectors(q, p);
      const d = _to.length();
      if (_to.dot(f) > 0 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  requestStop(): void {
    this.stopRequested = true;
    this.stoppedForRequest = false;
  }

  resume(): void {
    this.stopRequested = false;
    this.stoppedForRequest = false;
  }

  /** Index of the waypoint the driver is heading to. */
  get targetIndex(): number {
    return this.target;
  }

  fixedUpdate(dt: number): void {
    const v = this.vehicle;
    const c = v.controls;
    const pts = this.route.points;
    const n = pts.length;
    const speed = v.speed;
    this.hornTimer = Math.max(0, this.hornTimer - dt);
    this.wantHorn = this.hornTimer > 0.25;

    if (!this.active) {
      c.throttle = 0;
      c.brake = 1;
      c.handbrake = true;
      c.steer = 0;
      return;
    }
    c.handbrake = false;

    const p = v.getPosition(_pos);
    const f = v.forward(_fwd);
    // Advance through waypoints we've reached or passed.
    for (let guard = 0; guard < n; guard++) {
      _to.subVectors(pts[this.target]!, p).setY(0);
      const d = _to.length();
      if (d < 7 || (d < 18 && _to.dot(f) < 0)) this.target = (this.target + 1) % n;
      else break;
    }
    // Steer toward a point a little further along for smooth lines.
    const look = pts[(this.target + 1) % n]!;
    const aim = _to.copy(pts[this.target]!).lerp(look, 0.35).sub(p).setY(0);
    const fwdFlat = f.clone().setY(0).normalize();
    const angle = Math.atan2(fwdFlat.x * aim.z - fwdFlat.z * aim.x, fwdFlat.dot(aim));
    // Positive steer = left; cross(f, aim).y > 0 means aim is to the left.
    const crossY = fwdFlat.z * aim.x - fwdFlat.x * aim.z;
    const steerAngle = Math.sign(crossY) * Math.abs(angle);
    c.steer = Math.max(-1, Math.min(1, (steerAngle / v.tuning.steering.maxAngle) * 1.3));

    let desired = this.opts.cruise * Math.max(0.4, 1 - Math.abs(steerAngle) / 1.1);

    // Scheduled stops.
    const stop = this.route.stops.find(
      (s) => s.index === this.target || s.index === (this.target + n - 1) % n,
    );
    if (stop && this.servedStop !== stop.index) {
      const dist = _to.subVectors(pts[stop.index]!, p).setY(0).length();
      desired = Math.min(desired, Math.sqrt(2 * 1.4 * Math.max(0, dist - 2)));
      if (dist < 6 && Math.abs(speed) < 0.6) {
        this.dwell += dt;
        desired = 0;
        if (this.dwell === dt) this.opts.onStop?.(stop);
        if (this.dwell > stop.dwell) {
          this.servedStop = stop.index;
          this.dwell = 0;
        }
      }
    } else if (!stop) {
      this.servedStop = -1;
    }

    // Stop on request (passenger said "ruko!").
    if (this.stopRequested) {
      desired = 0;
      if (Math.abs(speed) < 0.4) this.stoppedForRequest = true;
    }

    // Don't run people over; honk at them instead (Mumbai rules).
    if (this.blocked(p, fwdFlat)) {
      desired = 0;
      this.blockedTime += dt;
      if (this.hornTimer === 0 && this.blockedTime > 0.4) this.hornTimer = 0.5 + Math.random() * 0.4;
    } else {
      this.blockedTime = 0;
    }

    const err = desired - speed;
    if (desired < 0.05 && speed < 0.5) {
      c.throttle = 0;
      c.brake = 0.6;
      c.handbrake = true;
    } else if (err > 0) {
      c.throttle = Math.min(1, err * 0.45 + 0.1);
      c.brake = 0;
    } else {
      c.throttle = 0;
      c.brake = Math.min(1, -err * 0.35);
    }
  }

  private blocked(p: Vector3, fwd: Vector3): boolean {
    const left = _to.set(fwd.z, 0, -fwd.x);
    const reach = this.opts.halfLength + 2 + Math.max(0, this.vehicle.speed) * 1.1;
    for (const o of this.opts.obstacles()) {
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const ahead = dx * fwd.x + dz * fwd.z;
      const side = dx * left.x + dz * left.z;
      if (ahead > this.opts.halfLength * 0.5 && ahead < reach && Math.abs(side) < this.opts.halfWidth + 0.9)
        return true;
    }
    return false;
  }
}
