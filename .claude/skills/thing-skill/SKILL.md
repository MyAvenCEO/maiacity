---
name: thing-skill
description: The maiaCITY thing skill — the still things the worlds are built from (props, tents, equipment and furniture) in the Things library (src/lib/models, /app/models; the code keeps the name models): where a thing lives (LIST, HISTORY, REAL_SIZES and the size test), how it is built (a new one with $lib/assets so the Things viewer and every other asset read it; size as a measure never a scale; models that pitch, open and build in named steps; parts and the catalog; walking in; lamps at night), how it composes (a thing goes into machines, buildings and worlds by carry or ref), versions that never break a game, checking and the lessons kept. Use it whenever a thing is built, upgraded, resized, taken apart, put into another asset or handed to a game. What works by moving parts is a machine (machine-skill); people and animals are actors (actor-skill). Part of asset-producer.
---

# Things: the still things worlds are built from

The Things are the still models. The app was called Models; its address (`/app/models`) and the code's names
(`src/lib/models`, `MODELS`, `ModelsView`) are kept. What works by moving parts — an engine, a vehicle that drives —
is a machine (`machine-skill`, our notes in its `ours.md`); people and animals are actors (`actor-skill`). The laws,
the shared core (`$lib/assets`, refs, one version control) and how we check are the `asset-producer`'s; this is what
the Things taught us on top of them. The conventions every model keeps (origin on the floor, back towards −z, shared
materials, seeded randomness, handles in `userData`) are in `production-designer`'s `models.md`.

## Where it lives

- A builder in `src/lib/models/*.js` (new code in JavaScript; older files are TypeScript), one file per family:
  `village.js` (pickup, loading ramp, solar panel), `planting.js` (backpack, bottle, seed packets, plant stake, dug
  earth), `tent.js` (dome and storage tent, their bags), `belltent.js` (bell tent, fire place, bag), `wayside.js`,
  `containers.js`.
- A line in `LIST` in `src/lib/models/index.ts`: `{ id, label, note, usedIn, make, variants }`. The note says what it
  is and its measures in words; variants are the same builder with other options (`{ pitch: 0.5 }`, `{ open: 1 }`).
- Its versions in `HISTORY` there (asset-producer: one version control).
- Its real size in `REAL_SIZES` (`src/lib/models/units.js`) and its builder in the `BUILD` map of
  `src/lib/models/sizes.test.js`. Write sizes as `1.8 * M` or `686 * MM`; the test allows 12 %.
- Its ref: `things/<id>@<v>`.

## How it is built

### In its parts, with the shared kit

- A new thing, or a new version built from scratch, is built with `$lib/assets` (`assetKit`, `part`, `seal`): `seal`
  writes the Things' handles (`userData.parts`, `catalog`, `explode`, `setBuild`) as well as `userData.asset`, so the
  Things viewer shows it, a machine or a building can carry it, and its parts have cards.
- The older things keep their own handles: each part a group tagged `userData.part = id`, listed in
  `userData.parts`, moved apart by `userData.explode(k)`, named by `userData.catalog = { assemblies, parts, steps,
  ranges, sources, play, seconds }`. With it the Things viewer (`src/lib/app/ModelsView.svelte`) picks a part on tap,
  shows it alone, explodes the model and plays or scrubs its steps.

### Size is a measure, not a scale

- Never `scale.set` on a model's root to resize it. A bigger kind is its own builder or its own measures.
- When a model really is the same design at another size (the storage tent is the dome tent twice as big), put its
  measures in one table (`DOME_TENT`, `STORAGE_TENT`) and let the builder take the table: every length inside scales
  from it (`S = r / DOME_TENT.r`: tubes, hubs, zip, lamp, its light's reach), and what must not scale stays absolute
  (the deck is still 15 cm high, a door is sized for people and things, not by the factor).

### Built to be pitched, opened, played

- A model that is put up, opened or built takes one number for how far (`{ pitch }`, `{ open }`, `{ built }`) and
  reshapes in place through `userData.setPitch(k)` / `setOpen(k)` / `setBuild(k)`, so a game can play it over seconds.
- Its steps are named ranges in its measures (`BELL_TENT.steps = { groundsheet: [0, .12], canvas: [.12, .2], … }`):
  the game, the viewer and the catalog all read the same table.
- `userData.work(k)` gives the point being worked on at `k`, so a game can put a person's hands there.
- Parts that only exist at some steps are hidden, never left inside another part.

### Walked into, lit at night

- `userData.walk = { x, z, yaw, r, door, headroom, colliders, canStand(x, z, …), floorAt, lamps }` lets the walker go
  in. A sloped wall needs `headroom` (the bell tent's 1.3 m from the pole), or the head passes through the canvas
  while the feet are still inside.
- `userData.lamp` (the light) and the glowing material (`userData.canvas`, `userData.shell`) let a game light it at
  night; a lamp's reach scales with the model.

## Composable

- A thing goes into everything bigger: a machine's load (jerrycans in a pickup's bed, a pallet on forks), a
  building's furniture, a world's props. A host built with the kit carries it (`carry`): a thing built with the kit
  brings its parts, an older one comes whole as one part with its card. A world or a building names it by its ref
  (`things/bell-tent@2`, built by `objectAt`) and so keeps it as it was.
- A piece used by several things (a hinge, a zip, a tent pole) is one builder function every thing imports, with its
  own measures, never copied.
- A still thing that starts to move by itself — a vehicle that drives, a door on a motor — becomes a machine; the old
  still thing stays as it was for the games that use it (the V1 travel van and the pickup stay Things while they are
  built again as machines).

## Versions

- A game imports a builder by name and keeps building what it built until its own thread switches. So an upgrade
  never changes what an existing call returns: either the builder takes a version (`pickup({ v: 2 })`) and the old
  branch stays exactly as it was, or the old export stays as it is and the new one gets a new name under the same
  Things id (`domeTent` v1 and `storageTent` v2 of `dome-tent`).
- When a refactor touches an old builder (making its size a parameter, sharing a helper), fingerprint it before and
  after: the hash of every attribute must not change.

## Checking

- The size test, the versions test and the type check (asset-producer's `checking.md`).
- `/app/models` as a mocked admin: the whole, every variant, the parts picked and isolated, explode, every step
  played; the thing in the world that uses it, at the distance it is seen at, by day and at night.

## Lessons kept

- A rod along a rolled door edge read as a straight cylinder hidden by the canvas: follow the edge with short
  segments and spheres at their joints.
- A tent's pole poked through the draped canvas: lift the canvas over the pole's line, not the pole down.
- The pickup was once drawn twice its size and looked absurd beside the van: that is why one measure is a law.
- Research the real product first: its maker's measures, its CAD where it is open (Open Source Ecology's GitHub when
  their wiki is blocked by the cloud proxy). Never name the brand or startup that inspired an asset.
