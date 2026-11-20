import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PhysicsWorld } from './PhysicsWorld';
import { VehiclePhysics } from './VehiclePhysics';
import { VEHICLE_PROFILES, getProfile } from '../actors/vehicles/VehicleProfile';

const DT = 1 / 60;

async function flatWorld(): Promise<PhysicsWorld> {
  const physics = await PhysicsWorld.create();
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2000, y: 0.5, z: 2000 });
  return physics;
}

function spawn(physics: PhysicsWorld, id: string): VehiclePhysics {
  const p = getProfile(id);
  const wheel = p.wheels[0]!;
  const y = -wheel.position[1] + wheel.radius + 0.05;
  return new VehiclePhysics(physics, p, new Vector3(0, y, 0), 0);
}

function run(physics: PhysicsWorld, v: VehiclePhysics, seconds: number, onStep?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += DT) {
    onStep?.(t);
    v.fixedUpdate(DT);
    physics.step(DT);
  }
}

describe('vehicle physics (Rapier DynamicRayCastVehicleController)', () => {
  let ids: string[] = [];
  beforeAll(() => {
    ids = Object.keys(VEHICLE_PROFILES);
  });

  it('has all M1 vehicles', () => {
    expect(ids.sort()).toEqual([
      'auto-rickshaw',
      'best-bus',
      'hatchback',
      'lorry',
      'police',
      'scooter',
      'taxi',
    ]);
  });

  for (const id of Object.keys(VEHICLE_PROFILES)) {
    it(`${id}: rests on its wheels, drives forward (+Z), steers left (+X), stays upright, brakes`, async () => {
      const physics = await flatWorld();
      const v = spawn(physics, id);
      run(physics, v, 1.5);
      expect(v.uprightness).toBeGreaterThan(0.97);
      const restY = v.getPosition().y;
      expect(restY).toBeGreaterThan(0.2);

      v.controls.throttle = 1;
      run(physics, v, 5);
      const p = v.getPosition();
      expect(p.z).toBeGreaterThan(8);
      expect(Math.abs(p.x)).toBeLessThan(1.5);
      expect(v.speed).toBeGreaterThan(4);
      expect(v.speedKmh).toBeLessThanOrEqual(getProfile(id).engine.topSpeedKmh + 3);

      // Gentle left turn at speed.
      const before = v.getPosition();
      v.controls.steer = 0.5;
      v.controls.throttle = 0.5;
      run(physics, v, 2);
      const after = v.getPosition();
      expect(after.x - before.x).toBeGreaterThan(0.5);
      expect(v.uprightness).toBeGreaterThan(0.75);

      // Brake to a stop.
      v.controls.steer = 0;
      v.controls.throttle = 0;
      v.controls.brake = 1;
      let minSpeed = Infinity;
      run(physics, v, 6, () => {
        minSpeed = Math.min(minSpeed, Math.abs(v.speed));
      });
      expect(minSpeed).toBeLessThan(0.5);
      expect(v.uprightness).toBeGreaterThan(0.75);
    });
  }

  it('the bus is heavier and slower to accelerate than the hatchback', async () => {
    const results: Record<string, number> = {};
    for (const id of ['hatchback', 'best-bus']) {
      const physics = await flatWorld();
      const v = spawn(physics, id);
      run(physics, v, 1);
      v.controls.throttle = 1;
      run(physics, v, 4);
      results[id] = v.speed;
    }
    expect(results['hatchback']!).toBeGreaterThan(results['best-bus']! * 1.3);
  });

  it('reverses when braking from a standstill', async () => {
    const physics = await flatWorld();
    const v = spawn(physics, 'hatchback');
    run(physics, v, 1);
    v.controls.brake = 1;
    run(physics, v, 3);
    expect(v.speed).toBeLessThan(-1);
    expect(v.getPosition().z).toBeLessThan(-1);
  });

  it('heavy vehicles hiss their air brakes when they stop', async () => {
    const physics = await flatWorld();
    const v = spawn(physics, 'best-bus');
    let hisses = 0;
    v.onAirBrake = () => hisses++;
    run(physics, v, 1);
    v.controls.throttle = 1;
    run(physics, v, 5);
    v.controls.throttle = 0;
    v.controls.brake = 1;
    run(physics, v, 8);
    expect(hisses).toBe(1);
  });

  it('reset() puts a flipped vehicle back on its wheels', async () => {
    const physics = await flatWorld();
    const v = spawn(physics, 'auto-rickshaw');
    v.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down
    run(physics, v, 3);
    expect(v.uprightness).toBeLessThan(0);
    v.reset();
    run(physics, v, 2);
    expect(v.uprightness).toBeGreaterThan(0.95);
  });
});
