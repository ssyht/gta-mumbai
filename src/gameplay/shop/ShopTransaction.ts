/**
 * Pure shop maths for SCENARIOS.md C1: what the player pays with, the change
 * the shopkeeper counts back, and the haggling mood model. No three.js here,
 * so it is unit-tested directly.
 */
export interface StockItem {
  id: string;
  name: string;
  dev: string;
  price: number;
  /** Health restored when bought (chai, cold drink, snacks). */
  heal?: number;
}

/** Notes and coins in circulation (₹). Change ≤ ₹20 is counted out in coins. */
export const NOTES = [500, 200, 100, 50, 20, 10] as const;
export const COINS = [20, 10, 5, 2, 1] as const;

/**
 * What a customer hands over: the single smallest note that covers the total,
 * or the fewest big notes when no single one does.
 */
export function tender(total: number): number[] {
  const single = [...NOTES].reverse().find((n) => n >= total);
  if (single !== undefined) return [single];
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    out.push(500);
    left -= 500;
  }
  return out;
}

/** Change counted back as notes then coins (largest first), so it can be placed piece by piece. */
export function change(paid: number, total: number): { notes: number[]; coins: number[] } {
  let left = paid - total;
  if (left < 0) throw new Error('underpaid');
  const notes: number[] = [];
  const coins: number[] = [];
  for (const n of NOTES.filter((n) => n > 20)) {
    while (left >= n) {
      notes.push(n);
      left -= n;
    }
  }
  for (const c of COINS) {
    while (left >= c) {
      coins.push(c);
      left -= c;
    }
  }
  return { notes, coins };
}

/** Prices are said aloud in Bambaiya Hindi. */
export function priceWords(n: number): string {
  const words: Record<number, string> = {
    1: 'ek',
    2: 'do',
    5: 'paanch',
    10: 'das',
    12: 'baarah',
    15: 'pandrah',
    20: 'bees',
    25: 'pachees',
    30: 'tees',
    35: 'paintees',
    40: 'chaalees',
    45: 'paintaalees',
    50: 'pachaas',
    60: 'saath',
    70: 'sattar',
    80: 'assi',
    90: 'nabbe',
    100: 'sau',
    120: 'ek sau bees',
    150: 'dedh sau',
    200: 'do sau',
    250: 'dhaai sau',
    68: 'arsath',
    186: 'ek sau chhiyaasi',
    254: 'do sau chauvan',
  };
  return words[n] ? `${words[n]} rupaye` : `${n} rupaye`;
}

export type HaggleResult =
  { kind: 'accept'; price: number } | { kind: 'counter'; price: number } | { kind: 'refuse'; price: number };

/**
 * Haggling (C1 beat 6). `patience` 0..1 drops with lowball offers. A lowball
 * below 50% annoys him for the rest of the visit. Offers ≥ 90% are accepted,
 * 70–90% meet halfway, lower ones are refused (he repeats his price).
 */
export class Haggle {
  patience = 1;
  annoyed = false;
  rounds = 0;

  constructor(readonly asking: number) {}

  offer(price: number): HaggleResult {
    this.rounds++;
    const r = price / this.asking;
    if (r < 0.5) {
      this.annoyed = true;
      this.patience = Math.max(0, this.patience - 0.5);
    } else if (r < 0.7) this.patience = Math.max(0, this.patience - 0.3);
    else if (r < 0.9) this.patience = Math.max(0, this.patience - 0.12);
    if (this.patience <= 0 || this.annoyed) return { kind: 'refuse', price: this.asking };
    if (r >= 0.9) return { kind: 'accept', price: Math.round(price) };
    if (r >= 0.7) return { kind: 'counter', price: Math.round((price + this.asking) / 2) };
    return { kind: 'refuse', price: this.asking };
  }
}

/** Opening hours like "09:30"–"22:30", with closed weekdays (0 = Sunday). */
export function isOpen(
  clockMinutes: number,
  open: string,
  close: string,
  weekday = 1,
  closedDays: number[] = [],
): boolean {
  if (closedDays.includes(weekday)) return false;
  const toMin = (s: string): number => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const o = toMin(open);
  const c = toMin(close);
  const t = ((clockMinutes % 1440) + 1440) % 1440;
  return o <= c ? t >= o && t < c : t >= o || t < c;
}
