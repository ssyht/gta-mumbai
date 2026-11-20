import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { Groups } from '../../physics/layers';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { HIP_HEIGHT, HumanoidRig, type Outfit } from '../rig/HumanoidRig';
import * as P from '../rig/poses';
import type { RigInstancer } from '../rig/RigInstancer';
import type { SeatRuntime, Vehicle } from '../vehicles/Vehicle';

export type NpcState = 'seated' | 'thrown' | 'gettingUp' | 'walkAway' | 'angry' | 'idle';

/** Outfit presets for Mumbai NPC archetypes (CLAUDE.md §3: People). */
export const OUTFITS: Record<string, Outfit> = {
  autoDriver: {
    skin: 0x8d5524,
    top: 0xb59a5a,
    bottom: 0xa88d50,
    shoes: 0x2b1d14,
    hair: 0x111111,
    belt: 0x3b2a1a,
  },
  busDriver: {
    skin: 0x7a4a24,
    top: 0x9e8d5e,
    bottom: 0x6b5d3c,
    shoes: 0x1a1a1a,
    hair: 0x1a1a1a,
    cap: 0x5d4f2f,
  },
  officeWorker: { skin: 0xa86b3c, top: 0xdfe8f2, bottom: 0x2b2f3a, shoes: 0x1a1a1a, hair: 0x101010 },
  sareeWoman: {
    skin: 0x9c6339,
    top: 0xd81b60,
    bottom: 0xe64a19,
    shoes: 0x6d4c41,
    hair: 0x0d0d0d,
    drape: 0xff7043,
  },
  student: { skin: 0xb07646, top: 0x1e88e5, bottom: 0x37474f, shoes: 0xf5f5f5, hair: 0x151515 },
  kurtaMan: {
    skin: 0x8a5a2b,
    top: 0xf3ead8,
    bottom: 0xf3ead8,
    shoes: 0x5d4037,
    hair: 0x222222,
    drape: 0xf3ead8,
  },
  police: {
    skin: 0x7a4a24,
    top: 0xb59a5a,
    bottom: 0xa88d50,
    shoes: 0x1a1a1a,
    hair: 0x111111,
    cap: 0x1a237e,
    belt: 0x3b2a1a,
  },
  dabbawala: {
    skin: 0x7b4a22,
    top: 0xffffff,
    bottom: 0xffffff,
    shoes: 0x3e2723,
    hair: 0x111111,
    cap: 0xf5f5f5,
  },
};

const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A pedestrian on the shared rig. M3 adds navmesh crowds; M1 needs seated drivers/passengers that can be carjacked. */
export class Npc {
  readonly rig: HumanoidRig;
  state: NpcState = 'idle';
  seat: { vehicle: Vehicle; seat: SeatRuntime } | null = null;
  private readonly pose = P.newPose();
  private readonly target = P.newPose();
  private body: RAPIER.RigidBody | null = null;
  private t = Math.random() * 10;
  private stateTime = 0;
  private walkDir = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private yaw = 0;

  constructor(
    readonly id: string,
    outfit: Outfit,
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    instancer?: RigInstancer,
  ) {
    this.rig = new HumanoidRig(outfit, !!instancer);
    scene.add(this.rig.root);
    instancer?.add(this.rig);
  }

  sitIn(vehicle: Vehicle, seat: SeatRuntime): void {
    seat.occupant = { kind: 'npc', id: this.id };
    this.seat = { vehicle, seat };
    this.state = 'seated';
  }

  placeAt(pos: THREE.Vector3, yaw: number): void {
    this.position.copy(pos);
    this.yaw = yaw;
    this.state = 'idle';
  }

