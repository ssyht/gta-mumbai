import * as THREE from 'three/webgpu';
import type { Vehicle } from '../actors/vehicles/Vehicle';
import type { VehicleManager } from '../actors/vehicles/VehicleManager';
import { Npc, OUTFITS } from '../actors/npcs/Npc';
import type { RigInstancer } from '../actors/rig/RigInstancer';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { mulberry32 } from '../render/materials/textures';
import type { LaneGraph } from '../world/roads/LaneGraph';
import { GraphDriver } from './GraphDriver';

/**
 * Ambient traffic (CLAUDE.md §4.3, §7: ≤80 active vehicles near the player).
 * Vehicles are pooled: spawned on graph nodes in a ring around the player
 * (out of the immediate view distance), driven by GraphDriver with an NPC at
 * the wheel, and recycled when far away or stuck. Lorries take over the
 * arterials at night; buses keep to wider roads. Carjacked vehicles leave the
 * pool and stay where the player abandons them.
 */
interface Managed {
  v: Vehicle;
  driver: GraphDriver;
  npc: Npc;
  profile: string;
  inUse: boolean;
}

const OUTFIT_FOR: Record<string, keyof typeof OUTFITS> = {
  'auto-rickshaw': 'autoDriver',
  taxi: 'autoDriver',
  'best-bus': 'busDriver',
  lorry: 'kurtaMan',
  scooter: 'student',
  hatchback: 'officeWorker',
};

export class TrafficSystem {
  private readonly pool: Managed[] = [];
  private timer = 0;
  private seq = 0;
  private readonly rnd = mulberry32(4242);
  maxActive: number;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly vehicles: VehicleManager,
    private readonly graph: LaneGraph,
    private readonly instancer: RigInstancer,
    maxActive: number,
    private readonly obstaclesFor: (self: Vehicle) => THREE.Vector3[],
    private readonly npcs: Map<string, Npc>,
  ) {
    this.maxActive = maxActive;
  }

  get activeCount(): number {
    return this.pool.filter((m) => m.inUse).length;
  }

  /** Weighted profile choice: time of day and road width matter. */
  private chooseProfile(night: boolean, roadWidth: number): string {
    const r = this.rnd();
    if (night && roadWidth >= 9 && r < 0.35) return 'lorry';
    if (roadWidth >= 10 && r < 0.08) return 'best-bus';
    const t = this.rnd();
    if (t < 0.3) return 'auto-rickshaw';
    if (t < 0.55) return 'taxi';
    if (t < 0.75) return 'scooter';
    if (t < 0.95) return 'hatchback';
    return roadWidth >= 9 ? 'lorry' : 'hatchback';
  }

  private acquire(profile: string): Managed {
    const free = this.pool.find((m) => !m.inUse && m.profile === profile);
    if (free) return free;
    const id = `tr-${this.seq++}`;
    const v = this.vehicles.spawn(profile, id, new THREE.Vector3(0, -40, 0), 0);
    const npc = new Npc(
      `${id}-driver`,
      OUTFITS[OUTFIT_FOR[profile] ?? 'officeWorker']!,
      this.scene,
      this.physics,
      this.instancer,
    );
    this.npcs.set(npc.id, npc);
    const driver = new GraphDriver(v.physics, this.graph, {
      cruise: v.profile.ai.cruiseSpeed * (0.85 + this.rnd() * 0.3),
      halfWidth: v.profile.chassis.halfExtents[0],
      halfLength: v.profile.chassis.halfExtents[2],
      obstacles: () => this.obstaclesFor(v),
      rnd: this.rnd,
    });
    const m: Managed = { v, driver, npc, profile, inUse: false };
    this.pool.push(m);
    return m;
  }

  private place(m: Managed, prev: number, cur: number): void {
    const a = this.graph.nodes[prev]!.p;
    const b = this.graph.nodes[cur]!.p;
    const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const link = this.graph.linkBetween(prev, cur);
    const off = Math.max(1.2, Math.min(3.6, (link?.width ?? 8) / 4));
    const wheel = m.v.profile.wheels[0]!;
    const pos = a
      .clone()
      .lerp(b, 0.3)
      .add(new THREE.Vector3(dir.z * off, 0, -dir.x * off));
    pos.y = -wheel.position[1] + wheel.radius + 0.12;
    m.v.setActive(true);
    m.v.repair();
    m.v.physics.reset(pos, Math.atan2(dir.x, dir.z));
    m.v.physics.controls.handbrake = false;
    m.v.snapHistory();
    m.v.ai = m.driver;
    m.driver.start(prev, cur);
    const seat = m.v.driverSeat;
    if (!seat.occupant) m.npc.sitIn(m.v, seat);
    m.npc.rig.setVisible(true);
    m.inUse = true;
  }

  private release(m: Managed): void {
    m.inUse = false;
    m.v.ai = null;
    m.v.setActive(false);
    m.npc.rig.setVisible(false);
  }

  /** Call every frame. `density` 0..1 from the city rhythm, `night` from TimeOfDay. */
  update(
    dt: number,
    player: THREE.Vector3,
    camera: THREE.Camera,
    density: number,
    night: boolean,
    playerVehicle: Vehicle | null,
  ): void {
    // Vehicles the player stole (or whose driver was pulled out) leave the pool.
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const m = this.pool[i]!;
      if (m.inUse && m.v.ai !== m.driver) {
        this.pool.splice(i, 1);
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const target = Math.round(this.maxActive * (0.3 + 0.7 * density));
    let active = 0;
    for (const m of this.pool) {
      if (!m.inUse) continue;
      const p = m.v.root.position;
      const d = p.distanceTo(player);
      const behind = new THREE.Vector3().subVectors(p, camera.position).dot(camDir) < 0;
      const tooFar = d > 330 || (d > 220 && behind);
      const stuck = m.driver.stuckTime > 8 && d > 40;
      const sunk = p.y < -2;
      if ((tooFar || stuck || sunk) && m.v !== playerVehicle) {
        this.release(m);
        continue;
      }
      active++;
    }
    // Spawn a couple per tick to avoid hitches.
    let budget = 2;
    while (active < target && budget-- > 0) {
      const [node] = this.graph.sampleRing(player, 110, 260, 1, this.rnd);
      if (!node) break;
      const link = node.links[Math.floor(this.rnd() * node.links.length)];
      if (!link) break;
      // Don't spawn on top of an existing vehicle.
      const np = node.p;
      if (this.vehicles.list.some((v) => v.active && v.root.position.distanceToSquared(np) < 100)) continue;
      const profile = this.chooseProfile(night, link.width);
      const m = this.acquire(profile);
      this.place(m, node.id, link.to);
      active++;
    }
  }
}
