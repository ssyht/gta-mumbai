import * as THREE from 'three/webgpu';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { VehiclePhysics } from '../../physics/VehiclePhysics';
import type { SeatDef, SeatType, VehicleProfile } from './VehicleProfile';
import { buildVehicleVisual, type VehicleVisual } from './VehicleMeshes';

export interface SeatOccupant {
  kind: 'player' | 'npc';
  id: string;
}

export interface SeatRuntime {
  def: SeatDef;
  occupant: SeatOccupant | null;
}

/** Anything that can drive a vehicle (player input or AI) writes controls via this. */
export interface VehicleDriverAI {
  fixedUpdate(dt: number): void;
  readonly wantHorn: boolean;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * One drivable/rideable vehicle: Rapier physics + procedural visual + the
 * data-driven seat sockets from its profile JSON.
 */
export class Vehicle {
  readonly physics: VehiclePhysics;
  readonly visual: VehicleVisual;
  readonly seats: SeatRuntime[];
  ai: VehicleDriverAI | null = null;
  hornOn = false;
  /** Burnt-out shell after an explosion. */
  exploded = false;
  explodedAt = 0;
  private dentStore: Array<{ mesh: THREE.Mesh; orig: Float32Array; mat: THREE.Material }> | null = null;

  private deformables(): THREE.Mesh[] {
    return this.visual.root.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData.deformable === true,
    );
  }

  private ensureDentStore(): NonNullable<Vehicle['dentStore']> {
    if (!this.dentStore) {
      this.dentStore = this.deformables().map((mesh) => ({
        mesh,
        orig: (mesh.geometry.getAttribute('position').array as Float32Array).slice(),
        mat: mesh.material as THREE.Material,
      }));
    }
    return this.dentStore;
  }

  /**
   * Crash deformation (GAME_SPEC §6.2): push body vertices near the impact
   * point inward along the impact direction, capped so cars crumple, not fold.
   */
  dent(dv: number, localDir: THREE.Vector3): void {
    const store = this.ensureDentStore();
    const [hx, hy, hz] = this.profile.chassis.halfExtents;
    const s =
      Math.max(Math.abs(localDir.x) / hx, Math.abs(localDir.y) / (hy + 0.5), Math.abs(localDir.z) / hz) || 1;
    const cx = localDir.x / s;
    const cy = localDir.y / s;
    const cz = localDir.z / s;
    const amount = Math.min(0.28, dv * 0.018);
    const radius = 0.7 + Math.min(0.6, dv * 0.03);
    for (const { mesh, orig } of store) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        const d = Math.hypot(a[i]! - cx, a[i + 1]! - cy, a[i + 2]! - cz);
        if (d > radius) continue;
        const k = amount * (1 - d / radius);
        a[i] = a[i]! - localDir.x * k;
        a[i + 1] = a[i + 1]! - localDir.y * k * 0.5;
        a[i + 2] = a[i + 2]! - localDir.z * k;
        // Cap total displacement.
        const ox = a[i]! - orig[i]!;
        const oz = a[i + 2]! - orig[i + 2]!;
        const m = Math.hypot(ox, oz);
        if (m > 0.45) {
          a[i] = orig[i]! + (ox / m) * 0.45;
          a[i + 2] = orig[i + 2]! + (oz / m) * 0.45;
        }
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }

  burn(material: THREE.Material): void {
    this.exploded = true;
    this.explodedAt = performance.now();
    for (const d of this.ensureDentStore()) d.mesh.material = material;
    for (const w of this.visual.wheelSpinners) w.visible = false;
    this.ai = null;
  }

  /** Undo dents, fire damage and engine damage (pool reuse, mod shop). */
  repair(): void {
    this.physics.repair();
    this.exploded = false;
    if (this.dentStore) {
      for (const { mesh, orig, mat } of this.dentStore) {
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        (pos.array as Float32Array).set(orig);
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.material = mat;
      }
    }
    for (const w of this.visual.wheelSpinners) w.visible = true;
  }

  /** False while parked in a traffic pool: no physics, not drawn, ignored by systems. */
  active = true;

  setActive(on: boolean): void {
    this.active = on;
    this.visual.root.visible = on;
    this.physics.body.setEnabled(on);
  }

  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();

