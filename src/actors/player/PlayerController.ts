import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Groups } from '../../physics/layers';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { HIP_HEIGHT, HumanoidRig } from '../rig/HumanoidRig';
import * as P from '../rig/poses';
import type { SeatRuntime, Vehicle } from '../vehicles/Vehicle';

export type PlayerState =
  'onFoot' | 'vault' | 'climb' | 'seated' | 'transition' | 'ragdoll' | 'gettingUp' | 'swim';

/** Sea surface height (the Arabian Sea and the harbour). */
export const SEA_LEVEL = -1.4;
const SWIM_FEET = SEA_LEVEL - 1.25;

export interface PlayerTuning {
  walk: number;
  jog: number;
  sprint: number;
  crouch: number;
  jumpVelocity: number;
  gravity: number;
}

export interface PlayerMoveInput {
  x: number;
  y: number;
  sprint: boolean;
}

/** Returns the velocity of a vehicle that just hit the player, or null. */
export type VehicleHitTest = (center: THREE.Vector3) => THREE.Vector3 | null;

const CAPSULE_HALF = 0.55;
const CAPSULE_R = 0.3;
const CENTER_Y = CAPSULE_HALF + CAPSULE_R; // feet → capsule centre
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Raju, the protagonist: male lead, late 20s, Mumbai local (CLAUDE.md §3). */
const RAJU = { skin: 0x9a6236, top: 0x2f7d6d, bottom: 0x2c3e66, shoes: 0xeeeeee, hair: 0x0e0e0e };

interface Transition {
  kind: 'enter' | 'exit';
  t: number;
  duration: number;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  toPos: THREE.Vector3;
  vehicle: Vehicle;
  seat: SeatRuntime;
}

interface Traverse {
  t: number;
  duration: number;
  from: THREE.Vector3;
  peak: THREE.Vector3;
  to: THREE.Vector3;
}

/**
 * Third-person on-foot controller on Rapier's kinematic character controller,
 * plus the player's vehicle seat state, enter/exit transitions and ragdoll.
 */
export class PlayerController {
  readonly rig = new HumanoidRig(RAJU);
  readonly tuning: PlayerTuning = {
    walk: 1.6,
    jog: 3.8,
    sprint: 6.9,
    crouch: 1.4,
    jumpVelocity: 5.0,
    gravity: 19,
  };
  state: PlayerState = 'onFoot';
  /** Feet position after the latest fixed step. */
  readonly position = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  crouched = false;
  walkMode = false;
  seat: { vehicle: Vehicle; seat: SeatRuntime } | null = null;
  onRagdoll: ((speed: number) => void) | null = null;
  /** Holding a pistol up (RMB): upper body overlays the aim pose, body faces the camera. */
  aiming = false;
  /** Seconds left on the current punch animation. */
  punchTimer = 0;
  /** Small pistol model in the right hand. */
  readonly pistol: THREE.Mesh;
  onFellInSea: (() => void) | null = null;
  /** Landed after a fall of `height` metres (fall damage from 4 m, GAME_SPEC §5.2). */
  onLanded: ((height: number) => void) | null = null;
  /** Out of stamina while swimming: drowning damage per second. */
  onDrowning: ((dps: number) => void) | null = null;
  /** 0..100. Sprint drains 12/s, regenerates 20/s after 1.5 s. */
  stamina = 100;
  private staminaRest = 0;
  private fallTop = 0;

