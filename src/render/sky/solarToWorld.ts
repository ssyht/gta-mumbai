import { Vector3 } from 'three';

/**
 * Convert a SunCalc 1.x horizontal position into a world-space unit vector
 * pointing FROM the ground TOWARD the body (sun or moon).
 *
 * SunCalc 1.x: azimuth in radians, 0 = south, positive toward west.
 *              altitude in radians above the horizon.
 * World:       +X = east, -Z = north (so +Z = south), +Y = up.
 *
 *   south (az 0)   → +Z
 *   west  (az π/2) → -X
 *   east  (az -π/2)→ +X
 *   north (az π)   → -Z
 */
export function solarToWorld(azimuth: number, altitude: number, out = new Vector3()): Vector3 {
  const cosAlt = Math.cos(altitude);
  return out.set(-Math.sin(azimuth) * cosAlt, Math.sin(altitude), Math.cos(azimuth) * cosAlt);
}

/** Spherical interpolation between two unit vectors (falls back to lerp when nearly parallel). */
export function slerpUnit(a: Vector3, b: Vector3, t: number, out = new Vector3()): Vector3 {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  const theta = Math.acos(d);
  if (theta < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}
