import type { SeatType } from '../actors/vehicles/VehicleProfile';
import type { DayPhase } from '../render/sky/lightingCurves';
import type { SettingsData } from './Settings';
import { EventBus } from './EventBus';

/** Every cross-system event in the game, with its payload. */
export interface GameEvents {
  'player:enteredVehicle': { vehicleId: string; seatId: string; seatType: SeatType; carjacked: boolean };
  'player:exitedVehicle': { vehicleId: string; bailed: boolean };
  'player:seatChanged': { vehicleId: string; seatId: string; seatType: SeatType };
  'player:ragdoll': { speed: number };
  'player:respawned': Record<string, never>;
  'vehicle:horn': { vehicleId: string; on: boolean };
  'vehicle:airBrake': { vehicleId: string };
  'vehicle:carjacked': { vehicleId: string };
  'vehicle:stopRequested': { vehicleId: string };
  'settings:changed': { settings: SettingsData; reloadNeeded: boolean };
  'time:phase': { phase: DayPhase };
  'ui:prompt': { text: string | null };
  /** Secondary prompt line (robbery, pickups) shown above the main one. */
  'ui:hint': { text: string | null };
  'ui:toast': { text: string };
  'ui:pause': { paused: boolean };
  'fare:update': { active: boolean; rupees: number; km: number };
  /** Something illegal happened; the wanted system decides what it's worth. */
  crime: { kind: CrimeKind; at: { x: number; y: number; z: number } };
  'player:damaged': { amount: number; cause: string };
  'player:died': { cause: string };
  'player:busted': Record<string, never>;
  'wanted:changed': { level: number };
  'weapon:fired': { at: { x: number; y: number; z: number } };
  'money:changed': { delta: number; reason: string };
  'mission:started': { id: string; title: string };
  'mission:objective': { text: string };
  'mission:ended': { id: string; success: boolean; reward: number };
  'radio:changed': { station: string | null };
}

export type CrimeKind = 'carjack' | 'hitPedestrian' | 'assault' | 'shooting' | 'robbery' | 'assaultCop';

export type GameBus = EventBus<GameEvents>;

export function createGameBus(): GameBus {
  return new EventBus<GameEvents>();
}
