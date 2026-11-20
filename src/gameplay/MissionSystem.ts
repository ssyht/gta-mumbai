import * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { GameState, Store } from '../core/Store';
import type { Vehicle } from '../actors/vehicles/Vehicle';
import dabba from './missions/dabba-dash.json';
import meter from './missions/meter-down.json';
import hot from './missions/hot-wheels.json';
import bunder from './missions/bunder-race.json';
import seaLink from './missions/sea-link-sprint.json';

/**
 * Data-driven missions (CLAUDE.md §4.7: trigger → objectives → fail/success).
 * Each mission is a JSON file in ./missions; objectives reference named places
 * the world registers, so the same file works as districts move.
 */
export type Objective =
  | { type: 'enterVehicle'; profile?: string; text: string; spawn?: { profile: string; place: string } }
  | { type: 'reach'; place: string; radius: number; inVehicle?: boolean; timeLimit?: number; text: string }
  | { type: 'escape'; wanted: number; text: string }
  | { type: 'race'; checkpoints: string[]; inVehicle?: boolean; timeLimit: number; text: string };

export interface MissionDef {
  id: string;
  title: string;
  dev: string;
  giver: string;
  brief: string;
  start: string;
  reward: number;
  objectives: Objective[];
}

export const MISSIONS: MissionDef[] = [dabba, meter, hot, bunder, seaLink] as MissionDef[];

export interface MissionHooks {
  places: Record<string, THREE.Vector3>;
  playerPos: () => THREE.Vector3;
  playerVehicle: () => Vehicle | null;
  spawnVehicle: (profile: string, place: THREE.Vector3) => Vehicle;
  wantedLevel: () => number;
  setWanted: (n: number) => void;
  earn: (amount: number, reason: string) => void;
  save: () => void;
}

export class MissionSystem {
  active: MissionDef | null = null;
  private step = 0;
  private timer = 0;
  private checkpoint = 0;
  private spawned: Vehicle | null = null;
  private readonly beam: THREE.Mesh;
  private readonly startMarkers: THREE.Mesh[] = [];
  private lastText = '';
  private cooldown = 0;

