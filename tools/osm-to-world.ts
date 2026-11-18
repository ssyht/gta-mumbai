/**
 * Convert raw Overpass JSON into the compact district file the game loads
 * (CLAUDE.md §2: "use OpenStreetMap ... then compress and stitch").
 * Usage: node tools/osm-to-world.ts colaba
 * Reads tools/.cache/<d>.osm.json, writes public/data/<d>.json.
 * Data © OpenStreetMap contributors, ODbL.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type LatLon = { lat: number; lon: number };
interface OsmElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: Array<{ role: string; type: string; geometry?: LatLon[] }>;
}

export const ORIGINS: Record<string, LatLon> = {
  // Gateway of India: the district's local (0, 0).
  colaba: { lat: 18.92196, lon: 72.83456 },
};

export type Pt = [number, number];

export function projector(origin: LatLon): (p: LatLon) => Pt {
  const kx = Math.cos((origin.lat * Math.PI) / 180) * 111320;
  const kz = 110574;
  // +X east, -Z north (CLAUDE.md §4A.1 world convention).
  return (p) => [
    Math.round((p.lon - origin.lon) * kx * 10) / 10,
    Math.round(-(p.lat - origin.lat) * kz * 10) / 10,
  ];
}

/** Signed area in the (x, -z) map plane: > 0 means counter-clockwise on a north-up map. */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]!;
    const [x2, z2] = pts[(i + 1) % pts.length]!;
    a += x1 * -z2 - x2 * -z1;
  }
  return a / 2;
}

/** Closed ring without the duplicate last point, wound counter-clockwise on a north-up map. */
export function normalizeRing(pts: Pt[]): Pt[] {
  const ring = pts.slice();
  if (ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]) ring.pop();
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

/** Join coastline ways whose endpoints touch into longer polylines (land is on the left). */
export function chainLines(lines: Pt[][]): Pt[][] {
  const pool = lines.map((l) => l.slice());
  const out: Pt[][] = [];
  const same = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
  while (pool.length) {
    let cur = pool.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i]!;
        if (same(cur.at(-1)!, l[0]!)) cur = cur.concat(l.slice(1));
        else if (same(l.at(-1)!, cur[0]!)) cur = l.concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Land mask on a grid: a cell is land if it lies to the LEFT of the nearest
 * coastline segment (OSM convention). Returned as run-length rows.
 */
export function landMask(
  coast: Pt[][],
  minX: number,
  minZ: number,
  cols: number,
  rows: number,
  cell: number,
): number[][] {
  const segs: Array<[Pt, Pt]> = [];
  for (const l of coast) for (let i = 0; i < l.length - 1; i++) segs.push([l[i]!, l[i + 1]!]);
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const runs: number[] = [];
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      let land = false;
      if (c < cols && segs.length) {
        const px = minX + (c + 0.5) * cell;
        const pz = minZ + (r + 0.5) * cell;
        let best = Infinity;
        let side = 0;
        for (const [a, b] of segs) {
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const len2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
          const qx = a[0] + dx * t - px;
          const qz = a[1] + dz * t - pz;
          const d = qx * qx + qz * qz;
          if (d < best) {
            best = d;
            // Map plane uses (x, -z): left of travel ⇔ cross((dx,-dz),(px-ax, -(pz-az))) > 0.
            side = dx * -(pz - a[1]) - -dz * (px - a[0]);
          }
        }
        land = side > 0;
      } else if (c < cols) {
        land = true;
      }
      if (land && start < 0) start = c;
      if (!land && start >= 0) {
        runs.push(start, c - start);
        start = -1;
      }
    }
    out.push(runs);
  }
  return out;
}

