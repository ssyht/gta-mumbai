# CLAUDE.md — "GTA: Mumbai" (working title)

Private, non-commercial hobby project. A GTA-style, open-world, third-person action game set in Mumbai, India, running in the browser on Three.js.

Claude Code reads this file at the start of every session. It is the source of truth for vision, stack, architecture, budgets, milestones and references. Keep it updated as decisions change: add to `## Decision log` instead of silently changing direction.

---

## 1. Vision

- **Fantasy:** the GTA V / GTA VI loop (on foot → steal any vehicle → drive → chaos → wanted level → escape → missions) in a dense, loud, colorful, believable **Mumbai**.
- **Look (top visual priority):** cinematic, high-end lighting and color grading, with daylight driven by the **player's own local clock**. Full spec in **§4A**. Warm, humid, hazy Mumbai light, golden-hour sea glow, sodium and neon nights, monsoon rain with wet reflective roads. Mood references are the GTA VI screenshots linked below.
- **Honest quality bar:** browsers can't match GTA VI's console rendering. The target is roughly **GTA V on PC at medium settings**: good lighting, post-processing and density do most of the work, not polygon count. Pick density and atmosphere over hero-asset detail every time.
- **Feel of Mumbai:** horns everywhere, loose lane discipline, autos squeezing through gaps, people walking on the road, street food smoke, tangled overhead wires, blue tarps, rooftop water tanks, hand-painted Devanagari and English signage, Bollywood hoardings, crows and pigeons, stray dogs, the odd cow.

## 2. Map: compressed real geography (south → north)

Build a **condensed** Mumbai of roughly 5 × 3 km playable area, laid out in real geographic order like GTA's Los Santos. The Arabian Sea is to the west, the harbour and bay to the east.

| #   | District                                | Hero landmarks / content                                                                                                                                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Colaba / Apollo Bunder**              | Gateway of India, Taj Mahal Palace hotel (1903 palace wing plus the 1972 tower), pigeons, ferries, horse carriages, Colaba Causeway street stalls                                                                         |
| 2   | **Fort / CSMT**                         | Chhatrapati Shivaji Terminus (Victorian Gothic), BMC building, Flora Fountain, office crowds, kaali-peeli taxis, BEST buses                                                                                               |
| 3   | **Marine Drive**                        | Curved "Queen's Necklace" promenade, art-deco facades, sea wall, tetrapods, night lights. The signature driving road                                                                                                      |
| 4   | **Crawford Market / Mohammed Ali Road** | Dense market lanes, fruit carts, handcarts, porters, food stalls, night food street                                                                                                                                       |
| 5   | **Dadar**                               | Flower market, Shivaji Park, railway station crowds, local trains, flyovers                                                                                                                                               |
| 6   | **Dharavi**                             | Dense informal settlement: narrow lanes, 2–4 storey self-built homes, pottery kilns, leather and recycling workshops, rooftops for parkour, railway edge. Show it as a living, working neighbourhood, not only as poverty |
| 7   | **Mahim / Bandra-Worli Sea Link**       | Cable-stayed bridge across the bay (high-speed set piece), Mahim causeway, fishing boats                                                                                                                                  |
| 8   | **Bandra West**                         | Bandstand promenade, Mannat (exterior only, famous sea-facing bungalow with fans gathered outside), Mount Mary church, Carter Road, Hill Road shopping, cafes, street art                                                 |
| 9   | **Juhu**                                | Juhu Beach, chowpatty food stalls (pav bhaji, bhel, kulfi), vendors, beach traffic                                                                                                                                        |

Connective tissue: arterial roads, flyovers, a coastal road, suburban rail line with moving local trains, chawls, and highrise residential towers in the background as impostors and skybox.

**Real data:** use OpenStreetMap (Overpass Turbo export) for the road graph and building footprints of each district's bounding box. Then **compress and stitch** the districts so the map isn't 25 km of travel. Keep real street alignment near landmarks so they read correctly.

**Sensitivity:** no missions or set pieces that recreate the 26/11 attacks at the Taj, CSMT or anywhere else. Landmarks are scenery, heists happen at fictional businesses.

## 3. Content lists

### Protagonist

- **Male lead**, late 20s, a Mumbai local (working name "Raju"; rename freely). Realistic proportions on the shared humanoid rig.
- Default outfit: casual shirt or tee, jeans, sneakers. Unlockable outfits: kurta, khaki auto-driver uniform, Bollywood-hero leather jacket, gym wear, monsoon raincoat. Facial hair and haircut options.
- Full animation set: locomotion (walk, jog, sprint, crouch), jump/vault/climb, punches and kicks, aim and shoot, ragdoll, and every vehicle-interaction anim listed below (enter, exit, carjack, mount, dismount, sit, stand-and-hold-rail, hang from bus door, jump from a moving vehicle).

### Vehicle interaction rule: the player can drive or ride ANYTHING that moves

