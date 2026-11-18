import SunCalc from 'suncalc';
import { Vector3 } from 'three';
import type { TimeMode } from '../../core/Settings';
import { slerpUnit, solarToWorld } from './solarToWorld';

/**
 * The single TimeOfDay service (CLAUDE.md §4A.1). Sun, sky, fog, exposure,
 * grade, street lights, windows, density and ambience all read from here.
 *
 * Game clock = the player's local wall-clock HH:MM. That HH:MM is interpreted
 * as Mumbai time (IST, UTC+5:30, no DST) on today's date, and that instant is
 * fed to SunCalc at Mumbai's coordinates.
 */
export const MUMBAI = { lat: 19.076, lng: 72.878 } as const;
export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;
const DAY_MIN = 1440;

/** Player's local clock reading → the instant when Mumbai's clock reads the same HH:MM:SS today. */
export function istInstantForLocalClock(local: Date): Date {
  const utcOfSameWallClock = Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
  );
  return new Date(utcOfSameWallClock - IST_OFFSET_MIN * MIN_MS);
}

/** Instant when Mumbai's clock reads `minutes` after midnight on `dateRef`'s local calendar date. */
export function istInstantForMinutes(dateRef: Date, minutes: number): Date {
  const m = ((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const midnightUtc = Date.UTC(dateRef.getFullYear(), dateRef.getMonth(), dateRef.getDate());
  return new Date(midnightUtc + (m - IST_OFFSET_MIN) * MIN_MS);
}

/** Minutes after midnight on Mumbai's wall clock at `instant`. */
export function istClockMinutes(instant: Date): number {
  const total = instant.getTime() / MIN_MS + IST_OFFSET_MIN;
  return ((total % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

export function formatClock(minutes: number): string {
  const m = Math.floor(((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface SkyState {
  instant: Date;
  /** Game clock (Mumbai wall clock) in minutes after midnight. */
  clockMinutes: number;
  /** Unit vector toward the sun (world space). */
  sunDir: Vector3;
  /** Unit vector toward the moon (world space). */
  moonDir: Vector3;
  sunAltitude: number;
  sunAzimuth: number;
  moonAltitude: number;
  /** Illuminated fraction of the moon, 0..1. */
  moonFraction: number;
  /** Moon phase 0..1 (0 new, 0.5 full). */
  moonPhase: number;
  /** True before solar noon. */
  isMorning: boolean;
  /** Key times today as Mumbai clock minutes (null if the event doesn't happen). */
  times: {
    sunrise: number | null;
    sunset: number | null;
    goldenHour: number | null;
    goldenHourEnd: number | null;
    dawn: number | null;
    dusk: number | null;
    solarNoon: number | null;
  };
}

function clockOrNull(d: Date | undefined): number | null {
  return d && !Number.isNaN(d.getTime()) ? istClockMinutes(d) : null;
}

/** Pure: Mumbai sky at an instant. */
export function computeSky(instant: Date): SkyState {
  const sun = SunCalc.getPosition(instant, MUMBAI.lat, MUMBAI.lng);
  const moon = SunCalc.getMoonPosition(instant, MUMBAI.lat, MUMBAI.lng);
  const illum = SunCalc.getMoonIllumination(instant);
  const t = SunCalc.getTimes(instant, MUMBAI.lat, MUMBAI.lng);
  return {
    instant,
    clockMinutes: istClockMinutes(instant),
    sunDir: solarToWorld(sun.azimuth, sun.altitude),
    moonDir: solarToWorld(moon.azimuth, moon.altitude),
    sunAltitude: sun.altitude,
    sunAzimuth: sun.azimuth,
    moonAltitude: moon.altitude,
    moonFraction: illum.fraction,
    moonPhase: illum.phase,
    isMorning: instant.getTime() < t.solarNoon.getTime(),
    times: {
      sunrise: clockOrNull(t.sunrise),
      sunset: clockOrNull(t.sunset),
      goldenHour: clockOrNull(t.goldenHour),
      goldenHourEnd: clockOrNull(t.goldenHourEnd),
      dawn: clockOrNull(t.dawn),
      dusk: clockOrNull(t.dusk),
      solarNoon: clockOrNull(t.solarNoon),
    },
  };
}

export interface TimeOfDayOptions {
  mode?: TimeMode;
  manualMinutes?: number;
  speed?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Seconds between SunCalc recomputes in real-time modes. */
  recomputeInterval?: number;
}

export class TimeOfDay {
  mode: TimeMode;
  /** Manual/time-lapse clock in minutes after midnight. */
  manualMinutes: number;
  /** Time-lapse multiplier in manual mode (1 = real time, 0 = frozen). */
  speed: number;

  /** Smoothed values that the renderer reads every frame. */
  readonly sunDir = new Vector3(0, 1, 0);
  readonly moonDir = new Vector3(0, -1, 0);
  private target: SkyState;

  private readonly now: () => Date;
  private readonly interval: number;
  private sinceRecompute = 0;
  private lastWallMs: number;
  private lastTzOffset: number;

  constructor(opts: TimeOfDayOptions = {}) {
    this.mode = opts.mode ?? 'sync';
    this.manualMinutes = opts.manualMinutes ?? 18 * 60 + 30;
    this.speed = opts.speed ?? 1;
    this.now = opts.now ?? (() => new Date());
    this.interval = opts.recomputeInterval ?? 10;
    const n = this.now();
    this.lastWallMs = n.getTime();
    this.lastTzOffset = n.getTimezoneOffset();
    this.target = computeSky(this.instantFor(n));
    this.snap();
  }

  /** The instant fed to SunCalc for the current mode. */
  instantFor(now: Date): Date {
    switch (this.mode) {
      case 'sync':
        return istInstantForLocalClock(now);
      case 'ist':
        return now;
      case 'manual':
        return istInstantForMinutes(now, this.manualMinutes);
    }
  }

  get state(): Readonly<SkyState> {
    return this.target;
  }

  get clockMinutes(): number {
    return this.target.clockMinutes;
  }

  setMode(mode: TimeMode): void {
    if (mode === this.mode) return;
    if (mode === 'manual') this.manualMinutes = this.target.clockMinutes;
    this.mode = mode;
    this.resync();
  }

  setManualMinutes(minutes: number): void {
    this.manualMinutes = ((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
    if (this.mode === 'manual') this.resync();
  }

  /** Recompute immediately and jump there (tab visible again, wake from sleep, DST/clock change). */
  resync(): void {
    const n = this.now();
    this.lastWallMs = n.getTime();
    this.lastTzOffset = n.getTimezoneOffset();
    this.target = computeSky(this.instantFor(n));
    this.sinceRecompute = 0;
    this.snap();
  }

  private snap(): void {
    this.sunDir.copy(this.target.sunDir);
    this.moonDir.copy(this.target.moonDir);
  }

  update(dt: number): void {
    const n = this.now();
    const wall = n.getTime();
    const drift = Math.abs(wall - this.lastWallMs - dt * 1000);
    const tz = n.getTimezoneOffset();
    this.lastWallMs = wall;
    // Sleep/wake, manual clock edits and DST shifts show up as wall-clock jumps.
    if (drift > 5000 || tz !== this.lastTzOffset) {
      this.resync();
      return;
    }

    if (this.mode === 'manual') {
      if (this.speed !== 0) {
        this.manualMinutes = (((this.manualMinutes + (dt * this.speed) / 60) % DAY_MIN) + DAY_MIN) % DAY_MIN;
      }
      // Time-lapse must move continuously, so recompute every frame.
      this.target = computeSky(this.instantFor(n));
      this.snap();
      return;
    }

    this.sinceRecompute += dt;
    if (this.sinceRecompute >= this.interval) {
      this.sinceRecompute = 0;
      this.target = computeSky(this.instantFor(n));
    }
    // Ease toward the latest target so 10 s recomputes never show as steps.
    const k = 1 - Math.exp(-dt / 2);
    slerpUnit(this.sunDir, this.target.sunDir, k, this.sunDir);
    slerpUnit(this.moonDir, this.target.moonDir, k, this.moonDir);
  }
}
