import * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { Input } from '../core/Input';
import type { GameState, Store } from '../core/Store';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerController } from '../actors/player/PlayerController';
import type { SeatRuntime, Vehicle } from '../actors/vehicles/Vehicle';
import type { VehicleManager } from '../actors/vehicles/VehicleManager';
import type { SeatType } from '../actors/vehicles/VehicleProfile';
import type { Npc } from '../actors/npcs/Npc';
import { WaypointDriver } from '../ai/WaypointDriver';
import { BEST_MIN_TICKET, FareMeter } from './FareMeter';

const BAIL_SPEED = 3; // m/s: faster than this, getting out means jumping out
const REACH = 2.4; // m from the chassis to interact
const PASSENGER_ORDER: SeatType[] = ['passenger', 'standing', 'doorHang'];
const SEAT_LABEL: Record<SeatType, string> = {
  driver: 'drive',
  passenger: 'sit',
  standing: 'stand, holding the rail',
  doorHang: 'hang from the door',
};

const _v = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * "The player can drive or ride ANYTHING that moves" (CLAUDE.md §3).
 * F: drive (carjack if occupied) / get out (jump out if moving).
 * G: ride as passenger / change spot (bus: sit → stand → door).
 * H: horn. R: flip vehicle back over. Space as passenger: jump off.
 */
export class InteractionSystem {
  private readonly fare = new FareMeter();
  private lastPos = new THREE.Vector3();
  private lastPrompt: string | null = null;
  private exitPending = false;

  constructor(
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly vehicles: VehicleManager,
    private readonly npcs: Map<string, Npc>,
    private readonly physics: PhysicsWorld,
    private readonly bus: GameBus,
    private readonly store: Store<GameState>,
  ) {}

  /** Per-frame: edge-triggered actions and prompts. */
  update(): void {
    const p = this.player;
    if (p.state === 'onFoot') this.onFoot();
    else if (p.state === 'seated' && p.seat) this.inVehicle(p.seat.vehicle, p.seat.seat);
    else this.prompt(null);

    this.syncStore();
  }

  /** Per fixed step: player-driven vehicle controls. */
  fixedUpdate(): void {
    const s = this.player.seat;
    if (!s || this.player.state !== 'seated' || s.seat.def.type !== 'driver') return;
    const c = s.vehicle.physics.controls;
    c.throttle = this.input.throttle();
    c.brake = this.input.brake();
    c.steer = this.input.steer();
    c.handbrake = this.input.isDown('jump');
  }

  private onFoot(): void {
    const v = this.vehicles.nearest(this.player.position.clone().setY(this.player.position.y + 0.9), REACH);
    if (!v) {
      this.prompt(null);
      return;
    }
    const driver = v.driverSeat;
    const free = this.pickPassengerSeat(v);
    const parts: string[] = [];
    if (driver.occupant?.kind !== 'player') {
      parts.push(driver.occupant ? `F  Carjack ${v.name}` : `F  Drive ${v.name}`);
    }
    if (free)
      parts.push(
        `G  ${v.profile.class === 'twoWheeler' ? 'Ride pillion' : `Ride as passenger (${SEAT_LABEL[free.def.type]})`}`,
      );
    this.prompt(parts.length ? parts.join('     ') : null);

    if (this.input.wasPressed('interact')) this.enterAsDriver(v);
    else if (this.input.wasPressed('passenger') && free) this.enterAsPassenger(v, free);
  }

  private enterAsDriver(v: Vehicle): void {
    const seat = v.driverSeat;
    let carjacked = false;
    if (seat.occupant?.kind === 'npc') {
      const npc = this.npcs.get(seat.occupant.id);
      v.exitWorld(seat.def, _v);
      _side.subVectors(_v, v.root.position).setY(0).normalize();
      npc?.eject(_side);
      carjacked = true;
      this.bus.emit('vehicle:carjacked', { vehicleId: v.id });
      this.bus.emit('ui:toast', {
        text:
          v.profile.class === 'bus'
            ? 'You hijacked a BEST bus. The passengers do not look surprised.'
            : `Carjacked the ${v.name}!`,
      });
    }
    // The player drives now; any AI route is dropped.
    v.ai = null;
    this.vehicles.setHorn(v, false);
    v.physics.controls.handbrake = false;
    this.player.enterSeat(v, seat, carjacked ? 0.9 : v.profile.class === 'twoWheeler' ? 0.5 : 0.7);
    this.vehicles.focus = v;
    this.bus.emit('player:enteredVehicle', {
      vehicleId: v.id,
      seatId: seat.def.id,
      seatType: 'driver',
      carjacked,
    });
  }

