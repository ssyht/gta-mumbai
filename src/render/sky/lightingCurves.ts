/**
 * Pure functions that turn sun altitude into lighting and grading values.
 * M2.5 replaces the grade keyframes with authored `.cube` LUTs and the sun
 * colour with @takram/three-atmosphere transmittance; the interface stays.
 */
export type DayPhase = 'night' | 'dawn' | 'day' | 'golden' | 'blue';
export type RGB = [number, number, number];

export const PHASE_LABEL: Record<DayPhase, string> = {
  night: 'Night',
  dawn: 'Dawn',
  day: 'Day',
  golden: 'Golden hour',
  blue: 'Blue hour',
};

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function dayPhase(altDeg: number, isMorning: boolean): DayPhase {
  if (altDeg < -6) return 'night';
  if (altDeg < -1) return isMorning ? 'dawn' : 'blue';
  if (altDeg < 8) return isMorning ? 'dawn' : 'golden';
  return 'day';
}

const SUN_STOPS: Array<[number, RGB]> = [
  [-2, [1.0, 0.22, 0.06]],
  [2, [1.0, 0.42, 0.16]],
  [8, [1.0, 0.66, 0.38]],
  [20, [1.0, 0.85, 0.66]],
  [45, [1.0, 0.95, 0.87]],
];

/** Approximate transmittance colour of hazy Mumbai sunlight. */
export function sunColor(altDeg: number): RGB {
  if (altDeg <= SUN_STOPS[0]![0]) return [...SUN_STOPS[0]![1]];
  for (let i = 1; i < SUN_STOPS.length; i++) {
    const [a1, c1] = SUN_STOPS[i]!;
    const [a0, c0] = SUN_STOPS[i - 1]!;
    if (altDeg <= a1) return lerpRGB(c0, c1, (altDeg - a0) / (a1 - a0));
  }
  return [...SUN_STOPS[SUN_STOPS.length - 1]![1]];
}

/** Directional sun intensity; fades to zero just below the horizon. */
export function sunIntensity(altDeg: number): number {
  const s = Math.sin((Math.max(0, altDeg) * Math.PI) / 180);
  return smoothstep(-1.5, 6, altDeg) * (1.0 + 3.4 * s);
}

/** Cool moonlight, only when the sun is down and the moon is up. */
export function moonIntensity(sunAltDeg: number, moonAltDeg: number, fraction: number): number {
  const night = 1 - smoothstep(-8, -2, sunAltDeg);
  return 0.18 * night * smoothstep(0, 10, moonAltDeg) * (0.25 + 0.75 * fraction);
}

/** Street lights: on around sunset, off around sunrise. */
export function streetLightFactor(altDeg: number): number {
  return 1 - smoothstep(-3, 4, altDeg);
}

/** Lit windows ramp in gradually through the evening (each window has its own threshold). */
export function windowLightFactor(altDeg: number): number {
  return 1 - smoothstep(-10, 6, altDeg);
}

/** Night factor 0 (day) .. 1 (full night), used for stars and sky glow. */
export function nightFactor(altDeg: number): number {
  return 1 - smoothstep(-12, -3, altDeg);
}

export interface GradeKey {
  tint: RGB;
  shadowTint: RGB;
  highlightTint: RGB;
  saturation: number;
  contrast: number;
  exposure: number;
  bloom: number;
  fogColor: RGB;
  fogDensity: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
}

