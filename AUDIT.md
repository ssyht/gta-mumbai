# AUDIT.md: SCENARIOS.md against the code

Status as of 2026-11-20, after Pack 1. Legend: **Exists** · **Partial** · **Missing**.
File paths are relative to the repo root.

## Mislabels found and fixed

| Issue | Fix |
|---|---|
| "BANARASI PAAN · restaurant": the robbery hint called a paan shop a restaurant (regex in `StreetBuildings.ts` lumped CAFE/SWEET/BAKERY/JUICE/CHAI/VADA/PAAN together) | New `shopKind()` in `src/world/buildings/StreetBuildings.ts`: PAAN/CHAI/VADA PAV are **stalls**, KHANA/CAFE are **restaurants**, everything else is a **shop**. `ShopFront.restaurant: boolean` became `kind`. Stall payouts are ₹300–1,800 (matches C5). The full gumti-stall rebuild for C5 is Pack 4. |
| Sweet marts, juice centres and bakeries paid out as restaurants | Now shops (bakery-cafés stay restaurants via CAFE). |
| No child NPCs (SCENARIOS rule; CLAUDE.md §3 listed "kids playing cricket") | Checked: crowds, path walkers, traffic drivers and police use adult proportions only. SCENARIOS.md wins; logged in the CLAUDE.md decision log. |

## Part A: foundation systems

| System | Status | Files | What exists / what has to change |
|---|---|---|---|
| A1 Interior cells | **Exists** (one cell) | `src/world/interiors/InteriorCell.ts`, `src/data/interiors/laxmi-general.json`, `src/world/buildings/StreetBuildings.ts` (`interior` bay, hollow collider shell) | Real room inside the footprint, real doorway, portal culling (inside, or doorway in frustum within 25 m; plug card otherwise), 0.4 s threshold blend, camera arm to 2.2 m and −5° FOV (`PlayerCamera.indoor`), interior walls collide with the camera, street low-pass 18 kHz→1.2 kHz and −9 dB plus interior bed (`src/audio/InteriorAudio.ts`), exposure adaptation over 0.8 s (`SkySystem.adaptation`), minimap floor plan, opening hours, rolling shutter with collider and rattle, tube lights plus one room lamp, dust motes in the door's sunbeam. **To do:** glass door with bell and bead curtain (cloth), half-open shutter crouch, probe/env swap (currently lower `envMapIntensity`), more cells (Pack 6/8). |
| A2 Prop kit | **Partial** | `src/world/interiors/ShopPropKit.ts`, `InteriorCell.ts` | Counter with glass top and 4×3 drop slots, galla on a slide (handle and inside points, real bundles and coins), racks with instanced stock, hero stock items, glass-front fridge with hinged door, ceiling fan, altar with garland and flickering diya, calendar, price board, stool, scale, cordless phone (handset is a real object), chips strip, notes, coins, bundles, bag, newspaper, notepad. **To do:** glass shattering, shot-off stock physics, fan wobble, CCTV, panic button, hidden lathi/shotgun (Packs 3–6). Notes and coins settle by placement, not a physics step yet. |
| A3 Face & emotion | **Missing** | `src/actors/rig/HumanoidRig.ts` (spectacles only) | Pack 2: eyes, lids, brows, morph mouth, emotion model, personality, gaze tells. |
| A4 Hand IK / attach / paired / fumble | **Partial** | `src/actors/rig/ArmIK.ts` (+ test), `HumanoidRig.handL/handR`, `KiranaScenario.ts` | Analytic two-bone arm IK with pole and blend weight, head look-at, reach-aware spine lean, attach/detach that keeps world transforms, a paired handoff (both hands meet, 0 cm gap in the test). **To do:** finger curl presets, fumble system, speed modulation by fear, paired-animation timelines with 0.15 s align (Pack 2). |
| A5 Dialogue & barks | **Partial** | `src/data/dialogue/shop.json`, `src/ui/Subtitles.ts`, `InteriorAudio.voice()` | Bambaiya Hindi + English lines, speaker name and colour, procedural murmur voice (pitch/rate/tremble), subtitle toggle in the pause menu. Greeting has 15 lines; other contexts 2–4. **To do:** jaw sync (needs A3), cooldowns, 15+ lines per context, emotion-driven voice params. |
| A6 Scenario Director | **Partial** | `src/gameplay/scenario/ScenarioDirector.ts` | Timestamped beat log, `window.__game.game.scenario.run(id, opts)` / `.step()`, `holdAt([...])` to freeze on a beat for screenshots. **To do:** data-driven beat graphs, interrupts, branches (Pack 2). |
| A7 Scenario camera | **Missing** | (`PlayerCamera.override` is debug-only) | Pack 3. |
| A8 Memory & persistence | **Missing** | `src/gameplay/SaveGame.ts` | Pack 3: NPC memory records, shop state machine Normal→Robbed→Recovering. |

