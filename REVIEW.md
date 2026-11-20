# REVIEW.md: beat screenshot review

## C1 Kirana (`screenshots/c1-kirana/`)

Captured in Chrome (WebGPU, High) with the debug driver `scenario.run('c1-kirana')`, `scenario.holdAt([...])` and a fixed debug camera for beats the gameplay camera can't see (the galla is on the shopkeeper's side of the counter).

| Beat | File | Verdict | Notes / fixes made |
|---|---|---|---|
| Approach | `none/01-approach.png` | OK | |
| Greeting, newspaper down | `none/02-greeting-newspaper-down.png` | OK | Paper lies on the counter, Mr. Shah standing to attend. |
| Pick up from shelf | `none/03-pickup-reach.png` | OK | Tin travels in the right hand at the waist. Fixed: camera had been lifted onto the roof (ground probe started inside the ceiling collider). |
| Price read aloud | `none/04-counter-place.png` | OK | Tin held up at face height, subtitle readable. |
| Total | `none/05-total.png` | OK | |
| Counterfeit check | `none/06-counterfeit-check.png` | OK after fix | Was reaching over his head; now held in front of the spectacles. |
| Galla open | `none/07-galla-open.png` | OK after fix | The drawer slid into his belly; the galla moved to his left side and he now sidesteps to it. Bundles and rubber bands visible. |
| Change on counter | `none/08-change-on-counter.png` | OK after fix | Coins now stacked on the ₹200 note (one scoop); coins enlarged to 2.7 cm. |
| Hip-bump close | `none/09-galla-close-hip-bump.png` | OK | |
| Bagging | `none/10-bagging.png` | OK | |
| Handoff | `none/11-handoff.png` | OK after fix | The bag dipped through the glass top; the hands now meet at 1.38 m and the test measures a 0 cm gap. |
| Phone "ek minute" | `phone/01-ek-minute.png` | OK after fix | Handset was hidden and in the wrong hand; he now reaches for it with IK, holds it to his ear and raises the paper hand. |
| Evening incense | `incense/01-incense-at-altar.png` | OK after fix | He reached backwards; he now turns to face the altar. |

Still weak: no facial expression yet (Pack 2); the incense smoke uses the dark smoke pool and barely reads; the coin stack is small at gameplay distance.
