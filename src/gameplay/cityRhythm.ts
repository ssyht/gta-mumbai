/**
 * How busy Mumbai is at a given clock time, 0..1 (CLAUDE.md §4.10: rush-hour
 * traffic, night food streets, quiet 3 AM roads). Drives ambience now and NPC
 * / traffic density from M3.
 */
function bump(m: number, centre: number, width: number): number {
  // Wrap around midnight.
  let d = Math.abs(m - centre);
  d = Math.min(d, 1440 - d);
  return Math.exp(-((d / width) ** 2));
}

export function cityDensity(clockMinutes: number): number {
  const m = ((clockMinutes % 1440) + 1440) % 1440;
  const morningRush = bump(m, 9.5 * 60, 110);
  const eveningRush = bump(m, 19 * 60, 150);
  const daytime = bump(m, 14 * 60, 300) * 0.7;
  const lateFood = bump(m, 22.5 * 60, 90) * 0.45;
  const deadOfNight = bump(m, 3.5 * 60, 120);
  const v = Math.max(morningRush, eveningRush, daytime, lateFood);
  return Math.min(1, Math.max(0.08, v * (1 - 0.85 * deadOfNight) + 0.08));
}
