/**
 * Mumbai auto-rickshaw meter: minimum fare covers the first 1.5 km, then a
 * per-km rate. Values follow the 2025 MMRTA tariff (₹26 minimum, ₹17.14/km).
 */
export const AUTO_TARIFF = { minimumFare: 26, minimumKm: 1.5, perKm: 17.14 } as const;
/** BEST non-AC minimum ticket. */
export const BEST_MIN_TICKET = 5;

export function autoFare(km: number): number {
  const extra = Math.max(0, km - AUTO_TARIFF.minimumKm) * AUTO_TARIFF.perKm;
  return Math.round((AUTO_TARIFF.minimumFare + extra) * 100) / 100;
}

export class FareMeter {
  active = false;
  meters = 0;

  start(): void {
    this.active = true;
    this.meters = 0;
  }

  addDistance(m: number): void {
    if (this.active) this.meters += m;
  }

  get km(): number {
    return this.meters / 1000;
  }

  get rupees(): number {
    return autoFare(this.km);
  }

  stop(): number {
    const fare = this.rupees;
    this.active = false;
    return fare;
  }
}