  constructor(
    readonly id: string,
    readonly profile: VehicleProfile,
    world: PhysicsWorld,
    position: THREE.Vector3,
    yaw: number,
    seed: number,
  ) {
    this.physics = new VehiclePhysics(world, profile, position, yaw);
    this.visual = buildVehicleVisual(profile, seed);
    this.visual.root.name = `vehicle:${id}`;
    this.seats = profile.seats.map((def) => ({ def, occupant: null }));
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.syncVisual(1);
  }

  get name(): string {
    return this.profile.name;
  }

  get root(): THREE.Group {
    return this.visual.root;
  }

  private capture(): void {
    this.physics.getPosition(this.currPos);
    this.physics.getQuaternion(this.currQuat);
  }

  fixedUpdate(dt: number): void {
    this.ai?.fixedUpdate(dt);
    this.physics.fixedUpdate(dt);
  }

  /** After the physics step: remember the last two poses for interpolation. */
  postStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.capture();
  }

  /** Teleport-safe: snap interpolation history (after reset/respawn). */
  snapHistory(): void {
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  syncVisual(alpha: number): void {
    const root = this.visual.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const c = this.physics.controller;
    const rest = this.physics.tuning.suspension.restLength;
    this.profile.wheels.forEach((w, i) => {
      const pivot = this.visual.wheelPivots[i]!;
      const len = c.wheelSuspensionLength(i) ?? rest;
      pivot.position.set(w.position[0], w.position[1] + rest - len, w.position[2]);
      pivot.rotation.y = c.wheelSteering(i) ?? 0;
      this.visual.wheelSpinners[i]!.rotation.x = c.wheelRotation(i) ?? 0;
    });
    // Two-wheelers: exaggerate the visual lean a touch (the physics lean is subtle).
    root.updateMatrixWorld();
  }

  get driverSeat(): SeatRuntime {
    return this.seats.find((s) => s.def.type === 'driver')!;
  }

  seat(id: string): SeatRuntime | undefined {
    return this.seats.find((s) => s.def.id === id);
  }

  freeSeats(types: SeatType[]): SeatRuntime[] {
    return this.seats.filter((s) => s.occupant === null && types.includes(s.def.type));
  }

  hasNpcDriver(): boolean {
    return this.driverSeat.occupant?.kind === 'npc';
  }

  /** World transform for an occupant's rig root (feet), given the seat pelvis position. */
  seatWorld(seat: SeatDef, hipHeight: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const root = this.visual.root;
    outPos
      .set(seat.position[0], seat.position[1] - hipHeight, seat.position[2])
      .applyMatrix4(root.matrixWorld);
    outQuat.copy(root.quaternion);
  }

  /** Seat pelvis position in world space (for the window camera). */
  seatHeadWorld(seat: SeatDef, out: THREE.Vector3): THREE.Vector3 {
    const up = seat.pose === 'standHoldRail' || seat.pose === 'doorHang' ? 0.62 : 0.68;
    return out
      .set(seat.position[0], seat.position[1] + up, seat.position[2])
      .applyMatrix4(this.visual.root.matrixWorld);
  }

  exitWorld(seat: SeatDef, out: THREE.Vector3, mirror = false): THREE.Vector3 {
    return out
      .set(mirror ? -seat.exit[0] : seat.exit[0], seat.exit[1], seat.exit[2])
      .applyMatrix4(this.visual.root.matrixWorld);
  }

  /** Distance from a world point to this vehicle's chassis box (0 if inside). */
  distanceTo(p: THREE.Vector3): number {
    _m.copy(this.visual.root.matrixWorld).invert();
    _v.copy(p).applyMatrix4(_m);
    const [hx, hy, hz] = this.profile.chassis.halfExtents;
    const dx = Math.max(0, Math.abs(_v.x) - hx);
    const dy = Math.max(0, Math.abs(_v.y) - (hy + 0.6));
    const dz = Math.max(0, Math.abs(_v.z) - hz);
    return Math.hypot(dx, dy, dz);
  }

  /** Point in the vehicle frame. */
  toLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _m.copy(this.visual.root.matrixWorld).invert();
    return out.copy(p).applyMatrix4(_m);
  }

  setLights(night: number, driven: boolean): void {
    const braking = this.physics.controls.brake > 0.05 && this.physics.speed > 0.5;
    const on = driven ? 0.25 + night * 3.5 : 0.05;
    this.visual.headMat.emissiveIntensity = on;
    this.visual.tailMat.emissiveIntensity = (driven ? 0.4 + night * 1.6 : 0.1) + (braking ? 3 : 0);
  }
}
