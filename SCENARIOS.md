# SCENARIOS.md — Detailed Scenario & Interior Spec (Mumbai Open World)

> Add-on to `GAME_SPEC.md`. Put it in the repo root. It covers the **systems** needed for detailed, emotional,
> believable scenarios and then the **scenarios themselves**, beat by beat.
> Rule: if a scenario here and the current code disagree, this file wins.

---

## 0. Prompts to paste into Claude Code

### 0.1 Kickoff (paste first)
```
Read SCENARIOS.md in full, then GAME_SPEC.md, PROGRESS.md and DECISIONS.md.

The game runs, but shops and crime scenarios are shallow: shops are facades with a prompt, robberies are a
hold-E timer, and NPCs have no emotion. SCENARIOS.md defines the depth we need.

Step 1 — Audit. Read the existing code for shops, robbery, NPCs, character rig, carjacking, police and
interiors. Write AUDIT.md: for each system in SCENARIOS.md Part A and each scenario in Part C, mark
Exists / Partial / Missing, list the exact files involved and what has to change. Include a fix for anything
mislabeled (for example "BANARASI PAAN · restaurant": a paan shop is a street stall, not a restaurant).

Step 2 — Plan. In plan mode, propose the build order from Section D and show me the file-level plan for
Pack 1 only.

Step 3 — Build Pack 1, then stop. Run typecheck, unit tests, build, and the scenario tests from Section E.
Capture Playwright screenshots of every beat that has a camera/face requirement and save them to
/screenshots/<scenario>/<beat>.png so I can review them. Update PROGRESS.md and commit.

Rules:
- Every beat in a scenario must actually happen on screen with the timing, animation, emotion, audio and
  dialogue listed. No beat may be skipped or replaced with a fade-to-black or a text popup.
- Every scenario must log its beats to the ScenarioDirector event log so tests can verify the order.
- Keep perf budgets: an interior adds at most 150 draw calls and is only rendered when the player is inside
  or looking through its doorway.
- All names, brands, dialogue and characters are original. No child NPCs anywhere in the game.
```

### 0.2 Continue (one pack per session)
```
Read SCENARIOS.md, AUDIT.md and PROGRESS.md. Fix open bugs first, then build the next pack from Section D.
For every scenario in the pack: implement all beats and branches, add the Section E tests, capture beat
screenshots, review the screenshots yourself against the spec (face readable? cash actually on the counter?
hands aligned to objects?), fix what's wrong, then commit.
```

### 0.3 Review a scenario
```
Run scenario <id> with each personality/branch using window.__game.scenario.run(). Screenshot every beat.
Compare against SCENARIOS.md line by line and list every mismatch (timing, missing animation, wrong emotion,
missing audio/dialogue, clipping, hands not touching objects, objects floating). Fix them all, re-run, commit.
```

---

# PART A — Foundation systems (build these before the scenarios)

## A1. Interior system (enterable shops)

**Goal:** you walk through a real doorway into a real room. No loading screens and no teleporting.

- **Interior cells:** each enterable shop is an `InteriorCell` authored from a data file
  (`data/interiors/<id>.json`). It holds the room's dimensions, walls/floor/ceiling materials, a prop list with
  transforms, NPC slots, interaction points, light rig, audio zone and a doorway portal.
- **Placement:** the cell sits physically inside the exterior building's footprint at the same coordinates. The
  exterior shell gets a real opening (the doorway or shutter) with collision cut out.
- **Portal culling:** the cell renders only when (a) the player is inside, or (b) the doorway portal is within
  the camera frustum and closer than 25 m. Each interior has a draw-call budget of ≤ 150 (merge static
  geometry, instance repeated stock).
- **Transition** (all continuous, over 0.4 s while crossing the threshold):
  - The camera spring arm shortens to 2.2 m indoors (from 4 m), the FOV narrows by 5°, and camera collision uses
    the interior walls.
  - The street audio passes through a low-pass filter (cutoff 18 kHz → 1.2 kHz) with volume −9 dB, and the
    interior ambience fades in (ceiling fan hum, radio, fridge compressor).
  - Exposure adapts from outdoor to indoor over 0.8 s (a brief bright glow at the door, then the eye adjusts).
  - The minimap shows the shop's floor plan.
- **Doors & shutters:**
  - Rolling metal shutter (most Mumbai shops): open, half-open (crouch to pass) or closed and locked.
    Shutters are animated with a rattle sound and can be pulled down by NPCs (see C2/C4).
  - Glass door with a bell: physics hinge, pushed open by the player's capsule; the bell rings.
  - Curtain/bead strip (chemist backroom, tailor): cloth simulation (verlet), parts around the player.
- **Opening hours:** each shop has hours (`open: "09:30", close: "22:30"`, plus closed days). Outside hours the
  shutter is locked (see the night break-in, C7).
- **Lighting:** 1–2 baked-look tube lights (emissive plus one pooled point light near the counter when the
  player is inside), a light-probe/environment-map swap for indoor reflections, and dust motes in sunbeams
  through the door during the day.

## A2. Modular shop prop kit (with real interactions)

Every prop has a mesh, a collider, a material and, where relevant, **interaction points** (named transforms
for hand IK) and **physics behavior**.

