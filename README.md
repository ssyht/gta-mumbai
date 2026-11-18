# Mumbai Open World (working title "GTA: Mumbai")

Private, non-commercial hobby project: a third-person open-world browser game set in Mumbai, built with Vite + TypeScript + Three.js (WebGPU with WebGL2 fallback) + Rapier. `CLAUDE.md` is the source of truth for vision, stack, architecture and milestones.

**Status: M0 Bootstrap + M1 Feel**, plus a dense hero bazaar street (colonial and chawl facades, shops, carts, bunting, crowds, taxis) next to a test track by the Arabian Sea.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest: time of day, sun mapping, vehicle physics, seats, fares
npm run lint
npm run build
```

URL flags: `?time=18:45` (frozen manual clock, add `&speed=60` for a time-lapse), `?quality=low|medium|high|ultra`, `?webgl=1` (force the WebGL2 backend), `?autostart=1`.

## What's in M1

- **Time of day synced to your clock** (§4A.1): your local HH:MM is read as Mumbai time (IST) on today's date. SunCalc at Mumbai's coordinates gives the real sun and moon, mapped to world space by `src/render/sky/solarToWorld.ts` (tested). Modes: sync to my clock / real IST / manual time-lapse.
- **Look**: physical sky with clouds, sun/moon key light with shadows, hemisphere ambient, Mumbai haze, stars, a phase-correct moon, sodium light-pollution glow, AgX tone mapping, time-of-day grade keyframes (dawn, midday, golden, blue, night), bloom, vignette, grain. Street lights and building windows switch on through the evening.
- **Player**: Raju, on a shared greybox rig. Walk, jog, sprint, crouch, jump, vault, climb, ragdoll when hit or bailing, collision-aware orbit camera.
- **Drive or ride anything** (data-driven seats in `src/actors/vehicles/profiles/*.json`): hatchback, auto rickshaw (three-wheel, tips in hard turns), scooter (rider lean, balance assist, pillion), BEST bus (sit, stand holding the rail, hang off the door, window view), and a "Horn OK Please" lorry (with the melodic horn, and a spot on top of the cargo).
- **Carjack** the auto or the bus driver. **Hire the auto** with G: the meter runs at the Mumbai tariff and F asks the driver to stop. The **BEST bus** runs a loop with stops and NPC passengers.
- Perf HUD (`` ` ``), pause/settings menu (Esc), lil-gui dev and tuning panel (P).

## The bazaar street

You spawn at the west end of a dense Mumbai street: procedural colonial, chawl and shophouse facades with stocked shops, rolling shutters, Devanagari + English boards, awnings and tube lights; food carts, umbrellas, plastic chairs, bunting and tangled wires; palms and shade trees; original painted film hoardings; murals, litter and puddles; parked kaali-peeli taxis and autos you can drive; and a crowd that walks, chats at stalls, jaywalks, dodges you and thins out at 3 AM. At night it switches to fairy lights, tube-lit shops, sodium lamps and neon boards.

## Controls

| Key               | Action                                                   |
| ----------------- | -------------------------------------------------------- |
| WASD / mouse      | Move, drive, look (click to capture the mouse)           |
| Shift             | Sprint                                                   |
| Space             | Jump, vault, climb · handbrake · jump off as a passenger |
| C / X             | Crouch / walk toggle                                     |
| F                 | Drive, carjack, get out (jumps out if moving)            |
| G                 | Ride as passenger, change spot                           |
| H                 | Horn                                                     |
| V                 | Chase / first-person / window camera                     |
| R                 | Flip the vehicle back over                               |
| Esc · P · `` ` `` | Menu · dev panel · perf HUD                              |

Gamepad: left stick move/steer, right stick look, RT/LT throttle/brake, A jump, Y enter/exit, X passenger, L3 horn.

## Layout

See CLAUDE.md §6. Key files: `src/core/Engine.ts` (wiring and loop), `src/render/sky/TimeOfDay.ts`, `src/physics/VehiclePhysics.ts`, `src/gameplay/InteractionSystem.ts`, `src/world/testtrack/TestTrack.ts`. Docs: `docs/PERF.md`, `docs/ASSETS.md`, screenshots in `docs/screenshots/`.

## M2 (in progress): Colaba from OpenStreetMap

Drive south from the test track's south road (or use the dev panel: P → Teleport → Gateway of India) into Colaba / Apollo Bunder at real scale: 969 real building footprints, 329 roads, the real harbour coastline with a sea wall, and greybox Gateway of India and Taj Mahal Palace (with the 1972 tower).

```bash
node tools/osm-fetch.ts colaba      # Overpass → tools/.cache (raw, git-ignored)
node tools/osm-to-world.ts colaba   # → public/data/colaba.json
```

Map data © OpenStreetMap contributors (ODbL).

## Next

M2: Colaba Causeway street dressing (reuse the bazaar kit on real streets), lane graph from OSM roads, Gateway plaza life (pigeons, horse carriages). Then M2.5 look-dev (atmosphere, CSM, LUTs, /lookdev captures).
