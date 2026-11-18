import { describe, expect, it } from 'vitest';
import { chainLines, landMask, normalizeRing, projector, signedArea, type Pt } from './osm-to-world';

describe('osm-to-world', () => {
  it('projects lat/lon to metres with +X east and -Z north', () => {
    const p = projector({ lat: 18.92196, lon: 72.83456 });
    const north = p({ lat: 18.93196, lon: 72.83456 });
    const east = p({ lat: 18.92196, lon: 72.84456 });
    expect(north[1]).toBeCloseTo(-1105.7, 0);
    expect(east[0]).toBeGreaterThan(1000);
    expect(east[0]).toBeLessThan(1100);
  });

  it('normalises rings to counter-clockwise on a north-up map and drops the closing point', () => {
    const cw: Pt[] = [
      [0, 0],
      [0, -10],
      [10, -10],
      [10, 0],
      [0, 0],
    ];
    const ring = normalizeRing(cw);
    expect(ring).toHaveLength(4);
    expect(signedArea(ring)).toBeGreaterThan(0);
  });

  it('chains coastline ways that share endpoints', () => {
    const lines = chainLines([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [20, 0],
        [30, 0],
      ],
      [
        [10, 0],
        [20, 0],
      ],
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(4);
  });

  it('puts land on the left of the coastline (OSM convention)', () => {
    // Coast runs north (towards -Z) along x = 50: land on the left = west.
    const coast: Pt[][] = [
      [
        [50, 100],
        [50, -100],
      ],
    ];
    const mask = landMask(coast, 0, -10, 10, 2, 10);
    // Columns 0..4 (x < 50) are land, 5..9 sea.
    expect(mask[0]).toEqual([0, 5]);
    expect(mask[1]).toEqual([0, 5]);
  });
});
