import * as THREE from 'three/webgpu';
import type { CrimeKind, GameBus } from '../core/events';
import type { GameState, Store } from '../core/Store';
import type { Vehicle, VehicleDriverAI } from '../actors/vehicles/Vehicle';
import type { VehicleManager } from '../actors/vehicles/VehicleManager';
import { Npc, OUTFITS } from '../actors/npcs/Npc';
import type { RigInstancer } from '../actors/rig/RigInstancer';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { LaneGraph } from '../world/roads/LaneGraph';
import { mulberry32 } from '../render/materials/textures';

/**
 * Wanted level and Mumbai Police pursuit (CLAUDE.md §4.5). Crimes add heat;
 * heat sets 1–5 stars. Police SUVs spawn on the road graph around the player,
 * chase and ram, set up roadblocks from 4 stars, and arrest a player caught on
 * foot. Breaking line of sight long enough lets the stars fade.
 */
const CRIME_HEAT: Record<CrimeKind, number> = {
  carjack: 1,
  hitPedestrian: 1,
  assault: 1,
  shooting: 2,
  robbery: 2,
  assaultCop: 2,
};

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();

/** Aggressive chase driver: aims at the target's predicted position and rams. */
class PursuitDriver implements VehicleDriverAI {
  wantHorn = false;
  roadblock = false;
  private reverseTime = 0;
  private stuck = 0;

  constructor(
    private readonly v: Vehicle,
    private readonly target: () => { pos: THREE.Vector3; vel: THREE.Vector3 },
  ) {}

  fixedUpdate(dt: number): void {
    const c = this.v.physics.controls;
    if (this.roadblock) {
      c.throttle = 0;
      c.brake = 1;
      c.handbrake = true;
      c.steer = 0;
      return;
    }
    const t = this.target();
    const p = this.v.physics.getPosition(_p);
    const aim = t.pos.clone().addScaledVector(t.vel, 0.6).sub(p).setY(0);
    const dist = aim.length();
    const f = this.v.physics.forward(_f).setY(0).normalize();
    const crossY = f.z * aim.x - f.x * aim.z;
    const angle = Math.atan2(Math.abs(crossY), f.dot(aim)) * Math.sign(crossY);
    const speed = this.v.physics.speed;
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.steer = -Math.sign(angle);
      return;
    }
    c.handbrake = false;
    c.steer = Math.max(-1, Math.min(1, angle * 1.8));
    const close = dist < 9 && t.vel.length() < 2;
    if (close) {
      c.throttle = 0;
      c.brake = 1;
    } else {
      c.throttle = Math.abs(angle) > 1.6 ? 0.4 : 1;
      c.brake = 0;
    }
    if (Math.abs(speed) < 0.6 && !close) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 2.5) {
      this.reverseTime = 1.4;
      this.stuck = 0;
    }
  }
}

interface Unit {
  v: Vehicle;
  npc: Npc;
  driver: PursuitDriver;
  inUse: boolean;
}