- **Drive** every road vehicle: cars, autos, taxis, scooters, motorbikes, bicycles, BEST buses (single and double-decker), lorries and trucks, tempos, water tankers, police and ambulance.
- **Ride as a passenger:** flag down and sit in the back of an auto or taxi (fast-travel option with a meter fare), or hop onto a **BEST bus as a passenger**. In that mode you sit, stand holding the rail, or hang off the open door Mumbai-style; the camera can switch to a window view; you get off at stops or jump off mid-route. Ride pillion on a scooter or bike behind an NPC.
- **Take over:** carjack any vehicle, including pulling the driver out of a bus or lorry cab.
- **Push/pull:** handcarts and fruit carts (slow, can be shoved into traffic). Horse carriage at Gateway (drive or ride).
- **Rail and water (stretch goals):** ride a local train (stand in the doorway, get off at stations), take a ferry, steal a fishing boat.
- Each class has its own seat sockets (driver, passenger, standing, door-hang), its own enter/exit anims and camera, and its own handling profile. Seat sockets are data-driven in each vehicle's JSON.

### Vehicles

- Auto rickshaw: black/yellow, CNG, three-wheel tilt-prone handling, meter, horn spam
- Kaali-peeli taxi: Premier Padmini-style (now retired IRL, keep as a classic), plus modern CNG hatch taxis
- BEST red buses: single and double-decker. Slow, heavy, wide turning circle, crush on impact. AI buses run real routes between stops with NPC passengers getting on and off; the player can drive one or ride one
- Two-wheelers: Activa-style scooter, Splendor-style commuter bike, Royal Enfield-style cruiser, delivery scooter with box
- Cars: small hatchbacks (most common), sedans, SUVs, luxury cars around Bandra/Taj, police Gypsy/SUV, ambulance
- **Lorries/trucks** (both drivable and part of ambient AI traffic): hand-painted "Horn OK Please" lorries with tassels and evil-eye charms, overloaded with goods. Tata 407-style tempos, water tankers, cement mixers, garbage trucks. Heavy-vehicle handling: slow acceleration, long braking distance, body roll, air-brake hiss, they push cars aside, and they're restricted from the narrowest lanes, so they rumble along the arterials and flyovers, mostly at night
- Non-motor: handcarts (thela), fruit carts, bicycles with milk cans, horse carriage (Victoria) at Gateway
- Water: ferry and fishing boats in the harbour (stretch goal)
- Rail: local train on a fixed track (rideable as a stretch goal)

### People (NPC archetypes, varied mesh/texture/colour)

Office workers, students, saree and salwar-kameez women, kurta men, vendors, porters, dabbawalas (tiffin crates), auto drivers in khaki, Mumbai Police in khaki (wanted system), traffic police with whistle, fishermen (Koli), tourists, beach families, gym-bros on Bandstand, kids playing cricket in lanes.

### Props and set dressing (instanced)

Vada pav, pani puri, chai tapri, pav bhaji and bhel stalls, fruit carts (bananas, mangoes, watermelons), paan shop, sugarcane juice machine, coconut seller, flower garlands, plastic chairs, gas cylinders, tangled overhead wires, rooftop Sintex-style water tanks, satellite dishes, blue/orange tarps, laundry lines, hoardings and Bollywood posters, shop shutters with painted signs (Devanagari + English), street dogs, crows, pigeons, cows, potholes, puddles, dividers with peeling yellow-black paint, cricket kit, bus stops, phone booths.

## 4. Gameplay systems

1. Third-person on-foot controller: walk, run, sprint, jump, climb low walls, ragdoll on hit, smooth camera with collision.
2. Drive or ride **any** vehicle (see the vehicle interaction rule in §3): enter/exit, carjack, mount/dismount, ride as passenger (auto, taxi, BEST bus, pillion), and jump out of moving vehicles. Per-class handling profiles. Heavy-vehicle physics for buses and lorries.
3. Traffic AI on a lane graph built from OSM roads. Lane-splitting two-wheelers, honking when blocked, jaywalkers, traffic signals mostly ignored.
4. Pedestrians: crowd simulation on navmesh, idle behaviours at stalls, flee or panic reactions, gather to watch crashes.
5. Wanted level: 1–5 stars, Mumbai Police pursuit, roadblocks, losing them in Dharavi lanes.
6. Weapons and melee: basic set. Keep it game-y.
7. Missions framework: data-driven JSON (trigger → objectives → fail/success). The first 5 missions are deliveries, chases and races across the Sea Link.
8. HUD: minimap (render from road graph), health/armour, wanted stars, phone UI (missions, contacts, camera mode), Devanagari-capable font.
9. Radio: 2–3 stations of original or royalty-free music plus fake RJ chatter.
10. World simulation: time of day synced to the player's local clock (§4A.1), weather (clear, haze, overcast, monsoon downpour), and time-aware city life (rush-hour traffic, night food streets, quiet 3 AM roads). Ganpati-style festival crowd event is a stretch goal.
11. Save/load to localStorage/IndexedDB. Settings menu with graphics presets.

## 4A. Lighting, color and time of day (top visual priority)

The goal is the best lighting a browser can run: a film-graded, physically based look that holds up in screenshots next to the GTA VI references. Lighting gets its own milestone (M2.5) and its own quality presets. It is never "good enough for now".

### 4A.1 Real-time sun synced to the player's local clock

