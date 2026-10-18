---
name: asset-producer
description: The maiaCITY asset producer — the meta skill over every asset we build: the asset laws (real size in metres, real numbers from real physics, built in its parts, everything composable, every upgrade its own frozen version, look like a critic), the shared core ($lib/assets — AirSup's kit, one part contract, carry and refs group/id@v, one version control and its test, where an asset is kept: recipes and schemas by hash, the box and the device cache, avenDB recipe entries later), the order of work, how we check (checking.md) and which sub skill to load, one per asset group — factory-skill (Factories, AirSup's; ours in its ours.md), machine-skill (Machines, AirSup's; ours in its ours.md), actor-skill (people and animals), world-skill (sandboxes, real places), building-skill (tents, domes, containers), thing-skill (still props, furniture), biome-skill (the floor) and plant-skill (grown from a seed). Use it whenever any asset is built, simulated, upgraded, composed into another or shown, or when it is unclear which asset skill a task needs.
---

# Asset producer

One producer, one workshop. Everything maiaCITY builds to be seen — a tent, a pickup, a BatteryPack, a stand-in, a
turbine, a whole factory — runs through the same laws, the same core and the same order. The producer keeps those;
each craft lives in its own sub skill, loaded when the work reaches it. It is to assets what `story-producer` is to
films.

## The asset laws (never break them)

1. **The real thing at its real size.** One measure everywhere: 1 unit = 1 m (`src/lib/models/units.js`), never a
   `scale.set` on a model's root; a bigger kind is its own builder, never a smaller one scaled up. A new thing or
   machine goes into `REAL_SIZES` and the `BUILD` map of `src/lib/models/sizes.test.js`, so its outer box is checked
   against the real one. Research the real dimensions, parts and materials before the first line of code
   (`machine-skill`, step 1).
2. **Real numbers or nothing.** Every number an asset shows comes from a model of how the real thing works — a
   solver (`machine-skill`, `references/solvers.md`) or a simulation (`factory-skill`, `references/des.md`) — with
   real constants, and says where its inputs come from. Never tune an input to get a nicer result; a line that misses
   its target is the finding.
3. **Built in its parts.** An asset is the parts a mechanic would name, in assembly order, each where it really sits,
   each with its card; nothing floats, nothing clips, every part touches what holds it. New assets are built with
   `$lib/assets` (below); the older ones keep their own way (a thing's `userData.catalog`, a rigged machine's bone per
   part, a plant's organs grown from its seed).
4. **Everything composes.** Samuel (2026-10-14): "all are composeable" — things go into machines, machines into
   factories and buildings, everything into worlds and biomes, and the parts and moving pieces of one asset are
   reused in the others. Never a second copy of a part in another file: import its builder, carry the asset, or name
   it by its ref (below).
5. **Every upgrade is its own frozen version.** The old builder stays and keeps building exactly what it built (a
   fingerprint of its geometry proves it, `checking.md`); the new one gets the next version and a dated note in its
   group's `HISTORY`. Games switch when they are ready. One version control for every group (below).
6. **Look at it like a critic.** Render it, read every image, list what is wrong, fix it, render again — whole view,
   close ups of joints, every step of a build or a pitch, every mode, at the distance it is seen at, by day and by
   night where it lives (`checking.md`). The pictures go to `/mnt/project-files/<group>/<asset>/`.

And always: JavaScript only for new code (never TypeScript); never name the brand or startup that inspired an asset,
nor an engine's maker; an asset never changes a game's story — the game thread takes the new names and decides.

## The shared core: one kit, one contract, one version control

### One kit: `$lib/assets`

AirSup's `kit/lab-kit.js`, ported into the app once for every group. It never scales anything: the studio is scaled
to the asset, never the asset to the studio.

- `kit.js`: the math (`clamp`, `ease`, `approach`, `table`, `rk4`, `fmt`), the measured materials (`MAT`, `mat`), the
  geometry (`GEO.lathe`, `disc`, `rbox`, `gear`, `blade`, `rotor`, `pipe`, `bolts`, `extrude`, `merge`, `ring`), the
  section caps (`CUT`, `LAB_PLANES`), the studio environment, the contact shadow and the flow streaks (`Flow`).
- `parts.js`: `assetKit(root, { assemblies, steps, sources })`, AirSup's `lab.add` as one contract: `part(obj, card,
  how)`, `mesh`, `label`, `onTick`, `carry` and `seal({ lab })`; and `castOf(root)` for the turntable.
- `stage.js`: AirSup's Lab studio and post (softbox environment, key shadow, contact shadow, a floor fading into the
  paper, GTAO, bloom, neutral tone mapping, grade) and its modes: Explode, Cut away, X-ray, Labels, Slow and the
  break.
- `index.js`: every group behind one name, `GROUPS`, `parseRef`, `refOf`, `readRef`, `assetAt`, `objectAt` (below).

### One contract: an asset in its parts

- The root is a plain `Object3D` at real size, standing on y 0, its front towards +z.
- Every part a mechanic would name is a group of real meshes added with `part(obj, card, how)`. The card: `id`,
  `label`, `assembly`, `what`, `moves`, `drive`, `specs`, `source`, `count`, `step`, and `[inferred]` on any number
  that is not measured. How it is shown: `explode` its way out, `xray: 'shell'` for a casing, `tag` a label with a live
  `value`.
- `seal(…)` writes `root.userData.asset` (parts, labels, shells, `explode(k)`, `build(u)`, `tick(dt, env)`, the
  catalog, the lab, the cut) and the Things' handles (`userData.parts`, `catalog`, `explode`, `setBuild`), so the
  Things viewer, the Machines stage, a game and another asset all read the same thing.
- A machine with a solver adds its lab: `hero`, `read`, `controls`, `how { text, eqs }`, `breakIt { label, run,
  reset }`, `cut { a, b, center, reach }`. The Power Cube v3 (`src/lib/machines/powercube.js`) is the worked example.

### Composable: three ways, from the whole to the piece

1. **By ref, anchored.** Any asset at any version has one name: `group/id@v`, with a variant after a colon
   (`machines/powercube@3`, `plants/apple@1`, `machines/powercube@1:powercube-electric`, `things/pickup` for the
   latest). `await assetAt(ref)` gives back its version and its builder, the one the explorer shows; `await
   objectAt(ref, …args)` builds it as one object with its ref on it (`userData.ref`). A world, a building, a factory
   or a film names what it puts in by ref and so stays anchored to it as it was.
2. **Carried, whole.** Inside a host built with the kit, `carry(guest, { at, rot, prefix, assembly, step, explode,
   ref, card })` hangs an asset where it is put. A sealed guest's parts (ids under the prefix), labels, x-ray shells
   and solver join the host's, so the host's catalog, explode, x-ray and cutaway reach into it (a Power Cube in a
   pickup's bed, a pallet on a forklift's forks, a machine in a building); with `explode` it first moves out as one
   unit. Any other object (an older thing, a rigged kind, a plant) comes whole, as one part with its `card`. Every
   part that came with a guest names it by its ref on its card (the turntable shows "Part of machines/powercube@3"),
   and a part keeps the ref it came with when its host is carried in turn. `src/lib/assets/compose.test.js` holds it.
3. **A piece, shared.** A part smaller than an asset (a wheel, a door, a ClickLock, a hydraulic ram) is a builder
   function in one file that every asset needing it imports, each with its own measures. The older rigged machines
   do this by functions that add their parts to another rig (`powerCubeParts`, `forkliftParts`, `clickLockPieces`).

A host's version names the versions of what it carries (cube v8 = packs v7), and carrying a newer guest is a new
version of the host.

### One version control for every group

- Every group lists its kinds with a `HISTORY` by id (`src/lib/app/versions.js`: `FIRST`, `versionsOf`, `versioned`):
  `{ ...FIRST, date, build }` for v1, then `{ v, date, note, build }`; the newest entry needs no `build`, the
  library's own builder is the latest.
- Every older version keeps its own frozen builder: a `*.v<n>.js` file beside the live one, or a version argument
  whose old branch stays exactly as it was (`batteryPack(v)`, `human(look, h, v)`). A version without one is
  `kept: false`, listed for its note and never shown as something it was not; only a world's older versions may be
  notes alone, since a world is a page.
- `bun test src/lib/assets/versions.test.js` holds every group to it: versions in order, dated, every older one kept,
  every one found again by its ref.
- One ask, one step, one version, one dated note. Never fold two asks into one version.

### Where an asset is kept: by hash in the repo, as recipe entries in avenDB

- **Today, everything by hash.** Each asset, version and variant is a recipe file named by the BLAKE3 hash of its
  bytes (`recipes.js`), made for a frozen engine (`engines.json`). Its schemas are frozen the same way
  (`schemas/schemas.json`: `asset.v1.json`, `card.v1.json`); a change to one is a new version beside it. A device loads
  a build (`<recipe hash>?values`) through one door (`load.js`): its own cache first (`cache.js`, keyed by BLAKE3 of
  the engine's hash, the recipe's hash and the values; never synced), else the box runs the recipe on its engine. Either
  way the card is checked against its schema, and our own code rebuilds the data within the box's budgets.
- **Refs name where an asset is kept.** `plants/fern@2` is the repo's;
  `vault:<vault id>/plants/fern@2[:variant][?values]` is a vault's, its version always named (`sources/avendb.js`).
  `readRef` reads both. Every loader (`assetAt`, `objectAt`, `hashOf`, `buildAt`, `loadAsset`, the renderer's `use`)
  refuses a vault's with one error, "avenDB storage is not switched on" (`repoRef`).
- **In avenDB, an asset is one `recipe` entry in the Maia City COOP vault** (avenCEO GmbH's), of avenDB's `Recipe, v1`:
  the code entry base that views and logic share, plus the card (`recipeEntryOf` maps ours onto it). `source` is the
  recipe file byte for byte (at most 200,000 characters), so its BLAKE3 is the hash the card names and every build is
  named by. `engine` is `{ host: 'box', version, hash }` from `engines.json`. `manifest.libs` lists the engine modules
  it requires. `params` has one row for each number parameter; text parameters (a seed, a name) stay in the card and
  the recipe. `contract` holds the box's time limit and the checks a build passes (`hash`, `card`, `budget`). `card` is
  the card of a build at its declared values: a plain object to avenDB, checked by our checker against `card.v1.json`,
  which stays in the repo with the engine. The COOP creates `asset.v1.json` as a `schema` entry of the same bytes
  (avenDB's own test reads it with its parser), so its blob id is the frozen hash.
- **Versions, variants and changes are avenDB's.** `@v` is the point in the entry's history whose card says version v.
  The versions go in in order, each as its recipe file reads in the repo, so a frozen version builds what it always
  built. A variant is an avenDB variant, an entry linked to the version it came from. A change is a proposal merged
  under the vault's policy. Only a new engine capability (a kit op, a material preset, a control kind, a budget) still
  goes in by repo PR.
- **Nothing built is stored.** No meshes and no pictures go into avenDB. A device reads the recipe entry, synced from
  the COOP's vault by its keep shares, checks that its source hashes to its card's recipe and that the engine is one it
  has frozen, and then takes the same path as today: box, checks, our rebuild, its own cache under the same key. A
  build cached from the repo seed is the same build from the vault, because the bytes are the same.
- **Every recipe's card is made in the repo** (`sources/cards.json`, by `bun scripts/recipe-cards.mjs`): the card of
  a build at its own values, as the box hands it back, which the COOP keeps beside the recipe. **After changing an
  asset, run it**: `sources/cards.test.js` fails while a recipe's hash has no card there (only what moved is built).
- **C10 switches it on** (the code architecture plan): `sources/avendb.js` reads the COOP's recipe entry for a vault
  ref (as `game/code/sources/avendb.js` will read code entries), and the loaders hand vault refs to it instead of
  refusing them. Our recipes and the asset schema are copied into the COOP, and the repo copy stays as the offline
  seed. Its gate is a fresh device that draws every world with the seed removed from the bundle. Until then, nothing
  writes to avenDB.

## The workshop: one sub skill per asset group

The asset groups (`GROUPS` of `src/lib/assets/index.js`), one sub skill each, in this order. Machines, actors, things
and plants are shown in avenDB's Assets (`/app/avendb/#assets`; their old addresses redirect there since #943);
factories, worlds, buildings and biomes keep their own pages for now:

| Group | Sub skill | Where it lives | Use it for |
|---|---|---|---|
| Factories | `factory-skill` (AirSup's, our library at its end) and its `ours.md` (ours) | `src/lib/factories/<factory>.js` on the runtime ported into `src/lib/factories`; `/app/factories` | a whole production line as a live 3D miniature on a real discrete event simulation: sizing a line, its bottleneck, "can this line make N a day" |
| Machines | `machine-skill` (AirSup's, our library at its end) and its `ours.md` (ours) | `src/lib/machines/<machine>.js` with `$lib/assets`; the older ones rigged in `src/lib/actors`; avenDB's Assets | what works by moving parts: an engine, a pump, a vehicle, the pod, the LifeTrac, the cubes, the BatteryPack; "show how X works" as a page or a film |
| Actors | `actor-skill` | `src/lib/actors`, avenDB's Assets | people and animals: the stand-in, its poses and its face, the animals of the worlds |
| Worlds | `world-skill` | `src/lib/worlds`, `src/lib/sandbox-*`, `/app/worlds` | a world, a sandbox, a real place or a village: the sky, the walker, the film camera, many things drawn cheaply |
| Buildings | `building-skill` | `src/lib/buildings`, `/app/buildings` | a tent, a dome, a container, a tower: sized, engineered, walked inside |
| Things | `thing-skill` | `src/lib/models`, avenDB's Assets | the still things: a prop, a tent, equipment or furniture, built, versioned, resized, pitched, taken apart, walked into |
| Biomes | `biome-skill` | `src/lib/biomes`, `/app/biomes` | the floor a world stands on: surfaces, cover in colonies, streamed round the eye |
| Plants | `plant-skill` | `src/lib/plants`, avenDB's Assets | a plant, a tree, a crop, a herb or a fungus grown from its seed through its stages to fruit |

Every one of our sub skills has the same shape, so what one group learns is found in the same place in the next:
**Where it lives**, **How it is built**, **Composable** (what goes into it, what it goes into), **Versions**,
**Checking** and **Lessons kept**. A lesson that holds for every group moves up here or into `checking.md`.

`factory-skill` and `machine-skill` are AirSup's text word for word, every text file of their repositories (`SKILL.md`
with only its `name` changed and one section of ours at its end, "Our library", `references/`, `README.md`,
`CONTRIBUTING.md`, their evals and the rest, listed in each `SOURCE.md`). They are not installed: their tools stay in
AirSup's repositories and are cloned into the scratchpad when a step needs them (`SOURCE.md` says how). Keep every one
of their files original but for that section. What we learn goes into our own sub skills, and for machines into
`machine-skill/ours.md`, for factories into `factory-skill/ours.md`. Where they and
ours differ, our laws win for anything that joins our libraries (real size without a scale, frozen versions, JS
modules); a standalone AirSup page follows its skill as written.

For films, `production-designer` (worlds and sets as a film sees them, art direction) works beside these.

## The order of work

Research before geometry, always.

1. **Research** the real thing: its dimensions in metres, its parts list with materials, the physics that makes it
   work (3 to 6 equations with real constants and its operating point), the one number a viewer cares about, the
   input they want to drive, and what breaks (`machine-skill`, step 1). For a line: product, volume, calendar and the
   route of 6 to 10 stations with real cycle times (`factory-skill`, `references/process.md`).
2. **Pick the skill** from the table. A machine that a game or film uses goes into our Machines (`machine-skill`'s
   `ours.md`); a standalone explainer page or a film of a machine is `machine-skill`'s HTML; a production line or a
   whole factory is `factory-skill`'s; a person or an animal is `actor-skill`'s, a still thing `thing-skill`'s, a
   plant `plant-skill`'s, a floor `biome-skill`'s, a building `building-skill`'s, a world `world-skill`'s.
3. **Find what already exists** in every library before building: a part, a piece or a whole asset that is already
   built is carried, imported or named by its ref (law 4), never drawn again.
4. **Build** at real size, in its parts, from real materials (never one grey), with the solver or simulation driving
   every motion and number.
5. **Check** (`checking.md`): the size test, the versions test, the type check, the skill's own headless check
   (`factory-skill`'s `check.mjs`, a machine's solver script, `bun scripts/fruit-check.mjs` for a plant), and the
   fingerprint of every frozen version.
6. **Look** at it like a critic (law 6), at least until the list of faults is empty.
7. **Ship**: one pull request, merged when it is done; the shots in `/mnt/project-files/<group>/<asset>/`; the
   export names, refs and shot paths sent to the thread that uses the asset.

## Where an AirSup page joins our assets

`factory-skill` and `machine-skill` each write one self-contained HTML file. Kept as it is, it is a finished
explainer or a film. When the same machine or line must live in our app (a machine in avenDB's Assets or a game, a
thing, a world; a line in `/app/factories`), port it into a JS module with `$lib/assets`: its parts through `part(...)`
with the same measures and cards, its solver and its lab as they were, its root at real size; a line as its spec on
the runtime ported into `src/lib/factories`, its engine pure with the same equations. Then follow the laws above: a
kind in its library's `LIST`, a frozen version, the size test, the versions test (`machine-skill`'s `ours.md` has the
steps for a machine, `factory-skill`'s for a line).
