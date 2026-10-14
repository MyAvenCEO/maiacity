---
name: world-skill
description: The maiaCITY world skill — the worlds and sandboxes everything is placed in (src/lib/worlds, src/lib/sandbox-*, /app/worlds, /app/games): one universe and one sky for every world (the sandbox kit — createStage, createSky, createWalker, createOrbitRig, connectFilm, SkyControl), a new world step by step, a real place rebuilt from map data or photos with one plan file of measures, the shell kept in the world and everything else from the libraries, many things drawn cheaply (welding, instancing, impostors, streamed cover, crowds), the film camera and versions. Use it whenever a world, a sandbox, a real place or a village is built, extended, furnished, walked or prepared for filming. Part of asset-producer.
---

# Worlds: where everything is placed

A world is a place to walk and to film: the room, the Apartment, the tired land, the Isar in Munich, the backyard
(`src/lib/worlds`, `/app/worlds`), and the sandboxes (`src/lib/sandbox-*`, `/app/games`). The details of each film
world (axes, where things are, how its light falls) are in `production-designer`'s `worlds.md`; this skill is how a
world is made.

## One universe, one sky

Every world is a view of the same universe (`src/lib/sandbox-kit`, its `README.md`): the same sky and stars, the same
time control (`SkyControl`: Auto, the in-game clock, or Manual, a slider from noon), the same cameras, the same hold
for the studio's film camera. A world chooses only its size (how far shadows and fog reach) and its lens
(`exposure`), never how the sky behaves.

- `createStage(container)`: canvas, scene, camera; `adapt(now)` keeps it smooth on a slow phone.
- `createSky(renderer, scene, { onHour, north, map })`: the sun on the hour, shadows, fog in the horizon's colour;
  `north` for a real room, `map: true` for a real place laid out as a map (x east, z south). A small world needs a
  short shadow range (`lightDistance`, `shadowNear`, `shadowFar`, a small `shadowBias`), or the sun leaks over walls.
- `createWalker(camera, canvas, { canStand, floorAt })` to walk; `createOrbitRig` for a map camera.
- `connectFilm({ sandbox, area, renderer, scene, camera, … })` hands the world to the studio's film camera; in the
  loop, `worldTime()` is the shot's clock and `filmDraws()` says the film draws the frame.

## A new world

1. **Mount it with the kit** (the `README.md` has a whole small world to start from).
2. **Register it**: `game/film/worlds.js` and `game/film/shot.js`, a film page `/games/<world>/`, an admin page
   `/app/worlds/<world>/` with the time control, a line in `WORLDS` (`src/lib/app/places.ts`).
3. **The world keeps only its shell** (walls, windows, doors, what is outside) and its lights. Everything else comes
   from the libraries: things (`thing-skill`), machines (`machine-skill`'s `ours.md`), people and animals
   (`actor-skill`), plants (`plant-skill`), the floor (`biome-skill`), buildings (`building-skill`).
4. **A real place**: one plan file of measures that every part is built from (the backyard's `layout.ts`), so a wall
   moved is moved everywhere; textures at their real size (every UV in metres); from map data where it exists (the
   Isar from OpenStreetMap and terrain, `scripts/worlds/isar-map.py`); from photos for a room, with the estimates
   named. The person who lives there notices a window on the wrong side at once.
5. **Real scale, real speeds**: distances in metres and speeds in m/s (`SPEED` in `src/lib/models/units.js`: walk 5,
   track 30, highway 80 km/h). A long drive is shortened by film cuts, never by speeding up.
6. **Check it** in the film camera at the hours its shots use, then on its admin page with the time on Manual
   (`asset-producer`'s `checking.md`).

## Many things, cheaply

- Weld what never moves: one mesh per material (the backyard's `freeze`), a hundred-odd draw calls for a whole yard.
- Instance what repeats: a tree as two geometries (wood, leaves) for instancing; a biome's cover as one instanced
  mesh a kind (`biome-skill`).
- Far things as impostors: a forest draws near trees in full, further ones coarser, the far ones as one card turned
  to the eye that also throws the tree's shadow (`src/lib/sandbox-2/interior/impostors.js`).
- Crowds: the nearest animals or people as rigged actors, the rest as instances at rest in coarser shapes
  (`src/lib/actors/crowd.ts`), chosen from the eye alone so a shot draws the same frame every time.
- Only the dome nearest the walker is built inside in full (Sandbox 4).

## Versions and seeds

A world is anchored to the versions of the assets it was built with (`apple@1`, `src/lib/app/versions.js`), so a
later asset never changes it. A world grown from a seed (the islands, the valley, the one village) is the same world
for the same seed, every time; films depend on that.
