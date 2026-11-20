import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { VehicleProfile } from '../actors/vehicles/VehicleProfile';
import { Groups } from './layers';
import type { PhysicsWorld } from './PhysicsWorld';

/** Driver inputs, written by the player or an AI driver every fixed step. */
export interface VehicleControls {
  /** 0..1 accelerator. */
  throttle: number;
  /** 0..1 brake (reverses when stopped). */
  brake: number;
  /** -1..1, positive = left. */
  steer: number;
  handbrake: boolean;
}

/** Live-tunable physics parameters (copied from the profile, edited by the dev panel). */
export type VehicleTuning = Pick<
  VehicleProfile,
  'suspension' | 'tyres' | 'engine' | 'steering' | 'stability'
> & {
  comHeight: number;
};

const UP = new Vector3(0, 1, 0);

/**
 * Per-class drivetrain + aero (GAME_SPEC §6.1): gear count, redline, drag and
 * downforce coefficients (N per (m/s)²), and how tough the body is.
 */
const DRIVETRAIN: Record<
  string,
  { gears: number; redline: number; drag: number; downforce: number; toughness: number }
> = {
  car: { gears: 5, redline: 6200, drag: 0.42, downforce: 0.12, toughness: 1 },
  auto: { gears: 4, redline: 5600, drag: 0.4, downforce: 0, toughness: 0.8 },
  twoWheeler: { gears: 1, redline: 8500, drag: 0.22, downforce: 0, toughness: 0.7 },
  bus: { gears: 5, redline: 2600, drag: 3.2, downforce: 0, toughness: 3 },
  truck: { gears: 6, redline: 2500, drag: 2.6, downforce: 0, toughness: 2.6 },
};
const IDLE_RPM = 800;
/** Velocity change in one 60 Hz step above this (m/s) counts as a crash. */
const IMPACT_DV = 2.5;
const _q = new Quaternion();
const _fwd = new Vector3();
const _left = new Vector3();
const _up = new Vector3();
const _v = new Vector3();

/**
 * Rapier DynamicRayCastVehicleController wrapper (CLAUDE.md §5). Pure physics
 * and control logic, no rendering, so it runs headless in unit tests.
 * Chassis frame: +Z forward, +X left, +Y up.
 */
