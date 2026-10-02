# Coverage: the standard shot list

Every scene — Samuel's real ones and the world's — gets a standard set of shots, so the editor can always cut: the place,
the action, the faces, the details, what he sees, and one angle nobody expects. Sizes and angles have names; the shot
list uses them.

## Shot sizes

| Size | Frames | Says |
|---|---|---|
| EWS — extreme wide | the whole landscape, the person a dot | where on earth; scale; isolation |
| WS — wide (the master) | the whole place, the person small in it | where we are; establishes the scene |
| FS — full shot | the whole person, head to feet | the body, how he moves through the place |
| MWS — medium wide ("cowboy") | from the knees up | action and gesture together |
| MS — medium | from the waist up | the action, who is doing it |
| MCU — medium close-up | chest up | talk; the face with its gesture |
| CU — close-up | the face | the feeling |
| ECU — extreme close-up | the eyes, a mouth, a hand | the moment of a feeling or a decision |
| Insert | a thing: a switch, a seed, a page | what matters is this object, now |

## Angles

| Angle | Carries |
|---|---|
| Eye level | neutral, the default |
| High | small, watched, vulnerable |
| Low | strong, rising |
| Overhead, top-down | a map, a pattern, a box seen from above |
| Worm's eye | huge, towering |
| Dutch | something is wrong |
| Over the shoulder (OTS) | we are with him, looking where he looks |
| POV | we are him |
| Profile / three-quarter / frontal | observed / natural / direct address |
| Reverse | the other side of a look |

## Creative angles a crew of one can shoot

- **Through a frame:** the door, the window, the gap in a wine crate, a chair's back (frame within a frame:
  `composition.md`).
- **From inside things:** inside a crate looking out (the crate's slats frame him), from a drawer, from behind the
  radiator's fins.
- **From the floor:** the tripod at its lowest — feet pacing the boards, the bed's edge towering.
- **Top-down:** the bed from above (a stand with a horizontal arm, or the camera on the top crate looking down).
- **A reflection:** the window glass at dusk, a mirror, a phone screen.
- **POV:** the phone at his eyes, his hands doing the thing; or the tripod held against his chest, moving with him
  (`solo.md`).
- **The light as a subject:** the bulb from straight below; the CB60 flaring into the lens; a silhouette against the
  window (contre-jour).
- **The long lens from the far corner** (the tele across the room's 4–5 m): compressed, observed.
- **The world camera's impossibles** — only the twin can: through the ceiling, the whole room top-down as a box, through
  a wall, out through the window into the city (`virtual-camera.md`).

## The standard coverage of one scene

1. **The master** (WS, or EWS outside): the whole place once — the establishing frame.
2. **The medium** (MS or FS): the action and who does it.
3. **Two close-ups** (CU, MCU): the face from two sides (front three-quarter, profile).
4. **Two inserts** (ECU, detail): the hands, the thing.
5. **A POV:** what he sees, from where he sees it.
6. **A reaction** (CU, silent): looking, listening — the editor's most reusable shot (`editor`, `cutting.md`).
7. **One creative angle** from the list above.

**Multiples:** every set-up in two or three takes with a variation (a different move, speed, lens or action); the same
action repeated in every set-up so it can be cut on (`director`, `staging.md`); 2–3 s of handle before and after;
entering and leaving the frame.

**A crew of one covers it from three or four tripod positions:**
- **A — the corner:** the master on the 0.5× or 1×, and the medium on the 2× from the same spot.
- **B — front three-quarter:** the MCU and the close-up on the 1× and 2×.
- **C — low or high:** the inserts and the creative angle.
- **D — handheld or chest-held:** the POV.

Light each position before the first take (`gaffer`).

## Writing it in the shot list

One line per shot: **size · angle · lens · move · light · what it says** — e.g. *WS · high, from the door corner · 0.5× ·
locked, he walks in · afternoon window, bulb off · the box*. In the studio it is a slate on V1 (`kind: 'slate'`, "not
filmed yet") with `script: { scene, label, size, description, notes }` — the size in `size`, the rest in `description`,
the light in `notes` — until the footage replaces it (`director`, `shot-list.md`).
