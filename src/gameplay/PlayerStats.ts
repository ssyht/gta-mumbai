import * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { GameState, Store } from '../core/Store';

/**
 * Health, armour and money, plus the two ways a spree ends: hospitalised
 * (health 0, pay the hospital bill) or arrested (police caught you on foot,
 * pay the fine). Armour soaks damage first; health slowly recovers to 40.
 */
export const HOSPITAL_BILL = 1000;
export const ARREST_FINE = 1500;

export class PlayerStats {
  private sinceHit = 99;
  /** Seconds left of a death/arrest screen. */
  downTime = 0;
  private respawnAt: (() => void) | null = null;

  constructor(
    private readonly bus: GameBus,
    private readonly store: Store<GameState>,
    respawn: { hospital: () => void; station: () => void; clearWanted: () => void },
  ) {
    bus.on('player:ragdoll', ({ speed }) => {
      if (speed > 6) this.damage(Math.min(60, (speed - 5) * 4), 'impact');
    });
    bus.on('player:died', () => {
      this.downTime = 4.5;
      this.respawnAt = () => {
        respawn.clearWanted();
        respawn.hospital();
        this.pay(HOSPITAL_BILL, 'Hospital bill');
        this.store.set({ stats: { ...this.store.get().stats, health: 100, armour: 0 } });
      };
    });
    bus.on('player:busted', () => {
      this.downTime = 4.5;
      this.respawnAt = () => {
        respawn.station();
        this.pay(ARREST_FINE, 'Court fine');
        this.store.set({ ammo: Math.min(this.store.get().ammo, 12), weapon: 'fists' });
      };
    });
  }

  get dead(): boolean {
    return this.store.get().stats.health <= 0;
  }

  damage(amount: number, cause: string): void {
    if (this.downTime > 0) return;
    const s = this.store.get().stats;
    const absorbed = Math.min(s.armour, amount * 0.7);
    const health = Math.max(0, s.health - (amount - absorbed));
    this.store.set({ stats: { ...s, armour: s.armour - absorbed, health } });
    this.sinceHit = 0;
    this.bus.emit('player:damaged', { amount, cause });
    if (health <= 0) this.bus.emit('player:died', { cause });
  }

  heal(health: number, armour = 0): void {
    const s = this.store.get().stats;
    this.store.set({
      stats: { ...s, health: Math.min(100, s.health + health), armour: Math.min(100, s.armour + armour) },
    });
  }

  earn(amount: number, reason: string): void {
    const s = this.store.get().stats;
    this.store.set({ stats: { ...s, money: s.money + amount } });
    this.bus.emit('money:changed', { delta: amount, reason });
  }

  pay(amount: number, reason: string): void {
    const s = this.store.get().stats;
    const paid = Math.min(s.money, amount);
    this.store.set({ stats: { ...s, money: s.money - paid } });
    this.bus.emit('money:changed', { delta: -paid, reason });
  }

  update(dt: number): void {
    if (this.downTime > 0) {
      this.downTime -= dt;
      if (this.downTime <= 0 && this.respawnAt) {
        this.respawnAt();
        this.respawnAt = null;
      }
      return;
    }
    this.sinceHit += dt;
    const s = this.store.get().stats;
    if (this.sinceHit > 8 && s.health < 40)
      this.store.set({ stats: { ...s, health: Math.min(40, s.health + dt * 2) } });
  }
}

/** Pickups dotted around the world: health (green), armour (blue), ammo (gold). */
export class Pickups {
  private readonly items: Array<{ mesh: THREE.Mesh; kind: 'health' | 'armour' | 'ammo'; respawn: number }> =
    [];

  constructor(scene: THREE.Scene, spots: Array<{ pos: THREE.Vector3; kind: 'health' | 'armour' | 'ammo' }>) {
    const colors = { health: 0x2ecc71, armour: 0x3498db, ammo: 0xf1c40f };
    for (const s of spots) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[s.kind],
        emissive: colors[s.kind],
        emissiveIntensity: 0.8,
      });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat);
      mesh.position.copy(s.pos).setY(s.pos.y + 0.9);
      scene.add(mesh);
      this.items.push({ mesh, kind: s.kind, respawn: 0 });
    }
  }

  update(dt: number, player: THREE.Vector3, stats: PlayerStats, store: Store<GameState>, bus: GameBus): void {
    for (const it of this.items) {
      it.mesh.rotation.y += dt * 2;
      if (it.respawn > 0) {
        it.respawn -= dt;
        it.mesh.visible = it.respawn <= 0;
        continue;
      }
      if (it.mesh.position.distanceTo(player.clone().setY(player.y + 0.9)) < 1.2) {
        if (it.kind === 'health') stats.heal(100);
        if (it.kind === 'armour') stats.heal(0, 100);
        if (it.kind === 'ammo') store.set({ ammo: store.get().ammo + 36 });
        bus.emit('ui:toast', {
          text: it.kind === 'ammo' ? '+36 rounds' : it.kind === 'armour' ? 'Armour' : 'Health',
        });
        it.respawn = 90;
        it.mesh.visible = false;
      }
    }
  }
}