  private enterAsPassenger(v: Vehicle, seat: SeatRuntime): void {
    this.player.enterSeat(v, seat, seat.def.type === 'doorHang' ? 0.6 : 0.8);
    this.vehicles.focus = v;
    const ai = v.ai instanceof WaypointDriver ? v.ai : null;
    if (ai && !ai.active) {
      // Hired the auto: the meter starts and the driver sets off.
      ai.active = true;
      ai.resume();
      this.fare.start();
      this.lastPos.copy(v.root.position);
      this.bus.emit('ui:toast', { text: 'Meter down. Chalo bhaiya!' });
    } else if (v.profile.class === 'bus') {
      this.bus.emit('ui:toast', {
        text: `Ticket ₹${BEST_MIN_TICKET}. G changes spot, V looks out the window`,
      });
    }
    this.bus.emit('player:enteredVehicle', {
      vehicleId: v.id,
      seatId: seat.def.id,
      seatType: seat.def.type,
      carjacked: false,
    });
  }

  private inVehicle(v: Vehicle, seat: SeatRuntime): void {
    const speed = Math.abs(v.physics.speed);
    const isDriver = seat.def.type === 'driver';
    const ai = v.ai instanceof WaypointDriver ? v.ai : null;

    if (this.fare.active) {
      this.fare.addDistance(v.root.position.distanceTo(this.lastPos));
      this.lastPos.copy(v.root.position);
    }

    if (isDriver) {
      if (this.input.wasPressed('horn')) this.vehicles.setHorn(v, true);
      if (!this.input.isDown('horn') && v.hornOn) this.vehicles.setHorn(v, false);
      if (this.input.wasPressed('reset') && v.physics.uprightness < 0.6) {
        v.physics.reset();
        v.snapHistory();
      }
      const flip = v.physics.isFlipped ? '     R  Flip it back over' : '';
      this.prompt((speed > BAIL_SPEED ? 'F  Jump out' : 'F  Get out') + '     H  Horn     V  Camera' + flip);
      if (this.input.wasPressed('interact')) this.leave(v, seat, speed > BAIL_SPEED);
      return;
    }

    // Passenger.
    const next = this.nextSpot(v, seat);
    const parts: string[] = [];
    if (ai && ai.active) parts.push(this.exitPending ? 'Stopping…' : 'F  Ask driver to stop');
    else parts.push(speed > BAIL_SPEED ? 'F  Jump off' : 'F  Get off');
    if (speed > BAIL_SPEED) parts.push('Space  Jump off');
    if (next) parts.push(`G  ${SEAT_LABEL[next.def.type]}`);
    parts.push('V  Window view');
    this.prompt(parts.join('     '));

    if (this.input.wasPressed('passenger') && next) {
      this.player.switchSeat(next);
      this.bus.emit('player:seatChanged', { vehicleId: v.id, seatId: next.def.id, seatType: next.def.type });
    }
    if (this.input.wasPressed('jump') && speed > BAIL_SPEED) {
      this.leave(v, seat, true);
      return;
    }
    if (this.input.wasPressed('interact')) {
      if (ai && ai.active && speed > 0.5) {
        ai.requestStop();
        this.exitPending = true;
        this.bus.emit('vehicle:stopRequested', { vehicleId: v.id });
        this.bus.emit('ui:toast', { text: 'Bhaiya, yahin rok do! (Stop here)' });
      } else {
        this.leave(v, seat, speed > BAIL_SPEED);
      }
    }
    if (this.exitPending && ai?.stoppedForRequest) this.leave(v, seat, false);
  }