| Prop | Interaction points / behavior |
|---|---|
| Wooden counter + glass display top | `counterTop[0..11]` drop slots (a 4×3 grid) where items and cash are placed; glass shatters when shot |
| **Galla** (cash drawer under the counter) | `drawerHandle`, slides out 28 cm on a prismatic joint; contents = cash bundles + coins as real objects |
| Tin cash box (paan stall, vada pav stall) | Lid hinge, `lidHandle`, `insideSlots[0..5]` |
| Cash bundles | ₹500 / ₹200 / ₹100 bundles (10–50 notes, rubber band), 0.15 kg, attach to the hand bone, settle on surfaces with a small physics step |
| Loose notes / coins | Coins scatter on drop (physics, sound per bounce), notes flutter (simple cloth quad) |
| Steel shelves / wooden racks | Instanced stock items (biscuit packets, soap, rice sacks, oil tins); a stray bullet knocks items off as physics props |
| Glass-front fridge | Hinged door, interior light, bottles you can take |
| Ceiling fan | Spins; can be stopped by gunfire (wobbles) |
| Shop altar (small framed picture with garland and a diya lamp) | Flickering light; NPC glances toward it in fear beats |
| Calendar, price board, hanging chips strips, plastic stool, weighing scale, cordless phone, CCTV camera (some shops), panic button (some shops), hidden lathi or old shotgun under the counter (some shops) | Each has a use in at least one scenario |

## A3. Face & emotion system (needed for "scared with emotion")

The current characters are blocky with no facial features. Add a **readable stylized face** to every human NPC
and the player.

**Face rig (procedural, fits the low-poly style):**
- Eyes: white spheres with an iris and pupil disc (the pupil scales 0.7–1.4 with fear), each with independent
  look-at.
- Eyelids: upper and lower hemisphere shells (rotation controls open/close, squint and blinks; blinks every
  2–6 s, faster when afraid).
- Eyebrows: two thin boxes, each with inner-raise, outer-raise and lower/furrow controls.
- Mouth: a mesh with morph targets: `jawOpen, smile, frown, lipStretch (fear grimace), lipPress, pucker,
  mouthLeft/Right`, plus teeth and tongue visible when open.
- Extras: forehead sweat beads (particle decals), tear streaks (decal plus glint), cheek flush (vertex color),
  nostril flare.
- LOD: the full face within 8 m, a simplified version (eyes and brows only) to 20 m, a static texture beyond
  that.

**Emotion model (per NPC, updated at 10 Hz):**
- Continuous values 0–1: `fear, anger, surprise, sadness, relief, disgust, joy`, each with its own decay rate
  (fear decays slowly at 0.02/s, surprise quickly at 0.5/s).
- Inputs: perceived threats (a gun aimed at them gives fear +0.6 at first, then +0.15/s; a gunshot nearby +0.5;
  the player's distance; the player's shouts), social contagion from nearby NPCs, and the NPC's personality.
- **Personality** (seeded per NPC): `courage, temper, greed, civicDuty, composure, talkative`.
- Output: a **dominant emotion state** (Calm, Curious, Annoyed, Angry, Startled, Afraid, Terrified, Pleading,
  Defiant, Shocked, Relieved, Grieving) that blends into:

| State | Face | Body | Voice |
|---|---|---|---|
| Startled | Brows fully up, eyes wide, jaw drops 30% for 0.4 s | Full-body flinch, a half step back, hands up toward the chest | A sharp gasp |
| Afraid | Inner brows up and together, eyes wide, lipStretch 0.6 | Shoulders hunched, head pulled in, hand tremor (amplitude 0.6 cm at 9 Hz), breathing visible (chest scale), weight shifts away from the threat | Pitch +2 semitones, speech fast, small stutters |
| Terrified | Like Afraid, at maximum; sweat; tears at > 8 s | Hands raised and shaking (tremor 1.2 cm), knees bent, may sink to the floor; gaze darts between the weapon and the player's face | Pitch +4, voice breaks, crying sounds |
| Pleading | Inner brows up, mouth open in "o" shapes | Palms together (namaste) or palms out, pushing forward-down, head bowing repeatedly | Rhythmic begging lines |
| Defiant | Brows down, lipPress, chin up | Squares up, steps toward the threat, points a finger | Pitch −2, louder |
| Angry | Brows down, nostrils flared, teeth showing | Arms wide, chest out, gestures sharply | Shouts, swears (mild) |
| Shocked (aftermath) | Blank stare, slow blinks | Stands still or sits; hands on head | Silent, then mutters |
| Relieved | Brows relax, exhale, eyes closed | Shoulders drop, hand on chest, leans on the counter | A long exhale, a nervous laugh |

**Gaze rules:** a frightened NPC alternates its gaze between the weapon (60%), the player's face (25%) and an
escape route or hidden item (15%). The **hidden-item glance is a gameplay tell**: if a shopkeeper keeps
glancing under the counter, they have a weapon or panic button.

**Readability:** in scenario close-up beats, the camera frames the face (see A7) so the emotion actually reads.

## A4. Body interaction & paired animation

- **Hand IK** (two-bone IK per arm) to named interaction points, with finger curl presets (grip bundle, grip
  handle, flat palm, point).
- **Attach/detach:** objects parent to the hand bone on grab and are released to a target slot or to physics.
  Objects never teleport; they travel in the hand.
- **Paired animations** (carjack, shove, grab collar, hand over wallet): synced by a shared timeline with align
  points, so both actors are snapped into alignment over 0.15 s before starting.
- **Fumble system:** under fear > 0.6, every hand action has a `fumbleChance = (fear − 0.6) × 0.5`. A fumble
  plays one of: dropping the object (physics), missing the grab and retrying, or coins spilling. The NPC reacts
  (a flinch toward the player: "sorry, sorry!") and then either picks it up or leaves it, depending on fear.
- **Speed modulation:** action speed = base × (1 + 0.4 × fear) for compliant NPCs (they rush), with the
  trajectories made jittery by tremor noise.

