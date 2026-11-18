import { describe, expect, it } from 'vitest';
import { cityDensity } from './cityRhythm';
import { autoFare, FareMeter } from './FareMeter';
import { EventBus } from '../core/EventBus';
import { FixedStepClock } from '../core/Time';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../core/Settings';
import { VEHICLE_PROFILES, validateProfile, type VehicleProfile } from '../actors/vehicles/VehicleProfile';

describe('city rhythm', () => {
  it('is busy at rush hour and quiet at 3 AM', () => {
    expect(cityDensity(9.5 * 60)).toBeGreaterThan(0.8);
    expect(cityDensity(19 * 60)).toBeGreaterThan(0.8);
    expect(cityDensity(3.5 * 60)).toBeLessThan(0.2);
    expect(cityDensity(3.5 * 60)).toBeGreaterThan(0);
  });
});

describe('auto fare meter', () => {
  it('charges the minimum fare for the first 1.5 km', () => {
    expect(autoFare(0)).toBe(26);
    expect(autoFare(1.5)).toBe(26);
  });
  it('adds the per-km rate after that', () => {
    expect(autoFare(2.5)).toBeCloseTo(43.14, 2);
  });
  it('accumulates distance only while running', () => {
    const m = new FareMeter();
    m.addDistance(500);
    expect(m.km).toBe(0);
    m.start();
    m.addDistance(3000);
    expect(m.km).toBe(3);
    expect(m.stop()).toBeCloseTo(26 + 1.5 * 17.14, 2);
  });
});

describe('core', () => {
  it('EventBus delivers, unsubscribes and supports once', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('ping', ({ n }) => got.push(n));
    bus.once('ping', ({ n }) => got.push(n * 10));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(got).toEqual([1, 10]);
  });

  it('FixedStepClock runs whole steps and caps the backlog', () => {
    const c = new FixedStepClock(60, 5);
    expect(c.advance(1 / 60 + 1e-6)).toBe(1);
    expect(c.advance(0.008)).toBe(0);
    expect(c.alpha).toBeGreaterThan(0);
    expect(c.advance(2)).toBe(5);
  });

  it('sanitizeSettings falls back per field', () => {
    const s = sanitizeSettings({ quality: 'insane', mouseSensitivity: 99, invertY: true, timeMode: 'ist' });
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.mouseSensitivity).toBe(5);
    expect(s.invertY).toBe(true);
    expect(s.timeMode).toBe('ist');
  });
});

describe('vehicle profiles (data-driven seats)', () => {
  it('every vehicle has one driver seat and unique seat ids', () => {
    for (const p of Object.values(VEHICLE_PROFILES)) {
      expect(p.seats.filter((s) => s.type === 'driver')).toHaveLength(1);
      expect(new Set(p.seats.map((s) => s.id)).size).toBe(p.seats.length);
    }
  });

  it('the BEST bus offers sit, stand-and-hold-rail and door-hang spots', () => {
    const types = new Set(VEHICLE_PROFILES['best-bus']!.seats.map((s) => s.type));
    expect(types).toEqual(new Set(['driver', 'passenger', 'standing', 'doorHang']));
    const doors = VEHICLE_PROFILES['best-bus']!.seats.filter((s) => s.type === 'doorHang');
    // Doors open on the left (+X), toward the kerb.
    for (const d of doors) expect(d.position[0]).toBeGreaterThan(1.28);
  });

  it('drivers sit on the right (Indian right-hand drive)', () => {
    for (const id of ['hatchback', 'best-bus', 'lorry']) {
      const driver = VEHICLE_PROFILES[id]!.seats.find((s) => s.type === 'driver')!;
      expect(driver.position[0]).toBeLessThan(0);
    }
  });

  it('rejects malformed profiles', () => {
    const bad = structuredClone(VEHICLE_PROFILES['hatchback']!) as VehicleProfile;
    bad.seats = bad.seats.filter((s) => s.type !== 'driver');
    expect(() => validateProfile(bad)).toThrow(/driver seat/);
  });
});
