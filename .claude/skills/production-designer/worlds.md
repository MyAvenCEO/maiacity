# The worlds and their sets

Where a world film is shot: the map of Sandbox 4, the Apartment of Samuel (his room and the rest of it), the tired
land, the Isar in Munich, and the sets built into a scene while it is filmed.

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

## The Apartment of Samuel (`src/lib/worlds/apartment.ts`)

The room is one room of Samuel's apartment, and the rest is built round it in the same axes — rough, from his sketch
and his photos, furnished with the models and none of the clutter. One set: walk out of his door and through it all.
- **The hallway** (x −4.60…−1.70, z 0.20…2.25), out of Samuel's door. The wall beside his door is painted with
  blackboard paint, the quote chalked on it (the wall itself, not a board). Along the other wall stand the shoe rack,
  the storeroom's door (shut) and the red fridge by the kitchen's doorway.
- **Its arm** (x −4.60…−3.10, z 2.25…6.40). The bar runs along one wall under the pallet shelf and the red pendant,
  with four stools. The bathroom's door stands across from the bar, and the front door (shut) at the far end. The
  coat stand and the print are on the end wall.
- **The kitchen** (x −8.10…−4.75, z 0.20…2.25), a galley. On the right as you come in: the washing machine, the oven
  under the gas hob, drawers and the black sink, under a brick wall, with the boiler over the sink and the X-shelf by
  the door. The dryer stands under the window at the far end. On the grey wall: the crate pantry and the bin.
- **The bathroom** (x −8.10…−4.75, z 2.40…4.40), long and narrow. The basin and the WC are on the left, the towel
  radiator on the right, and the glass shower at the far end under the tall window. Its door stands open into it,
  its mirror a true one: it shows the room, not the sky.
- **The windows at the far end look south:** the sun comes into the kitchen and the bathroom. The shadows reach the
  whole apartment (`shadowReach` 9.8 round the room); past their reach the sun would shine through the walls.
- **The door opens as you come to it.** In a shot it is shut while the camera is inside the room and open when it
  stands outside. The apartment's lamps light only when one can see out — the door open, or oneself outside. What is
  behind a shut door does not light the room, so the room's shots stay as they were.
- **The pendant and the bathroom's spots are downlights with shadows**, so the walls keep their light in their
  rooms. The kitchen's bare bulb has no shadows and a short reach (3.2 m) for the same reason. They are all the
  shot's `lamps`.

## The tired land (`src/lib/worlds/tired-land.ts`, `tiredLandSet.js`)

Day 19's world as it was, west of the city's edge:
- ploughed monoculture fields in ochre and tired green;
- a highway at x = −470 with power lines and dead trees;
- eight trucks driving on the shot's clock.

It is its own world (`/games/tired-land`) and also Sandbox 4's `tired-land` set.

## The Isar (`src/lib/worlds/isar`)

The river in Munich from the Wittelsbacherbrücke south to the railway bridge (the Braunauer Eisenbahnbrücke), about
700 m of it, flowing north. A real place built from open data, not by hand:
- **Its data** comes from `scripts/worlds/isar-map.py` (run it again to bring the map up to date): OpenStreetMap for
  the river's outline, the gravel, the meadows, woods, paths, benches, trees, both bridges and the town; the Bavarian
  survey's 1 m terrain model (DGM1) for the ground's real heights. It writes `map.json` (every feature in the world's
  metres) and `ground.bin` (the heights on the world's grid). Both are credited on the world's page: © OpenStreetMap
  contributors (ODbL), DGM1 © Bayerische Vermessungsverwaltung (CC BY 4.0).
- **Axes:** x east, z south, y up, in metres from a point on the river midway between the bridges (UTM 32N 690850 E,
  5332890 N); y 0 is the water's surface there (513.24 m above sea level), and it falls 1.1 m per km downstream.
  The river's own frame: **s** along it, downstream (north-east), **n** across it, towards the east bank.
- **Where things are:** the railway bridge at s ≈ −343, the Wittelsbacherbrücke at s ≈ +340. The river 35–60 m
  wide, deepest (up to 1.8 m) along the steep, tree-lined west bank, shallow over the gravel bars on the east. The
  east bank: the gravel path by the water (n ≈ 20–58), the meadow some 2 m above the water, the dike with its benches
  and the cycle path (n ≈ 85–115), the park behind it. The statue's pier stands on the gravel island under the
  bridge; the path passes under its third arch; stone steps lead down to the water under its south face.
- **The Wittelsbacherbrücke:** four arches of 44, 28, 27 and 26 m from the west, clad in shell limestone; the bays
  of its piers, the pavilions on the two eastern ones, Otto von Wittelsbach on his pillar over the island (upstream
  side), lamps along both parapets. Its plan is OpenStreetMap's outline, its ends' heights the survey's; the arches'
  rise, the pavilions and the pillar's height are estimates from photos.
- **The railway bridge:** three spans of about 48.5 m on stone piers, the two tracks on plate girders, the catenary,
  and on its downstream side the old lattice truss. Its piers' places are estimated from the ground and its length.
- **The skyline:** the houses round it from their footprints and storeys; St. Maximilian's two towers north beyond
  the bridge; the Heizkraftwerk Süd's chimneys (176, 130, 90 m) south beyond the railway bridge.
- **Walked** along the east bank and into the river: wading over the gravel, swimming where it is deep (the current
  carries a swimmer downstream), not up the west bank nor over the dike; up the ramps at the bridge's east end and
  across its deck between the parapets. **Filmed** as `world.sandbox: 'isar'`; its lights are the shot's `lamps`
  (the bridge's lanterns). Close to the camera the grass grows in blades and the trees are drawn full: both follow
  the shot's camera, so a shot renders the same every time.
- **The sky turns as Munich's does** (`createSky({ map: true })`): the sun rises over the east bank, stands in the
  south at noon and sets behind the west bank's trees.

## Building a new world

1. **Mount it with the sandbox kit** (`src/lib/sandbox-kit`):
   - `createStage` — the renderer and the camera.
   - `createSky` — the hour and the sun. Give it the place's `north`; for a real place laid out as a map (x east,
     z south), `map: true`, or the sun turns the mirror way round. A small world needs a short shadow range:
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
