import * as THREE from 'three/webgpu';

/**
 * Road graph for traffic and pedestrians (CLAUDE.md §4.3: "Traffic AI on a
 * lane graph built from OSM roads"). Every district adds its road centre
 * lines; nodes that touch (shared OSM junction nodes) merge, so cars can turn
 * from one street into the next. India drives on the left: lanes are offset
 * to the left of the direction of travel at drive time.
 */
export interface RoadPolyline {
  pts: THREE.Vector3[];
  width: number;
  cls: string;
}

export interface GraphLink {
  to: number;
  width: number;
  cls: string;
}

export interface GraphNode {
  id: number;
  p: THREE.Vector3;
  links: GraphLink[];
}

/** Classes vehicles may use; footways/steps are pedestrians only. */
export const VEHICLE_CLASSES = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'residential',
  'living_street',
  'service',
  'loop',
  'bazaar',
  'connector',
]);

/** Cruise speed by road class (m/s). Mumbai traffic is slow. */
export const CLASS_SPEED: Record<string, number> = {
  primary: 13,
  primary_link: 9,
  secondary: 11,
  secondary_link: 8,
  tertiary: 9,
  residential: 7,
  living_street: 5,
  service: 5,
  loop: 12,
  bazaar: 7,
  connector: 10,
};

const CELL = 6;
const MERGE = 1.6;
const STEP = 12;

export class LaneGraph {
  readonly nodes: GraphNode[] = [];
  private readonly grid = new Map<string, number[]>();

  private key(x: number, z: number): string {
    return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
  }

  private findOrCreate(p: THREE.Vector3, merge: boolean): number {
    if (merge) {
      const cx = Math.floor(p.x / CELL);
      const cz = Math.floor(p.z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const id of this.grid.get(`${cx + dx}:${cz + dz}`) ?? []) {
            const n = this.nodes[id]!;
            if (Math.abs(n.p.x - p.x) < MERGE && Math.abs(n.p.z - p.z) < MERGE) return id;
          }
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, p: p.clone(), links: [] });
    const k = this.key(p.x, p.z);
    const list = this.grid.get(k);
    if (list) list.push(id);
    else this.grid.set(k, [id]);
    return id;
  }

  private link(a: number, b: number, width: number, cls: string): void {
    if (a === b) return;
    const na = this.nodes[a]!;
    const nb = this.nodes[b]!;
    if (!na.links.some((l) => l.to === b)) na.links.push({ to: b, width, cls });
    if (!nb.links.some((l) => l.to === a)) nb.links.push({ to: a, width, cls });
  }

  /** Add a road centre line; endpoints and original vertices merge with existing junctions. */
  addRoad(r: RoadPolyline): void {
    if (r.pts.length < 2) return;
    let prev = this.findOrCreate(r.pts[0]!, true);
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1]!;
      const b = r.pts[i]!;
      const len = a.distanceTo(b);
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 1; k <= n; k++) {
        const isVertex = k === n;
        const p = a.clone().lerp(b, k / n);
        const id = this.findOrCreate(p, isVertex);
        this.link(prev, id, r.width, r.cls);
        prev = id;
      }
    }
  }

  get size(): number {
    return this.nodes.length;
  }

  /** Nearest node with at least one link of the allowed classes. */
  nearest(p: THREE.Vector3, maxDist = 60, vehicles = true): GraphNode | null {
    let best: GraphNode | null = null;
    let bd = maxDist * maxDist;
    const r = Math.ceil(maxDist / CELL);
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (const id of this.grid.get(`${cx + dx}:${cz + dz}`) ?? []) {
          const n = this.nodes[id]!;
          if (vehicles && !n.links.some((l) => VEHICLE_CLASSES.has(l.cls))) continue;
          const d = (n.p.x - p.x) ** 2 + (n.p.z - p.z) ** 2;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  /** Random nodes in a distance ring around a point (for spawning). */
  sampleRing(
    p: THREE.Vector3,
    rMin: number,
    rMax: number,
    count: number,
    rnd: () => number,
    vehicles = true,
  ): GraphNode[] {
    const out: GraphNode[] = [];
    for (let tries = 0; tries < count * 12 && out.length < count; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = rMin + rnd() * (rMax - rMin);
      const n = this.nearest(
        new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r),
        25,
        vehicles,
      );
      if (!n) continue;
      const d = Math.hypot(n.p.x - p.x, n.p.z - p.z);
      if (d >= rMin && d <= rMax + 25 && !out.includes(n)) out.push(n);
    }
    return out;
  }

  /** Pick where to go after reaching `cur` from `prev`: avoid U-turns unless it's a dead end. */
  pickNext(prev: number, cur: number, rnd: () => number, vehicles = true): GraphLink | null {
    const links = this.nodes[cur]!.links.filter((l) => !vehicles || VEHICLE_CLASSES.has(l.cls));
    if (!links.length) return null;
    const forward = links.filter((l) => l.to !== prev);
    const pool = forward.length ? forward : links;
    // Prefer bigger roads a little (traffic flows along arterials).
    const weights = pool.map((l) => 0.6 + l.width / 10);
    const sum = weights.reduce((a, b) => a + b, 0);
    let t = rnd() * sum;
    for (let i = 0; i < pool.length; i++) {
      t -= weights[i]!;
      if (t <= 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }

  linkBetween(a: number, b: number): GraphLink | undefined {
    return this.nodes[a]?.links.find((l) => l.to === b);
  }
}
