# Asset & license ledger

Every external asset used by the game, even though the project is private (CLAUDE.md §8.6).

| Asset | Where used | Source | Author | License |
|---|---|---|---|---|
| Bebas Neue (`public/fonts/BebasNeue-Regular.ttf`) | HUD numerals, titles, painted signage | https://fonts.google.com/specimen/Bebas+Neue | Dharma Type (Ryoichi Tsunekawa) | SIL Open Font License 1.1 |
| Colaba map data (`public/data/colaba.json`) | Roads, building footprints, coastline for M2 | https://www.openstreetmap.org via Overpass API | OpenStreetMap contributors | ODbL 1.0 (attribution on the title card) |
| Mukta (Google Fonts CDN) | HUD text, Devanagari signage | https://fonts.google.com/specimen/Mukta | Ek Type | SIL Open Font License 1.1 |

Everything else in M1 is generated at runtime: procedural canvas textures (asphalt, road markings, kerbs, pavers, facades, signage, water normals), greybox meshes for vehicles, people and buildings, and synthesised WebAudio (horns, engines, air brakes, ambience). No downloaded models, textures or sounds yet.

The other fonts in `/Fonts` (Creato Display, Akira Expanded Demo, Apple Garamond) are kept in the repo but are **not** shipped in the build; check their licenses before using them.