- **Game clock = the machine's local wall-clock time.** Read `new Date()` and take the player's local hours and minutes. Example: a player in Chicago at 11:30 PM sees Mumbai at 11:30 PM, so it's night.
- **The sun follows Mumbai's real sky at that clock time.** Interpret the player's local HH:MM as Mumbai time (IST, Asia/Kolkata) on today's date. Feed that instant and Mumbai's coordinates (lat 19.076, lng 72.878) into **SunCalc** (`getPosition`, `getTimes`, `getMoonPosition`, `getMoonIllumination`). The result is correct sun altitude/azimuth, real sunrise, sunset and golden-hour times for the season, and the real moon position and phase.
- Map SunCalc azimuth (radians, 0 = south, measured toward west) into world space, where world +X = east and −Z = north. Put that mapping in one tested helper, `sky/solarToWorld.ts`, with unit tests for sunrise (east), noon (high, south-ish in winter) and sunset (west, over the Arabian Sea).
- Runs at **1:1 real time** by default. Recompute every 10 s and slerp the sun direction smoothly, so there are no visible steps. Re-sync on `visibilitychange`, on wake from sleep and on DST or clock changes.
- Settings → Time of day:
  1. **Sync to my clock** (default)
  2. **Real Mumbai time (IST)**
  3. **Manual / time-lapse** (slider plus speed multiplier, for testing and photo mode)
- Dev shortcut: `?time=18:45` URL param and a lil-gui slider, so you can check any lighting state instantly.
- Sun, sky, fog, exposure, color grade, street lights, window emissives, NPC density (busier at rush hour, quieter at 3 AM) and ambient audio all read from one `TimeOfDay` service. Nothing hard-codes "day" or "night".

### 4A.2 Sky, atmosphere and weather

- **Physically based atmosphere:** `@takram/three-atmosphere` (Bruneton precomputed scattering; it has a WebGPU/TSL path) for the sky, sun and sky light, and aerial perspective, so distant towers fade into humid blue-grey haze. Drive it with the same Date from `TimeOfDay`.
- **Clouds:** `@takram/three-clouds` volumetric clouds on Ultra/High. Note: it needs the pmndrs `postprocessing` EffectComposer, so check WebGPU support in the pinned version first. Fallback: a TSL cloud dome plus animated cloud shadows projected on the ground.
- **Night sky:** stars, real moon phase and position, an orange light-pollution glow near the horizon over the city, and a moonlight directional light (cool, low intensity).
- **Mumbai haze:** height fog with sun in-scattering. Thicker at dawn and over the sea; light shafts through gaps between buildings and Dharavi lanes.
- **Weather:** clear, humid haze, overcast, monsoon downpour. Weather changes the color grade, exposure, fog, wetness, puddles and audio. On rain days, wetness ramps up and roads take time to dry.

### 4A.3 Lighting pipeline (WebGPU path)

- **Direct light:** sun as a directional light with cascaded shadow maps (3–4 cascades, stable texel snapping) plus soft contact shadows. Sun color and intensity come from the atmosphere's transmittance, so it turns deep orange and dim at the horizon automatically.
- **Indirect / GI:** three.js **SSGI** (WebGPU-only) on Ultra/High, layered over **baked irradiance light probes** per district. Keep two probe sets, day and night, and blend them by sun altitude, so narrow lanes and interiors never go flat black. Use **GTAO** for ambient occlusion.
- **Reflections:** SSR for wet roads, glass towers and car paint, with cubemap/probe fallback. Use planar or reflective water for the sea and Marine Drive at night.
- **Night practicals (critical, many players play at night):**
  - sodium-vapour orange streetlights on old roads, white LED on the Sea Link and newer roads
  - neon and LED shop signs, Bollywood hoarding spotlights
  - headlights and tail-lights with volumetric cones in rain or haze
  - emissive windows that switch on gradually through the evening (randomized per window, warm tungsten or cool tube-light)
  - fairy lights on stalls, kerosene lamps on carts in Dharavi
  - **Approach:** tiled or clustered lighting if your pinned three.js offers it on WebGPU; otherwise emissives plus bloom plus a limited pool of real point/spot lights nearest the camera, with cheap "light card" decals on the ground for the rest.
- **Materials:** calibrated PBR albedo (no pure black or white). Wetness shader: darker albedo, lower roughness, puddle mask in world space, rain ripple normals. Dust and grime decals. Subsurface-ish foliage, and a clear-coat car paint.
- **Anti-aliasing:** TRAA on WebGPU (stable, film-like), SMAA/FXAA fallback on WebGL2.

### 4A.4 Cinematic color pipeline

- **Exposure:** physically based EV with **auto-exposure / eye adaptation**. Stepping out of a dark Dharavi lane into midday sun should blow out briefly and settle.
- **Tone mapping:** AgX (preferred) or ACES Filmic, with HDR rendering throughout.
- **Grading:** time-of-day **3D LUT blending** (`.cube` LUTs authored in DaVinci Resolve against the GTA VI reference shots). LUT keyframes:
  - **Dawn:** cool teal shadows, soft pink sky, low contrast
  - **Midday:** warm, hazy, slightly bleached high-key, strong but softened shadows
  - **Golden hour:** amber/orange highlights with teal shadows, the blockbuster teal-orange look; the signature shot is the sunset over Marine Drive and the Sea Link
  - **Blue hour:** deep blue ambient against glowing sodium-orange practicals
  - **Night:** cyan-teal shadows, orange sodium, magenta and green neon accents, rich blacks
  - **Monsoon:** desaturated green-grey, higher contrast, bright wet specular highlights
