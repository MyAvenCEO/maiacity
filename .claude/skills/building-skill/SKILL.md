---
name: building-skill
description: The maiaCITY building skill — what a settlement lives and works in, in the Buildings library (src/lib/buildings, /app/buildings): the tents a settler starts in, the domes of a village in the order it grows them (glamp, home, large, grand, master, the glass factory) with their walkable interiors, the fitted-out containers and the wayside buildings, all on one round grid ground and stepped inside; how a building is built (research, real size, its shell first), how it composes (furnished from Things, machines and plants by ref or carry, floored with a biome, placed in worlds), dome sizes and engineering (geodesic caps, the hemp north third), the 1 hex = settlement and 7 hexes = village terms, versions kept walkable as they were, checking and the lessons kept. Use it whenever a tent, a dome, a container, a tower or any building is built, changed, sized, furnished or walked. Part of asset-producer.
---

# Buildings: what a settlement lives and works in

Every building stands alone in `/app/buildings` (admin) on the same round ground (`src/lib/buildings/ground.js`: a
disc of light earth, 1 m grid squares, every 10 m darker, a rim), made as large as it needs, and opens straight
inside to be walked. The laws, the shared core (`$lib/assets`, refs, one version control) and how we check are the
`asset-producer`'s; this is what the buildings taught us on top of them.

## Where it lives

- `src/lib/buildings/index.js`: `BUILDINGS` = the domes (versioned), the containers and the wayside buildings, each
  `{ id, label, note, usedIn, size, versions }`, grouped as "Tents and domes", "Containers" and the wayside group;
  their `HISTORY` there.
- `src/lib/buildings/domes.js`: `DOMES_IN_ORDER`, the domes in the order a village grows them, each with its picture
  from inside (a media vault hash) and what it is: the tent, glamp (16 m), home (40 m), large (70 m), grand (100 m),
  master (136 m) and the factory that makes their glass.
- Their interiors are Sandbox 3's (`src/lib/sandbox-2/interior`: `interior.ts`, `tent.ts`, `factory.ts`, `rooms.ts`,
  `water.ts`, `spaces.ts`): galleries of private rooms round the edge facing out through the glass, a shared ground
  floor of plaza, food forest, stream and pond, kitchens and aquaponics under the gallery.
- Containers are models (`src/lib/models/containers.js`, 40-foot high cubes, 12.19 × 2.44 × 2.90 m, walkable,
  `userData.roof`, `userData.walk`); the wayside buildings too (`wayside.js`: bus stop, gas station, the village
  store, the old shed). A building that is also handed to a game as a thing follows `thing-skill`.
- Its ref: `buildings/<id>@<v>`.

## How it is built

1. **Research** the real construction: span, height, struts and hubs, glazing, the north shell, people per dome and
   rooms per person, what the floor carries. Say which figures are estimates.
2. **Build** at real size (1 unit = 1 m), in its parts: structure, skin, floors and galleries, doors to the compass
   points, the interior's plan before its furniture. A new building's structure is built with `$lib/assets`, so its
   struts, hubs, glass and shell are parts with cards that explode and cut like a machine's.
3. **Furnish** it from the libraries, never with its own copies (below).
4. **Walk** it: every door, every gallery, the stairs, the headroom under the slope of the shell.

### Sizes and the terms we use

- 1 hex = a settlement; 7 hexes = a village (Samuel, 2026-10-08).
- Buildings app domes (half spheres): small 40 m for 12 people, medium 70 m for 24, large 100 m for 48, master and
  the solar factory 136 m.
- Since 2026-10-08 every dome (and tower) has its north third closed in hemp; per-size figures are in
  `/mnt/project-files/dome-research/dome-sizes.md` (and `.json`, which the one-village sandbox reads).
- The engineered 150 m dome (research): a 50 m high geodesic cap of about 6 m struts (frequency 16, 2,390 struts,
  830 hubs), larch or Douglas glulam struts, recycled cast-steel hubs, all joints steel, mineral glass, a hemp-fibre
  north shell, the floor at ground level.
- The one-village sandbox (`src/lib/sandbox-7`, label Sandbox 6) builds hexes 665.6 m across flats at real scale, with
  Dome40/80/120 and one tower; its numbers and their sources are in `specs.js`.

## Composable

- What goes in: furniture and equipment from the Things (`thing-skill`), machines from the Machines (`machine-skill`'s
  `ours.md`: a geothermal plant, a BatteryCube in the plant room, a forklift in the store), people and animals from
  the Actors, plants from the Plants (`plant-skill`), the floor from a biome (`biome-skill`). Each named by its ref
  (`machines/batterycube@9`, `plants/apple@1`), so the building keeps them as they were when it was furnished; a
  building built with the kit carries a sealed guest (`carry`), and its catalog, explode and cut reach into it.
- What it goes into: settlements, villages and worlds (`world-skill`), named there by its ref, and a factory's hall
  (`factory-skill`'s "Our library").
- A piece shared by several buildings (a gallery module, a door, a strut and hub) is one builder function they all
  import, with their own measures.

## Versions

A changed dome goes up a version in `HISTORY` (`index.js`), its old interior kept as its own kind in the interior
code so it can still be walked as it was (the grand dome's v2: a green middle and a sunken rainforest pond with a
waterfall). The versions test holds every older version to its own builder. The grand dome's v1 (a glass fish tank)
was never built into a world and was dropped before that rule, so its list starts at v2; from now on every older
version keeps its builder.

## Checking

- The versions test and the type check (asset-producer's `checking.md`); a container or wayside building also the
  size test.
- `/app/buildings` as a mocked admin: from outside and inside, every gallery and door, at noon and at night.

## Lessons kept

- The headroom under a sloped shell decides where a gallery and a bed can go: walk it at eye height before
  furnishing.
- A building's own copy of a tree or a chair drifts from the library's: furnish from the libraries by ref.
