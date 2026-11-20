import * as THREE from 'three/webgpu';
import type { GameBus } from '../../core/events';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import { lightUniforms } from '../../render/lightUniforms';
import { Vehicle } from './Vehicle';
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