- **Lens and film:**
  - HDR bloom (subtle by day, strong at night)
  - anamorphic streaks on bright lights
  - lens flare and dirt when facing the sun
  - vignette and light film grain
  - very subtle chromatic aberration at the edges
  - motion blur at vehicle speed
  - depth of field in cutscenes and photo mode
- **Photo mode:** pause, free camera, time-of-day slider, LUT and filter picker, DoF focus, high-res capture.
- **Look-dev scene:** `/lookdev` route with a fixed camera rig of 8 hero shots (Gateway at dawn, Taj at noon, Marine Drive at golden hour, Sea Link at blue hour, Bandstand at night, Dharavi lane at midday, Crawford Market in rain, Juhu at sunset). Playwright captures all 8 after every lighting change, as a visual regression check.

### 4A.5 Quality presets (lighting-specific)

| Preset     | Target                                                | Lighting features                                                                                                     |
| ---------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Ultra**  | RTX 4070-class, 1440p, 60 FPS with dynamic resolution | WebGPU, SSGI, SSR, volumetric clouds, full-res volumetric fog, TRAA, 4 shadow cascades, all lens FX                   |
| **High**   | RTX 3060 / M1 Pro, 1080p 60                           | WebGPU, SSGI half-res, SSR, cloud dome, GTAO, TRAA, 3 cascades                                                        |
| **Medium** | Mid laptops, 1080p 45–60                              | GTAO, probe GI only, SSR off (probe reflections), half-res fog, SMAA                                                  |
| **Low**    | Integrated / WebGL2                                   | Baked probes, SSAO, FXAA, 2 cascades, LUT grading and bloom kept (the grade is cheap and it carries most of the look) |

**Dynamic resolution scaling** holds the frame-rate target on every preset. Color grading and tone mapping are never turned off.

## 5. Tech stack (decided; change only via the Decision log)

- **Vite + TypeScript (strict)**, vanilla **Three.js**. Use `WebGPURenderer` with automatic WebGL2 fallback, and TSL for custom materials. No React in the hot path; React is fine for menus and HUD only if it helps.
- **Physics:** Rapier (`@dimforge/rapier3d-compat`). Use `DynamicRayCastVehicleController` for cars, autos and bikes, and the kinematic character controller for on-foot.
- **Navigation/crowds:** `recast-navigation` + `@recast-navigation/three` (navmesh, Detour crowd).
- **Steering/AI helpers:** custom lane-graph traffic. Yuka is allowed for steering behaviours.
- **Collision acceleration:** `three-mesh-bvh` for raycasts against static city meshes.
- **Lighting/post (see §4A):** native TSL `PostProcessing` on WebGPU (SSGI, GTAO, SSR, TRAA, bloom, DoF, 3D LUT, AgX) plus `@takram/three-atmosphere` / `three-clouds`, and **SunCalc** for sun and moon. WebGL2 fallback: pmndrs `postprocessing` plus `realism-effects` (SSGI/TRAA) or SSAO/SMAA. Never use the old examples `EffectComposer` with WebGPURenderer, and drive the loop with `renderer.setAnimationLoop()`.
- **Assets:** glTF/GLB only, optimized with **glTF-Transform** (meshopt + KTX2). Animations retargeted to one shared humanoid skeleton.
- **Audio:** WebAudio via Three.js `PositionalAudio`; horn, engine, crowd and ambience layers.
- **Testing:** Vitest for systems; Playwright (MCP) to load the game, take screenshots and check console errors and FPS.

## 6. Architecture

```
/src
  main.ts                 # boot, renderer select (WebGPU→WebGL2), loop
  core/                   # Engine, Time, EventBus, Input (kb/mouse/gamepad/touch), AssetManager, Settings
  render/                 # Renderer, PostFX, Sky/Sun/Time-of-day, Weather, Water, materials (TSL)
  physics/                # Rapier world wrapper, layers, vehicle factory
  world/
    streaming/            # chunk grid (e.g. 256 m cells), load/unload, LOD, impostors
    districts/            # colaba.ts, fort.ts, marine-drive.ts, ... (layout + landmark placement)
    roads/                # OSM → lane graph, road mesh gen, sidewalks, markings
    buildings/            # procedural facade generator (Indian styles), landmark loaders
    props/                # instanced scatter rules per district
  actors/
    player/               # controller, camera, animation state machine
    vehicles/             # profiles: auto, taxi, bus, scooter, bike, car, truck, handcart
    npcs/                 # pedestrians, drivers, police, vendors
  ai/                     # traffic, crowd (recast), police pursuit, wanted system
  gameplay/               # missions (JSON), weapons, damage, economy, save/load
  ui/                     # HUD, minimap, phone, menus, radio
  audio/
/tools                    # node scripts: osm-fetch, osm-to-world, gltf-optimize, lod-gen, atlas
/public/assets            # optimized GLB/KTX2/audio only (raw sources live in /assets-src, git-ignored or LFS)
/docs                     # ASSETS.md (source + license ledger), PERF.md, decisions
```

