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
  'ui:toast': { text: string };
  'ui:pause': { paused: boolean };
  'fare:update': { active: boolean; rupees: number; km: number };
}

export type GameBus = EventBus<GameEvents>;

export function createGameBus(): GameBus {
  return new EventBus<GameEvents>();
}