## Part C: scenarios

| Scenario | Status | Files | Notes |
|---|---|---|---|
| C1 Enter & buy (Kirana) | **Exists** | `src/gameplay/shop/KiranaScenario.ts`, `ShopTransaction.ts` (+ tests) | All 9 beats plus phone and evening-incense variants. Haggling: hold Q, offer falls while held, release to offer; patience/annoyed model. Counterfeit check on ₹500, galla opened and closed by hip bump, change coin by coin, bag handoff, "Aur kuch?". **Gaps:** crowded-queue variant (aunty cutting in line) not built; brows/face reactions wait for A3. |
| C2 Armed galla robbery | **Missing** | `src/gameplay/Robbery.ts` (hold-E timer), `KiranaScenario` hands-up placeholder | Pack 3. Inside Laxmi, a drawn gun gets a startled hands-up and a bark; the legacy hold-E robbery works at the counter only with a pistol equipped. |
| C3 Unarmed intimidation | **Missing** | Robbery.ts | Pack 4 (collar grab, fistfight). |
| C4 Bazaar closes in | **Missing** | `src/actors/npcs/Crowd.ts` (panic exists) | Pack 4: shutter contagion, mobs, beat constable. |
| C5 Paan stall | **Partial** | `StreetBuildings.shopKind` | Correct category and payout only; gumti stall model and beats are Pack 4. |
| C6 Jewellery store | **Missing** | | Pack 6. |
| C7 Night break-in | **Missing** | `InteriorCell` opening hours, shutter | Pack 6 (padlock, crowbar, watchman, dogs). |
| C8 Carjacking (7 types) | **Partial** | `src/gameplay/InteractionSystem.ts` | Carjack exists (under 5 km/h per GAME_SPEC, driver pulled out). No per-vehicle beats or personalities. Pack 5. |
| C9 Street mugging | **Missing** | Crowd.ts | Pack 4. |
| C10 Police interactions | **Partial** | `src/ai/WantedSystem.ts` | Pursuit, roadblocks, busted timer exist. No traffic constable, pull-over, bribe, lock-up cell. Pack 7. |
| C11 Crowd contagion | **Partial** | Crowd.ts, PathCrowd.ts | Panic radius and flee exist; no emotion broadcast, tripping, chappals, phone filming. Pack 7. |
| C12 Normal life | **Partial** | `BazaarStreet.ts` (carts, chairs, stalls as props) | Only C1 is interactive. Pack 8. |

## Build order (Part D) and file plan

Pack 1 (done): A1 + A2 + C1. Files added: `src/world/interiors/{InteriorCell,ShopPropKit}.ts`, `src/gameplay/shop/{KiranaScenario,ShopTransaction}.ts`, `src/gameplay/scenario/ScenarioDirector.ts`, `src/actors/rig/ArmIK.ts`, `src/audio/InteriorAudio.ts`, `src/ui/Subtitles.ts`, `src/data/interiors/laxmi-general.json`, `src/data/dialogue/shop.json`. Changed: `StreetBuildings.ts`, `BazaarStreet.ts`, `GameplayLayer.ts`, `PlayerCamera.ts`, `SkySystem.ts`, `Minimap.ts`, `HumanoidRig.ts`, `poses.ts`, `Robbery.ts`, `Settings.ts`, `PauseMenu.ts`, `Engine.ts`, `styles.css`.

Pack 2 next: face rig and emotion model (A3) on `HumanoidRig`, finger curls and fumbles (A4), dialogue cooldowns and jaw sync (A5), and a data-driven beat graph runner in `ScenarioDirector` (A6) that C1 is then ported onto.
