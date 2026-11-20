import * as THREE from 'three/webgpu';
import type { GameBus } from '../../core/events';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import { Vehicle } from './Vehicle';
import type { Particles } from '../../render/Particles';
import { getProfile } from './VehicleProfile';

/**
 * Owns every vehicle: spawning, fixed updates, interpolation, horn events,
 * sea respawn and the pooled headlight spot (one real light, rest emissive).
 */
export class VehicleManager {
  readonly list: Vehicle[] = [];
  private readonly spawns = new Map<string, { pos: THREE.Vector3; yaw: number }>();
  private readonly headlight: THREE.SpotLight;
  /** Vehicle the headlight spot is attached to (player's, or one they ride). */
  focus: Vehicle | null = null;
  private seed = 1;
  /** Set by the engine: smoke, fire, sparks, skid marks. */
  particles: Particles | null = null;
  private readonly burntMat = new THREE.MeshStandardMaterial({
    color: 0x1c1a18,
    roughness: 1,
    metalness: 0.2,
  });
  private fxTimer = 0;
  private readonly lastSkid = new Map<string, THREE.Vector3>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: PhysicsWorld,
    private readonly bus: GameBus,
  ) {
    this.headlight = new THREE.SpotLight(0xfff1d0, 0, 45, 0.5, 0.55, 1.6);
    this.headlight.castShadow = false;
    scene.add(this.headlight, this.headlight.target);
  }

  spawn(profileId: string, id: string, pos: THREE.Vector3, yaw: number): Vehicle {
    const profile = getProfile(profileId);
    const wheel = profile.wheels[0]!;
    const p = pos.clone();
    p.y += -wheel.position[1] + wheel.radius + 0.08;
    const v = new Vehicle(id, profile, this.world, p, yaw, this.seed++ * 7919);
    v.physics.onAirBrake = () => this.bus.emit('vehicle:airBrake', { vehicleId: id });
    v.physics.onImpact = (dv, dir) => {
      if (!v.active) return;
      v.dent(dv, dir);
      const hit = new THREE.Vector3(
        dir.x * v.profile.chassis.halfExtents[0],
        0,
        dir.z * v.profile.chassis.halfExtents[2],
      ).applyMatrix4(v.root.matrixWorld);
      for (let i = 0; i < Math.min(12, dv * 1.5); i++)
        this.particles?.emit('spark', hit, {
          vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6),
        });
      this.bus.emit('vehicle:crashed', { vehicleId: id, dv });
      if (v.physics.health <= 0 && !v.exploded) this.explode(v);
    };
    this.scene.add(v.root);
    this.list.push(v);
    this.spawns.set(id, { pos: p.clone(), yaw });
    return v;
  }

  get(id: string): Vehicle | undefined {
    return this.list.find((v) => v.id === id);
  }

  fixedUpdate(dt: number): void {
    for (const v of this.list) {
      if (!v.active) continue;
      v.fixedUpdate(dt);
      const want = v.ai?.wantHorn ?? false;
      if (v.ai && want !== v.hornOn) this.setHorn(v, want);
    }
  }

  postStep(): void {
    for (const v of this.list) {
      if (!v.active) continue;
      v.postStep();
      // Fell into the Arabian Sea or off the world: tow it back.
      if (v.physics.getPosition().y < -3) this.respawn(v);
    }
  }

  /** Engine health hit zero: fireball, radial blast, burnt shell (GAME_SPEC §6.2). */
  explode(v: Vehicle): void {
    const at = v.root.position.clone();
    v.burn(this.burntMat);
    this.setHorn(v, false);
    this.particles?.explosion(at);
    v.physics.body.applyImpulse({ x: 0, y: v.profile.chassis.mass * 6, z: 0 }, true);
    v.physics.body.applyTorqueImpulse(
      { x: v.profile.chassis.mass * 2, y: 0, z: v.profile.chassis.mass * 1.5 },
      true,
    );
    for (const o of this.list) {
      if (o === v || !o.active) continue;
      const d = o.root.position.distanceTo(at);
      if (d > 12) continue;
      const k = (1 - d / 12) * o.profile.chassis.mass * 8;
      const dir = o.root.position.clone().sub(at).setY(0.6).normalize();
      o.physics.body.applyImpulse({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, true);
      o.physics.health -= (1 - d / 12) * 400;
    }
    this.bus.emit('vehicle:exploded', { vehicleId: v.id, at: { x: at.x, y: at.y, z: at.z } });
  }

  respawn(v: Vehicle): void {
    const s = this.spawns.get(v.id);
    if (!s) return;
    v.physics.reset(s.pos, s.yaw);
    v.snapHistory();
    if (!v.id.startsWith('tr-')) this.bus.emit('ui:toast', { text: `${v.name} towed back to its stand` });
  }

  setHorn(v: Vehicle, on: boolean): void {
    if (v.hornOn === on) return;
    v.hornOn = on;
    this.bus.emit('vehicle:horn', { vehicleId: v.id, on });
  }

  syncVisuals(alpha: number, playerVehicleId: string | null): void {
    const night = lightUniforms.street.value;
    for (const v of this.list) {
      if (!v.active) continue;
      v.syncVisual(alpha);
      const driven = v.id === playerVehicleId || v.driverSeat.occupant !== null;
      v.setLights(night, driven);
    }
    this.vehicleFx();
    const f = this.focus;
    if (f && night > 0.02) {
      const anchor = f.visual.headlightAnchor;
      this.headlight.position.copy(anchor).applyMatrix4(f.root.matrixWorld);
      this.headlight.target.position
        .set(anchor.x, anchor.y - 1.2, anchor.z + 14)
        .applyMatrix4(f.root.matrixWorld);
      this.headlight.intensity = 60 * night;
    } else {
      this.headlight.intensity = 0;
    }
  }

  /** Smoke and fire from damaged engines, skid marks under sliding tyres. */
  private vehicleFx(): void {
    const p = this.particles;
    if (!p) return;
    this.fxTimer += 1 / 60;
    const emitNow = this.fxTimer > 0.08;
    if (emitNow) this.fxTimer = 0;
    for (const v of this.list) {
      if (!v.active) continue;
      const h = v.physics.health;
      if (emitNow && (h < 400 || v.exploded)) {
        const engine = new THREE.Vector3(
          0,
          v.profile.chassis.halfExtents[1] * 0.8,
          v.profile.chassis.halfExtents[2] * 0.7,
        ).applyMatrix4(v.root.matrixWorld);
        p.emit('smoke', engine, { size: h < 150 ? 0.5 : 0.3 });
        if (h < 150 || v.exploded) p.emit('fire', engine, { size: 0.35 });
      }
      // Skids: hard lateral slide or locked-up braking at speed.
      const lv = v.physics.body.linvel();
      const f = v.physics.forward();
      const side = Math.abs(lv.x * f.z - lv.z * f.x);
      const fwd = Math.abs(v.physics.speed);
      const sliding =
        (side > 3 && fwd > 4) ||
        (v.physics.controls.handbrake && fwd > 5) ||
        (v.physics.controls.brake > 0.8 && fwd > 10);
      if (!sliding || v.exploded) continue;
      const c = v.physics.controller;
      for (let i = 0; i < v.profile.wheels.length; i++) {
        if (!c.wheelIsInContact(i)) continue;
        const cp = c.wheelContactPoint(i);
        if (!cp) continue;
        const key = `${v.id}:${i}`;
        const last = this.lastSkid.get(key);
        const here = new THREE.Vector3(cp.x, cp.y + 0.02, cp.z);
        if (last && last.distanceTo(here) < 0.45) continue;
        this.lastSkid.set(key, here);
        p.skidMark(here, Math.atan2(lv.x, lv.z));
      }
    }
  }

  /** Nearest vehicle whose chassis is within `maxDist` of `p`. */
  nearest(p: THREE.Vector3, maxDist: number, exclude?: Vehicle): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = maxDist;
    for (const v of this.list) {
      if (v === exclude || !v.active) continue;
      const d = v.distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }
}
