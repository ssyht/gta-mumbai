import type * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { Input } from '../core/Input';
import type { PlayerController } from '../actors/player/PlayerController';
import type { PlayerStats } from './PlayerStats';
import type { Targetable } from './Combat';

export interface ShopFront {
  pos: THREE.Vector3;
  name: string;
  restaurant: boolean;
}

/**
 * Hold-ups at shops and restaurants (all fictional businesses, CLAUDE.md §2).
 * Stand at a shop front and hold E: the shopkeeper empties the till over a
 * few seconds. Restaurants carry more cash. Every robbery is worth at least
 * two stars, the street panics, and the shop needs a while to restock.
 */
const HOLD = 3.5;
const COOLDOWN = 300;

export class Robbery {
  private progress = 0;
  private current: ShopFront | null = null;
  private readonly cooldown = new Map<ShopFront, number>();
  private lastHint: string | null = null;

  constructor(
    private readonly shops: ShopFront[],
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly stats: PlayerStats,
    private readonly crowds: Targetable[],
    private readonly bus: GameBus,
    private readonly wantedAtLeast: (n: number) => void,
  ) {}

  get count(): number {
    return this.shops.length;
  }

  get list(): readonly ShopFront[] {
    return this.shops;
  }

  available(s: ShopFront): boolean {
    return (this.cooldown.get(s) ?? 0) <= 0;
  }

  private hint(text: string | null): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.bus.emit('ui:hint', { text });
  }

  update(dt: number): void {
    for (const [s, t] of this.cooldown) this.cooldown.set(s, t - dt);
    if (!this.player.isOnFoot) {
      this.progress = 0;
      this.hint(null);
      return;
    }
    const p = this.player.position;
    let near: ShopFront | null = null;
    let bd = 2.4;
    for (const s of this.shops) {
      const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
      if (d < bd && Math.abs(s.pos.y - p.y) < 1.5) {
        bd = d;
        near = s;
      }
    }
    if (!near) {
      this.progress = 0;
      this.current = null;
      this.hint(null);
      return;
    }
    if (!this.available(near)) {
      this.hint(`${near.name}: till is empty, come back later`);
      return;
    }
    if (near !== this.current) {
      this.current = near;
      this.progress = 0;
    }
    if (this.input.isDown('use')) {
      if (this.progress === 0) {
        this.bus.emit('crime', { kind: 'robbery', at: p });
        this.wantedAtLeast(2);
        for (const c of this.crowds) c.panic(p, 30);
      }
      this.progress += dt;
      this.hint(`Robbing ${near.name}… ${Math.round((this.progress / HOLD) * 100)}%`);
      if (this.progress >= HOLD) {
        const cash = Math.round(
          (near.restaurant ? 4000 : 1500) + Math.random() * (near.restaurant ? 5000 : 3000),
        );
        this.stats.earn(cash, `Robbed ${near.name}`);
        this.bus.emit('ui:toast', { text: `₹${cash.toLocaleString('en-IN')} from ${near.name}. Run!` });
        this.cooldown.set(near, COOLDOWN);
        this.progress = 0;
        this.current = null;
      }
    } else {
      if (this.progress > 0) this.progress = Math.max(0, this.progress - dt * 2);
      this.hint(`E (hold)  Rob ${near.name}${near.restaurant ? ' · restaurant' : ''}`);
    }
  }
}
