/**
 * Fetch raw OpenStreetMap data for a district bbox from Overpass (CLAUDE.md §2).
 * Usage: node tools/osm-fetch.ts colaba
 * Writes tools/.cache/<district>.osm.json (git-ignored raw data).
 * Data © OpenStreetMap contributors, ODbL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const DISTRICTS: Record<string, [number, number, number, number]> = {
  // [south, west, north, east]: Apollo Bunder, Gateway, Taj, Colaba Causeway (north part).
  colaba: [18.912, 72.826, 18.926, 72.8375],
};

const name = process.argv[2] ?? 'colaba';
const bbox = DISTRICTS[name];
if (!bbox) throw new Error(`Unknown district ${name}`);
const [s, w, n, e] = bbox;
const pad = 0.006;
const query = `[out:json][timeout:90];
(
  way["building"](${s},${w},${n},${e});
  relation["building"](${s},${w},${n},${e});
  way["highway"](${s},${w},${n},${e});
  way["natural"="coastline"](${s - pad},${w - pad},${n + pad},${e + pad});
);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'osm-district-fetch/1.0' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
const json = await res.json();
mkdirSync('tools/.cache', { recursive: true });
writeFileSync(`tools/.cache/${name}.osm.json`, JSON.stringify({ bbox, ...json }));
console.info(`${name}: ${json.elements.length} elements`);
