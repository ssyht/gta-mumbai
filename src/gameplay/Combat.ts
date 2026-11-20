import * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { Input } from '../core/Input';
import type { GameState, Store } from '../core/Store';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Groups } from '../physics/layers';
import type { PlayerController } from '../actors/player/PlayerController';
import type { VehicleManager } from '../actors/vehicles/VehicleManager';

/** Anything that can be punched, shot or panicked (both crowds implement this). */
export interface Targetable {
  strike(at: THREE.Vector3, dir: THREE.Vector3, range: number): number;
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number;
  panic(at: THREE.Vector3, radius: number): void;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Weapons and melee (CLAUDE.md §4.6, "keep it game-y"): fists (LMB punch)
 * and a pistol (hold RMB to aim over the shoulder, LMB to fire). Shots are
 * hitscan from the crosshair; people go down, vehicles get shoved, crowds
 * panic, and every hit is a crime for the wanted system.
 */
export class Combat {
  private cooldown = 0;
  private readonly flash: THREE.PointLight;
  private readonly tracer: THREE.Line;
  private readonly spark: THREE.Mesh;
  private fxTime = 0;

  constructor(
    scene: THREE.Scene,
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
    private readonly vehicles: VehicleManager,
    private readonly targets: Targetable[],
    private readonly bus: GameBus,
    private readonly store: Store<GameState>,
    private readonly isPolice: (vehicleId: string) => boolean,
  ) {
    this.flash = new THREE.PointLight(0xffc070, 0, 8, 2);
    scene.add(this.flash);
    const tg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.tracer = new THREE.Line(
      tg,
      new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 }),
    );
    this.tracer.visible = false;
    this.tracer.frustumCulled = false;
    scene.add(this.tracer);
    this.spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd080 }),
    );
    this.spark.visible = false;
    scene.add(this.spark);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.fxTime = Math.max(0, this.fxTime - dt);
    this.flash.intensity = this.fxTime > 0 ? 40 : 0;
    this.tracer.visible = this.fxTime > 0;
    this.spark.visible = this.fxTime > 0;

    const s = this.store.get();
    if (this.input.wasPressed('weapon1')) this.store.set({ weapon: 'fists' });
    if (this.input.wasPressed('weapon2')) this.store.set({ weapon: 'pistol' });
    const onFoot = this.player.isOnFoot;
    const pistol = s.weapon === 'pistol';
    this.player.aiming = onFoot && pistol && this.input.isDown('aim');
    this.player.pistol.visible = onFoot && pistol;
    if (!onFoot || !this.input.wasPressed('attack') || this.cooldown > 0) return;

    if (!pistol) {
      // Punch.
      this.cooldown = 0.45;
      this.player.punchTimer = 0.4;
      const fwd = _d.set(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
      let hits = 0;
      for (const t of this.targets) hits += t.strike(this.player.position, fwd, 1.5);
      if (hits > 0) {
        this.bus.emit('crime', { kind: 'assault', at: this.player.position });
        for (const t of this.targets) t.panic(this.player.position, 12);
      }
      return;
    }
    if (s.ammo <= 0) {
      this.bus.emit('ui:toast', { text: 'Out of ammo' });
      this.cooldown = 0.5;
      return;
    }
    this.fire();
  }

  private fire(): void {
    this.cooldown = 0.22;
    this.store.set({ ammo: this.store.get().ammo - 1 });
    const origin = _o.copy(this.camera.position);
    const dir = this.camera.getWorldDirection(_d.clone());
    const maxDist = 120;
    // Nearest of: a person, the world, a vehicle.
    let best = maxDist;
    let hitPerson = false;
    for (const t of this.targets) {
      const d = t.shoot(origin, dir, best);
      if (d >= 0 && d < best) {
        best = d;
        hitPerson = true;
      }
    }
    const hit = this.physics.castRay(origin, dir, maxDist, Groups.CAMERA_QUERY, this.player.rigidBody);
    if (hit && hit.distance < best) {
      best = hit.distance;
      hitPerson = false;
      const v = this.vehicles.list.find((x) => x.physics.collider === hit.collider);
      if (v) {
        v.physics.body.applyImpulseAtPoint({ x: dir.x * 300, y: 50, z: dir.z * 300 }, hit.point, true);
        if (this.isPolice(v.id)) this.bus.emit('crime', { kind: 'assaultCop', at: this.player.position });
      }
    }
    const end = origin.clone().addScaledVector(dir, best);
    const muzzle = new THREE.Vector3();
    this.player.pistol.getWorldPosition(muzzle);
    this.tracer.geometry.setFromPoints([muzzle, end]);
    this.spark.position.copy(end);
    this.flash.position.copy(muzzle);
    this.fxTime = 0.05;
    this.bus.emit('weapon:fired', { at: muzzle });
    this.bus.emit('crime', { kind: hitPerson ? 'assault' : 'shooting', at: this.player.position });
    if (hitPerson) this.bus.emit('crime', { kind: 'shooting', at: this.player.position });
    for (const t of this.targets) t.panic(this.player.position, 40);
  }
}