## A5. Dialogue & barks

- `data/dialogue/*.json`: each line has a speaker type, an emotion tag, a context, text in **Bambaiya Hindi**
  with an English subtitle, and a cooldown.
- Voice output: a procedural "murmur" synthesizer whose pitch, speed, tremble and volume come from the emotion
  values, synced to the jaw (`jawOpen` follows the amplitude envelope). Text-to-speech can be plugged in later.
- Subtitles show the speaker name and color, the Hindi line, and the English line underneath (toggle in
  settings).
- All lines are original. Starter set (extend to 15+ lines per context):

| Context | Line (Hindi) | Subtitle |
|---|---|---|
| Greeting | "Aao saab, bolo kya chahiye?" | "Come in, sir, what do you need?" |
| Haggling | "Itne mein toh mera bhi nahi aata, bhai." | "Even I can't buy it for that, brother." |
| Gun drawn – shock | "Arre baap re… bhai, bhai, ruko!" | "Oh my god… brother, wait!" |
| Compliant | "Le lo, sab le lo! Maarna mat!" | "Take it, take everything! Don't shoot!" |
| Pleading | "Bhagwan ke liye… mere bachche hain ghar pe." | "For God's sake… I have kids at home." |
| Fumble | "Sorry, sorry, haath kaanp rahe hain…" | "Sorry, sorry, my hands are shaking…" |
| Lying | "Galla khaali hai, sach mein! Aaj dhanda nahi hua." | "The drawer's empty, really! No business today." |
| Defiant | "Tere jaise bahut dekhe hain. Nikal yahan se!" | "I've seen plenty like you. Get out!" |
| Aftermath shout | "Chor! Chor! Pakdo usko!" | "Thief! Thief! Catch him!" |
| Pointing out the direction | "Udhar bhaaga, laal shirt wala!" | "He ran that way, the one in red!" |
| Later recognition | "Tu… phir aa gaya? Jaa yahan se!" | "You… you're back? Get out of here!" |

## A6. Scenario Director (one state machine for every scenario)

- Every scenario is a data-driven **beat graph**: `beats[]` with `id, actors, preconditions, actions
  (animations, IK targets, dialogue, audio, camera, emotion impulses), duration or exit condition,
  interrupts[], next / branches[]`.
- **Interrupts** at any beat: the player shoots, leaves the area, a cop enters, a customer escapes, the player
  lowers the weapon, the player gets hurt, the player shouts (Q = "Haath upar!" / hands up), the NPC's hidden
  weapon becomes available.
- Every beat transition is written to `ScenarioDirector.log` with a timestamp. Tests read this log.
- Debug: `window.__game.scenario.run(id, {seed, personality, branch})` forces a branch;
  `window.__game.scenario.step()` advances beat by beat for screenshots.

## A7. Scenario camera

- During key beats the gameplay camera stays player-controlled but gets **soft framing**: it subtly drifts (no
  hard cuts) to keep both the player's weapon hand and the NPC's face in frame, and the FOV narrows by up to 8°
  as intimidation rises.
- Optional **"Scenario Cam"** setting: short cinematic angles (over the shopkeeper's shoulder onto the gun, a
  close-up of hands placing cash) that cut back to the gameplay camera, each no longer than 1.2 s. They are
  skippable and off by default during combat.
- Heartbeat audio and a vignette for the player when wanted ≥ 2 inside an interior.

## A8. NPC memory & world persistence

- NPC memory record: `{ npcId, playerFaceSeen, lastIncident, type, dayStamp, grudge (0–1) }`, saved to the save
  file.
- The shop's state machine: Normal → Robbed (shutter half down, closed for the rest of the in-game day) →
  Recovering (next day: reopened, broken glass replaced by tape, CCTV added, a watchman with a lathi hired at
  random) → Normal after 7 in-game days.
- Damage persists until the shop resets: bullet holes, shattered display glass, fallen stock, coins on the floor.

---

# PART B — Scenario template (every scenario must define all of this)

```
id, title, location type, time-of-day variants
actors: roles, archetypes, personality ranges, spawn slots
props: required props + states
trigger: what starts it (player action / proximity / time)
beats: table with id · time window · what each actor does (animation, IK target, emotion, dialogue) ·
       camera · audio · player options
branches: by personality, player choice, interrupts
outcomes: money, wanted level, witness reports, NPC memory, world state
aftermath: what happens in the world 0–60 s, 1 hour and 1 day later
acceptance tests: verifiable assertions (Section E)
```

If you add a new scenario (or the code has one not listed here), write it to this template before building it.

---

# PART C — Scenarios

## C1. Entering a shop & buying something (Kirana store, normal day)

**Setting:** *Laxmi General Stores*, a 4 × 6 m room with a rolling shutter fully open, an L-shaped counter, the
galla under the counter on the right, steel racks floor to ceiling, rice and dal sacks with scoops on the floor,
a fridge by the door, an altar on a high shelf with a diya, a ceiling fan, and a calendar.
**Actors:** shopkeeper *Mr. Shah* (50s, vest and spectacles on a chain) sits on a stool behind the counter;
0–2 customers; a delivery boy (adult) sometimes stacks crates.

