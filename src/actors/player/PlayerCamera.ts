import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Groups } from '../../physics/layers';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { SeatDef } from '../vehicles/VehicleProfile';
import type { Vehicle } from '../vehicles/Vehicle';

export type CameraMode = 'follow' | 'vehicle' | 'firstPerson';

export interface CameraContext {
  /** Player feet (interpolated) when on foot. */
  playerPos: THREE.Vector3;
  crouched: boolean;
  vehicle: Vehicle | null;
  seat: SeatDef | null;
  firstPerson: boolean;
  lookX: number;
  lookY: number;
  wheel: number;
  sensitivity: number;
  invertY: boolean;
  excludeBody: RAPIER.RigidBody | null;
  aiming?: boolean;
}

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Third-person orbit camera with collision (on foot), chase camera that
 * recentres behind the vehicle with speed-based pull-back and FOV, and a
 * first-person / window camera for drivers and passengers (bus window view).
 */
export class PlayerCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'follow';
  yaw = 0;
  pitch = 0.22;
  private distance = 4.2;
  private currentDist = 4.2;
  private sinceLook = 99;
  private fpYaw = 0;
  private fpPitch = 0;
  private baseFov = 65;
  /** 0..1 indoor blend from the interior system (shorter arm, narrower FOV). */
  indoor = 0;
  private readonly smoothTarget = new THREE.Vector3();
  private initialised = false;

  constructor(
    private readonly physics: PhysicsWorld,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 5200);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, ctx: CameraContext): void {
    const sens = 0.0022 * ctx.sensitivity;
    const dx = ctx.lookX * sens;
    const dy = ctx.lookY * sens * (ctx.invertY ? -1 : 1);
    if (Math.abs(ctx.lookX) + Math.abs(ctx.lookY) > 0.5) this.sinceLook = 0;
    else this.sinceLook += dt;

    const prevMode = this.mode;
    this.mode = ctx.vehicle ? (ctx.firstPerson ? 'firstPerson' : 'vehicle') : 'follow';
    if (this.mode !== prevMode && this.mode === 'firstPerson') {
      this.fpYaw = 0;
      this.fpPitch = 0;
    }

    let fov = this.baseFov;
    if (this.mode === 'firstPerson' && ctx.vehicle && ctx.seat) {
      this.updateFirstPerson(dx, dy, ctx.vehicle, ctx.seat);
      fov = 72;
    } else {
      this.yaw -= dx;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -1.1, 1.2);
      if (ctx.wheel !== 0) this.distance = THREE.MathUtils.clamp(this.distance + ctx.wheel * 0.5, 1.8, 9);

      let dist = this.distance;
      if (this.mode === 'vehicle' && ctx.vehicle) {
        const v = ctx.vehicle;
        const cam = v.profile.camera;
        const speed = Math.abs(v.physics.speed);
        _target.set(0, cam.lookHeight, 0).applyMatrix4(v.root.matrixWorld);
        // Recentre behind the vehicle when the mouse is idle.
        if (this.sinceLook > 1.2) {
          const behindYaw = v.physics.speed < -1 ? v.physics.yaw + Math.PI : v.physics.yaw;
          let d = behindYaw - this.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          this.yaw += d * Math.min(1, dt * (1.5 + speed * 0.12));
          const defaultPitch = Math.atan2(cam.height - cam.lookHeight, cam.distance);
          this.pitch += (defaultPitch - this.pitch) * Math.min(1, dt * 1.5);
        }
        dist = cam.distance * (this.distance / 4.2) + speed * 0.05;
        fov = cam.fov + Math.min(14, speed * 0.32);
      } else {
        if (this.indoor > 0) {
          dist = THREE.MathUtils.lerp(dist, Math.min(dist, 2.2), this.indoor);
          fov -= 5 * this.indoor;
        }
        if (ctx.aiming) {
          dist = 1.9;
          fov = 50;
        }
        _target.copy(ctx.playerPos);
        _target.y += ctx.crouched ? 1.15 : ctx.aiming ? 1.62 : 1.55;
        // Over-the-shoulder offset (to the character's right).
        const shoulder = ctx.aiming ? 0.62 : 0.38;
        _target.x += -Math.cos(this.yaw) * shoulder;
        _target.z += Math.sin(this.yaw) * shoulder;
      }

      if (!this.initialised) {
        this.smoothTarget.copy(_target);
        this.initialised = true;
      }
      this.smoothTarget.lerp(_target, 1 - Math.exp(-dt * (this.mode === 'vehicle' ? 14 : 20)));

      _dir.set(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      // Collision: pull in instantly, ease back out.
      const hit = this.physics.castRay(
        this.smoothTarget,
        _dir,
        dist + 0.3,
        Groups.CAMERA_QUERY,
        ctx.excludeBody ?? undefined,
      );
      const allowed = hit ? Math.max(0.6, hit.distance - 0.3) : dist;
      this.currentDist =
        allowed < this.currentDist
          ? allowed
          : this.currentDist + (allowed - this.currentDist) * Math.min(1, dt * 3);
      _desired.copy(this.smoothTarget).addScaledVector(_dir, this.currentDist);
      // Never dip under the ground.
      // Probe from just above the camera: starting 2 m up would begin inside ceilings (interiors) and lift it onto the roof.
      const gy = this.physics.groundHeight(
        _desired.x,
        _desired.z,
        _desired.y + (this.indoor > 0 ? 0.4 : 2),
        -100,
      );
      if (_desired.y < gy + 0.25) _desired.y = gy + 0.25;
      this.camera.position.copy(_desired);
      this.camera.lookAt(this.smoothTarget);
    }

    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateFirstPerson(dx: number, dy: number, vehicle: Vehicle, seat: SeatDef): void {
    this.fpYaw = THREE.MathUtils.clamp(this.fpYaw - dx, -2.4, 2.4);
    this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - dy, -0.9, 0.7);
    vehicle.seatHeadWorld(seat, this.camera.position);
    // Window seats look out of their side window; others look ahead.
    const base = seat.window === 'left' ? Math.PI / 2 : seat.window === 'right' ? -Math.PI / 2 : 0;
    _e.set(this.fpPitch, base + this.fpYaw + Math.PI, 0, 'YXZ');
    _q.setFromEuler(_e);
    this.camera.quaternion.copy(vehicle.root.quaternion).multiply(_q);
    // Keep the third-person yaw roughly in sync for when we switch back.
    this.yaw = vehicle.physics.yaw;
    this.smoothTarget.copy(this.camera.position);
  }

  /** Forward direction on the ground plane for on-foot movement. */
  get moveYaw(): number {
    return this.yaw;
  }
}