  /** Get out normally, or jump out of a moving vehicle. */
  private leave(v: Vehicle, seat: SeatRuntime, bail: boolean): void {
    this.exitPending = false;
    const ai = v.ai instanceof WaypointDriver ? v.ai : null;
    if (this.fare.active) {
      const fare = this.fare.stop();
      this.bus.emit('ui:toast', {
        text: `Paid ₹${fare.toFixed(0)} on the meter (${this.fare.km.toFixed(2)} km)`,
      });
      if (ai && v.profile.class === 'auto') {
        // The auto waits for its next fare.
        ai.active = false;
      }
    }
    ai?.resume();
    if (seat.def.type === 'driver') {
      this.vehicles.setHorn(v, false);
      const c = v.physics.controls;
      c.throttle = 0;
      c.brake = 0;
      c.steer = 0;
      c.handbrake = !bail;
    }
    const exit = this.findExit(v, seat);
    if (bail) {
      _side.subVectors(exit, v.root.position).setY(0).normalize();
      const lv = v.physics.body.linvel();
      this.player.bail(exit, _v.set(lv.x, lv.y, lv.z), _side);
    } else {
      this.player.exitSeat(exit);
    }
    this.vehicles.focus = null;
    this.bus.emit('player:exitedVehicle', { vehicleId: v.id, bailed: bail });
  }

  private findExit(v: Vehicle, seat: SeatRuntime): THREE.Vector3 {
    const tryPoint = (mirror: boolean): THREE.Vector3 | null => {
      const p = v.exitWorld(seat.def, new THREE.Vector3(), mirror);
      p.y = this.physics.groundHeight(p.x, p.z, p.y + 3, p.y);
      return this.physics.capsuleBlocked(p, 0.3, 0.55, v.physics.body) ? null : p;
    };
    const p = tryPoint(false) ?? tryPoint(true);
    if (p) return p;
    // Both sides blocked: climb out over the roof.
    const top = new THREE.Vector3(0, v.profile.chassis.halfExtents[1] + 0.3, 0).applyMatrix4(
      v.root.matrixWorld,
    );
    return top;
  }

  private pickPassengerSeat(v: Vehicle): SeatRuntime | null {
    const ppos = this.player.position;
    for (const type of PASSENGER_ORDER) {
      const free = v.freeSeats([type]);
      if (free.length === 0) continue;
      let best = free[0]!;
      let bestD = Infinity;
      for (const s of free) {
        const d = v.exitWorld(s.def, _v).distanceTo(ppos);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    }
    return null;
  }

  /** Bus spot cycling: sit → stand → hang from the door → sit. */
  private nextSpot(v: Vehicle, current: SeatRuntime): SeatRuntime | null {
    const order = PASSENGER_ORDER;
    const start = order.indexOf(current.def.type);
    for (let i = 1; i <= order.length; i++) {
      const type = order[(start + i) % order.length]!;
      if (type === current.def.type) continue;
      const free = v.freeSeats([type]);
      if (free.length) return free[0]!;
    }
    return null;
  }

  private prompt(text: string | null): void {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.bus.emit('ui:prompt', { text });
  }

  private syncStore(): void {
    const p = this.player;
    const s = this.store.get();
    const mode =
      p.state === 'ragdoll'
        ? 'ragdoll'
        : p.state === 'transition'
          ? 'transition'
          : p.state === 'seated'
            ? p.seat?.seat.def.type === 'driver'
              ? 'driving'
              : 'passenger'
            : 'onFoot';
    const vehicleId = p.seat?.vehicle.id ?? null;
    const seatId = p.seat?.seat.def.id ?? null;
    const seatType = p.seat?.seat.def.type ?? null;
    const fare = { active: this.fare.active, rupees: this.fare.rupees, km: this.fare.km };
    if (
      s.player.mode !== mode ||
      s.player.vehicleId !== vehicleId ||
      s.player.seatId !== seatId ||
      s.fare.active !== fare.active ||
      (fare.active && Math.abs(s.fare.rupees - fare.rupees) > 0.009)
    ) {
      this.store.set({ player: { mode, vehicleId, seatId, seatType }, fare });
      if (fare.active || s.fare.active) this.bus.emit('fare:update', fare);
    }
  }
}