Rules: systems talk through the EventBus. Gameplay state is in one store. No system imports another system's internals. Everything that spawns many copies uses `InstancedMesh` or `BatchedMesh`.

## 7. Performance budgets (enforce with an on-screen perf HUD)

- 60 FPS at 1080p on an RTX 3060 / Apple M1 class machine; 30 FPS on Intel Iris Xe at the "Low" preset.
- Initial download under 40 MB before you can play; everything else streams by chunk.
- At most ~1,500 draw calls and ~3M visible triangles. Textures are KTX2, max 2K for heroes and 1K for common props.
- Up to 150 active pedestrians and 80 active vehicles near the player. Beyond that use LOD and impostors, or despawn.
- Shadows: cascaded shadow maps (3 cascades) on the sun; no shadows from point lights except hero ones.

## 8. Asset strategy

1. **Greybox first.** Every system must work with procedural placeholders (boxes, capsules, extruded OSM footprints) before real art goes in.
2. **Procedural Indian buildings:** a facade generator with modules for chawl balconies, art-deco curves (Marine Drive), Indo-Saracenic arches and domes (Colaba/Fort), slum blocks (Dharavi: corrugated sheet, tarp, brick, painted plaster), glass towers. Weathering via vertex colour and decals (damp stains, posters, AC units, wires).
3. **Hero landmarks** (Gateway, Taj, CSMT, Sea Link, Mannat, Mount Mary, Marine Drive arc): model in Blender (Blender MCP can help), or source and heavily optimize. Each gets 3 LODs plus an impostor.
4. **Characters:** one shared rig. Base meshes from Quaternius / Mixamo plus Indian clothing variants (saree, kurta, khaki uniform). Use texture and colour variation for crowds.
5. Run every model through `tools/gltf-optimize` (glTF-Transform: `optimize --compress meshopt --texture-compress ktx2`) and generate LODs.
6. Even though this is private, log every external asset in `docs/ASSETS.md` (source URL, author, license), so you don't have to dig later if you ever share it.

## 9. Milestones (each ends with a playable build, Playwright screenshots and a perf note)

- **M0 Bootstrap:** Vite + TS + Three (WebGPU/WebGL2), Rapier, perf HUD, input, settings, CI lint/test, and the `TimeOfDay` service (local-clock → Mumbai sun via SunCalc, with tests).
- **M1 Feel:** player controller, camera, one drivable car and an auto rickshaw on a test track. Tune until it's fun.
- **M2 First district (Colaba):** OSM roads and footprints → meshes, Gateway and Taj greybox, sea plane, sky, time of day, PostFX.
- **M2.5 Look-dev (lighting milestone):** everything in §4A for Colaba: atmosphere, clouds, CSM, SSGI/GTAO/SSR, probes (day/night), night practicals, wetness, auto-exposure, AgX, time-of-day LUT blending, lens FX, the `/lookdev` 8-shot rig with Playwright captures, and quality presets with dynamic resolution. Don't continue to M3 until golden hour and night look cinematic in the captures.
- **M3 Life:** pedestrians on navmesh, traffic on a lane graph (including lorries on the arterials), honking, drive or ride any vehicle, carjacking, BEST bus routes with stops and boarding (drive the bus or ride as a passenger), and auto/taxi passenger mode.
- **M4 Mumbai density:** props and stalls, wires, signage, scooters and two-wheeler swarm, BEST bus, taxis, handcarts.
- **M5 Systems:** wanted level and police, damage, weapons/melee, HUD, minimap, phone, radio, save/load.
- **M6 More districts:** Fort/CSMT, Marine Drive, Crawford Market, then streaming and LOD across districts.
- **M7 North:** Dadar, Dharavi (parkour rooftops), Sea Link, Bandra (Bandstand, Mannat exterior), Juhu.
- **M8 Polish:** monsoon weather, night lighting, the first 5 missions, audio pass, performance pass, mobile/touch controls.

## 10. How Claude Code should work in this repo

- Start each milestone in **plan mode**: list tasks, files and risks, then implement.
- Small, focused commits with conventional messages. Never commit raw multi-hundred-MB assets.
- After each feature: `npm run dev`, then use **Playwright MCP** to open the page, wait for load, screenshot key views, read console errors and check the perf HUD numbers. Fix before moving on.
- Use the installed **Three.js skills** (see section 12) for API correctness. Use **Blender MCP** for modelling and cleanup, Poly Haven HDRIs and textures, and Sketchfab imports.
- Use subagents for parallel, isolated work (e.g. "build the facade generator", "build the lane-graph tool") with clear interfaces.
- Prefer procedural generation plus instancing over hand-placing. Data-drive districts, spawn rules and missions as JSON.
- Ask before downloading large asset packs or changing the tech stack.
- Keep `docs/PERF.md` updated with FPS, draw calls and memory per milestone.

## 11. Decision log

