# PROGRESS.md

Scenario packs from `SCENARIOS.md` Part D. Engine milestones live in `CLAUDE.md` §9; perf numbers in `docs/PERF.md`.

## Pack 1: interiors + prop kit + C1 (done, 2026-11-20)

- Laxmi General Stores, a walk-in Kirana shop on the bazaar street (first north-side building, next to the spawn). Open 08:00–22:30; shutter down and locked outside hours.
- C1 complete: approach → threshold → greeting → newspaper down → browse and pick up (E) → put on the counter → prices read aloud → tally → total → optional haggle (hold Q) → pay (E) → ₹500 counterfeit check → galla open → change counted coin by coin → hip-bump close → change pocketed → bagging → paired bag handoff → "Aur kuch?" → back to his paper on exit.
- Variants: phone call ("ek minute"), evening incense at the altar, and a browsing customer.
- Tests: `src/gameplay/shop/KiranaScenario.test.ts` (beat order, drawer joint, coins as objects, items in hand, counter rest, hand-attachment gap, handoff alignment, both variants), `ShopTransaction.test.ts`, `ArmIK.test.ts`. 69 tests total, all passing.
- Screenshots: `screenshots/c1-kirana/{none,phone,incense}/`. Review notes are in `REVIEW.md`.
- Perf: the interior is 55 visible meshes, about 132 draw calls with shadow and depth passes (≈170 while the drawer is open). Street views through the door stay within exterior + 150.

### Open items carried forward

- C1 crowded-queue variant (customer cutting in line).
- Face reactions (brows, eyes) in C1 wait for Pack 2's face rig.
- Coins and notes are placed, not physically simulated (bounce, scatter) yet.
- The whole bazaar street is already near the 1,500 draw-call budget (≈1,350–1,550 at the busiest views); a street-level batching pass is still owed.

## Next: Pack 2 (A3 face & emotion, A4 fumbles/fingers, A5 dialogue polish, A6 beat graphs)