  private readonly prevPosition = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private vy = 0;
  private jumpBuffer = 0;
  private visualYaw = 0;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly cc: RAPIER.KinematicCharacterController;
  private ragdoll: RAPIER.RigidBody | null = null;
  private ragdollTime = 0;
  private slowTime = 0;
  private transition: Transition | null = null;
  private traverse: Traverse | null = null;
  private getUpTime = 0;
  private readonly pose = P.newPose();
  private readonly target = P.newPose();
  private animT = 0;
  private phase = 0;
  private speedNow = 0;

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    spawn: THREE.Vector3,
    yaw: number,
    private readonly hitTest: VehicleHitTest,
  ) {
    const R = physics.R;
    const w = physics.world;
    this.position.copy(spawn);
    this.prevPosition.copy(spawn);
    this.yaw = this.visualYaw = yaw;
    this.body = w.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER_Y, spawn.z),
    );
    this.collider = w.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R).setCollisionGroups(Groups.PLAYER_BODY),
      this.body,
    );
    this.cc = w.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.4, 0.2, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(false);
    scene.add(this.rig.root);
    P.idle(this.pose, 0);
    this.pistol = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.12, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x1b1b1b, metalness: 0.7, roughness: 0.35 }),
    );
    this.pistol.position.set(0, -0.3, 0.06);
    this.pistol.visible = false;
    this.rig.joints.elbowR.add(this.pistol);
  }

  get rigidBody(): RAPIER.RigidBody {
    return this.body;
  }

  get isOnFoot(): boolean {
    return this.state === 'onFoot';
  }

  get horizontalSpeed(): number {
    return this.speedNow;
  }

  queueJump(): void {
    this.jumpBuffer = 0.15;
  }

  fixedUpdate(dt: number, move: PlayerMoveInput, camYaw: number): void {
    this.prevPosition.copy(this.position);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    switch (this.state) {
      case 'onFoot':
        this.stepOnFoot(dt, move, camYaw);
        break;
      case 'swim':
        this.stepSwim(dt, move, camYaw);
        break;
      case 'vault':
      case 'climb':
        this.stepTraverse(dt);
        break;
      case 'transition':
        this.stepTransition(dt);
        break;
      case 'seated':
        this.followSeat();
        break;
      case 'ragdoll':
        this.stepRagdoll(dt);
        break;
      case 'gettingUp':
        this.getUpTime += dt;
        if (this.getUpTime > 1.3) this.state = 'onFoot';
        break;
    }
  }

  private stepOnFoot(dt: number, move: PlayerMoveInput, camYaw: number): void {
    const t = this.tuning;
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    // forward = (sin, cos); right = (-cos, sin)
    const wx = fx * move.y - fz * move.x;
    const wz = fz * move.y + fx * move.x;
    const mag = Math.min(1, Math.hypot(wx, wz));
    const sprinting = move.sprint && mag > 0.1 && this.stamina > 0 && !this.crouched && !this.walkMode;
    this.updateStamina(dt, sprinting ? 12 : 0);
    const speed = this.crouched ? t.crouch : this.walkMode ? t.walk : sprinting ? t.sprint : t.jog;
    const tx = mag > 0.01 ? (wx / Math.hypot(wx, wz)) * speed * mag : 0;
    const tz = mag > 0.01 ? (wz / Math.hypot(wx, wz)) * speed * mag : 0;
    // Linear acceleration 12 m/s², deceleration 16 m/s², much less in the air.
    const speeding = tx * tx + tz * tz > this.vel.x * this.vel.x + this.vel.z * this.vel.z;
    const a = (this.grounded ? (speeding ? 12 : 16) : 3) * dt;
    const ex = tx - this.vel.x;
    const ez = tz - this.vel.z;
    const el = Math.hypot(ex, ez);
    if (el <= a) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (ex / el) * a;
      this.vel.z += (ez / el) * a;
    }
    if (this.aiming) {
      let d = camYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 20);
    } else if (mag > 0.05) {
      const want = Math.atan2(wx, wz);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }

    if (this.jumpBuffer > 0 && this.grounded) {
      this.jumpBuffer = 0;
      if (this.tryTraverse()) return;
      this.vy = this.crouched ? t.jumpVelocity * 0.6 : t.jumpVelocity;
      this.grounded = false;
      this.crouched = false;
    }

    this.vy -= t.gravity * dt;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(
      this.collider,
      desired,
      this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS,
      Groups.PLAYER_QUERY,
    );
    const mv = this.cc.computedMovement();
    const wasAir = !this.grounded;
    this.grounded = this.cc.computedGrounded();
    if (!this.grounded) this.fallTop = Math.max(this.fallTop, this.position.y);
    else if (!wasAir) this.fallTop = this.position.y;
    if (this.grounded && this.vy < 0) {
      if (wasAir) {
        const h = this.fallTop - (this.position.y + mv.y);
        this.fallTop = this.position.y + mv.y;
        if (h > 4) this.onLanded?.(h);
        if (h > 6) {
          this.startRagdoll(_v.set(this.vel.x, -2, this.vel.z), 0.6);
          return;
        }
      }
      this.vy = -1;
    }
    // Bumped our head.
    if (this.vy > 0 && mv.y < desired.y * 0.5) this.vy = 0;
    this.position.x += mv.x;
    this.position.y += mv.y;
    this.position.z += mv.z;
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CENTER_Y,
      z: this.position.z,
    });
    this.speedNow = Math.hypot(mv.x, mv.z) / dt;

    if (this.position.y < SWIM_FEET + 0.4 && !this.grounded) {
      this.enterSwim();
      return;
    }
    // Did a vehicle just hit us? Under 25 km/h it's a shove, above it a ragdoll (GAME_SPEC §5.1).
    const hit = this.hitTest(_v.set(this.position.x, this.position.y + CENTER_Y, this.position.z));
    if (hit && hit.length() < 6.9) {
      this.vel.x += hit.x * 0.9;
      this.vel.z += hit.z * 0.9;
    } else if (hit) {
      const sp = hit.length();
      this.startRagdoll(
        _v2
          .copy(hit)
          .multiplyScalar(1.05)
          .add(_v.set(0, 2 + sp * 0.15, 0)),
        sp * 0.4,
      );
    }
  }

  private updateStamina(dt: number, drain: number): void {
    if (drain > 0) {
      this.stamina = Math.max(0, this.stamina - drain * dt);
      this.staminaRest = 0;
    } else {
      this.staminaRest += dt;
      if (this.staminaRest > 1.5) this.stamina = Math.min(100, this.stamina + 20 * dt);
    }
  }

  private enterSwim(): void {
    this.state = 'swim';
    this.vy = 0;
    this.crouched = false;
    this.position.y = SWIM_FEET;
    this.fallTop = SWIM_FEET;
  }

  /** Surface swimming (GAME_SPEC §5.2): slow, drains stamina, climb out over walls with jump. */
  private stepSwim(dt: number, move: PlayerMoveInput, camYaw: number): void {
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const wx = fx * move.y - fz * move.x;
    const wz = fz * move.y + fx * move.x;
    const mag = Math.min(1, Math.hypot(wx, wz));
    const fast = move.sprint && this.stamina > 0;
    this.updateStamina(dt, fast ? 12 : mag > 0.1 ? 2 : 0);
    if (this.stamina <= 0) this.onDrowning?.(6);
    const speed = (fast ? 2.4 : 1.4) * mag;
    const k = 1 - Math.exp(-4 * dt);
    this.vel.x += ((mag > 0.01 ? wx / Math.hypot(wx, wz) : 0) * speed - this.vel.x) * k;
    this.vel.z += ((mag > 0.01 ? wz / Math.hypot(wx, wz) : 0) * speed - this.vel.z) * k;
    if (mag > 0.05) {
      let d = Math.atan2(wx, wz) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 6);
    }
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      if (this.tryTraverse(3.8)) return;
    }
    const bob = Math.sin(performance.now() / 600) * 0.04;
    const desired = { x: this.vel.x * dt, y: SWIM_FEET + bob - this.position.y, z: this.vel.z * dt };
    this.cc.computeColliderMovement(
      this.collider,
      desired,
      this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS,
      Groups.PLAYER_QUERY,
    );
    const mv = this.cc.computedMovement();
    this.position.x += mv.x;
    this.position.y += mv.y;
    this.position.z += mv.z;
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CENTER_Y,
      z: this.position.z,
    });
    this.speedNow = Math.hypot(mv.x, mv.z) / dt;
    // Reached somewhere shallow enough to stand.
    if (this.cc.computedGrounded() && this.position.y > SWIM_FEET + 0.5) this.state = 'onFoot';
  }

  /** Vault over waist-high obstacles, climb onto low walls (CLAUDE.md §4.1). */
  private tryTraverse(maxClimb = 2.2): boolean {
    const f = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const feet = this.position;
    const knee = { x: feet.x, y: feet.y + 0.5, z: feet.z };
    const hit = this.physics.castRay(knee, f, 1.0, Groups.PLAYER_QUERY, this.body);
    if (!hit) return false;
    const probeAt = (d: number): number | null => {
      const px = hit.point.x + f.x * d;
      const pz = hit.point.z + f.z * d;
      const top = this.physics.castRay(
        { x: px, y: feet.y + 2.4, z: pz },
        { x: 0, y: -1, z: 0 },
        2.9,
        Groups.PLAYER_QUERY,
        this.body,
      );
      return top ? top.point.y - feet.y : null;
    };
    const h = probeAt(0.2);
    if (h === null || h < 0.35 || h > maxClimb) return false;
    const peakY = feet.y + h + 0.35;
    if (h <= 1.3) {
      // Find the far side.
      for (const d of [0.5, 0.8, 1.1, 1.5]) {
        const hh = probeAt(d);
        if (hh !== null && hh < 0.3) {
          const to = new THREE.Vector3(
            hit.point.x + f.x * (d + 0.35),
            feet.y + Math.max(0, hh),
            hit.point.z + f.z * (d + 0.35),
          );
          if (this.physics.capsuleBlocked(to, CAPSULE_R, CAPSULE_HALF, this.body)) break;
          this.beginTraverse('vault', to, peakY, 0.55);
          return true;
        }
      }
    }
    // Too thick or too tall to vault: climb on top.
    const to = new THREE.Vector3(hit.point.x + f.x * 0.45, feet.y + h, hit.point.z + f.z * 0.45);
    if (this.physics.capsuleBlocked(to, CAPSULE_R, CAPSULE_HALF, this.body)) return false;
    this.beginTraverse(h <= 1.3 ? 'vault' : 'climb', to, peakY, h <= 1.3 ? 0.5 : 0.95);
    return true;
  }

  private beginTraverse(kind: 'vault' | 'climb', to: THREE.Vector3, peakY: number, duration: number): void {
    const from = this.position.clone();
    const peak = from.clone().lerp(to, kind === 'climb' ? 0.25 : 0.5);
    peak.y = peakY;
    this.traverse = { t: 0, duration, from, peak, to };
    this.state = kind;
    this.vel.set(0, 0, 0);
    this.vy = 0;
  }

  private stepTraverse(dt: number): void {
    const tr = this.traverse;
    if (!tr) {
      this.state = 'onFoot';
      return;
    }
    tr.t = Math.min(1, tr.t + dt / tr.duration);
    const u = tr.t;
    // Quadratic Bézier through the peak.
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    this.position.set(
      a * tr.from.x + b * tr.peak.x + c * tr.to.x,
      a * tr.from.y + b * tr.peak.y + c * tr.to.y,
      a * tr.from.z + b * tr.peak.z + c * tr.to.z,
    );
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CENTER_Y,
      z: this.position.z,
    });
    if (tr.t >= 1) {
      this.traverse = null;
      this.state = 'onFoot';
      this.grounded = true;
      this.vy = -1;
    }
  }

  /** Walk into a seat. Duration covers the door/mount animation. */
  enterSeat(vehicle: Vehicle, seat: SeatRuntime, duration = 0.65): void {
    seat.occupant = { kind: 'player', id: 'player' };
    this.seat = { vehicle, seat };
    this.collider.setEnabled(false);
    this.transition = {
      kind: 'enter',
      t: 0,
      duration,
      fromPos: this.position.clone(),
      fromQuat: new THREE.Quaternion().setFromAxisAngle(UP, this.visualYaw),
      toPos: new THREE.Vector3(),
      vehicle,
      seat,
    };
    this.state = 'transition';
    this.vel.set(0, 0, 0);
    this.crouched = false;
  }

  /** Move to another seat in the same vehicle (bus: sit / stand / hang from door). */
  switchSeat(seat: SeatRuntime): void {
    if (!this.seat) return;
    this.seat.seat.occupant = null;
    seat.occupant = { kind: 'player', id: 'player' };
    this.enterSeat(this.seat.vehicle, seat, 0.5);
  }

  /** Climb out of the seat onto `feet` (world). */
  exitSeat(feet: THREE.Vector3, duration = 0.55): void {
    if (!this.seat) return;
    const { vehicle, seat } = this.seat;
    this.transition = {
      kind: 'exit',
      t: 0,
      duration,
      fromPos: this.rig.root.position.clone(),
      fromQuat: this.rig.root.quaternion.clone(),
      toPos: feet.clone(),
      vehicle,
      seat,
    };
    this.state = 'transition';
  }

  /** Jump out of a moving vehicle: tumble away from the door. */
  bail(feet: THREE.Vector3, vehicleVel: THREE.Vector3, sideDir: THREE.Vector3): void {
    this.releaseSeat();
    this.position.copy(feet);
    this.body.setTranslation({ x: feet.x, y: feet.y + CENTER_Y + 0.2, z: feet.z }, true);
    const v = _v2.copy(vehicleVel).multiplyScalar(0.85).addScaledVector(sideDir, 3.5);
    v.y = 2.2;
    this.startRagdoll(v, vehicleVel.length() * 0.3);
  }

  private releaseSeat(): void {
    if (this.seat) this.seat.seat.occupant = null;
    this.seat = null;
    this.transition = null;
  }

  private stepTransition(dt: number): void {
    const tr = this.transition;
    if (!tr) {
      this.state = 'onFoot';
      return;
    }
    tr.t = Math.min(1, tr.t + dt / tr.duration);
    const e = tr.t * tr.t * (3 - 2 * tr.t);
    if (tr.kind === 'enter') {
      tr.vehicle.seatWorld(tr.seat.def, HIP_HEIGHT, tr.toPos, _q);
      // Rise to the seat in an arc (stepping up into a bus, swinging a leg over a scooter).
      _v.lerpVectors(tr.fromPos, tr.toPos, e);
      _v.y += Math.sin(Math.PI * tr.t) * 0.25;
      this.position.copy(_v);
      this.rig.root.position.copy(_v);
      this.rig.root.quaternion.slerpQuaternions(tr.fromQuat, _q, e);
      if (tr.t >= 1) {
        this.transition = null;
        this.state = 'seated';
      }
    } else {
      _v.lerpVectors(tr.fromPos, tr.toPos, e);
      _v.y += Math.sin(Math.PI * tr.t) * 0.15;
      this.position.copy(_v);
      this.rig.root.position.copy(_v);
      const yaw = tr.vehicle.physics.yaw;
      this.rig.root.quaternion.slerpQuaternions(tr.fromQuat, _q.setFromAxisAngle(UP, yaw), e);
      if (tr.t >= 1) {
        this.releaseSeat();
        this.position.copy(tr.toPos);
        this.prevPosition.copy(tr.toPos);
        this.yaw = this.visualYaw = yaw;
        this.body.setTranslation({ x: tr.toPos.x, y: tr.toPos.y + CENTER_Y, z: tr.toPos.z }, true);
        this.collider.setEnabled(true);
        this.state = 'onFoot';
        this.grounded = true;
        this.vy = -1;
      }
    }
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CENTER_Y,
      z: this.position.z,
    });
  }

  private followSeat(): void {
    if (!this.seat) {
      this.state = 'onFoot';
      return;
    }
    this.seat.vehicle.seatWorld(this.seat.seat.def, HIP_HEIGHT, this.position, _q);
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CENTER_Y,
      z: this.position.z,
    });
  }

  startRagdoll(linvel: THREE.Vector3, spin: number): void {
    const R = this.physics.R;
    this.releaseSeat();
    this.collider.setEnabled(false);
    this.traverse = null;
    const c = this.body.translation();
    this.ragdoll = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(c.x, c.y, c.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw))
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setAngvel({
          x: (Math.random() - 0.5) * spin * 2,
          y: (Math.random() - 0.5) * spin,
          z: (Math.random() - 0.5) * spin * 2,
        })
        .setLinearDamping(0.3)
        .setAngularDamping(1.2)
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R)
        .setCollisionGroups(Groups.RAGDOLL)
        .setFriction(0.8)
        .setDensity(300),
      this.ragdoll,
    );
    this.state = 'ragdoll';
    this.ragdollTime = 0;
    this.slowTime = 0;
    this.onRagdoll?.(linvel.length());
  }

  private stepRagdoll(dt: number): void {
    const b = this.ragdoll;
    if (!b) {
      this.state = 'onFoot';
      return;
    }
    this.ragdollTime += dt;
    const t = b.translation();
    this.position.set(t.x, t.y - CENTER_Y, t.z);
    const v = b.linvel();
    if (Math.hypot(v.x, v.y, v.z) < 0.7) this.slowTime += dt;
    else this.slowTime = 0;
    if (t.y < SEA_LEVEL - 0.5) {
      // Splash down: stop tumbling and swim.
      this.physics.world.removeRigidBody(b);
      this.ragdoll = null;
      this.teleport(new THREE.Vector3(t.x, SWIM_FEET, t.z), this.yaw);
      this.enterSwim();
      return;
    }
    if ((this.ragdollTime > 1.2 && this.slowTime > 0.6) || this.ragdollTime > 7) {
      const gy = this.physics.groundHeight(t.x, t.z, t.y + 0.5, t.y - CENTER_Y);
      const feet = new THREE.Vector3(t.x, gy, t.z);
      this.physics.world.removeRigidBody(b);
      this.ragdoll = null;
      this.teleport(feet, this.yaw);
      this.state = 'gettingUp';
      this.getUpTime = 0;
      P.lying(this.pose);
    }
  }

  teleport(feet: THREE.Vector3, yaw: number): void {
    this.releaseSeat();
    if (this.ragdoll) {
      this.physics.world.removeRigidBody(this.ragdoll);
      this.ragdoll = null;
    }
    this.position.copy(feet);
    this.prevPosition.copy(feet);
    this.yaw = this.visualYaw = yaw;
    this.vel.set(0, 0, 0);
    this.vy = -1;
    this.body.setTranslation({ x: feet.x, y: feet.y + CENTER_Y, z: feet.z }, true);
    this.collider.setEnabled(true);
    this.state = 'onFoot';
    this.grounded = true;
  }

  /** Per-frame: interpolate the rig and run the animation state machine. */
  frameUpdate(dt: number, alpha: number): void {
    this.animT += dt;
    const root = this.rig.root;
    const k = 1 - Math.exp(-dt * 12);
    switch (this.state) {
      case 'onFoot':
      case 'swim':
      case 'vault':
      case 'climb':
      case 'gettingUp': {
        root.position.lerpVectors(this.prevPosition, this.position, alpha);
        let d = this.yaw - this.visualYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.visualYaw += d * Math.min(1, dt * 14);
        root.quaternion.setFromAxisAngle(UP, this.visualYaw);
        if (this.state === 'swim') {
          this.phase += dt * (2 + this.speedNow * 1.5);
          P.swim(this.target, this.phase, this.speedNow > 0.3);
        } else if (this.state === 'vault') P.vault(this.target, this.traverse?.t ?? 1);
        else if (this.state === 'climb') P.climb(this.target, this.traverse?.t ?? 1);
        else if (this.state === 'gettingUp') {
          if (this.getUpTime < 0.5) P.lying(this.target);
          else P.idle(this.target, this.animT);
        } else if (!this.grounded) P.airborne(this.target, this.vy > 0, this.animT);
        else {
          const s = this.speedNow;
          const stride = 1.25 + s * 0.17;
          this.phase += (dt * Math.PI * 2 * s) / stride;
          if (this.crouched) P.crouch(this.target, this.phase, s);
          else if (s < 0.2) P.idle(this.target, this.animT);
          else P.locomotion(this.target, this.phase, s);
        }
        if (this.state === 'onFoot') {
          if (this.aiming) P.overlayAim(this.target);
          else if (this.punchTimer > 0) P.overlayPunch(this.target, 1 - this.punchTimer / 0.4);
        }
        this.punchTimer = Math.max(0, this.punchTimer - dt);
        P.blendPose(
          this.pose,
          this.target,
          this.state === 'gettingUp'
            ? 1 - Math.exp(-dt * 4)
            : this.punchTimer > 0 || this.aiming
              ? 1 - Math.exp(-dt * 25)
              : k,
        );
        break;
      }
      case 'transition':
      case 'seated': {
        if (this.state === 'seated' && this.seat) {
          this.seat.vehicle.seatWorld(this.seat.seat.def, HIP_HEIGHT, root.position, root.quaternion);
        }
        const s = this.seat;
        if (s) this.seatPose(s.vehicle, s.seat);
        P.blendPose(this.pose, this.target, this.state === 'transition' ? 1 - Math.exp(-dt * 8) : k);
        break;
      }
      case 'ragdoll': {
        const b = this.ragdoll;
        if (b) {
          const t = b.translation();
          const r = b.rotation();
          root.quaternion.set(r.x, r.y, r.z, r.w);
          _v.set(0, -CENTER_Y, 0).applyQuaternion(root.quaternion);
          root.position.set(t.x + _v.x, t.y + _v.y, t.z + _v.z);
        }
        P.tumble(this.target, this.animT);
        P.blendPose(this.pose, this.target, k);
        break;
      }
    }
    this.rig.applyPose(this.pose);
  }

  private seatPose(vehicle: Vehicle, seat: SeatRuntime): void {
    const steer = vehicle.physics.steerAngle / Math.max(0.01, vehicle.profile.steering.maxAngle);
    switch (seat.def.pose) {
      case 'drive':
        P.drive(this.target, steer, this.animT);
        break;
      case 'ride':
        P.ride(this.target, steer);
        break;
      case 'pillion':
        P.pillion(this.target, this.animT);
        break;
      case 'standHoldRail':
        P.standHoldRail(this.target, this.animT, vehicle.physics.steerAngle);
        break;
      case 'doorHang':
        P.doorHang(this.target, this.animT, Math.abs(vehicle.physics.speed));
        break;
      default:
        P.sit(this.target, this.animT);
    }
  }
}
