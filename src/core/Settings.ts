/**
 * Player settings + graphics presets (CLAUDE.md §4A.5, §7).
 * Persisted to localStorage; every read/write is guarded because storage can
 * be unavailable (private windows, blocked site data).
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type TimeMode = 'sync' | 'ist' | 'manual';

export interface SettingsData {
  quality: QualityPreset;
  dynamicResolution: boolean;
  timeMode: TimeMode;
  /** Manual clock, minutes after midnight (0..1440). */
  manualMinutes: number;
  /** Time-lapse multiplier for manual mode (0 = frozen, 1 = real time). */
  timeSpeed: number;
  mouseSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  showPerfHud: boolean;
}

export interface QualityConfig {
  label: string;
  pixelRatioCap: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowFar: number;
  msaaSamples: number;
  fxaa: boolean;
  bloom: number;
  filmGrain: boolean;
  maxPointLights: number;
  targetFps: number;
  minResolutionScale: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  ultra: {
    label: 'Ultra',
    pixelRatioCap: 2,
    shadowMapSize: 2048,
    shadowCascades: 4,
    shadowFar: 260,
    msaaSamples: 4,
    fxaa: false,
    bloom: 1,
    filmGrain: true,
    maxPointLights: 12,
    targetFps: 60,
    minResolutionScale: 0.6,
  },
  high: {
    label: 'High',
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFar: 200,
    msaaSamples: 4,
    fxaa: false,
    bloom: 1,
    filmGrain: true,
    maxPointLights: 8,
    targetFps: 60,
    minResolutionScale: 0.6,
  },
  medium: {
    label: 'Medium',
    pixelRatioCap: 1.25,
    shadowMapSize: 1024,
    shadowCascades: 3,
    shadowFar: 160,
    msaaSamples: 0,
    fxaa: true,
    bloom: 0.9,
    filmGrain: true,
    maxPointLights: 6,
    targetFps: 50,
    minResolutionScale: 0.55,
  },
  low: {
    label: 'Low',
    pixelRatioCap: 1,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowFar: 120,
    msaaSamples: 0,
    fxaa: true,
    // Grade and bloom stay on at every preset: they carry most of the look.
    bloom: 0.8,
    filmGrain: false,
    maxPointLights: 4,
    targetFps: 30,
    minResolutionScale: 0.5,
  },
};

export const DEFAULT_SETTINGS: SettingsData = {
  quality: 'high',
  dynamicResolution: true,
  timeMode: 'sync',
  manualMinutes: 18 * 60 + 30,
  timeSpeed: 1,
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  showPerfHud: true,
};

/** Settings changes that only apply after a reload (shadow maps are built once). */
export const RELOAD_KEYS: ReadonlyArray<keyof SettingsData> = ['quality'];

const STORAGE_KEY = 'gta-mumbai:settings:v1';
const PRESETS = Object.keys(QUALITY_PRESETS) as QualityPreset[];
const TIME_MODES: TimeMode[] = ['sync', 'ist', 'manual'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Coerce unknown JSON into valid settings, falling back to defaults per field. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.quality === 'string' && PRESETS.includes(r.quality as QualityPreset))
    s.quality = r.quality as QualityPreset;
  if (typeof r.timeMode === 'string' && TIME_MODES.includes(r.timeMode as TimeMode))
    s.timeMode = r.timeMode as TimeMode;
  if (typeof r.dynamicResolution === 'boolean') s.dynamicResolution = r.dynamicResolution;
  if (typeof r.manualMinutes === 'number' && Number.isFinite(r.manualMinutes))
    s.manualMinutes = ((r.manualMinutes % 1440) + 1440) % 1440;
  if (typeof r.timeSpeed === 'number' && Number.isFinite(r.timeSpeed))
    s.timeSpeed = clamp(r.timeSpeed, 0, 3600);
  if (typeof r.mouseSensitivity === 'number' && Number.isFinite(r.mouseSensitivity))
    s.mouseSensitivity = clamp(r.mouseSensitivity, 0.1, 5);
  if (typeof r.invertY === 'boolean') s.invertY = r.invertY;
  if (typeof r.masterVolume === 'number' && Number.isFinite(r.masterVolume))
    s.masterVolume = clamp(r.masterVolume, 0, 1);
  if (typeof r.showPerfHud === 'boolean') s.showPerfHud = r.showPerfHud;
  return s;
}

/** Parse `HH:MM` (24h) into minutes after midnight, or null when invalid. */
export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * URL overrides for dev and look-dev: `?time=18:45` (frozen manual clock,
 * add `&speed=60` for a time-lapse), `?quality=low`.
 */
export function applyUrlOverrides(s: SettingsData, search: string): SettingsData {
  const out = { ...s };
  const params = new URLSearchParams(search);
  const t = parseClock(params.get('time'));
  if (t !== null) {
    out.timeMode = 'manual';
    out.manualMinutes = t;
    const speed = Number(params.get('speed') ?? '0');
    out.timeSpeed = Number.isFinite(speed) ? clamp(speed, 0, 3600) : 0;
  }
  const q = params.get('quality');
  if (q && PRESETS.includes(q as QualityPreset)) out.quality = q as QualityPreset;
  return out;
}

export function loadSettings(): SettingsData {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: SettingsData): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: settings just won't persist.
  }
}