/** Time-of-day grade keyframes (CLAUDE.md §4A.4), placeholders for M2.5 LUTs. */
export const GRADE_KEYS: Record<Exclude<DayPhase, 'day'> | 'midday', GradeKey> = {
  dawn: {
    tint: [0.97, 0.97, 1.04],
    shadowTint: [0.86, 1.0, 1.06],
    highlightTint: [1.08, 0.96, 1.0],
    saturation: 0.9,
    contrast: 0.92,
    exposure: 1.15,
    bloom: 0.3,
    fogColor: [0.86, 0.74, 0.76],
    fogDensity: 0.0034,
    hemiSky: [0.62, 0.64, 0.82],
    hemiGround: [0.36, 0.3, 0.3],
    hemiIntensity: 0.65,
  },
  midday: {
    tint: [1.04, 1.0, 0.94],
    shadowTint: [0.92, 0.99, 1.05],
    highlightTint: [1.06, 1.0, 0.92],
    saturation: 1.12,
    contrast: 1.04,
    exposure: 0.62,
    bloom: 0.12,
    fogColor: [0.72, 0.8, 0.88],
    fogDensity: 0.0013,
    hemiSky: [0.86, 0.84, 0.8],
    hemiGround: [0.62, 0.48, 0.34],
    hemiIntensity: 1.1,
  },
  golden: {
    tint: [1.1, 0.98, 0.84],
    shadowTint: [0.82, 0.98, 1.08],
    highlightTint: [1.16, 0.96, 0.78],
    saturation: 1.12,
    contrast: 1.08,
    exposure: 1.0,
    bloom: 0.35,
    fogColor: [0.96, 0.7, 0.48],
    fogDensity: 0.0026,
    hemiSky: [0.7, 0.62, 0.7],
    hemiGround: [0.45, 0.32, 0.22],
    hemiIntensity: 0.7,
  },
  blue: {
    tint: [0.88, 0.95, 1.1],
    shadowTint: [0.8, 0.92, 1.14],
    highlightTint: [1.12, 0.94, 0.82],
    saturation: 1.06,
    contrast: 1.05,
    exposure: 1.05,
    bloom: 0.55,
    fogColor: [0.22, 0.28, 0.42],
    fogDensity: 0.003,
    hemiSky: [0.26, 0.33, 0.56],
    hemiGround: [0.12, 0.1, 0.1],
    hemiIntensity: 0.38,
  },
  night: {
    tint: [0.94, 1.0, 1.06],
    shadowTint: [0.78, 0.96, 1.1],
    highlightTint: [1.14, 0.96, 0.82],
    saturation: 1.1,
    contrast: 1.1,
    exposure: 0.95,
    bloom: 0.6,
    fogColor: [0.09, 0.09, 0.12],
    fogDensity: 0.0028,
    hemiSky: [0.1, 0.14, 0.26],
    hemiGround: [0.08, 0.06, 0.05],
    hemiIntensity: 0.28,
  },
};

/** Blend weights for each grade keyframe; they always sum to 1. */
export function gradeWeights(altDeg: number, isMorning: boolean): Record<keyof typeof GRADE_KEYS, number> {
  const day = smoothstep(3, 14, altDeg);
  const lowSun = (1 - day) * smoothstep(-4, 0, altDeg);
  const twilight = (1 - day - lowSun) * smoothstep(-11, -5, altDeg);
  const night = Math.max(0, 1 - day - lowSun - twilight);
  return {
    midday: day,
    golden: isMorning ? 0 : lowSun,
    dawn: isMorning ? lowSun + twilight : 0,
    blue: isMorning ? 0 : twilight,
    night,
  };
}

/** Blend the keyframes into one grade for the current sun altitude. */
export function gradeFor(altDeg: number, isMorning: boolean): GradeKey {
  const w = gradeWeights(altDeg, isMorning);
  const out: GradeKey = {
    tint: [0, 0, 0],
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    saturation: 0,
    contrast: 0,
    exposure: 0,
    bloom: 0,
    fogColor: [0, 0, 0],
    fogDensity: 0,
    hemiSky: [0, 0, 0],
    hemiGround: [0, 0, 0],
    hemiIntensity: 0,
  };
  const rgbKeys = ['tint', 'shadowTint', 'highlightTint', 'fogColor', 'hemiSky', 'hemiGround'] as const;
  const numKeys = ['saturation', 'contrast', 'exposure', 'bloom', 'fogDensity', 'hemiIntensity'] as const;
  for (const name of Object.keys(w) as Array<keyof typeof GRADE_KEYS>) {
    const k = GRADE_KEYS[name];
    const wt = w[name];
    if (wt === 0) continue;
    for (const rk of rgbKeys) for (let i = 0; i < 3; i++) out[rk][i]! += k[rk][i]! * wt;
    for (const nk of numKeys) out[nk] += k[nk] * wt;
  }
  return out;
}