| # | Time | What happens |
|---|---|---|
| 1 | Approach (within 6 m) | Shopkeeper glance check: if the player has a weapon drawn, jump to C2. Otherwise he looks up (head IK), recognizes a customer, and raises his eyebrows slightly. |
| 2 | Threshold | Interior transition (A1). The fan hum and a radio playing old film-style music (original procedural track) fade in. |
| 3 | +0.5 s | Greeting bark (context Greeting); he puts his newspaper down on the counter (the prop is placed, not hidden). |
| 4 | Browsing | The player looks at shelves. Items under the crosshair highlight with a name and price label (₹). Pressing E picks up an item in the player's hand. A shelf "focus" camera is optional. |
| 5 | Buying | The player walks to the counter and presses E. The item goes onto a counter slot. The shopkeeper picks it up, turns it to read the price, says the price aloud, and tallies it on a notepad if there are 2 or more items. |
| 6 | Haggling (optional) | Hold Q to haggle: an offer slider. His mood (patience 0–1) drops with lowball offers; brows furrow, and he may refuse (with an annoyed bark) or meet halfway. A lowball below 50% makes him annoyed for the rest of the visit. |
| 7 | Payment | The player's hand places notes on the counter. He takes them, holds a ₹500 note up to the light (a counterfeit check animation), opens the galla (drawer slides out on screen), puts the note in, counts out change coin by coin into a small pile on the counter, and closes the drawer with a hip bump. |
| 8 | Bagging | Puts the items in a thin plastic bag and hands it over (paired handoff). Says "Aur kuch?" ("Anything else?"). |
| 9 | Exit | He goes back to his newspaper. The audio transition reverses. |

**Variants:** a crowded shop means the player waits in an informal queue (customers jostle and an aunty cuts in
line); the shopkeeper may be on a phone call and holds up a finger ("ek minute"); in the evening he lights an
incense stick at the altar.
**Tests:** galla opened and closed with the drawer joint moving; change coins exist as objects; the item is
attached to the player's hand.

---

## C2. Armed shop robbery — the flagship scenario (galla robbery)

**Setting:** any shop with a galla (Kirana, chemist, mobile shop, Irani café). Uses C1's layout.
**Actors:** shopkeeper; 0–3 customers; possibly a delivery boy (adult); possibly a neighbor shopkeeper on the
street outside.
**Shopkeeper personality roll** (seeded; weights per district):

| Type | Weight | Summary |
|---|---|---|
| **Terrified** | 40% | Complies fast, fumbles, cries |
| **Pleading** | 20% | Complies slowly while begging, tries to keep some money |
| **Liar** | 15% | Claims the drawer is empty; complies when pressured |
| **Defiant** | 15% | Refuses, argues; may pull a lathi or old shotgun if the tell is ignored |
| **Frozen** | 10% | Locks up in shock; needs the player's shout to snap into compliance |

### Beats

| # | Time | Shopkeeper | Customers / world | Player / camera / audio |
|---|---|---|---|---|
| 1 Entry | — | If the player enters with a gun already drawn: Startled immediately (skip to 3). Otherwise C1 beats 1–3. | Normal | — |
| 2 Draw | 0.0 s | The player aims at the shopkeeper. **Startled:** a full-body flinch, the stool scrapes back, the newspaper drops (falls with physics), brows fly up, jaw drops, a gasp. | Customers startle at once (each with their own flinch timing 0.1–0.4 s). | Soft framing begins; the radio keeps playing (irony), the fan hum stays. A low drone starts in the score. |
| 3 Realization | 0.4–1.5 s | His eyes lock on the gun barrel (pupils dilate), then flick to the player's face. Hands rise slowly to shoulder height, palms out, fingers spread and **trembling**. He stands up. Line: "Arre baap re… bhai, bhai, ruko!" | A customer drops a soap bar or packet (physics). An aunty gasps "Hai Ram!" and covers her mouth. | The intimidation meter appears (a thin ring around the crosshair). |
| 4 Command | Player | The player presses **E (hold) "Paise de!"** ("Give me the money!") or **Q "Haath upar!"**. Each shout gives fear +0.15 and a flinch. | — | The player's character barks the line, with arm gesture animation (pointing the gun toward the drawer). |
| 5 Turn to the galla | 1.5–2.5 s | Keeping his eyes on the player (head turned to the player, body turned to the drawer: a split look-at), he lowers one hand slowly toward the drawer. **He says what he's doing:** "Galla khol raha hoon… dekho, dheere se…" ("I'm opening the drawer… look, slowly…"). | Customers back toward the walls, hands up. | — |
| 6 Open the drawer | 2.5–3.2 s | Hand IK to `drawerHandle`; the drawer slides out (rattle of coins). Fumble check: on failure the drawer jams and he yanks it twice. | — | The camera's soft framing includes the counter top. Optional Scenario Cam: a close-up of the drawer opening (≤ 1.2 s). |
| 7 **Placing the cash on the counter** (a loop) | Each bundle 1.0–1.8 s | For each bundle: reach into the drawer → grip (finger curl) → lift → glance up at the player → carry it to the next free `counterTop` slot → place it (hand opens; the bundle settles with a soft thump) → pull his hand back quickly to "hands visible". **Fear speeds him up and adds tremor; fumbles drop bundles or spill coins.** On a fumble: "Sorry, sorry, haath kaanp rahe hain…", and he either picks it up (Pleading/Liar types) or freezes looking at it (Terrified). | — | Each bundle placed adds a little to the intimidation ring. A ₹ counter in the HUD previews the total on the counter. |
| 8 Bundle count | — | Total bundles = 3 + floor(intimidation × 6) (shop tier scales the ₹ per bundle: ₹2,000–₹10,000). Pleading/Liar types **hold back the last bundle** (see branches). The final action: he slides the loose coins forward with a flat palm, then steps back from the counter with both hands up. | — | — |
| 9 Pick-up | Player | The player walks to the counter and holds E. Each bundle travels from the counter to the player's hand and then into their pocket (a quick animation per bundle; hold E for all). A floating "+₹X" appears for each, with the cash-register sound. The player can also **shoot the ceiling** (fear +0.4, plaster dust falls, the fan wobbles, customers scream and crouch, he drops to his knees). | — | — |
| 10 Leaving | Player | When the player turns away: his eyes follow them, he stays frozen with hands up until the player is 4 m away. | The customer nearest the door may try to slip out early (see branch B5). | — |
| 11 Aftermath 0–10 s | After the player exits | His hands come down slowly, he leans on the counter and **breathes heavily** (chest scale), wipes his forehead (sweat decal), looks at the empty drawer and closes it. Then he picks up the cordless phone and dials (a phone call animation). If civicDuty ≥ 0.4, this is a police report (with the player's description). | A customer comforts him (a hand on his shoulder). | — |
| 12 Aftermath 10–40 s | — | Comes out onto the footpath and **shouts "Chor! Chor! Pakdo usko!"**, pointing in the player's direction ("Udhar bhaaga, laal shirt wala!", using the player's actual shirt color). | Neighbor shopkeepers come out; 3–6 passersby gather (Curious state); 1–2 brave pedestrians chase the player on foot for 20 m; **neighbor shops pull their shutters down** (rattle sounds ripple down the street). | Wanted level is applied according to the reports (see outcomes). |
| 13 Aftermath 40–120 s | — | Sits on the shop step with his head in his hands (Shocked → Grieving), talking to the crowd. | A police jeep arrives if reported; a constable takes his statement (a notepad animation); the crowd points. | — |