  constructor(
    scene: THREE.Scene,
    private readonly bus: GameBus,
    private readonly store: Store<GameState>,
    private readonly hooks: MissionHooks,
  ) {
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffcf1a,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24, 1, true), beamMat);
    this.beam.visible = false;
    scene.add(this.beam);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffcf1a,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    for (const m of this.available) {
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.5, 20, 1, true), markerMat);
      mk.position.copy(hooks.places[m.start]!).setY(hooks.places[m.start]!.y + 1.25);
      mk.userData.mission = m.id;
      scene.add(mk);
      this.startMarkers.push(mk);
    }
    bus.on('player:died', () => this.fail('You were hospitalised'));
    bus.on('player:busted', () => this.fail('You were arrested'));
  }

  /** Missions whose places all exist in the current world. */
  get available(): MissionDef[] {
    const p = this.hooks.places;
    return MISSIONS.filter((m) => {
      const names = [
        m.start,
        ...m.objectives.flatMap((o) =>
          'place' in o
            ? [o.place]
            : 'checkpoints' in o
              ? o.checkpoints
              : 'spawn' in o && o.spawn
                ? [o.spawn.place]
                : [],
        ),
      ];
      return names.every((n) => p[n]);
    });
  }

  isDone(id: string): boolean {
    return this.store.get().missions.completed.includes(id);
  }

  start(id: string): void {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m || this.active) return;
    this.active = m;
    this.step = -1;
    this.store.set({ missions: { ...this.store.get().missions, active: id } });
    this.bus.emit('mission:started', { id, title: m.title });
    this.bus.emit('ui:toast', { text: `${m.title} · ${m.giver}: ${m.brief}` });
    this.advance();
  }

  private advance(): void {
    const m = this.active;
    if (!m) return;
    this.step++;
    if (this.step >= m.objectives.length) {
      this.succeed();
      return;
    }
    const o = m.objectives[this.step]!;
    this.timer = 'timeLimit' in o && o.timeLimit ? o.timeLimit : 0;
    this.checkpoint = 0;
    if (o.type === 'enterVehicle' && o.spawn) {
      const at = this.hooks.places[o.spawn.place]!.clone();
      at.x += 4;
      this.spawned = this.hooks.spawnVehicle(o.spawn.profile, at);
    }
    if (o.type === 'escape') this.hooks.setWanted(o.wanted);
  }

  private succeed(): void {
    const m = this.active!;
    this.hooks.earn(m.reward, m.title);
    const done = this.store.get().missions.completed;
    this.store.set({ missions: { active: null, completed: done.includes(m.id) ? done : [...done, m.id] } });
    this.bus.emit('mission:ended', { id: m.id, success: true, reward: m.reward });
    this.end();
    this.hooks.save();
  }

  fail(reason: string): void {
    if (!this.active) return;
    const m = this.active;
    this.bus.emit('ui:toast', { text: `${m.title} failed: ${reason}` });
    this.bus.emit('mission:ended', { id: m.id, success: false, reward: 0 });
    this.store.set({ missions: { ...this.store.get().missions, active: null } });
    this.end();
  }

  private end(): void {
    this.active = null;
    this.beam.visible = false;
    this.spawned = null;
    this.cooldown = 4;
    this.objective('');
  }

  private objective(text: string): void {
    if (text === this.lastText) return;
    this.lastText = text;
    this.bus.emit('mission:objective', { text });
  }

  /** Current target for the minimap. */
  get target(): THREE.Vector3 | null {
    const m = this.active;
    if (!m) return null;
    const o = m.objectives[this.step];
    if (!o) return null;
    if (o.type === 'reach') return this.hooks.places[o.place] ?? null;
    if (o.type === 'race') return this.hooks.places[o.checkpoints[this.checkpoint]!] ?? null;
    if (o.type === 'enterVehicle') return this.spawned?.root.position ?? null;
    return null;
  }

  get startPoints(): Array<{ id: string; pos: THREE.Vector3 }> {
    return this.available
      .filter(() => !this.active)
      .map((m) => ({ id: m.id, pos: this.hooks.places[m.start]! }));
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const t = (performance.now() / 1000) % 10;
    for (const mk of this.startMarkers) {
      mk.visible = !this.active;
      mk.rotation.y = t;
    }
    const pp = this.hooks.playerPos();
    if (!this.active) {
      if (this.cooldown > 0 || this.hooks.playerVehicle()) return;
      for (const mk of this.startMarkers) {
        if (Math.hypot(mk.position.x - pp.x, mk.position.z - pp.z) < 1.6) {
          this.start(mk.userData.mission as string);
          break;
        }
      }
      return;
    }
    const m = this.active;
    const o = m.objectives[this.step]!;
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail('Out of time');
        return;
      }
    }
    const clock =
      this.timer > 0
        ? `  ${Math.floor(this.timer / 60)}:${String(Math.floor(this.timer % 60)).padStart(2, '0')}`
        : '';
    const veh = this.hooks.playerVehicle();
    const tgt = this.target;
    this.beam.visible = !!tgt && o.type !== 'enterVehicle';
    if (tgt) this.beam.position.set(tgt.x, tgt.y + 30, tgt.z);
    switch (o.type) {
      case 'enterVehicle': {
        this.objective(`${o.text}${clock}`);
        if (veh && (!o.profile || veh.profile.id === o.profile)) this.advance();
        break;
      }
      case 'reach': {
        this.objective(`${o.text}${clock}${o.inVehicle && !veh ? '  (get back in a vehicle)' : ''}`);
        const p = this.hooks.places[o.place]!;
        if (Math.hypot(p.x - pp.x, p.z - pp.z) < o.radius && (!o.inVehicle || veh)) this.advance();
        break;
      }
      case 'escape': {
        this.objective(`${o.text}  ${'★'.repeat(this.hooks.wantedLevel())}`);
        if (this.hooks.wantedLevel() === 0) this.advance();
        break;
      }
      case 'race': {
        this.objective(`${o.text} ${this.checkpoint + 1}/${o.checkpoints.length}${clock}`);
        const p = this.hooks.places[o.checkpoints[this.checkpoint]!]!;
        if (Math.hypot(p.x - pp.x, p.z - pp.z) < 16 && (!o.inVehicle || veh)) {
          this.checkpoint++;
          this.bus.emit('ui:toast', { text: `Checkpoint ${this.checkpoint}/${o.checkpoints.length}` });
          if (this.checkpoint >= o.checkpoints.length) this.advance();
        }
        break;
      }
    }
  }
}
