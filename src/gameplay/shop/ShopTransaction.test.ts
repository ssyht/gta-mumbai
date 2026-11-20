import { describe, expect, it } from 'vitest';
import { change, Haggle, isOpen, priceWords, tender } from './ShopTransaction';

describe('ShopTransaction', () => {
  it('pays with the smallest single note that covers the bill', () => {
    expect(tender(18)).toEqual([20]);
    expect(tender(60)).toEqual([100]);
    expect(tender(240)).toEqual([500]);
    expect(tender(1200)).toEqual([500, 500, 500]);
  });
  it('counts change back as notes then coins and it adds up', () => {
    const c = change(500, 237);
    expect(c.notes).toEqual([200, 50]);
    expect(c.coins).toEqual([10, 2, 1]);
    expect([...c.notes, ...c.coins].reduce((a, b) => a + b, 0)).toBe(263);
    expect(change(500, 254)).toEqual({ notes: [200], coins: [20, 20, 5, 1] });
    expect(() => change(10, 20)).toThrow();
  });
  it('says prices aloud', () => {
    expect(priceWords(20)).toBe('bees rupaye');
    expect(priceWords(37)).toBe('37 rupaye');
  });
  it('haggling: fair offer accepted, middling meets halfway, lowball annoys him for the visit', () => {
    expect(new Haggle(100).offer(92)).toEqual({ kind: 'accept', price: 92 });
    expect(new Haggle(100).offer(80)).toEqual({ kind: 'counter', price: 90 });
    const h = new Haggle(100);
    expect(h.offer(40).kind).toBe('refuse');
    expect(h.annoyed).toBe(true);
    expect(h.offer(95).kind).toBe('refuse');
  });
  it('opening hours, including overnight and closed days', () => {
    expect(isOpen(9 * 60 + 29, '09:30', '22:30')).toBe(false);
    expect(isOpen(9 * 60 + 30, '09:30', '22:30')).toBe(true);
    expect(isOpen(22 * 60 + 30, '09:30', '22:30')).toBe(false);
    expect(isOpen(1 * 60, '18:00', '02:00')).toBe(true);
    expect(isOpen(12 * 60, '09:30', '22:30', 0, [0])).toBe(false);
  });
});
