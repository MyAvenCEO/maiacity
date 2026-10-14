---
name: asset-producer
description: The maiaCITY asset producer — the meta skill over every asset we build. It holds the asset laws (real measure in metres, real numbers from real physics, built in its parts, every upgrade its own frozen version, look at it like a critic), the order of work, how we check (checking.md) and which sub skill to load — model-skill (props, vehicles, tents in the Models library), actor-skill (whatever moves: rigged machines, the stand-in and its face), plant-skill (plants grown from a seed), biome-skill (the floor a world stands on), building-skill (tents, domes, containers, towers), world-skill (worlds and sandboxes, real places), factory-skill (a whole production line as a live 3D discrete event simulation, AirSup's original) and machine-skill (one machine as a photoreal physics simulation with cutaway, explode, break and a film, AirSup's original). Use it whenever any asset is built, simulated, upgraded or shown, or when it is unclear which asset skill a task needs.
---

# Asset producer

One producer, one workshop. Everything maiaCITY builds to be seen — a tent, a pickup, a BatteryPack, a stand-in, a
turbine, a whole factory — runs through the same laws and the same order. The producer keeps the laws and the order;
each craft lives in its own skill, loaded when the work reaches it. It is to assets what `story-producer` is to films.

## The asset laws (never break them)

1. **The real thing at its real size.** One measure everywhere: 1 unit = 1 m (`src/lib/models/units.js`), never a
   `scale.set` on a model's root. A new model goes into `REAL_SIZES` and the `BUILD` map of
   `src/lib/models/sizes.test.js`, so its outer box is checked against the real one (`model-skill`). Research the real
   dimensions, parts and materials before the first line of code (`machine-skill`, step 1).
2. **Real numbers or nothing.** Every number an asset shows comes from a model of how the real thing works — a
   solver (`machine-skill`, `references/solvers.md`) or a simulation (`factory-skill`, `references/des.md`) — with
   real constants, and says where its inputs come from. Never tune an input to get a nicer result; a line that misses
   its target is the finding.
3. **Built in its parts.** An asset is the parts a mechanic would name, in assembly order, each where it really sits;
   nothing floats, nothing clips, every part touches what holds it. Models that can be taken apart carry a
   `userData.catalog` and `userData.parts`, so the Models viewer can pick, isolate, explode and step through them
   (`model-skill`); machine actors have a bone and a card per part (`actor-skill`); plants grow organ by organ from
   their seed (`plant-skill`).
4. **Every upgrade is its own frozen version.** The old builder stays and keeps building exactly what it built (check
   it with a fingerprint of its geometry, `checking.md`); the new one gets the next version, a dated note in the
   library's `HISTORY` and the latest `make`. Games switch when they are ready.
5. **Look at it like a critic.** Render it, read every image, list what is wrong, fix it, render again — whole view,
   close ups of joints, every step of a build or a pitch, at the distance it is seen at, by day and by night where it
   lives (`checking.md`). The pictures go to `/mnt/project-files/<asset>/`.

And always: JavaScript only for new code (never TypeScript); never name the brand or startup that inspired an asset;
an asset never changes a game's story — the game thread takes the new names and decides.

## The workshop — load the sub skill the work needs

Our own sub skills, one per kind of asset, each written from what building them taught us:

| Sub skill | The kind | Use it for |
|---|---|---|
| `model-skill` | the Models library (`src/lib/models`, `/app/models`) | a prop, a vehicle, a tent, a piece of equipment or furniture: built, versioned, resized, pitched, taken apart, walked into |
| `actor-skill` | the Actors library (`src/lib/actors`, `/app/actors`) | whatever moves: a machine rigged in its parts, a combinable kit, the stand-in, its poses and its face |
| `plant-skill` | the Plants library (`src/lib/plants`, `/app/plants`) | a plant, a tree, a crop, a herb or a fungus grown from its seed through its stages to fruit |
| `biome-skill` | the Biomes library (`src/lib/biomes`, `/app/biomes`) | the floor a world stands on: surfaces, cover in colonies, streamed round the eye |
| `building-skill` | the Buildings library (`src/lib/buildings`, `/app/buildings`) | a tent, a dome, a container, a tower: sized, engineered, walked inside |
| `world-skill` | the worlds and sandboxes (`src/lib/worlds`, `src/lib/sandbox-*`) | a world, a sandbox, a real place or a village: the sky, the walker, the film camera, many things drawn cheaply |

AirSup's two, kept original:

| Sub skill | What it makes | Use it for |
|---|---|---|
| `factory-skill` | a whole factory as a live 3D tilt-shift miniature on a real discrete event simulation | sizing a line, finding its bottleneck, "can this line make N a day", a plant or digital twin demo |
| `machine-skill` | one machine, photoreal, physics driven, with cutaway, explode, x-ray, break and a film | "show how X works", an engine, a pump, a mechanism or an instrument as an interactive 3D model or a video |

`factory-skill` and `machine-skill` are AirSup's text word for word (only their `name` changed), not installed: their
tools stay in AirSup's repositories and are cloned into the scratchpad when a step needs them (`SOURCE.md` in each
says how). Keep them original; what we learn goes into our own sub skills, never into them. Where they and ours
differ, our laws win for anything that joins our libraries (real size without a scale, frozen versions, JS modules);
a standalone AirSup page follows its skill as written.

For films, `production-designer` (worlds and sets as a film sees them, art direction) works beside these.

How we check and look, for every kind: `checking.md` (the shot route, Playwright in the container, what to shoot, the
size test, the type check, fingerprints of frozen versions, what we have seen go wrong).

## The order of work

Research before geometry, always.

1. **Research** the real thing: its dimensions in metres, its parts list with materials, the physics that makes it
   work (3 to 6 equations with real constants and its operating point), the one number a viewer cares about, the
   input they want to drive, and what breaks (`machine-skill`, step 1). For a line: product, volume, calendar and the
   route of 6 to 10 stations with real cycle times (`factory-skill`, `references/process.md`).
2. **Pick the skill** from the table. A single machine that a game or film uses goes into our library as a model or an
   actor; a standalone explainer page or a film of a machine is `machine-skill`'s HTML; a production line or a whole
   factory is `factory-skill`'s; a plant is `plant-skill`'s, a floor `biome-skill`'s, a building `building-skill`'s, a
   world `world-skill`'s.
3. **Build** at real size, in its parts, from real materials (never one grey), with the solver or simulation driving
   every motion and number.
4. **Check** (`checking.md`): the size test (`bun test src/lib/models/sizes.test.js`), the type check
   (`npx svelte-check --threshold error`), the skill's own headless check (`factory-skill`'s `check.mjs`), the fruit
   check for a plant (`bun scripts/fruit-check.mjs`), and the fingerprint of every frozen version.
5. **Look** at it like a critic (law 5), at least until the list of faults is empty.
6. **Ship**: one pull request, merged when it is done; the shots in `/mnt/project-files/<asset>/`; the export names,
   versions and shot paths sent to the thread that uses the asset.

## Where an AirSup page joins our assets

`factory-skill` and `machine-skill` each write one self-contained HTML file. Kept as it is, it is a finished
explainer or a film. When the same machine or line must live in our app (a Models entry, an actor in a game, a world),
port its parts and its solver into a JS module beside the others (`src/lib/models/*.js`, `src/lib/actors/*.js`) with
the same measures and equations, then follow the laws above: real size, its parts, a frozen version, the size test.