export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  readonly tuning: VehicleTuning;
  steerAngle = 0;
  /** Fired once each time a heavy vehicle comes to rest under braking. */
  onAirBrake: (() => void) | null = null;
  /** Crash callback: Δv (m/s) and the impact direction in the vehicle frame (pointing into the body). */
  onImpact: ((dv: number, localDir: Vector3) => void) | null = null;
  /** Body/engine health 0..1000 (GAME_SPEC §6.2). */
  health = 1000;
  /** Weather/surface grip multiplier (wet asphalt ≈ 0.75). */
  gripScale = 1;
  gear = 1;
  rpm = IDLE_RPM;
  private shiftTimer = 0;
  private stallTimer = 0;
  private appliedGrip = 1;
  private readonly prevVel = new Vector3();
  private hasPrev = false;

  private readonly physics: PhysicsWorld;
  private readonly profile: VehicleProfile;
  private readonly driveCount: number;
  private wasMoving = false;
  private flippedTime = 0;
  private stopHold = 0;

  constructor(physics: PhysicsWorld, profile: VehicleProfile, position: Vector3, yaw: number) {
    this.physics = physics;
    this.profile = profile;
    const R = physics.R;
    this.tuning = structuredClone({
      suspension: profile.suspension,
      tyres: profile.tyres,
      engine: profile.engine,
      steering: profile.steering,
      stability: profile.stability,
      comHeight: profile.chassis.centerOfMass[1],
    });
    _q.setFromAxisAngle(UP, yaw);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(profile.chassis.linearDamping)
        .setAngularDamping(profile.chassis.angularDamping)
        .setCanSleep(false),
    );
    const [hx, hy, hz] = profile.chassis.halfExtents;
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.4)
        .setRestitution(0.05)
        .setCollisionGroups(Groups.VEHICLE_CHASSIS)
        .setMassProperties(profile.chassis.mass, this.comVector(), this.inertia(), {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
        }),
      this.body,
    );

    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const w of profile.wheels) {
      const [x, y, z] = w.position;
      const rest = profile.suspension.restLength;
      this.controller.addWheel(
        { x, y: y + rest, z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        rest,
        w.radius,
      );
    }
    this.driveCount = profile.wheels.filter((w) => w.drive).length;
    this.applyTuning();
  }

  private comVector(): RAPIER.Vector {
    const c = this.profile.chassis.centerOfMass;
    return { x: c[0], y: this.tuning?.comHeight ?? c[1], z: c[2] };
  }

  private inertia(): RAPIER.Vector {
    const [hx, hy, hz] = this.profile.chassis.halfExtents;
    const m = this.profile.chassis.mass * this.profile.chassis.inertiaScale;
    return {
      x: (m / 3) * (hy * hy + hz * hz),
      y: (m / 3) * (hx * hx + hz * hz),
      z: (m / 3) * (hx * hx + hy * hy),
    };
  }

  /** Push the current tuning into Rapier (called after dev-panel edits). */
  applyTuning(): void {
    const t = this.tuning;
    const c = this.controller;
    this.profile.wheels.forEach((_w, i) => {
      c.setWheelSuspensionRestLength(i, t.suspension.restLength);
      c.setWheelSuspensionStiffness(i, t.suspension.stiffness);
      c.setWheelSuspensionCompression(i, t.suspension.compression);
      c.setWheelSuspensionRelaxation(i, t.suspension.relaxation);
      c.setWheelMaxSuspensionTravel(i, t.suspension.maxTravel);
      c.setWheelMaxSuspensionForce(i, t.suspension.maxForce);
      c.setWheelFrictionSlip(i, t.tyres.frictionSlip);
      c.setWheelSideFrictionStiffness(i, t.tyres.sideFrictionStiffness);
    });
    this.collider.setMassProperties(this.profile.chassis.mass, this.comVector(), this.inertia(), {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
  }

  /** Signed forward speed in m/s. */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  get speedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  getPosition(out = new Vector3()): Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  getQuaternion(out = new Quaternion()): Quaternion {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.getQuaternion(_q));
  }

  /** Heading around +Y (0 = facing +Z). */
  get yaw(): number {
    this.forward(_fwd);
    return Math.atan2(_fwd.x, _fwd.z);
  }

  /** How upright the chassis is (1 = level, 0 = on its side, -1 = upside down). */
  get uprightness(): number {
    return _up.set(0, 1, 0).applyQuaternion(this.getQuaternion(_q)).y;
  }

  /** True when the vehicle has been on its side/roof and nearly still for a while. */
  get isFlipped(): boolean {
    return this.flippedTime > 1.5;
  }

  fixedUpdate(dt: number): void {
    const t = this.tuning;
    const c = this.controls;
    const v = this.speed;
    const top = t.engine.topSpeedKmh / 3.6;
    const topRev = t.engine.reverseTopSpeedKmh / 3.6;

    this.detectImpact();
    const dtc = DRIVETRAIN[this.profile.class] ?? DRIVETRAIN.car!;
    // Automatic gearbox: rpm from speed within the current gear's band.
    const gearTop = (g: number): number => top * Math.pow(g / dtc.gears, 0.85);
    const absV = Math.abs(v);
    this.rpm = IDLE_RPM + (dtc.redline - IDLE_RPM) * Math.min(1, absV / gearTop(this.gear));
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.shiftTimer === 0 && dtc.gears > 1) {
      if (this.rpm > dtc.redline * 0.93 && this.gear < dtc.gears) {
        this.gear++;
        this.shiftTimer = 0.22;
      } else if (this.gear > 1 && absV < gearTop(this.gear - 1) * 0.75) {
        this.gear--;
        this.shiftTimer = 0.12;
      }
    }
    const rpmT = (this.rpm - IDLE_RPM) / (dtc.redline - IDLE_RPM);
    const torque = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, rpmT * 1.1 + 0.05));
    const gearMul = dtc.gears > 1 ? 1.35 - (0.55 * (this.gear - 1)) / (dtc.gears - 1) : 1;
    // Badly damaged engines stall now and then.
    this.stallTimer = Math.max(0, this.stallTimer - dt);
    if (this.health < 150 && this.stallTimer === 0 && Math.random() < dt * 0.25) this.stallTimer = 1.2;
    const enginePower =
      this.health <= 0
        ? 0
        : (this.shiftTimer > 0 ? 0.2 : 1) * (this.stallTimer > 0 ? 0 : 1) * torque * gearMul;

    let engine = 0;
    let brake = 0;
    const thr = Math.max(0, Math.min(1, c.throttle));
    const brk = Math.max(0, Math.min(1, c.brake));
    if (thr > 0.02) {
      if (v < -0.8) brake = t.engine.brakeForce * thr;
      else engine = t.engine.force * enginePower * thr * Math.max(0, Math.min(1, (top - v) / (top * 0.12)));
    }
    if (brk > 0.02) {
      if (v > 0.8) {
        brake = Math.max(brake, t.engine.brakeForce * brk);
        this.stopHold = 0;
      } else if (thr <= 0.02) {
        // Come to a full stop and hold briefly before reversing.
        this.stopHold += dt;
        if (this.stopHold < 0.35 && v > -0.3) brake = t.engine.brakeForce * brk;
        else
          engine =
            -t.engine.reverseForce *
            (this.health <= 0 ? 0 : 1) *
            brk *
            Math.max(0, Math.min(1, (topRev + v) / (topRev * 0.3)));
      }
    } else {
      this.stopHold = 0;
    }
    if (thr <= 0.02 && brk <= 0.02) brake = t.engine.coastBrake;

    // Steering: slower and narrower at speed.
    const speedT = Math.min(1, Math.abs(v) / Math.max(1, top * 0.75));
    const target = c.steer * t.steering.maxAngle * (1 + (t.steering.highSpeedFactor - 1) * speedT);
    const maxDelta = t.steering.speed * dt;
    this.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, target - this.steerAngle));

    const ctrl = this.controller;
    const totalBrakeShare = this.profile.wheels.reduce((s, w) => s + w.brake, 0) || 1;
    this.profile.wheels.forEach((w, i) => {
      ctrl.setWheelSteering(i, w.steer ? this.steerAngle : 0);
      ctrl.setWheelEngineForce(i, w.drive ? engine / this.driveCount : 0);
      let b = (brake * w.brake) / totalBrakeShare;
      if (c.handbrake && w.handbrake) b += t.engine.handbrakeForce;
      ctrl.setWheelBrake(i, b);
      // Handbrake turns: rear tyres lose some side grip.
      ctrl.setWheelSideFrictionStiffness(
        i,
        c.handbrake && w.handbrake ? t.tyres.sideFrictionStiffness * 0.4 : t.tyres.sideFrictionStiffness,
      );
    });

    if (Math.abs(this.gripScale - this.appliedGrip) > 0.01) {
      this.appliedGrip = this.gripScale;
      this.profile.wheels.forEach((_w, i) =>
        ctrl.setWheelFrictionSlip(i, t.tyres.frictionSlip * this.gripScale),
      );
    }
    ctrl.updateVehicle(dt, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, Groups.WHEEL_QUERY);
    this.applyAero(dt, dtc.drag, dtc.downforce);

    if (t.stability.uprightAssist > 0) this.applyUprightAssist(dt);
    if (t.stability.rollFactor > 0) this.applyCorneringRoll(dt, v);

    // Air-brake hiss when a heavy vehicle stops under braking.
    if (t.stability.airBrake) {
      if (Math.abs(v) > 3) this.wasMoving = true;
      if (this.wasMoving && Math.abs(v) < 0.3 && (brk > 0.02 || c.handbrake)) {
        this.wasMoving = false;
        this.onAirBrake?.();
      }
    }

    const up = this.uprightness;
    if (up < 0.35 && this.body.linvel().y ** 2 + v * v < 4) this.flippedTime += dt;
    else this.flippedTime = 0;
    const lv = this.body.linvel();
    this.prevVel.set(lv.x, lv.y, lv.z);
    this.hasPrev = true;
  }

  /** Quadratic aerodynamic drag and a little downforce at speed. */
  private applyAero(dt: number, drag: number, downforce: number): void {
    const lv = this.body.linvel();
    const sp = Math.hypot(lv.x, lv.z);
    if (sp < 1) return;
    const k = drag * sp * dt;
    this.body.applyImpulse({ x: -lv.x * k, y: -downforce * sp * sp * dt, z: -lv.z * k }, true);
  }

  /**
   * Crashes: a velocity change in one step far beyond what engine or brakes
   * can do means we hit something. Damage scales with the hit and the class
   * toughness (GAME_SPEC §6.2: damage = f(impulse)).
   */
  private detectImpact(): void {
    if (!this.hasPrev) return;
    const lv = this.body.linvel();
    const dvx = lv.x - this.prevVel.x;
    const dvy = lv.y - this.prevVel.y + 9.81 / 60;
    const dvz = lv.z - this.prevVel.z;
    const dv = Math.hypot(dvx, dvy, dvz);
    if (dv < IMPACT_DV) return;
    const tough = (DRIVETRAIN[this.profile.class] ?? DRIVETRAIN.car!).toughness;
    this.health = Math.max(0, this.health - ((dv - IMPACT_DV) * 22) / tough);
    // The body was pushed along Δv, so the hit came from the opposite side.
    const inv = this.getQuaternion(_q).invert();
    const local = new Vector3(-dvx, -dvy * 0.3, -dvz).applyQuaternion(inv).normalize();
    this.onImpact?.(dv, local);
  }

  /** Engine speed 0 (idle) .. 1 (redline), for audio. */
  get rpmNorm(): number {
    const d = DRIVETRAIN[this.profile.class] ?? DRIVETRAIN.car!;
    return Math.max(0, Math.min(1, (this.rpm - IDLE_RPM) / (d.redline - IDLE_RPM)));
  }

  /** Mod-shop / pool reset. */
  repair(): void {
    this.health = 1000;
    this.stallTimer = 0;
    this.gear = 1;
  }

  /**
   * Two-wheeler balance (and a light anti-tip for autos): a PD torque about the
   * chassis forward axis that holds a lean angle proportional to steering × speed.
   */
  private applyUprightAssist(dt: number): void {
    const q = this.getQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(q);
    _left.set(1, 0, 0).applyQuaternion(q);
    // Lean to the right is a positive rotation about +Z (forward).
    const rollRight = Math.asin(Math.max(-1, Math.min(1, _left.dot(UP))));
    const av = this.body.angvel();
    const rollRate = _v.set(av.x, av.y, av.z).dot(_fwd);
    const speedT = Math.min(1, Math.abs(this.speed) / 8);
    const target =
      -this.steerAngle *
      speedT *
      (this.tuning.stability.maxLean / Math.max(0.01, this.tuning.steering.maxAngle));
    const strength = this.tuning.stability.uprightAssist;
    const inertia = this.inertia().z;
    const torque = inertia * strength * (90 * (target - rollRight) - 14 * rollRate);
    this.body.applyTorqueImpulse(
      { x: _fwd.x * torque * dt, y: _fwd.y * torque * dt, z: _fwd.z * torque * dt },
      true,
    );
  }

  /**
   * Rapier's raycast vehicle produces almost no body roll, so add the roll
   * torque a real CoM height would create: m · a_lat · k about the forward axis.
   * Turning left (positive yaw rate) rolls the body outward to the right.
   */
  private applyCorneringRoll(dt: number, v: number): void {
    if (!this.anyWheelGrounded()) return;
    const q = this.getQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(q);
    _up.set(0, 1, 0).applyQuaternion(q);
    const av = this.body.angvel();
    const yawRate = _v.set(av.x, av.y, av.z).dot(_up);
    const latAccel = Math.max(-12, Math.min(12, v * yawRate));
    const torque = this.profile.chassis.mass * latAccel * this.tuning.stability.rollFactor;
    this.body.applyTorqueImpulse(
      { x: _fwd.x * torque * dt, y: _fwd.y * torque * dt, z: _fwd.z * torque * dt },
      true,
    );
  }

  anyWheelGrounded(): boolean {
    for (let i = 0; i < this.profile.wheels.length; i++) if (this.controller.wheelIsInContact(i)) return true;
    return false;
  }

  /** Put the vehicle back on its wheels (R key, falling into the sea, ...). */
  reset(position?: Vector3, yaw?: number): void {
    const p = position ?? this.getPosition(_v).add(_up.set(0, 1.2, 0));
    const y = yaw ?? this.yaw;
    _q.setFromAxisAngle(UP, y);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.flippedTime = 0;
    this.hasPrev = false;
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
