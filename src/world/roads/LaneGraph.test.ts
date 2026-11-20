import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LaneGraph } from './LaneGraph';

const V = (x: number, z: number) => new Vector3(x, 0, z);

describe('LaneGraph', () => {
  it('merges roads that share a junction node into one network', () => {
    const g = new LaneGraph();
    g.addRoad({ pts: [V(0, 0), V(30, 0)], width: 8, cls: 'residential' });
    g.addRoad({ pts: [V(30, 0), V(30, 40)], width: 8, cls: 'residential' });
    const j = g.nearest(V(30, 0), 2)!;
    expect(j.links).toHaveLength(2);
  });

  it('densifies long segments so drivers get regular targets', () => {
    const g = new LaneGraph();
    g.addRoad({ pts: [V(0, 0), V(100, 0)], width: 8, cls: 'primary' });
    expect(g.size).toBeGreaterThanOrEqual(9);
  });

  it('avoids U-turns unless at a dead end', () => {
    const g = new LaneGraph();
    g.addRoad({ pts: [V(0, 0), V(10, 0), V(20, 0)], width: 8, cls: 'residential' });
    const a = g.nearest(V(0, 0), 1)!.id;
    const b = g.nearest(V(10, 0), 1)!.id;
    const c = g.nearest(V(20, 0), 1)!.id;
    for (let i = 0; i < 20; i++) expect(g.pickNext(a, b, Math.random)?.to).toBe(c);
    expect(g.pickNext(b, c, Math.random)?.to).toBe(b);
  });

  it('keeps footways out of the vehicle network', () => {
    const g = new LaneGraph();
    g.addRoad({ pts: [V(0, 0), V(10, 0)], width: 2.5, cls: 'footway' });
    expect(g.nearest(V(0, 0), 5, true)).toBeNull();
    expect(g.nearest(V(0, 0), 5, false)).not.toBeNull();
  });
});
