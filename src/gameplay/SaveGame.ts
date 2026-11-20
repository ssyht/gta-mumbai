import type { GameState, Store } from '../core/Store';

/**
 * Save/load to localStorage (CLAUDE.md §4.11). Stores progress, not the world:
 * money, health/armour, ammo, completed missions, radio station and where the
 * player last stood on foot. Guarded: storage can be blocked.
 */
const KEY = 'gta-mumbai:save:v1';

export interface SaveData {
  version: 1;
  savedAt: number;
  stats: GameState['stats'];
  ammo: number;
  missionsCompleted: string[];
  radio: string | null;
  position: { x: number; y: number; z: number; yaw: number } | null;
}

export function writeSave(
  store: Store<GameState>,
  position: SaveData['position'],
  radio: string | null,
): boolean {
  const s = store.get();
  const data: SaveData = {
    version: 1,
    savedAt: Date.now(),
    stats: s.stats,
    ammo: s.ammo,
    missionsCompleted: s.missions.completed,
    radio,
    position,
  };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.version !== 1 || !d.stats) return null;
    return {
      version: 1,
      savedAt: Number(d.savedAt) || 0,
      stats: {
        health: Math.max(1, Math.min(100, Number(d.stats.health) || 100)),
        armour: Math.max(0, Math.min(100, Number(d.stats.armour) || 0)),
        money: Math.max(0, Number(d.stats.money) || 0),
      },
      ammo: Math.max(0, Number(d.ammo) || 0),
      missionsCompleted: Array.isArray(d.missionsCompleted)
        ? d.missionsCompleted.filter((x) => typeof x === 'string')
        : [],
      radio: typeof d.radio === 'string' ? d.radio : null,
      position: d.position && Number.isFinite(d.position.x) ? d.position : null,
    };
  } catch {
    return null;
  }
}

export function applySave(store: Store<GameState>, d: SaveData): void {
  store.set({
    stats: d.stats,
    ammo: d.ammo,
    missions: { active: null, completed: d.missionsCompleted },
  });
}