const ROAD_W: Record<string, number> = {
  primary: 14,
  primary_link: 9,
  secondary: 11,
  secondary_link: 8,
  tertiary: 9,
  residential: 7,
  living_street: 6,
  service: 4.5,
  pedestrian: 6,
  footway: 2.5,
  path: 2.5,
  steps: 2.5,
};

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function convert(
  raw: { bbox: [number, number, number, number]; elements: OsmElement[] },
  origin: LatLon,
) {
  const proj = projector(origin);
  const [s, w, n, e] = raw.bbox;
  const [minX, minZ] = proj({ lat: n, lon: w });
  const [maxX, maxZ] = proj({ lat: s, lon: e });
  const inBox = (p: Pt, m = 40): boolean =>
    p[0] > minX - m && p[0] < maxX + m && p[1] > minZ - m && p[1] < maxZ + m;

  const roads: Array<{ cls: string; w: number; pts: Pt[]; name?: string }> = [];
  const buildings: Array<{ pts: Pt[]; h: number; levels: number; kind?: string; name?: string }> = [];
  const coastRaw: Pt[][] = [];

  for (const el of raw.elements) {
    const t = el.tags ?? {};
    if (t.highway && el.geometry && ROAD_W[t.highway] !== undefined) {
      // Split ways at points that leave the district.
      let cur: Pt[] = [];
      for (const g of el.geometry) {
        const p = proj(g);
        if (inBox(p)) cur.push(p);
        else if (cur.length) {
          if (cur.length > 1)
            roads.push({
              cls: t.highway,
              w: ROAD_W[t.highway]!,
              pts: cur,
              ...(t.name ? { name: t.name } : {}),
            });
          cur = [];
        }
      }
      if (cur.length > 1)
        roads.push({ cls: t.highway, w: ROAD_W[t.highway]!, pts: cur, ...(t.name ? { name: t.name } : {}) });
    } else if (t.natural === 'coastline' && el.geometry) {
      coastRaw.push(el.geometry.map(proj));
    } else if (t.building) {
      const rings: LatLon[][] = el.geometry
        ? [el.geometry]
        : (el.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!);
      for (const r of rings) {
        const pts = normalizeRing(r.map(proj));
        if (pts.length < 3 || !pts.every((p) => inBox(p, 0))) continue;
        const area = Math.abs(signedArea(pts));
        if (area < 12) continue;
        const name = t.name;
        let levels = Number(t['building:levels'] ?? NaN);
        const hTag = Number((t.height ?? '').replace(/[^\d.]/g, ''));
        if (!Number.isFinite(levels)) {
          const rnd = hash(el.id);
          levels =
            area < 60
              ? 1 + Math.floor(rnd * 2)
              : area < 250
                ? 2 + Math.floor(rnd * 3)
                : 3 + Math.floor(rnd * 4);
        }
        let kind: string | undefined;
        if (name && /Gateway of India/i.test(name)) kind = 'gateway';
        else if (name && /^Taj Mahal Palace/i.test(name)) kind = 'taj';
        const h = Number.isFinite(hTag) && hTag > 2 ? hTag : levels * 3.4 + 0.8;
        buildings.push({
          pts,
          h: Math.round(h * 10) / 10,
          levels,
          ...(kind ? { kind } : {}),
          ...(name ? { name } : {}),
        });
      }
    }
  }

  const coast = chainLines(coastRaw);
  const cell = 5;
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxZ - minZ) / cell);
  const mask = landMask(coast, minX, minZ, cols, rows, cell);
  // Drop buildings and roads that ended up in the sea.
  const isLand = (p: Pt): boolean => {
    const c = Math.floor((p[0] - minX) / cell);
    const r = Math.floor((p[1] - minZ) / cell);
    const runs = mask[r];
    if (!runs) return false;
    for (let i = 0; i < runs.length; i += 2) if (c >= runs[i]! && c < runs[i]! + runs[i + 1]!) return true;
    return false;
  };
  const landBuildings = buildings.filter((b) => {
    const cx = b.pts.reduce((a, p) => a + p[0], 0) / b.pts.length;
    const cz = b.pts.reduce((a, p) => a + p[1], 0) / b.pts.length;
    return isLand([cx, cz]) || b.kind === 'gateway';
  });

  return {
    attribution: 'Map data © OpenStreetMap contributors (ODbL)',
    origin,
    bounds: { minX, minZ, maxX, maxZ },
    grid: { cell, cols, rows, minX, minZ, mask },
    roads,
    buildings: landBuildings,
    coast,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] ?? 'colaba';
  const raw = JSON.parse(readFileSync(`tools/.cache/${name}.osm.json`, 'utf8'));
  const out = convert(raw, ORIGINS[name]!);
  mkdirSync('public/data', { recursive: true });
  writeFileSync(`public/data/${name}.json`, JSON.stringify(out));
  console.info(
    `${name}: ${out.roads.length} roads, ${out.buildings.length} buildings, ${out.coast.length} coast lines, grid ${out.grid.cols}×${out.grid.rows}`,
  );
}
