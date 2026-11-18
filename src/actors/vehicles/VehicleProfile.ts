/**
 * Data-driven vehicle definitions (CLAUDE.md §3: "Seat sockets are data-driven
 * in each vehicle's JSON").
 *
 * Vehicle-local frame: +Z forward, +X LEFT, +Y up, origin = chassis box centre.
 * Indian vehicles are right-hand drive, so drivers sit at negative X, and bus
 * doors open on the left (+X), toward the kerb.
 *
 * Seat `position` is where the occupant's pelvis goes; `exit` is where their
 * feet land when they get out (both in the vehicle frame).
 */
import hatchback from './profiles/hatchback.json';
import autoRickshaw from './profiles/auto-rickshaw.json';
import scooter from './profiles/scooter.json';
import bestBus from './profiles/best-bus.json';
import lorry from './profiles/lorry.json';
import taxi from './profiles/taxi.json';

export type Vec3T = [number, number, number];
export type SeatType = 'driver' | 'passenger' | 'standing' | 'doorHang';
export type SeatPose = 'drive' | 'sit' | 'ride' | 'pillion' | 'standHoldRail' | 'doorHang';
export type VehicleClass = 'car' | 'auto' | 'twoWheeler' | 'bus' | 'truck';
export type HornId = 'car' | 'auto' | 'scooter' | 'bus' | 'truck';
export type EngineId = 'petrol' | 'auto' | 'scooter' | 'diesel';

export interface SeatDef {
  id: string;
  type: SeatType;
  pose: SeatPose;
  position: Vec3T;
  exit: Vec3T;
  /** Which side window this seat looks out of in window-camera mode. */
  window?: 'left' | 'right';
}

export interface WheelDef {
  /** Wheel centre at suspension rest. */
  position: Vec3T;
  radius: number;
  width: number;
  steer: boolean;
  drive: boolean;
  /** Share of brake force on this wheel. */
  brake: number;
  handbrake?: boolean;
}

export interface VehicleProfile {
  id: string;
  name: string;
  class: VehicleClass;
  mesh: string;
  chassis: {
    halfExtents: Vec3T;
    mass: number;
    centerOfMass: Vec3T;
    inertiaScale: number;
    linearDamping: number;
    angularDamping: number;
  };
  wheels: WheelDef[];
  suspension: {
    restLength: number;
    stiffness: number;
    compression: number;
    relaxation: number;
    maxTravel: number;
    maxForce: number;
  };
  tyres: { frictionSlip: number; sideFrictionStiffness: number };
  engine: {
    force: number;
    reverseForce: number;
    topSpeedKmh: number;
    reverseTopSpeedKmh: number;
    brakeForce: number;
    handbrakeForce: number;
    coastBrake: number;
  };
  steering: { maxAngle: number; speed: number; highSpeedFactor: number };
  /**
   * uprightAssist: two-wheeler balance strength. maxLean: lean into turns (rad).
   * rollFactor: extra roll torque from cornering (body roll; >0.7 lets an auto tip).
   */
  stability: { uprightAssist: number; maxLean: number; airBrake: boolean; rollFactor: number };
  seats: SeatDef[];
  camera: { distance: number; height: number; lookHeight: number; fov: number };
  audio: { horn: HornId; engine: EngineId };
  ai: { cruiseSpeed: number };
}

const SEAT_TYPES: SeatType[] = ['driver', 'passenger', 'standing', 'doorHang'];

/** Throws with a readable message if a profile is malformed. */
export function validateProfile(p: VehicleProfile): VehicleProfile {
  const fail = (msg: string): never => {
    throw new Error(`Vehicle profile "${p.id}": ${msg}`);
  };
  if (!p.id || !p.name) fail('missing id or name');
  if (p.chassis.mass <= 0) fail('mass must be positive');
  if (p.wheels.length < 2) fail('needs at least 2 wheels');
  if (!p.wheels.some((w) => w.drive)) fail('needs a drive wheel');
  if (!p.wheels.some((w) => w.steer)) fail('needs a steering wheel');
  const drivers = p.seats.filter((s) => s.type === 'driver');
  if (drivers.length !== 1) fail(`needs exactly one driver seat, has ${drivers.length}`);
  const ids = new Set<string>();
  for (const s of p.seats) {
    if (ids.has(s.id)) fail(`duplicate seat id "${s.id}"`);
    ids.add(s.id);
    if (!SEAT_TYPES.includes(s.type)) fail(`seat "${s.id}" has unknown type "${s.type}"`);
    if (s.position.length !== 3 || s.exit.length !== 3) fail(`seat "${s.id}" needs 3D position and exit`);
  }
  if (p.engine.topSpeedKmh <= 0) fail('top speed must be positive');
  return p;
}

export const VEHICLE_PROFILES: Record<string, VehicleProfile> = Object.fromEntries(
  ([hatchback, autoRickshaw, scooter, bestBus, lorry, taxi] as VehicleProfile[]).map((p) => [
    p.id,
    validateProfile(p),
  ]),
);

export function getProfile(id: string): VehicleProfile {
  const p = VEHICLE_PROFILES[id];
  if (!p) throw new Error(`Unknown vehicle profile "${id}"`);
  return p;
}
