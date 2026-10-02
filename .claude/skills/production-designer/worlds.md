# The worlds and their sets

Where a world film is shot: the map of Sandbox 4, the room and the tired land, and the sets built into a scene while it is filmed.

## Framing Sandbox 4

- **`stand` and `dome`:** only the dome nearest the walker is built inside and shown in full. Set `stand` near the
  dome you film, and `dome: i` to wait for it.
- **Dome indices:** 0 the master dome; 1–6 the large domes at `polar(150, k·60°)` (1 = (0,150), 2 = (130,75)); 7–12
  the medium domes at `polar(200, 30°+k·60°)` (8 = (200,0)).
- **World (x, z in metres):** master dome (0,0), R 68 — the commons, its gallery ring, the stone theatre at the centre,
  workshops at its foot (r ≈ 60). Large domes at 150 m, R 35, terrace at 5 m from r 34 to 41, arches every 7.5°.
  Medium domes at 200 m, R 20. Animals: hens (49,77), bees (57,104), frogs (69,96), goats (135,120), geese (94,316);
  live positions in `window.__village.herds`. Playgrounds at 118 m; the stream by (100–110, 290–315).

## Sets (`scripts/film/props.mjs`)

When the story needs something the world doesn't have, build it into the scene while filming — never into the game.
A shot names it (`props: 'tired-land'`); `shoot.mjs` builds it once and calls `window.__props(clock)` every frame.
Day 19's `tired-land` west of the city's edge (x < −398): ploughed monoculture fields, a highway at x = −470, power
lines, dead trees, eight trucks. The empty plain beyond the edge showed nothing and read as a dead shot.

## The room (`src/lib/worlds/room.ts`)

Samuel's real bedroom (Day 02), rebuilt from seven photos: 3.10 × 4.50 m, 2.55 m high.
- **Axes:** x across (−1.55 the left wall with the door, +1.55 the window wall), z along (−2.25 the back wall behind
  the bed, +2.25 the front wall), y up.
- **North is +x:** the window looks north (`createSky({ north: π/2 })`), so the sun never shines in. It rises behind
  the bed, stands in the south over the door's side at noon, and sets behind the front wall.
- **Where things are:**
  - The bed (140 × 200) stands against the back wall between two wine-crate shelves.
  - The window sits a little right of its wall's middle (z −0.35…0.95), with its deep reveal, the radiator, the
    blanket on the sill and the curtain knotted to the front.
  - The red chair stands just before the window; the leather school chair by the left wall.
  - The door is in the left wall near the front corner (z 0.88…1.74).
  - The picture hangs between the window and the front corner. The sheepskin lies at the bed's foot.
  - The Edison bulb hangs on a short cord; the CB60 light stands on its stand (`neewer-cb60`).
- **Walked** at a room's pace, kept off the walls and out of the furniture by solid boxes. **Filmed** as
  `world.sandbox: 'room'` — its lights are the shot's `lamps` (the bulb) and `cb60`.

## The tired land (`src/lib/worlds/tired-land.ts`, `tiredLandSet.js`)

Day 19's world as it was, west of the city's edge:
- ploughed monoculture fields in ochre and tired green;
- a highway at x = −470 with power lines and dead trees;
- eight trucks driving on the shot's clock.

It is its own world (`/games/tired-land`) and also Sandbox 4's `tired-land` set.

## Building a new world

1. **Mount it with the sandbox kit** (`src/lib/sandbox-kit`):
   - `createStage` — the renderer and the camera.
   - `createSky` — the hour and the sun. Give it the place's `north`. A small world needs a short shadow range:
     `lightDistance`, `shadowNear`, `shadowFar` and a small `shadowBias`. Over a sky's 1400 m, the bias reaches half
     a metre, and the sun leaks in over a room's walls.
   - `createWalker` — walking, with a `canStand` test.
   - `connectFilm` — `sandbox`, the `advance` and `lights` hooks, and `place`.
2. **Register it:**
   - `game/film/worlds.js` (label, areas) and `game/film/shot.js` (the `Sandbox` type);
   - a film page `/games/<world>/` (FilmRoute);
   - an admin page `/app/worlds/<world>/` with the time control (`SkyControl`, Auto/Manual);
   - a line in `WORLDS` (`src/lib/app/places.ts`).
3. **Furnish it from the 3D models** (`models.md`). The world's own code keeps only its shell — walls, windows, doors,
   what is outside — and its lights.
4. **Check it in the film camera** at the hours its shots use, from every camera position in the shot list. Then
   check it in its admin page with the time control on Manual.
