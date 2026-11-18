import { describe, expect, it } from 'vitest';
import {
  TimeOfDay,
  formatClock,
  istClockMinutes,
  istInstantForLocalClock,
  istInstantForMinutes,
} from './TimeOfDay';
import { applyUrlOverrides, DEFAULT_SETTINGS, parseClock } from '../../core/Settings';

const deg = (r: number): number => (r * 180) / Math.PI;

/** A fake wall clock that tests can advance. */
function fakeClock(start: Date) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (sec: number) => {
      t += sec * 1000;
    },
  };
}

describe('local clock → Mumbai instant', () => {
  it("interprets the player's local HH:MM as IST", () => {
    // Works in any test-machine time zone because we build the date from local parts.
    const local = new Date(2026, 11, 21, 7, 30, 0);
    const instant = istInstantForLocalClock(local);
    expect(istClockMinutes(instant)).toBeCloseTo(7 * 60 + 30, 6);
  });

  it('a Chicago player at 11:30 PM sees Mumbai at night', () => {
    const tod = new TimeOfDay({ mode: 'sync', now: () => new Date(2026, 10, 17, 23, 30) });
    expect(formatClock(tod.clockMinutes)).toBe('23:30');
    expect(deg(tod.state.sunAltitude)).toBeLessThan(-20);
  });

  it('noon on the local clock is daytime in Mumbai', () => {
    const tod = new TimeOfDay({ mode: 'sync', now: () => new Date(2026, 10, 17, 12, 0) });
    expect(deg(tod.state.sunAltitude)).toBeGreaterThan(40);
  });

  it('istInstantForMinutes keeps the local calendar date', () => {
    const ref = new Date(2026, 0, 5, 3, 0);
    const i = istInstantForMinutes(ref, 18 * 60 + 45);
    expect(formatClock(istClockMinutes(i))).toBe('18:45');
  });

  it('real IST mode uses the actual instant', () => {
    const instant = new Date(Date.UTC(2026, 10, 17, 0, 0)); // 05:30 IST
    const tod = new TimeOfDay({ mode: 'ist', now: () => instant });
    expect(formatClock(tod.clockMinutes)).toBe('05:30');
  });
});

describe('TimeOfDay service', () => {
  it('manual time-lapse advances by speed × dt', () => {
    const clock = fakeClock(new Date(2026, 10, 17, 9, 0));
    const tod = new TimeOfDay({ mode: 'manual', manualMinutes: 600, speed: 60, now: clock.now });
    for (let i = 0; i < 60; i++) {
      clock.advance(1 / 60);
      tod.update(1 / 60);
    }
    // 1 s at 60× = 1 game minute.
    expect(tod.clockMinutes).toBeCloseTo(601, 1);
  });

  it('frozen manual time stays put', () => {
    const clock = fakeClock(new Date(2026, 10, 17, 9, 0));
    const tod = new TimeOfDay({ mode: 'manual', manualMinutes: 1125, speed: 0, now: clock.now });
    clock.advance(30);
    tod.update(30);
    expect(formatClock(tod.clockMinutes)).toBe('18:45');
  });

  it('eases the sun toward new targets instead of stepping', () => {
    const clock = fakeClock(new Date(2026, 10, 17, 17, 0));
    const tod = new TimeOfDay({ mode: 'sync', now: clock.now, recomputeInterval: 10 });
    const before = tod.sunDir.clone();
    // Jump the target 20 minutes by advancing in small steps across a recompute boundary.
    let maxStep = 0;
    let prev = tod.sunDir.clone();
    for (let i = 0; i < 1200 * 60; i += 1) {
      clock.advance(1 / 60);
      tod.update(1 / 60);
      if (i % 60 === 0) {
        maxStep = Math.max(maxStep, prev.angleTo(tod.sunDir));
        prev = tod.sunDir.clone();
      }
      if (i > 60 * 60) break;
    }
    expect(tod.sunDir.angleTo(before)).toBeGreaterThan(0);
    // No visible jumps: under 0.05° per second of game time.
    expect((maxStep * 180) / Math.PI).toBeLessThan(0.05);
  });

  it('re-syncs on a wall-clock jump (sleep / clock change)', () => {
    const clock = fakeClock(new Date(2026, 10, 17, 10, 0));
    const tod = new TimeOfDay({ mode: 'sync', now: clock.now });
    clock.advance(6 * 3600); // laptop slept 6 hours
    tod.update(1 / 60);
    expect(formatClock(tod.clockMinutes)).toBe('16:00');
    expect(tod.sunDir.distanceTo(tod.state.sunDir)).toBeCloseTo(0);
  });

  it('switching to manual keeps the current clock', () => {
    const tod = new TimeOfDay({ mode: 'sync', now: () => new Date(2026, 10, 17, 14, 15) });
    tod.setMode('manual');
    expect(formatClock(tod.clockMinutes)).toBe('14:15');
  });
});

describe('settings time overrides', () => {
  it('parses HH:MM', () => {
    expect(parseClock('18:45')).toBe(1125);
    expect(parseClock('6:05')).toBe(365);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('nope')).toBeNull();
  });

  it('?time=18:45 freezes a manual clock, &speed sets a time-lapse', () => {
    const s = applyUrlOverrides(DEFAULT_SETTINGS, '?time=18:45');
    expect(s.timeMode).toBe('manual');
    expect(s.manualMinutes).toBe(1125);
    expect(s.timeSpeed).toBe(0);
    expect(applyUrlOverrides(DEFAULT_SETTINGS, '?time=06:00&speed=120').timeSpeed).toBe(120);
  });
});
