---
name: model-skill
description: The maiaCITY model skill — props, vehicles, tents, equipment and furniture in the Models library (src/lib/models, /app/models): where a model lives (LIST, HISTORY, REAL_SIZES and the size test), versions that never break a game (a version argument or a new builder under the same id, fingerprints), size as a measure never a scale (one table of measures per design), models that pitch, open and build in named steps (setPitch, setOpen, setBuild, work), parts and the catalog the viewer picks, explodes and plays, walking in (userData.walk, headroom), lamps and night glow, and what went wrong once. Use it whenever a model is built, upgraded, resized, taken apart or handed to a game. Part of asset-producer.
---

# Models: what we learned building them

The conventions every model keeps (origin on the floor, back towards −z, shared materials, seeded randomness, handles
in `userData`) are in `production-designer`'s `models.md`. This skill is what building the V1 props, the pickup, the
dome, storage and bell tents taught us on top of them.

## Where a model lives

- A builder in `src/lib/models/*.js` (new code in JavaScript; older files are TypeScript), one file per family:
  `village.js` (pickup, loading ramp, solar panel), `planting.js` (backpack, bottle, seed packets, plant stake, dug
  earth), `tent.js` (dome and storage tent, their bags), `belltent.js` (bell tent, fire place, bag), `wayside.js`.
- A line in `LIST` in `src/lib/models/index.ts`: `{ id, label, note, usedIn, make, variants }`. The note says what it
  is and its measures in words; variants are the same builder with other options (`{ pitch: 0.5 }`, `{ open: 1 }`).
- Its versions in `HISTORY` there (`src/lib/app/versions.js`): `{ ...FIRST, date, note, build }` for v1, then
  `{ v, date, note, build }`; the newest entry has no `build`, the `LIST` `make` builds it.
- Its real size in `REAL_SIZES` (`src/lib/models/units.js`) and its builder in the `BUILD` map of
  `src/lib/models/sizes.test.js`. Write sizes as `1.8 * M` or `686 * MM`; the test allows 12 %.

## Versions without breaking anyone

- A game imports a builder by name and keeps building what it built until its own thread switches. So an upgrade
  never changes what an existing call returns: either the builder takes a version (`pickup({ v: 2 })`,
  `batteryPack(v)`, `human(look, h, v)`) and the old branch stays exactly as it was, or the old export stays as it is
  and the new one gets a new name under the same Models id (`domeTent` v1 and `storageTent` v2 of `dome-tent`).
- When a refactor touches an old builder (making its size a parameter, sharing a helper), fingerprint it before and
  after (`asset-producer`'s `checking.md`): the hash of every attribute must not change.
- One step at a time: Samuel asks for an upgrade, it becomes one version with one dated note. Never fold two asks into
  one version.

## Size is a measure, not a scale

- Never `scale.set` on a model's root to resize it. A bigger kind is its own builder or its own measures: a crawler
  excavator is a different machine, never a mini scaled up.
- When a model really is the same design at another size (the storage tent is the dome tent twice as big), put its
  measures in one table (`DOME_TENT`, `STORAGE_TENT`) and let the builder take the table: every length inside scales
  from it (`S = r / DOME_TENT.r`: tubes, hubs, zip, lamp, its light's reach), and what must not scale stays absolute
  (the deck is still 15 cm high, a door is sized for people and things, not by the factor).

## Built to be pitched, opened, played

- A model that is put up, opened or built takes one number for how far (`{ pitch }`, `{ open }`, `{ built }`) and
  reshapes in place through `userData.setPitch(k)` / `setOpen(k)` / `setBuild(k)`, so a game can play it over seconds.
- Its steps are named ranges in its measures (`BELL_TENT.steps = { groundsheet: [0, .12], canvas: [.12, .2], … }`):
  the game, the viewer and the catalog all read the same table.
- `userData.work(k)` gives the point being worked on at `k`, so a game can put a person's hands there.
- Parts that only exist at some steps are hidden, never left inside another part.

## Taken apart: parts and the catalog

- Each part is a group tagged `userData.part = id`; the model lists them in `userData.parts` and moves them apart
  with `userData.explode(k)`.
- `userData.catalog = { assemblies, parts, steps, ranges, sources, play, seconds }` names them, groups them, says
  which step each belongs to and where its facts come from. With it, the Models viewer picks a part on tap, shows it
  alone, explodes the model and plays or scrubs its steps (`src/lib/app/ModelsView.svelte`). The actors' version of
  the same idea is in `actor-skill`.

## Walked into, lit at night

- `userData.walk = { x, z, yaw, r, door, headroom, colliders, canStand(x, z, …), floorAt, lamps }` lets the walker go
  in. A sloped wall needs `headroom` (the bell tent's 1.3 m from the pole), or the head passes through the canvas
  while the feet are still inside.
- `userData.lamp` (the light) and the glowing material (`userData.canvas`, `userData.shell`) let a game light it at
  night; a lamp's reach scales with the model.

## Things that went wrong once

- A rod along a rolled door edge read as a straight cylinder hidden by the canvas: follow the edge with short
  segments and spheres at their joints.
- A tent's pole poked through the draped canvas: lift the canvas over the pole's line, not the pole down.
- `Box3` counts invisible meshes, so a hidden part still grows the size test's box; after moving vertices reset
  `geo.boundingBox = geo.boundingSphere = null` and recompute the normals.
- The pickup was once drawn twice its size and looked absurd beside the van: that is why one measure is a law.
- Research the real product first: its maker's measures, its CAD where it is open (Open Source Ecology's GitHub when
  their wiki is blocked by the cloud proxy). Never name the brand or startup that inspired an asset.