- (start) Vanilla Three.js + Rapier + recast-navigation; WebGPU with WebGL2 fallback; condensed real geography from OSM.
- (start) Male protagonist. Every vehicle is drivable or rideable, including BEST buses as a passenger. Lorries are drivable and part of AI traffic.
- (start) Lighting is the top visual priority. Game clock = the player's local wall-clock; sun and moon = Mumbai's real sky at that clock time (SunCalc). Cinematic grade = AgX + time-of-day LUT blending.
- (2026-11-18, M0/M1) Pinned versions: three 0.187.0, @dimforge/rapier3d-compat 0.21.0, vite 8.3.5, vitest 5.1.0, TypeScript 6.0.3 (typescript-eslint doesn't support TS 7 yet), lil-gui 0.21.0.
- (2026-11-18) **suncalc pinned to 1.9.0.** suncalc 2.x changed azimuth to degrees clockwise from north; §4A.1 and `solarToWorld` assume the 1.x convention (radians, 0 = south, toward west). Revisit only together with the helper and its tests.
- (2026-11-18) Post stack uses `THREE.RenderPipeline` (r183 renamed `PostProcessing`). M1 grade = keyframed tint/split-tone/saturation/contrast as a stand-in for M2.5 LUTs.
- (2026-11-18) **CSM deferred to M2.5.** three r187 `CSMShadowNode` throws during TSL build (fade path and the standard path) in our setup. M1 uses one camera-following sun shadow with texel snapping, sized per preset. One key light serves as sun by day and moon by night (no light-count shader recompiles at dusk). `PCFSoftShadowMap` is gone on WebGPU, so we use `PCFShadowMap`.
- (2026-11-18) Vehicle frame convention: +Z forward, **+X left**, +Y up (Rapier positive steer = left). Indian right-hand drive puts drivers at −X; bus doors are at +X (kerb side). Rapier's raycast vehicle produces almost no body roll, so profiles carry a `rollFactor` (cornering roll torque); the auto's high value makes it tilt-prone.
- (2026-11-18) Kinematic player body makes no contacts with vehicles (vehicle hits are resolved as ragdolls by gameplay); character-controller sweeps still treat vehicles as solid.
- (2026-11-18) M1 humanoids are procedural greybox rigs with a pose library; no Quaternius/Mixamo download yet (needs approval for asset packs). The project is hosted on GitHub (private repo) and deployed to Vercel as a static Vite build.
- (2026-11-18, street pass) Added the hero **bazaar street** (`world/districts/BazaarStreet.ts`) using the user's Hitman 3 Mumbai screenshots purely as a mood/density reference (all art, signage, posters and layout are original). Procedural facade kit (`world/buildings/StreetBuildings.ts`: colonial / chawl / shophouse, shops with shutters, signs, awnings, tube lights), street kit (carts, umbrellas, chairs, bunting), instanced dressing, alpha-card palms and trees, kaali-peeli taxi, instanced crowd via `RigInstancer`.
- (2026-11-18) **Tone mapping switched to ACES Filmic** (§4A.4 allows it). AgX desaturated the bright physical sky to white and gave a flat look against the reference shots; revisit when M2.5 LUTs land.
- (2026-11-18) Image-based light: a sun-disc-free copy of the sky is baked to PMREM and re-baked when the sun moves >1.2°. GTAO (High/Ultra) uses a depth/normal pre-pass plus DenoiseNode (raw GTAO was noisy on thin geometry). Sky luminance scaled ×0.6 so midday reads deep blue under ACES.

---

## 12. Reference links

### GTA VI visual reference (mood boards, lighting, density, HUD)

- Official GTA VI site and gallery: https://www.rockstargames.com/VI
- GTABase: every official GTA VI screenshot: https://www.gtabase.com/gta-6/screenshots/official/
- GTABase: trailer screencaps: https://www.gtabase.com/gta-6/screenshots/trailers/
- GTAboom: all official screenshots and artwork: https://www.gtaboom.com/all-the-official-gta-6-screenshots-and-artwork-3nd7

### Mumbai places (Wikimedia Commons: freely licensed photos, great for textures and reference)

- Taj Mahal Palace Hotel (category): https://commons.wikimedia.org/wiki/Category:Taj_Mahal_Palace_Hotel
- Streets in Mumbai (category, 300+ photos, includes "Streets in Dharavi" and "Streetscapes in Mumbai"): https://commons.wikimedia.org/wiki/Category:Streets_in_Mumbai
- Dharavi (category): https://commons.wikimedia.org/wiki/Category:Dharavi
- Gateway of India: https://commons.wikimedia.org/w/index.php?search=Gateway+of+India
- Chhatrapati Shivaji Terminus: https://commons.wikimedia.org/w/index.php?search=Chhatrapati+Shivaji+Terminus
- Marine Drive: https://commons.wikimedia.org/w/index.php?search=Marine+Drive+Mumbai
- Bandra-Worli Sea Link: https://commons.wikimedia.org/w/index.php?search=Bandra+Worli+Sea+Link
- Bandstand / Mannat: https://commons.wikimedia.org/w/index.php?search=Mannat+Bandstand+Bandra
- Mount Mary Church Bandra: https://commons.wikimedia.org/w/index.php?search=Mount+Mary+Church+Bandra
- Crawford Market: https://commons.wikimedia.org/w/index.php?search=Crawford+Market+Mumbai
- Dadar flower market: https://commons.wikimedia.org/w/index.php?search=Dadar+flower+market
- Juhu Beach: https://commons.wikimedia.org/w/index.php?search=Juhu+Beach
- Chawls: https://commons.wikimedia.org/w/index.php?search=chawl+Mumbai
- Mapillary (street-level photos for ground-truth): https://www.mapillary.com
- OpenStreetMap: https://www.openstreetmap.org/#map=13/19.02/72.84

### Mumbai transport and street life (Commons searches)

- Auto rickshaws in Mumbai: https://commons.wikimedia.org/w/index.php?search=auto+rickshaw+Mumbai
- Kaali-peeli taxi / Premier Padmini: https://commons.wikimedia.org/w/index.php?search=Premier+Padmini+taxi+Mumbai
- BEST buses: https://commons.wikimedia.org/w/index.php?search=BEST+bus+Mumbai
- Mumbai local trains: https://commons.wikimedia.org/w/index.php?search=Mumbai+suburban+railway+train
- Indian trucks "Horn OK Please": https://commons.wikimedia.org/w/index.php?search=Horn+OK+Please+truck
- Dabbawalas: https://commons.wikimedia.org/w/index.php?search=dabbawala+Mumbai
- Mumbai Police: https://commons.wikimedia.org/w/index.php?search=Mumbai+Police
- People of Mumbai (category): https://commons.wikimedia.org/wiki/Category:People_of_Mumbai
- Street vendors / handcarts: https://commons.wikimedia.org/w/index.php?search=street+vendor+Mumbai

### Mumbai food (for stall props and textures)

- Vada pav: https://commons.wikimedia.org/w/index.php?search=vada+pav
- Pav bhaji: https://commons.wikimedia.org/w/index.php?search=pav+bhaji
- Pani puri: https://commons.wikimedia.org/w/index.php?search=pani+puri
- Bhel puri: https://commons.wikimedia.org/w/index.php?search=bhel+puri
- Cutting chai / tapri: https://commons.wikimedia.org/w/index.php?search=chai+stall+India
- Fruit carts: https://commons.wikimedia.org/w/index.php?search=fruit+cart+India

### 3D assets: free / CC0 libraries

- Poly Haven (CC0 HDRIs, PBR textures, models): https://polyhaven.com
- ambientCG (CC0 PBR textures: concrete, asphalt, plaster, corrugated metal, tarp): https://ambientcg.com
- Quaternius Universal Base Characters (CC0, glTF, rig-compatible): https://quaternius.com/packs/universalbasecharacters.html
- Quaternius Universal Animation Library (CC0, 120+ anims): https://quaternius.com/packs/universalanimationlibrary.html
- Quaternius Universal Animation Library 2 (combat combos): https://quaternius.com/packs/universalanimationlibrary2.html
- All Quaternius CC0 packs (cars, modular streets, buildings, food): https://opengameart.org/content/all-cc0-uploader-quaternius
- RG-Poly Cartoon City characters (CC0 free tier; stylized, useful as crowd fillers): https://rg-poly.itch.io/cartoon-city-massive-pack
- Kenney (CC0 props, vehicles, UI): https://kenney.nl/assets
- Poly Pizza (low-poly models): https://poly.pizza
- Mixamo (rigging and animation library): https://www.mixamo.com

### 3D assets: India-specific (check each license; paid ones marked)

- Sketchfab downloadable auto rickshaws: https://sketchfab.com/search?q=auto+rickshaw&features=downloadable&type=models
- Sketchfab downloadable Indian trucks: https://sketchfab.com/search?q=indian+truck&features=downloadable&type=models
- Sketchfab downloadable Indian buses: https://sketchfab.com/search?q=indian+bus&features=downloadable&type=models
- Sketchfab downloadable Indian street food carts: https://sketchfab.com/search?q=indian+food+cart&features=downloadable&type=models
- Sketchfab downloadable Mumbai models: https://sketchfab.com/search?q=mumbai&features=downloadable&type=models
- Sketchfab Auto Rikshaw by sagarkalbande (has downloadable versions): https://sketchfab.com/sagarkalbande
- Free Chingchi motorcycle rickshaw (royalty-free): https://superhivemarket.com/products/chingchi-traditional-motorcycle-rickshaw
- Traditional Auto Rickshaw, game-ready PBR (paid): https://www.renderhub.com/zarrarabbas73/traditional-auto-rickshaw
- Rickshaw Art Panels Pack (paid): https://www.renderhub.com/zarrarabbas73/rickshaw-art-panels-pack
- Taj Hotel Mumbai, PBR (paid): https://cgtrader.com/3d-models/exterior/landmark/taj-hotel-mumbai
- Taj Palace Hotel Mumbai (paid, high-poly; needs decimation): https://www.cgtrader.com/3d-models/exterior/landmark/taj-palace-hotel-mumbai
- India landmarks bundle incl. Taj Palace (paid): https://www.cgtrader.com/gallery/project/gate-way-of-india
- Indian woman in sari, rigged (free, toon): https://www.turbosquid.com/3d-models/indian-women-character-model-1594661
- Indian Casual Saree with glTF (paid, cheap): https://cgtrader.com/3d-models/character/clothing/indian-casual-saree-a-3d-model-with-textures
- Free saree mesh (Blender): https://www.cgtrader.com/free-3d-models/character/clothing/bangladeshi-saree-blender

### City from real map data

- Overpass Turbo (export OSM roads and buildings per district bbox): https://overpass-turbo.eu
- OSM2World (OSM → glTF/GLB): https://github.com/tordanik/OSM2World
- osm2threejs (Python, OSM → Three.js / GLB): https://pypi.org/project/osm2threejs/
- OSMThree (OSM buildings into a three.js scene): https://github.com/skewart/osmthree
- Simple 3D Buildings tagging (heights, roof shapes): https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings

### Engine / gameplay code to learn from

- Three.js docs and examples: https://threejs.org/docs/ · https://threejs.org/examples/
- Sketchbook (three.js third-person controller, enter/exit vehicles, cars, planes): https://github.com/swift502/Sketchbook
- Rapier `DynamicRayCastVehicleController` API: https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html
- Rapier vehicle demo (raw API): https://elettrotecnica.github.io/aframe-rapier-physics/examples/vehicle.html
- Raycast Vehicle Engine (drive any GLTF car in three.js): https://github.com/Jaagrav/raycast-vehicle-engine
- ecctrl (pmndrs character and vehicle controllers, reference for tuning): https://github.com/pmndrs/ecctrl
- recast-navigation-js (navmesh, pathfinding, crowds): https://github.com/isaac-mason/recast-navigation-js
- three-pathfinding (lightweight navmesh pathing): https://github.com/donmccurdy/three-pathfinding
- three-mesh-bvh (fast raycasts/collision): https://github.com/gkjohnson/three-mesh-bvh
- pmndrs postprocessing: https://github.com/pmndrs/postprocessing
- Yuka (game AI steering/FSM): https://github.com/Mugen87/yuka
- glTF-Transform (optimize/compress GLB): https://github.com/donmccurdy/glTF-Transform · CLI docs: https://gltf-transform.dev/cli
- Notblox (three.js multiplayer "GTA-like" demo, ECS): https://ewcodealot.github.io/Notblox

### Lighting, atmosphere and color

- Three.js WebGPURenderer manual (new post stack, SSGI, SSS, DoF): https://threejs.org/manual/en/webgpurenderer
- Three.js post-processing with WebGPURenderer (TSL `pass()`, TRAA, MRT): https://threejs.org/manual/en/webgpu-postprocessing
- Three.js SSGI example (WebGPU): https://threejs.org/examples/#webgpu_postprocessing_ssgi
- Three.js examples, filter by "webgpu" for GTAO, SSR, bloom, DoF, LUT, volumetric lights: https://threejs.org/examples/
- takram three-geospatial: `@takram/three-atmosphere` (precomputed scattering) and `@takram/three-clouds`: https://github.com/takram-design-engineering/three-geospatial
- three-atmosphere WebGPU/TSL docs: https://www.npmjs.com/package/@takram/three-atmosphere
- SunCalc (sun/moon position, sunrise/sunset/golden hour, moon phase): https://github.com/mourner/suncalc
- realism-effects (SSGI, TRAA, motion blur, AO for the WebGL2 path): https://www.npmjs.com/package/realism-effects
- pmndrs postprocessing (WebGL2 path, LUT, bloom, tone mapping): https://github.com/pmndrs/postprocessing
- DaVinci Resolve (free; grade reference frames, export `.cube` LUTs): https://www.blackmagicdesign.com/products/davinciresolve
- Poly Haven HDRIs (lighting reference, fallback sky): https://polyhaven.com/hdris

### Audio

- Freesound: Mumbai traffic / horns: https://freesound.org/search/?q=mumbai+traffic
- Freesound: Indian market ambience: https://freesound.org/search/?q=indian+market
- Freesound: auto rickshaw engine: https://freesound.org/search/?q=auto+rickshaw
- Freesound: Mumbai local train: https://freesound.org/search/?q=mumbai+train

### Fonts (HUD, signage)

- Noto Sans Devanagari: https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari
- Mukta (Devanagari + Latin): https://fonts.google.com/specimen/Mukta

### Claude Code skills and MCP servers for this project

- Three.js Game Skills (director + gameplay, UI, QA, asset skills): https://github.com/majidmanzarpour/threejs-game-skills
- Three.js Skills for Claude Code (API fundamentals, loaders, materials, etc.): https://github.com/cloudai-x/threejs-skills
- game-creator `threejs-game` skill (EventBus/GameState architecture): https://github.com/opusgamelabs/game-creator
- Anthropic skills (e.g. `frontend-design` for HUD/menus): https://github.com/anthropics/skills
- Blender MCP (Blender control, Poly Haven, Sketchfab, AI 3D gen): https://github.com/ahujasid/blender-mcp
- Playwright MCP (Claude opens the game, screenshots, reads console): https://github.com/microsoft/playwright-mcp