  /** Yanked out of the vehicle (carjack): becomes a tumbling physics body. */
  eject(away: THREE.Vector3): void {
    if (!this.seat) return;
    const { vehicle, seat } = this.seat;
    const R = this.physics.R;
    vehicle.exitWorld(seat.def, _pos);
    seat.occupant = null;
    this.seat = null;
    const lv = vehicle.physics.body.linvel();
    this.body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(_pos.x, _pos.y + 1.0, _pos.z)
        .setLinvel(lv.x + away.x * 4, 2.5, lv.z + away.z * 4)
        .setAngvel({
          x: (Math.random() - 0.5) * 6,
          y: (Math.random() - 0.5) * 4,
          z: (Math.random() - 0.5) * 6,
        })
        .setLinearDamping(0.4)
        .setAngularDamping(1.5),
    );
    this.physics.world.createCollider(
      R.ColliderDesc.capsule(0.45, 0.25).setCollisionGroups(Groups.RAGDOLL).setFriction(0.9).setDensity(400),
      this.body,
    );
    this.walkDir.copy(away).setY(0).normalize();
    this.state = 'thrown';
    this.stateTime = 0;
  }

  update(dt: number): void {
    this.t += dt;
    this.stateTime += dt;
    const k = 1 - Math.exp(-dt * 10);
    switch (this.state) {
      case 'seated': {
        if (!this.seat) break;
        const { vehicle, seat } = this.seat;
        vehicle.seatWorld(seat.def, HIP_HEIGHT, _pos, _q);
        this.rig.root.position.copy(_pos);
        this.rig.root.quaternion.copy(_q);
        const pose = seat.def.pose;
        const steer = vehicle.physics.steerAngle / Math.max(0.01, vehicle.profile.steering.maxAngle);
        if (pose === 'drive') P.drive(this.target, steer, this.t);
        else if (pose === 'ride') P.ride(this.target, steer);
        else if (pose === 'pillion') P.pillion(this.target, this.t);
        else if (pose === 'standHoldRail') P.standHoldRail(this.target, this.t, vehicle.physics.steerAngle);
        else if (pose === 'doorHang') P.doorHang(this.target, this.t, Math.abs(vehicle.physics.speed));
        else P.sit(this.target, this.t);
        P.blendPose(this.pose, this.target, k);
        break;
      }
      case 'thrown': {
        const b = this.body;
        if (!b) break;
        const t = b.translation();
        const r = b.rotation();
        this.rig.root.position.set(t.x, t.y - 0.7, t.z);
        this.rig.root.quaternion.set(r.x, r.y, r.z, r.w);
        P.tumble(this.target, this.t);
        P.blendPose(this.pose, this.target, k);
        const v = b.linvel();
        if ((this.stateTime > 1.2 && Math.hypot(v.x, v.y, v.z) < 0.6) || this.stateTime > 4) {
          this.position.set(t.x, this.physics.groundHeight(t.x, t.z, t.y + 1, t.y - 0.7), t.z);
          this.physics.world.removeRigidBody(b);
          this.body = null;
          this.yaw = Math.atan2(this.walkDir.x, this.walkDir.z);
          this.state = 'gettingUp';
          this.stateTime = 0;
          P.lying(this.pose);
        }
        break;
      }
      case 'gettingUp':
        this.place();
        if (this.stateTime < 0.6) P.lying(this.target);
        else P.idle(this.target, this.t);
        P.blendPose(this.pose, this.target, 1 - Math.exp(-dt * 5));
        if (this.stateTime > 1.6) this.setState('walkAway');
        break;
      case 'walkAway': {
        const speed = 1.5;
        this.position.addScaledVector(this.walkDir, speed * dt);
        this.position.y = this.physics.groundHeight(
          this.position.x,
          this.position.z,
          this.position.y + 1.5,
          this.position.y,
        );
        this.place();
        P.locomotion(this.target, this.t * 6.2, speed);
        P.blendPose(this.pose, this.target, k);
        if (this.stateTime > 3.5) {
          this.yaw += Math.PI; // turn back to shout at the thief
          this.setState('angry');
        }
        break;
      }
      case 'angry':
        this.place();
        P.shakeFist(this.target, this.t);
        P.blendPose(this.pose, this.target, k);
        if (this.stateTime > 4) this.setState('idle');
        break;
      case 'idle':
        this.place();
        P.idle(this.target, this.t);
        P.blendPose(this.pose, this.target, k);
        break;
    }
    this.rig.applyPose(this.pose);
  }

  private place(): void {
    this.rig.root.position.copy(this.position);
    this.rig.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
  }

  private setState(s: NpcState): void {
    this.state = s;
    this.stateTime = 0;
  }

  getPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.rig.root.position);
  }

  dispose(): void {
    this.scene.remove(this.rig.root);
    if (this.body) this.physics.world.removeRigidBody(this.body);
  }
}
