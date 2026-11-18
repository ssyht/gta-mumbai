import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import SunCalc from 'suncalc';
import { slerpUnit, solarToWorld } from './solarToWorld';
import { MUMBAI, computeSky, istInstantForMinutes } from './TimeOfDay';

const deg = (r: number): number => (r * 180) / Math.PI;
const WINTER = new Date(2026, 11, 21, 12, 0); // local calendar date; time is replaced below
const SUMMER = new Date(2027, 5, 21, 12, 0);

function skyAt(date: Date, minutes: number) {
  return computeSky(istInstantForMinutes(date, minutes));
}

describe('solarToWorld', () => {
  it('maps SunCalc cardinal azimuths to world axes (+X east, -Z north)', () => {
    const south = solarToWorld(0, 0);
    const west = solarToWorld(Math.PI / 2, 0);
    const east = solarToWorld(-Math.PI / 2, 0);
    const north = solarToWorld(Math.PI, 0);
    expect(south.z).toBeCloseTo(1);
    expect(west.x).toBeCloseTo(-1);
    expect(east.x).toBeCloseTo(1);
    expect(north.z).toBeCloseTo(-1);
    expect(solarToWorld(0.3, Math.PI / 2).y).toBeCloseTo(1);
    expect(solarToWorld(1.234, 0.4).length()).toBeCloseTo(1);
  });

  it('puts the winter sunrise in the east', () => {
    const { times } = skyAt(WINTER, 12 * 60);
    expect(times.sunrise).not.toBeNull();
    const s = skyAt(WINTER, times.sunrise!);
    expect(s.sunDir.x).toBeGreaterThan(0.85);
    expect(Math.abs(s.sunDir.y)).toBeLessThan(0.03);
    // December sunrise is south of due east.
    expect(s.sunDir.z).toBeGreaterThan(0);
  });

  it('puts the winter noon sun high and to the south', () => {
    const { times } = skyAt(WINTER, 12 * 60);
    const s = skyAt(WINTER, times.solarNoon!);
    expect(deg(s.sunAltitude)).toBeGreaterThan(44);
    expect(deg(s.sunAltitude)).toBeLessThan(51);
    expect(s.sunDir.z).toBeGreaterThan(0.6);
    expect(Math.abs(s.sunDir.x)).toBeLessThan(0.05);
  });

  it('puts the June noon sun nearly overhead, slightly north (Mumbai is below the Tropic of Cancer)', () => {
    const { times } = skyAt(SUMMER, 12 * 60);
    const s = skyAt(SUMMER, times.solarNoon!);
    expect(deg(s.sunAltitude)).toBeGreaterThan(80);
    expect(s.sunDir.z).toBeLessThan(0);
  });

  it('sets the sun in the west, over the Arabian Sea', () => {
    const { times } = skyAt(WINTER, 12 * 60);
    const s = skyAt(WINTER, times.sunset!);
    expect(s.sunDir.x).toBeLessThan(-0.85);
    expect(Math.abs(s.sunDir.y)).toBeLessThan(0.03);
  });

  it('matches SunCalc for an arbitrary instant', () => {
    const instant = new Date(Date.UTC(2026, 10, 17, 11, 0));
    const p = SunCalc.getPosition(instant, MUMBAI.lat, MUMBAI.lng);
    const v = solarToWorld(p.azimuth, p.altitude);
    expect(Math.asin(v.y)).toBeCloseTo(p.altitude, 6);
  });
});

describe('slerpUnit', () => {
  it('stays on the unit sphere and hits both endpoints', () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 1, 0);
    expect(slerpUnit(a, b, 0).distanceTo(a)).toBeCloseTo(0);
    expect(slerpUnit(a, b, 1).distanceTo(b)).toBeCloseTo(0);
    const mid = slerpUnit(a, b, 0.5);
    expect(mid.length()).toBeCloseTo(1);
    expect(mid.x).toBeCloseTo(Math.SQRT1_2);
  });
});
