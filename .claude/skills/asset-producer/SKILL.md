---
name: asset-producer
description: The maiaCITY asset producer — the meta skill over every asset we build. It holds the asset laws (real measure in metres, real numbers from real physics, built in its parts, every upgrade its own frozen version, look at it like a critic), the order of work, how we check (checking.md) and which sub skill to load, one per asset group, in the dashboard's order — factory-skill (Factories: a whole production line as a live 3D discrete event simulation, AirSup's original), machine-skill (Machines: one machine as a photoreal physics simulation, AirSup's original, with our notes on the Machines library in its ours.md), actor-skill (Actors: people and animals, the stand-in and its face), world-skill (Worlds: worlds, sandboxes, real places), building-skill (Buildings: tents, domes, containers, towers), thing-skill (Things: the still props, vehicles, tents and furniture), biome-skill (Biomes: the floor a world stands on) and plant-skill (Plants: grown from a seed). Use it whenever any asset is built, simulated, upgraded or shown, or when it is unclear which asset skill a task needs.
---

# Asset producer

One producer, one workshop. Everything maiaCITY builds to be seen — a tent, a pickup, a BatteryPack, a stand-in, a
turbine, a whole factory — runs through the same laws and the same order. The producer keeps the laws and the order;
each craft lives in its own skill, loaded when the work reaches it. It is to assets what `story-producer` is to films.

## The asset laws (never break them)

1. **The real thing at its real size.** One measure everywhere: 1 unit = 1 m (`src/lib/models/units.js`), never a
   `scale.set` on a model's root. A new thing or machine goes into `REAL_SIZES` and the `BUILD` map of
   `src/lib/models/sizes.test.js`, so its outer box is checked against the real one (`thing-skill`). Research the real
   dimensions, parts and materials before the first line of code (`machine-skill`, step 1).
2. **Real numbers or nothing.** Every number an asset shows comes from a model of how the real thing works — a
   solver (`machine-skill`, `references/solvers.md`) or a simulation (`factory-skill`, `references/des.md`) — with
   real constants, and says where its inputs come from. Never tune an input to get a nicer result; a line that misses
   its target is the finding.
3. **Built in its parts.** An asset is the parts a mechanic would name, in assembly order, each where it really sits;
   nothing floats, nothing clips, every part touches what holds it. Things that can be taken apart carry a
   `userData.catalog` and `userData.parts`, so the Things viewer can pick, isolate, explode and step through them
   (`thing-skill`); machines have a bone and a card per part (`machine-skill`'s `ours.md`); plants grow organ by organ from
   their seed (`plant-skill`).
4. **Every upgrade is its own frozen version.** The old builder stays and keeps building exactly what it built (check
   it with a fingerprint of its geometry, `checking.md`); the new one gets the next version, a dated note in the
   library's `HISTORY` and the latest `make`. Games switch when they are ready.
5. **Look at it like a critic.** Render it, read every image, list what is wrong, fix it, render again — whole view,
   close ups of joints, every step of a build or a pitch, at the distance it is seen at, by day and by night where it
   lives (`checking.md`). The pictures go to `/mnt/project-files/<asset>/`.

And always: JavaScript only for new code (never TypeScript); never name the brand or startup that inspired an asset;
an asset never changes a game's story — the game thread takes the new names and decides.

## The workshop: one sub skill per asset group

The asset groups are the dashboard's Game Assets (`src/lib/app/places.ts`), one sub skill each, in this order:

| Group | Sub skill | Where it lives | Use it for |
|---|---|---|---|
| Factories | `factory-skill` (AirSup's) | a self-contained page; no Factories app until we build the first | a whole production line as a live 3D miniature on a real discrete event simulation: sizing a line, its bottleneck, "can this line make N a day" |
| Machines | `machine-skill` (AirSup's) and its `ours.md` (ours) | `src/lib/machines`, built in `src/lib/actors`; `/app/machines` | what works by moving parts: an excavator, the pod, the LifeTrac, the cubes, the BatteryPack; "show how X works" as a page or a film |
| Actors | `actor-skill` | `src/lib/actors`, `/app/actors` | people and animals: the stand-in, its poses and its face, the animals of the worlds |
| Worlds | `world-skill` | `src/lib/worlds`, `src/lib/sandbox-*`, `/app/worlds` | a world, a sandbox, a real place or a village: the sky, the walker, the film camera, many things drawn cheaply |
| Buildings | `building-skill` | `src/lib/buildings`, `/app/buildings` | a tent, a dome, a container, a tower: sized, engineered, walked inside |
| Things | `thing-skill` | `src/lib/models`, `/app/models` | the still things: a prop, a vehicle, a tent, equipment or furniture, built, versioned, resized, pitched, taken apart, walked into |
| Biomes | `biome-skill` | `src/lib/biomes`, `/app/biomes` | the floor a world stands on: surfaces, cover in colonies, streamed round the eye |
| Plants | `plant-skill` | `src/lib/plants`, `/app/plants` | a plant, a tree, a crop, a herb or a fungus grown from its seed through its stages to fruit |

`factory-skill` and `machine-skill` are AirSup's text word for word (only their `name` changed), not installed: their
tools stay in AirSup's repositories and are cloned into the scratchpad when a step needs them (`SOURCE.md` in each
says how). Keep their `SKILL.md` and `references/` original. What we learn goes into our own sub skills, and for
machines into `machine-skill/ours.md` beside AirSup's text (a factory's into a `factory-skill/ours.md` once we build
one into our app). Where they and ours differ, our laws win for anything that joins our libraries (real size without a
scale, frozen versions, JS modules); a standalone AirSup page follows its skill as written.

For films, `production-designer` (worlds and sets as a film sees them, art direction) works beside these.

How we check and look, for every kind: `checking.md` (the shot route, Playwright in the container, what to shoot, the
size test, the type check, fingerprints of frozen versions, what we have seen go wrong).

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
explainer or a film. When the same machine or line must live in our app (a machine in `/app/machines` or a game, a thing, a
world), port its parts and its solver into a JS module beside the others (`src/lib/actors/*.js` with a kind in
`src/lib/machines/index.js`, or `src/lib/models/*.js`) with the same measures and equations, then follow the laws
above: real size, its parts, a frozen version, the size test (`machine-skill`'s `ours.md` has the steps).
