# KICKOFF — GTA: Mumbai in Claude Code

## Step 1: Create the repo and drop in the brief

```bash
mkdir gta-mumbai && cd gta-mumbai
git init
# put CLAUDE.md (the project brief) in this folder
```

## Step 2: Install skills (pick global -g or project-level)

```bash
# Three.js game skills (director + gameplay/UI/QA/asset skills)
npx skills add majidmanzarpour/threejs-game-skills --skill '*' -a claude-code -g -y

# Three.js API fundamentals skills → project .claude/skills
git clone --depth 1 https://github.com/cloudai-x/threejs-skills /tmp/threejs-skills
mkdir -p .claude/skills && cp -r /tmp/threejs-skills/* .claude/skills/   # check the repo layout first; copy only the skill folders

# Architecture skill (EventBus / GameState pattern)
npx skills add https://github.com/opusgamelabs/game-creator --skill threejs-game
```

## Step 3: Add MCP servers

```bash
# Browser testing: Claude opens the game, screenshots, reads console/FPS
claude mcp add playwright npx @playwright/mcp@latest

# Blender control (install the Blender add-on from the repo README first,
# then click "Connect to Claude" in Blender's N-panel)
claude mcp add blender uvx blender-mcp
```

Optional: add a Sketchfab API key in the Blender MCP add-on preferences so Claude can search and import Sketchfab models.

Also install Node 20+, Blender 4.x, and the glTF-Transform CLI:

```bash
npm i -g @gltf-transform/cli
```

## Step 4: Start Claude Code and paste this as your first message

```
Read CLAUDE.md fully. It is the source of truth for this project: a private,
GTA-style open-world browser game set in Mumbai, built with Vite + TypeScript +
Three.js (WebGPU with WebGL2 fallback) + Rapier + recast-navigation.

Use /threejs-game-director and the other installed Three.js skills for API
correctness. Use Playwright MCP to verify every milestone in a real browser.

Do this now, in plan mode first:
1. Propose the detailed task breakdown for M0 (Bootstrap) and M1 (Feel) from
   CLAUDE.md §9, including files to create, npm packages with versions, and risks.
   Wait for my OK.
2. After approval, implement M0:
   - Vite + TS strict project, folder structure from CLAUDE.md §6
   - Renderer bootstrap: WebGPURenderer with automatic WebGL2 fallback
   - Rapier world wrapper, fixed-timestep loop, EventBus, Input (kb/mouse/gamepad)
   - On-screen perf HUD (FPS, frame ms, draw calls, triangles, memory)
   - TimeOfDay service per CLAUDE.md §4A.1: player's local wall-clock HH:MM →
     interpreted as IST on today's date → SunCalc at Mumbai (19.076, 72.878) →
     sun/moon direction in world space (solarToWorld helper with unit tests),
     smooth slerp updates, re-sync on visibilitychange, ?time=HH:MM override,
     settings: Sync to my clock / Real IST / Manual time-lapse
   - Settings with Low/Medium/High/Ultra presets
   - ESLint + Prettier + Vitest, npm scripts: dev, build, test, lint
3. Then implement M1:
   - MALE protagonist on the shared humanoid rig (Quaternius Universal Base
     Character male + Universal Animation Library, or capsule placeholder first),
     third-person controller (walk/run/sprint/jump/vault) with a collision-aware
     orbit camera and an animation state machine
   - Test track scene: asphalt ground (ambientCG-style PBR placeholder), ramps,
     kerbs, a bus stop, sun driven by the TimeOfDay service with cascaded
     shadows, AgX tone mapping (full look-dev comes in M2.5)
   - Generic data-driven VehicleSeat system (driver / passenger / standing /
     door-hang sockets defined per vehicle JSON) so ANY vehicle can be driven
     or ridden
   - Four vehicles via Rapier DynamicRayCastVehicleController:
     (a) small hatchback car, (b) auto rickshaw (3 wheels, light, high centre of
     mass, twitchy, can tip), (c) scooter (rider lean, balance assist),
     (d) BEST bus (heavy, long wheelbase, wide turning circle, air-brake hiss).
     Add a hand-painted lorry/truck right after if time allows.
   - F = enter/exit as driver (carjack if occupied), G = board as passenger
     (bus: sit / stand-hold-rail / hang from door; auto/taxi: back seat),
     jump out of a moving vehicle, H = horn (spam-able), per-vehicle chase
     camera + bus window camera
   - Tuning panel (lil-gui) for suspension, friction, engine, steering
4. Run the game, use Playwright MCP to screenshot on-foot and both vehicles,
   check console errors, and report FPS/draw calls into docs/PERF.md.
5. Commit with clear messages and summarize what's done and what's next (M2: Colaba).

Rules: greybox first, procedural placeholders, no large asset downloads without
asking, update CLAUDE.md's Decision log when you make a structural choice.
```

