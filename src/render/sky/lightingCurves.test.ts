import { describe, expect, it } from 'vitest';
import {
  dayPhase,
  gradeFor,
  gradeWeights,
  streetLightFactor,
  sunColor,
  sunIntensity,
} from './lightingCurves';

describe('lighting curves', () => {
  it('sun is off below the horizon and strongest when high', () => {
    expect(sunIntensity(-5)).toBe(0);
    expect(sunIntensity(10)).toBeGreaterThan(0.5);
    expect(sunIntensity(70)).toBeGreaterThan(sunIntensity(10));
  });

  it('sun turns deep orange near the horizon', () => {
    const low = sunColor(1);
    const high = sunColor(60);
    expect(low[2]).toBeLessThan(0.3);
    expect(high[2]).toBeGreaterThan(0.8);
  });

  it('phases follow the sun, morning vs evening', () => {
    expect(dayPhase(30, true)).toBe('day');
    expect(dayPhase(3, false)).toBe('golden');
    expect(dayPhase(3, true)).toBe('dawn');
    expect(dayPhase(-4, false)).toBe('blue');
    expect(dayPhase(-15, false)).toBe('night');
  });

  it('grade weights always sum to 1', () => {
    for (let alt = -30; alt <= 80; alt += 0.5) {
      for (const morning of [true, false]) {
        const w = gradeWeights(alt, morning);
        const sum = Object.values(w).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 6);
        for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('night is exposed brighter than midday and blooms more', () => {
    expect(gradeFor(-30, false).exposure).toBeGreaterThan(gradeFor(60, false).exposure);
    expect(gradeFor(-30, false).bloom).toBeGreaterThan(gradeFor(60, false).bloom);
  });

  it('street lights are on at night and off at noon', () => {
    expect(streetLightFactor(-10)).toBe(1);
    expect(streetLightFactor(40)).toBe(0);
  });
});
