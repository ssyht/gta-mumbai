import type { SeatType } from '../actors/vehicles/VehicleProfile';

/** All gameplay state lives in one store (CLAUDE.md §6). */
export type PlayerMode = 'onFoot' | 'driving' | 'passenger' | 'ragdoll' | 'transition';

export interface GameState {
  started: boolean;
  paused: boolean;
  player: {
    mode: PlayerMode;
    vehicleId: string | null;
    seatId: string | null;
    seatType: SeatType | null;
  };
  fare: { active: boolean; rupees: number; km: number };
}

type Listener<T> = (state: Readonly<T>, prev: Readonly<T>) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): Readonly<T> {
    return this.state;
  }

  set(patch: Partial<T> | ((s: Readonly<T>) => Partial<T>)): void {
    const prev = this.state;
    const p = typeof patch === 'function' ? patch(prev) : patch;
    this.state = { ...prev, ...p };
    for (const l of [...this.listeners]) l(this.state, prev);
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function createGameStore(): Store<GameState> {
  return new Store<GameState>({
    started: false,
    paused: false,
    player: { mode: 'onFoot', vehicleId: null, seatId: null, seatType: null },
    fare: { active: false, rupees: 0, km: 0 },
  });
}