## Step 5: Prompts for later milestones (paste one at a time)

**M2 Colaba**

```
Implement M2 from CLAUDE.md. Write tools/osm-fetch.ts to pull roads + building
footprints for the Colaba/Apollo Bunder bbox via Overpass, and tools/osm-to-world.ts
to convert them to a lane graph + extruded building meshes (heights from
building:levels, fallback by district rules). Place greybox Gateway of India and
Taj Mahal Palace (palace wing + tower) at correct real positions. Add sea plane
with water shader, time-of-day sun/sky, haze, bloom, SSAO. Verify with Playwright
screenshots at noon, golden hour and night.
```

**M2.5 Look-dev (lighting & color, top priority)**

```
Implement M2.5 from CLAUDE.md §4A for the Colaba district. Use the WebGPU TSL
PostProcessing stack only (never the old EffectComposer with WebGPURenderer):
- @takram/three-atmosphere sky + sun/sky light + aerial perspective driven by
  the TimeOfDay Date; clouds via @takram/three-clouds if compatible with our
  pinned versions, else a TSL cloud dome + cloud shadows
- CSM (3-4 cascades) + contact shadows; SSGI (Ultra/High) + GTAO; SSR for wet
  roads/glass; day and night irradiance probe sets blended by sun altitude
- Night practicals: sodium + LED streetlights, neon signs, headlights with
  volumetric cones, windows switching on through the evening, moonlight,
  light-pollution sky glow
- Height fog with sun in-scattering, light shafts, monsoon wetness/puddles
- Auto-exposure, AgX, time-of-day 3D LUT blending (dawn, midday, golden hour,
  blue hour, night, monsoon) with placeholder LUTs + a lil-gui grading panel,
  bloom, anamorphic streaks, lens flare, vignette, grain, motion blur
- Quality presets Ultra/High/Medium/Low + dynamic resolution
- /lookdev route with the 8 hero shots from §4A.4; Playwright captures all 8
  at their times of day. Show me the captures, then iterate until golden hour
  and night look cinematic. Log the performance of each preset in docs/PERF.md.
```

**M3 Life**

```
Implement M3: recast navmesh over sidewalks/plazas, Detour crowd with 100
pedestrians (idle at stalls, wander, flee on gunfire/crash), lane-graph traffic
with 50 vehicles (cars, autos, scooters lane-splitting, lorries on arterials
mostly at night), honking when blocked, jaywalkers. Drive-or-ride-anything via
the VehicleSeat system: carjack any vehicle incl. bus and lorry cabs, BEST bus
AI routes with stops where NPCs and the player can board, ride, and get off;
flag down an auto/taxi and ride in the back with a meter fare (fast travel).
Traffic density follows TimeOfDay (rush hour vs 3 AM).
Keep under the perf budgets in CLAUDE.md §7.
```

**M4 Mumbai density**

```
Implement M4: instanced prop scatter per district (vada pav/chai/fruit carts,
handcarts, plastic chairs, gas cylinders, water tanks on roofs, dish antennas,
tarps, laundry lines), procedural overhead wire generator between poles/buildings,
signage/decal system with Devanagari + English shop boards and hoardings, BEST
bus, kaali-peeli taxi, two-wheeler swarm. Build the procedural Indian facade
generator (chawl, art-deco, Indo-Saracenic, slum-block, glass tower modules).
```

**M5 → M8**: follow CLAUDE.md §9 in order, with the same verify-with-Playwright loop.

## Using Blender MCP for landmarks (example prompt)

```
Using Blender MCP: model a game-ready Gateway of India (basalt arch, four
turrets, central dome, Indo-Saracenic details) at real scale (~26 m tall).
Use Commons reference photos from CLAUDE.md §12. Make LOD0 (~40k tris),
LOD1 (~10k), LOD2 (~2k), bake AO, PBR textures from ambientCG/Poly Haven
(stone, weathered basalt). Export GLB to /assets-src/landmarks/, then run
tools/gltf-optimize to /public/assets/landmarks/.
```