### Branches

- **B1 Liar:** at beat 6 he opens the drawer only halfway, showing a few coins: "Galla khaali hai, sach mein!"
  - The player shouts again or steps closer → fear +0.3, his face cracks, and he pulls out the **hidden bundle
    from under the drawer tray** (an extra ₹ bonus).
  - The player hesitates for 4 s → he relaxes slightly (fear −0.1) and the meter drains.
- **B2 Pleading:** he places bundles slowly while talking constantly ("Bhagwan ke liye… mere bachche hain ghar
  pe"), and palms the last bundle back toward the drawer. If the player shouts, he gives it up with a sob.
- **B3 Defiant:**
  - Beat 3 becomes: brows down, he stands up tall, "Tere jaise bahut dekhe hain. Nikal yahan se!"
  - **Tell:** he glances at the space under the counter twice (A3 gaze rules).
  - If the player closes in to within 1.5 m or shoots near him → he breaks into fear and complies (with a
    resentful face: brows still down and jaw clenched, but hands trembling).
  - If the player ignores the tell for 3 s → he **ducks and pulls a lathi** (melee fight) **or an old
    single-barrel shotgun** (a 20% chance; he stands up with the gun shaking, so his accuracy is low).
  - Neutralizing him puts him on the floor, wounded and groaning; you then open the drawer yourself (beat 7
    done by the player at their own speed).
- **B4 Frozen:** no response to the first command (eyes wide, mouth open, not moving, slow blinks). The player
  must shout Q or point closer → he snaps out of it with a gasp and switches to the Terrified track.
- **B5 Customer escape:** a customer edges toward the door (sidling, glancing at the player).
  - The player aims at them or shouts → they freeze and raise their hands.
  - If they get out → they run, screaming, and become a witness who calls the police 5–8 s later.
  - The player can **pull the shutter down from the inside** (E at the shutter) to stop anyone leaving. Fear
    rises for everyone inside, the room goes dimmer, and the "trapped" lines play.
- **B6 Panic button / CCTV** (shops after the Recovering state, and the jewelry store): if he glances at the
  panic button and the player doesn't stop him, he presses it with his knee (a subtle animation) → a silent
  alarm, police arrive in 45 s. Shooting the CCTV camera removes the guaranteed identification.
- **B7 Player lowers the weapon midway:** fear decays, he stops placing bundles and may shout for help (if
  courage > 0.5).
- **B8 Player shoots the shopkeeper:** wanted +2 extra, customers scream and flee or hide, the aftermath has no
  shout from him; customers shout instead. The money already on the counter remains; the rest of the drawer can
  be looted by the player.

### Outcomes
- Money: the bundles actually picked up (cash left on the counter stays there and becomes evidence the police
  pick up).
- Wanted: report-based (A6 of the main spec): 2 stars once reported, +1 if a shot was fired, +2 if anyone was
  hit.
- Memory: the shopkeeper and every customer remember the player's face for 7 in-game days (`grudge` 0.9).
- World: the shop goes into the Robbed state (A8).

### 1 day later (revisit)
- He sees the player at the door → **Startled → Afraid**: ducks behind the counter, "Tu… phir aa gaya? Jaa
  yahan se!" and reaches for the phone; or (Defiant) shouts and picks up the new lathi.
- A newly hired watchman (adult, khaki uniform, plastic chair outside) stands up and blocks the door.
- The player can't buy anything here until the grudge decays.

---

## C3. Unarmed intimidation robbery (fists only)

The same beats as C2, except:
- The player has to **close the distance** (within 1.5 m) and press E to grab the shopkeeper by the collar (a
  paired animation over the counter). Intimidation builds only while the collar grab is held.
- Personality weights shift: Defiant 40% (unarmed robbers are less scary).
- A defiant shopkeeper shoves back and a **fistfight** starts; customers may join in (each brave customer
  with courage > 0.7 joins).
- If the player wins the fight, the shopkeeper complies from the floor, pointing at the drawer: "Le ja… le ja…".

---

## C4. Robbery gone wrong — the bazaar closes in

Triggered when a shot is fired inside a shop on a busy bazaar street, or when the robbery lasts more than 40 s.
- **Shutter contagion:** every shop within 40 m pulls its shutter down in a ripple outward, 0.3–1.2 s apart.
  NPCs duck inside first. The street empties within 15 s; stalls are abandoned (prop carts left behind).
- Vendors' carts are left in the road, so the player's escape route by car is obstructed (they're physics
  props).
- A **crowd mob** forms when the player is on foot and wanted ≤ 2: 4–8 brave NPCs approach with sticks or bare
  hands, shouting. The player can fire in the air to scatter them (fear contagion), or fight.
- A local beat constable arrives on foot first (whistle blowing, lathi raised) within 30 s, then the police
  jeep.

---

## C5. Paan stall robbery (street stall, not an enterable interior)

**Fix the current build:** "BANARASI PAAN" is labeled a restaurant. It should be a **gumti stall**: a raised
wooden platform 1 m off the ground under a tin canopy, a mirror and photos on the back wall, a glass jar rack
of mukhwas and candies, a betel leaf stack under a wet red cloth, small steel bowls of katha and chuna, a
hanging cigarette display, an incense stick holder, and a dangling lighter on a string.
**Actors:** the *paanwala*, sitting cross-legged on the platform folding a paan; 2–4 men standing around
chatting and smoking; a small radio playing cricket commentary (procedural murmur crowd with cheers).

| # | Beat | Detail |
|---|---|---|
| 1 | Gun drawn | The paanwala is mid-fold: his hands **freeze holding the half-folded leaf**. The loiterers scatter at different speeds (one drops a cigarette, which bounces with sparks). One man stays frozen with his hands up. |
| 2 | Command | He puts the leaf down carefully (even in fear, a habit), wipes his red-stained fingers on a cloth, raises his hands. "Bhai… chhota dhanda hai, kya milega?" ("Brother… it's a small business, what will you get?") |
| 3 | Tin box | He turns to the tin cash box behind him, opens the lid (hinge creak), and takes out **crumpled notes and coins** (not bundles) — ₹300–₹1,800 total. He places them on the **platform edge in front of the player** in small handfuls, coins spilling and rolling off onto the road (the player can collect them). |
| 4 | Extra | If intimidation is high, he also takes off his **gold ring** (a fumbling twist animation) and puts it on the pile (+₹ via the pawn shop). |
| 5 | Aftermath | The loiterers come back within 10 s and gather around; he narrates loudly with big gestures; the cricket commentary keeps going. |

---

## C6. Jewelry store robbery (Zaveri-style showroom, high-tier interior)

**Setting:** *Shree Ganesh Jewellers*, a 6 × 10 m air-conditioned showroom (glass door with an AC air curtain
sound), mirrored walls, velvet-lined glass display counters in a U shape, a seated customer area with stools,
a back office with a safe, CCTV in two corners, a uniformed **armed security guard** (adult, old revolver) on
a stool by the door, 3 salesmen in shirts, and an owner in the back office.

| # | Beat | Detail |
|---|---|---|
| 1 | Entry | The guard eyes the player (head IK tracking). If the player is wanted ≥ 1, he stands and blocks the door: "Ruko, andar nahi." ("Stop, you can't come in.") |
| 2 | Draw | Whoever reacts first: the guard (courage roll). If he draws, a shootout begins; if the player covers him first: "Bandook neeche! Neeche rakh!" → he puts the revolver on the floor slowly with a shaking hand, kicks it over when told, and lies face down. |
| 3 | Room control | The intimidation meter is now **room-wide** (sums the fear of everyone in the room). Each salesman and customer has their own reaction (crouch, hands up, crying, one attempts the panic button — B6 tell). |
| 4 | Smash | The player smashes display counters (melee or a gun butt): glass shards fly as physics with a sparkle shader; trays of necklaces, bangles and rings spill. Each case takes 3 hits (the first cracks it, the second spider-webs it, the third breaks it). |
| 5 | Grab | Holding E sweeps the jewelry into a duffel bag (pieces move into the bag along curves). Each case is worth ₹40,000–₹2,00,000. The bag on the back gets visibly fuller. |
| 6 | Safe (optional) | Drag the owner from the back office (a paired arm-grab) to the safe. He fumbles the combination dial under fear (a fumble animation; each failed attempt costs 3 s; shouting reduces his fumble chance by scaring him into focus, but over-scaring increases it — **a sweet spot mechanic**). The safe door swings open: gold biscuits and cash bundles. |
| 7 | Timer | A silent alarm (if pressed) or the CCTV → police in 60–90 s; the score's tempo rises; outside, a crowd gathers at the glass looking in. |
| 8 | Exit | The air curtain whooshes; 3 stars minimum. |

---

## C7. Night break-in (closed shop)

| # | Beat | Detail |
|---|---|---|
| 1 | Shutter | Locked with a padlock at the bottom. The player needs a crowbar (hardware shop) or shoots the lock (loud). |
| 2 | Pry | A crowbar minigame: hold to apply force, with metal creaking and a sweet spot to hit; too much and it slips with a loud clang (noise radius 30 m). |
| 3 | Watchman | A building watchman (adult, sleeping on a plastic chair with a radio) may wake up from the noise: rubs his eyes, stands, swings a torch beam. Stealth: crouch out of the torch cone, or intimidate him (he complies, sits down with his hands on his head), or he blows a whistle (alerts the street). |
| 4 | Inside | It's dark; the player can turn on the tube light (risky; visible from outside) or use a phone torch (a flashlight cone). The galla is locked: pry it open (loud) or find the key on a nail behind the altar (a hint for observant players). |
| 5 | Street dogs | Stray dogs (procedural quadrupeds) bark at the player at night, raising the noise level. |

---

## C8. Carjacking — vehicle-by-vehicle scenarios

Common rules: the paired-animation alignment (A4); the driver's emotional arc is Startled → (personality) →
Aftermath; traffic behind the car **honks** (density scaled to how Mumbai traffic actually sounds); onlookers
stop and stare.

### C8.1 Kaali-peeli taxi (black-and-yellow cab, original model "Padmavati")
| # | Beat | Detail |
|---|---|---|
| 1 | Approach | The car is stopped at a signal or crawling. The driver (adult, khaki uniform) has his arm out of the window and is chatting with a passenger. |
| 2 | Yank | The player opens the driver's door (the door swings with a hinge creak), grabs his collar and shirt with both hands (paired). **Driver Startled:** eyes wide, he grips the steering wheel with both hands for a beat (a tug-of-war — the player pulls twice), then lets go. |
| 3 | Out | He's thrown out onto the road and lands rolling (a partial ragdoll, then he scrambles up). His cap falls off and stays on the road as a prop. |
| 4 | Passenger | A passenger in the back screams, grabs her bag and scrambles out of the far door (the door is left open). If the player drives off immediately, the open door swings and **slams shut** with acceleration physics. |
| 5 | Personality | Coward (55%): backs away with his hands up, "Le ja, le ja!" Angry (35%): runs alongside the car hitting the roof with his palm, shouting, for up to 3 s at speed below 15 km/h. Brave (10%): grabs the player through the window — a struggle QTE; failure means the player is pulled out. |
| 6 | Aftermath | Stands in the road with his hands on his head; flags down another taxi, pointing after the player; calls the police. His colleague drivers nearby (the taxi stand) gather. |

### C8.2 Auto-rickshaw (3-wheeler, no doors)
- The driver sits in the middle. The player grabs him from the **side opening**: the driver clings to the
  handlebar and the roof frame. If the player throttles before he's fully out, he's **dragged 2–4 m**, holding
  on with his legs trailing, then lets go and rolls.
- Passengers (up to 3, squeezed in the back seat) tumble out of both open sides.
- The auto has a meter that keeps ticking (a sound and a display prop) — a small detail that sells it.

### C8.3 Private car with an occupant couple
- Doors may be locked (35%): the player **taps the window with the gun** first: the driver freezes; fear makes
  him unlock it with a shaking finger (a hand IK onto the lock). Or the player smashes the window (glass
  shatter, the driver cowers away from the glass, arms up).
- The passenger: Panics and runs (60%), Stays frozen until the player gestures (25%), or Hits the player with a
  handbag (15%; the player flinches).
- The driver may offer money instead: "Kitna chahiye? Le lo, gaadi chhod do!" ("How much do you want? Take it,
  leave the car!") → **a choice prompt**: accept the wallet (₹2,000–₹15,000, no car) or take the car.

### C8.4 Motorbike with a pillion rider
- The player kicks the bike or shoves the rider: both fall (the bike slides and sparks), the riders ragdoll and
  get up limping. Helmet physics (the helmet may come off and roll).
- The pillion rider shouts and helps the rider up; both chase on foot for a few meters.

### C8.5 Luxury sedan with a chauffeur and a businessman in the back
- The chauffeur protests politely ("Saab ki gaadi hai, bhai…" — "It's sir's car, brother…") and complies with
  a terrified face.
- The businessman in the back: first **outraged** (Angry: "Jaanta hai main kaun hoon?" — "Do you know who I
  am?"), then, when the gun turns to him, abruptly **terrified** (an emotion snap over 0.3 s), fumbling with
  his seat belt (a fumble animation), dropping his phone.
- He offers his gold watch and chain, taking them off with trembling hands (a fumble twist on the watch clasp).
- Aftermath: he immediately makes a phone call; this car has a **GPS tracker**, so police get the car's
  location until it's resprayed or swapped.

### C8.6 Truck driver (tough)
- Courage is high: he climbs down with a tire iron. A melee fight. If the player wins, he complies from the
  ground, holding his ribs.
- The truck's cabin is high, so the player needs a climb-up animation (2 handholds and a step).

### C8.7 Police jeep
- Only if parked and empty, or after a fight. Stealing it gives an instant 2 stars, the police scanner radio,
  and the lights and siren (H). Other drivers pull over for you (until the police identify the stolen jeep
  within 60 s).

---

## C9. Street mugging

| # | Beat | Detail |
|---|---|---|
| 1 | Target | A pedestrian on the footpath, using a phone or carrying a bag. |
| 2 | Draw | Startled: the phone drops (screen cracks on impact — a decal swap); hands go up. |
| 3 | Command | E "Nikaal!" ("Hand it over!"). They pat their pockets frantically, pull out the wallet, open it and **offer the cash only** first (₹200–₹3,000, notes held out in a trembling hand). |
| 4 | Pressure | The player shouts again → they hand over the whole wallet, then take off a gold chain (the clasp fumble animation behind the neck), and a watch. |
| 5 | Bystanders | Pedestrians within 15 m react: most cross the road away, one films from a distance (holding the phone up — a witness), one brave uncle shouts "Ae! Chhod usko!" and approaches with an umbrella. |
| 6 | Release | When the player leaves: the victim walks away fast, looking back repeatedly, then breaks into a run; at 30 m they shout for help. |

---

## C10. Police interactions

| Scenario | Detail |
|---|---|
| **Traffic constable at a junction** | Stands on a podium with a whistle. When the player runs a red light in front of him, he blows a sharp whistle and points; if wanted 0, he writes a mental note (a fine of ₹500 the next time he catches the player on foot); at wanted ≥ 1, he radios it in (a shoulder radio animation). |
| **Being pulled over** | A patrol bike flags the player with a hand wave. If the player stops: the officer walks up, leans on the window, and asks for a license. Options: comply (a fine), **bribe** (a choice; may work by officer personality and wanted level; refusing a bribe as an honest cop adds 1 star), or floor it. |
| **Foot chase in the bazaar** | The constable chases with a lathi raised, blowing his whistle in bursts; vendors shout and point the way; crowds part with stumbles; carts and fruit crates topple. The constable vaults low obstacles more slowly than the player and runs out of stamina (hands on knees, panting) after 40 s. |
| **Arrest (busted)** | The player is pushed against a wall or car hood (paired), hands behind the back, a short walk to the jeep, the head pushed down entering the jeep. A cut to a lock-up cell (an interior with a tiny barred window): the player wakes up, a havaldar bangs on the bars, release paperwork; you pay a fine and lose weapons. |

---

## C11. Crowd, witnesses & emotional contagion (applies everywhere)

- Each NPC broadcasts its emotion within a 10 m radius; listeners receive `emotion × 0.4 × (1 − composure)`
  per second, so panic spreads realistically through dense crowds.
- Panic flight uses the navmesh with stumbles (a 5% chance of tripping in dense crowds; others step around or
  over them) and **footwear left behind** (a dropped chappal prop) — a small touch.
- Crowds gather **after** the danger has passed (the curiosity state): a ring of onlookers at 4–6 m, people
  standing on their toes and craning their necks, someone narrating to new arrivals.
- Phone filming: Curious NPCs hold their phones up; the player can intimidate them to drop their phones
  (removes those witnesses).

---

## C12. Normal-life scenarios (so the world isn't only crime)

Each of these is a short beat graph so the city feels alive and gives the crime scenarios contrast:
- **Chai tapri:** the chaiwala pours chai from a height between two vessels (a long stream animation), serves
  cutting chai in small glasses, customers sip and chat; the player can buy chai (+health).
- **Vada pav stall:** frying in a big kadhai (oil bubble particles, sizzling audio), the vendor hands a vada pav
  wrapped in newspaper.
- **Barber (saloon):** the chair swivels, a cape goes on, the haircut has a mirror camera; the post-shave head
  massage is the barber's signature (a comedic, rapid head-tapping animation).
- **Chemist:** the pharmacist reads the slip, climbs a stool for a high shelf, writes the price on the strip.
- **Mobile repair shop:** a technician with a loupe on his eye, phone parts on a mat, a soldering iron with a
  smoke wisp.
- **Street cricket in a gully** (adults only): a stumps-and-crate wicket; the ball can roll into the road and
  stop traffic.

---

# PART D — Build order (one pack per session)

| Pack | Contents | Why first |
|---|---|---|
| **1** | A1 Interior system + A2 prop kit + C1 (enter the Kirana store and buy) | Everything else happens inside these rooms |
| **2** | A3 Face & emotion + A4 hand IK, attach/detach, fumble + A5 dialogue + A6 Scenario Director | The core of "scared with emotion" |
| **3** | C2 Armed shop robbery with all branches B1–B8 + A7 camera + A8 memory | The flagship scenario; use it to tune everything |
| **4** | C3, C4, C5 (and fix the paan stall's category), C9 | Reuse of the Pack 3 machinery |
| **5** | C8 Carjacking (all 7 vehicle types) | Paired animations at scale |
| **6** | C6 Jewelry store, C7 Night break-in | High-tier interiors and stealth |
| **7** | C10 Police interactions, C11 Crowd contagion polish | Systemic reactions |
| **8** | C12 Normal-life scenarios, plus 6 more shop interiors (chemist, mobile shop, Irani café, clothing, barber, hardware) using the template in Part B | Fills out the world |

---

# PART E — Acceptance tests (Playwright + Vitest)

For every scenario and branch:
1. **Beat order:** `ScenarioDirector.log` contains every required beat in order, with timings inside the
   specified windows (±20%).
2. **Physical truth:** for C2, each cash bundle's world position goes drawer → hand → counter slot → player;
   no bundle is ever more than 2 cm from the hand bone while attached; every counter-top bundle rests within
   1 cm of the counter surface (no floating, no clipping).
3. **Emotion:** the shopkeeper's `fear` exceeds 0.7 by beat 5 in the Terrified branch; tremor amplitude > 0;
   the face's `browInnerUp` is above 0.6 during beats 3–9.
4. **Gaze tell:** in the Defiant branch, at least two glances at the hidden-weapon point happen before the
   draw.
5. **Contagion:** in C4, at least 80% of shutters within 40 m are closed 5 s after the gunshot.
6. **Persistence:** after save → reload and +1 in-game day, the robbed shop is in the Recovering state and the
   shopkeeper's memory record has grudge > 0.5.
7. **Screenshots:** every beat flagged with a camera/face requirement saves a screenshot to
   `/screenshots/<scenario>/<branch>/<beat>.png`. Claude Code reviews these and writes `REVIEW.md` noting
   anything unreadable (a face too small, hands not on objects, z-fighting, wrong lighting).
8. **Performance:** the C2 scenario with 3 customers inside, plus the street outside, stays ≥ 55 FPS on High.
   Draw calls inside the interior ≤ (exterior count after culling + 150).