export class WantedSystem {
  heat = 0;
  level = 0;
  private sinceSeen = 0;
  private units: Unit[] = [];
  private timer = 0;
  private bustTimer = 0;
  private seq = 0;
  private flash = 0;
  private readonly rnd = mulberry32(100);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly vehicles: VehicleManager,
    private readonly graph: LaneGraph,
    private readonly instancer: RigInstancer,
    private readonly npcs: Map<string, Npc>,
    private readonly bus: GameBus,
    private readonly store: Store<GameState>,
    private readonly target: () => { pos: THREE.Vector3; vel: THREE.Vector3; onFoot: boolean },
  ) {
    bus.on('crime', ({ kind }) => this.addHeat(CRIME_HEAT[kind] ?? 1));
  }

  addHeat(h: number): void {
    this.heat = Math.min(5.99, this.heat + h);
    this.sinceSeen = 0;
    this.setLevel(Math.max(this.level, Math.min(5, Math.floor(this.heat))));
  }

  /** Force a minimum level (robberies, shooting at police). */
  atLeast(level: number): void {
    if (this.level < level) {
      this.heat = Math.max(this.heat, level);
      this.setLevel(level);
    }
  }

  clear(): void {
    this.heat = 0;
    this.setLevel(0);
    for (const u of this.units) this.release(u);
  }

  private setLevel(l: number): void {
    if (l === this.level) return;
    this.level = l;
    this.store.set({ wanted: { level: l, evading: false } });
    this.bus.emit('wanted:changed', { level: l });
  }

  get bustProgress(): number {
    return Math.min(1, this.bustTimer / 2.5);
  }

  get policeVehicles(): Vehicle[] {
    return this.units.filter((u) => u.inUse).map((u) => u.v);
  }

  /** Are the police lights currently flashing near `p` (for the minimap / siren). */
  get sirenActive(): boolean {
    return this.level > 0 && this.units.some((u) => u.inUse);
  }

  private acquire(): Unit {
    const free = this.units.find((u) => !u.inUse);
    if (free) return free;
    const id = `police-${this.seq++}`;
    const v = this.vehicles.spawn('police', id, new THREE.Vector3(0, -40, 0), 0);
    const npc = new Npc(`${id}-cop`, OUTFITS.police!, this.scene, this.physics, this.instancer);
    this.npcs.set(npc.id, npc);
    const driver = new PursuitDriver(v, () => {
      const t = this.target();
      return { pos: t.pos, vel: t.vel };
    });
    const u: Unit = { v, npc, driver, inUse: false };
    this.units.push(u);
    return u;
  }

  private place(u: Unit, pos: THREE.Vector3, yaw: number, roadblock = false): void {
    const wheel = u.v.profile.wheels[0]!;
    const p = pos.clone();
    p.y = -wheel.position[1] + wheel.radius + 0.15 + Math.max(0, pos.y);
    u.v.setActive(true);
    u.v.repair();
    u.v.physics.reset(p, yaw);
    u.v.snapHistory();
    u.v.ai = u.driver;
    u.driver.roadblock = roadblock;
    if (!u.v.driverSeat.occupant) u.npc.sitIn(u.v, u.v.driverSeat);
    u.npc.rig.setVisible(true);
    u.inUse = true;
  }

  private release(u: Unit): void {
    u.inUse = false;
    u.v.ai = null;
    u.v.setActive(false);
    u.npc.rig.setVisible(false);
    const m = u.v.visual.sirenMats;
    if (m) m[0].emissiveIntensity = m[1].emissiveIntensity = 0;
  }

  update(dt: number, camera: THREE.Camera, playerVehicle: Vehicle | null): void {
    // Stolen police cars leave the force.
    this.units = this.units.filter((u) => !(u.inUse && u.v.ai !== u.driver));
    this.flash += dt;
    for (const u of this.units) {
      if (!u.inUse) continue;
      const m = u.v.visual.sirenMats;
      if (m) {
        const on = Math.floor(this.flash * 6) % 2 === 0;
        m[0].emissiveIntensity = on ? 9 : 0.3;
        m[1].emissiveIntensity = on ? 0.3 : 9;
      }
    }
    if (this.level === 0) {
      if (this.units.some((u) => u.inUse))
        for (const u of this.units) if (u.inUse && u.v !== playerVehicle) this.release(u);
      return;
    }
    const t = this.target();
    // Line of sight: any unit within range with a clear ray.
    const range = 70 + this.level * 25;
    let seen = false;
    for (const u of this.units) {
      if (!u.inUse || u.v === playerVehicle) continue;
      const d = u.v.root.position.distanceTo(t.pos);
      if (d < range) {
        const from = u.v.root.position.clone().setY(u.v.root.position.y + 1.2);
        const dir = t.pos
          .clone()
          .setY(t.pos.y + 1)
          .sub(from);
        const len = dir.length();
        const hit = this.physics.castRay(from, dir.normalize(), len, 0xffff0001 >>> 0, u.v.physics.body);
        if (!hit || hit.distance > len - 2) seen = true;
      }
    }
    // Busted: a police car stopped right next to a player on foot.
    const cornered =
      t.onFoot &&
      this.units.some(
        (u) =>
          u.inUse &&
          u.v !== playerVehicle &&
          u.v.root.position.distanceTo(t.pos) < 7 &&
          Math.abs(u.v.physics.speed) < 2,
      );
    this.bustTimer = cornered ? this.bustTimer + dt : Math.max(0, this.bustTimer - dt);
    if (this.bustTimer > 2.5) {
      this.bustTimer = 0;
      this.bus.emit('player:busted', {});
      this.clear();
      return;
    }
    if (seen) this.sinceSeen = 0;
    else this.sinceSeen += dt;
    const evading = this.sinceSeen > 2;
    if (this.store.get().wanted.evading !== evading)
      this.store.set({ wanted: { level: this.level, evading } });
    if (this.sinceSeen > 10 + this.level * 5) {
      this.bus.emit('ui:toast', { text: 'You lost the police.' });
      this.clear();
      return;
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const want = Math.min(8, Math.ceil(this.level * 1.5));
    let active = 0;
    for (const u of this.units) {
      if (!u.inUse || u.v === playerVehicle) continue;
      if (u.v.root.position.distanceTo(t.pos) > 420 || u.v.root.position.y < -2) this.release(u);
      else active++;
    }
    if (active < want) {
      const [node] = this.graph.sampleRing(t.pos, 90, 200, 1, this.rnd);
      if (node) {
        const u = this.acquire();
        const yaw = Math.atan2(t.pos.x - node.p.x, t.pos.z - node.p.z);
        this.place(u, node.p, yaw);
      }
    }
    // Roadblock ahead of a driving player at 4+ stars.
    if (this.level >= 4 && playerVehicle && this.rnd() < 0.15 && active + 2 <= want + 2) {
      const ahead = t.pos.clone().addScaledVector(t.vel.clone().setY(0).normalize(), 140);
      const node = this.graph.nearest(ahead, 40);
      if (node && node.links[0]) {
        const other = this.graph.nodes[node.links[0].to]!.p;
        const dir = other.clone().sub(node.p).setY(0).normalize();
        const across = Math.atan2(dir.x, dir.z) + Math.PI / 2;
        for (const s of [-1.6, 1.6]) {
          const u = this.acquire();
          this.place(u, node.p.clone().add(new THREE.Vector3(-dir.z * s, 0, dir.x * s)), across, true);
        }
        this.bus.emit('ui:toast', { text: 'Roadblock ahead!' });
      }
    }
    void camera;
  }
}
