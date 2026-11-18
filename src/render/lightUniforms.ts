import { uniform } from 'three/tsl';
import { Color, Vector3 } from 'three/webgpu';

/**
 * Global lighting uniforms written by the SkySystem (from TimeOfDay) and read
 * by world materials, so nothing hard-codes "day" or "night" (CLAUDE.md §4A.1).
 */
export const lightUniforms = {
  /** 0 = street lights off, 1 = fully on. */
  street: uniform(0),
  /** 0..1 evening ramp; each window switches on at its own random threshold. */
  windows: uniform(0),
  /** 0 = day, 1 = full night (stars, sky glow). */
  night: uniform(0),
  /** Unit vector toward the sun (moon phase shading, haze glow). */
  sunDir: uniform(new Vector3(0, 1, 0)),
  /** Animated time for water etc. */
  time: uniform(0),
  /** Horizon / fog colour (water fakes its sky reflection with it). */
  horizon: uniform(new Color(0.8, 0.8, 0.8)),
};
