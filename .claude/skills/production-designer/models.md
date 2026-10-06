# The 3D models: built once, placed anywhere

Every reusable thing — a bed, a chair, a crate shelf, a light on its stand, a truck — is a function in the 3D models
library, shown on its own in the 3D models viewer and placed in any world.

## Where they live

- `src/lib/models/furniture.ts` — the models: `bed`, `wineCrate`, `crateTower`, `chair`, `edisonBulb`,
  `framedPicture`, `sheepskin`, `truck`, and the fixtures (the CB60 light on its stand, `neewer-cb60`).
- `src/lib/models/outdoor.ts` — under the open sky: trees (`broadleaf`, `willow`, `poplar`, `shrub`; the garden's
  `lilac`, `corkscrew`, `maple`, `privet`, `sapling`), a park bench, the Wittelsbacherbrücke's lamp, a limestone
  block, the bronze rider. A world plants many trees, so a tree is two geometries for instancing (`treeParts`: its
  wood and its leaves, full or light); `tree()` puts them together for the viewer. Small plants: `bush` (leaf cards
  through a dome — herbs, shrubs, a crown), `stems` (hanging or climbing: ivy, a trailing herb, a creeper),
  `scatterLeaves` (leaves on a surface of their own: a hedge's, an ivy cone's), each in a leaf and a tint
  (`plantLeaves`; a gain over 1 lightens it, an olive's silver).
- `src/lib/models/terrace.ts` — the backyard's terrace: the club sofa, the bamboo table, the bistro table and its
  moulded chairs, paper lanterns (one paper for all: `userData.glass`), ribbed planters and their herbs, the olive
  tree, terracotta pots, the bird of paradise, the monstera, the ficus, a geranium, festoon lights, the toy monkey and
  the toy bee.
- `src/lib/models/yard.ts` — the backyard's courtyard and garden: the steel window and the casement window, the front
  door, the workshop door, the door canopy, the barn lamp, the letterbox on its post, window boxes, the city bike, the
  rain barrel, the insect hotel, the floodlight, the station clock, the teak table and recliners, the folding chair,
  the stoneware crock, the red tin, the ashtray, the clipped hedge, the ivy cone.
- `src/lib/models/containers.js` — Sandbox 1's settlement containers, 40-foot high cubes (12.19 × 2.44 × 2.90 m) fitted
  out and walkable: the kitchen (range, combi steamer, sinks, fridges, the serving hatch, the pantry behind a
  partition), the workshop (bench and pegboard, timber rack, the machines and power tools), the tech container (solar on
  the roof and fold-out wings, batteries, inverters, a hydrogen fuel cell and electrolyser, Starlink, the AI server
  room) and the sanitary container (washers and dryers, basins, three showers and three toilets). The open cargo end is
  the way in; each has `userData.roof` (the viewer lifts it off) and `userData.walk` (where to start, `canStand`,
  `floorAt`, the ceiling lamps) for the walker.
- `src/lib/biomes/` — the floors the worlds stand on, as recipes that mix (`/app/biomes`, admin): **surfaces**
  (`surfaces.js`: leaf litter, humus, needles, moss carpet, the living mat, bare soil) blended by one shader in
  patches of their own size, and **cover** (`cover.js`: grasses, sedge, moss cushions, low flowers, woodruff, wood
  sorrel, ramsons, strawberries, blueberry, ferns, leaves and twigs, deadwood, stones, mushrooms), each kind in its
  colonies on the surface it belongs on — herbs carpet their patches rather than being sprinkled evenly, moss sits on
  what rises, grass and flowers only where light reaches. A biome (`index.js`) is surface weights plus colonies;
  `mix(a, b, t)` runs two together. Its cover is too dense for a whole world at once, so a world streams it in tiles
  round the eye (`stream.js`): one instanced mesh a kind for all tiles, every plant ranked so the cover thins out with
  distance (`near`, `thin`) and grows out of the ground as you come (no edge, no pop); `origin` lays it in a dome's
  own ground. Sandbox 5's floor is the food forest biome, under its domes' glass the warm food forest. A new floor is
  a recipe there.
- Sandbox 5's forest (`src/lib/sandbox-2/interior/flora.js`) draws each tree in full near you, coarser further off,
  and beyond that as an impostor (`impostors.js`): each kind photographed from eight sides into one texture once
  grown, each far tree one card turned to the eye that also throws the tree's shadow. `forest.mask(circles)` leaves
  out ground whose own forest is shown (a dome's full inside).
- `src/lib/models/textures.ts` — their surfaces, drawn once on a canvas and shared: limed oak, pine (fresh and aged),
  painted pine, plaster (as a bump map), wool, the face on the wall.
- `src/lib/models/index.ts` — `MODELS`: each model's id, label, note (its measure and what it is), where it is used,
  and the function that makes it. A new model is a function in `furniture.ts` and a line here.
- `/app/models` (admin) — the viewer: every model on a turntable on a grid of 10 cm squares, with its width × depth ×
  height in centimetres. Check every new model there before placing it. A model with `userData.walk` can be walked
  inside (the sandboxes' walker, Esc to walk out); one with `userData.roof` can have its roof lifted; one with
  `userData.tick(t)` (a rigged machine, the excavators) plays its work.

## The conventions every model keeps

- **Metres, to its real measure.** The bed is 140 × 200; the wine crate 50 × 33 × 42 cm.
- **It stands on the floor at its origin** (y 0 is the floor), its middle over x = 0, z = 0. A thing that hangs (the
  bulb) hangs from its origin.
- **Its back towards −z, its front towards +z** (a bed's head, a crate's back boards, a chair's backrest, a light's
  rear panel).
- **Shared materials:** one material per surface for every copy, so a room full of models costs little.
- **Shadows:** parts cast; big surfaces also catch.
- **Seeded randomness:** a texture or a crumple is the same every time, so a film renders the same pixels on every
  machine.
- **Handles for the world:** whatever a world needs to drive (a bulb's glass, its filament, where its light sits) is
  in `userData`.

## The actors: rigged to move (`src/lib/actors`)

Whatever moves — the stand-in a shot is blocked with, and the animals — is an actor, not a model: a skeleton of bones
under one skinned mesh, built in its rest pose (facing +z, on y 0), its parts riding a bone each or a chain of bones
(blended over a few centimetres either side of a joint, so an elbow, a knee or a neck bends smoothly).
- `rig.ts` — the rig: `rig(bones, parts, materials)` builds it; `pose()` turns the bones (radians from the rest
  pose, a 4th number a bone's size, `root` moves the first bone); a clip is a function of time that gives a pose;
  `blend` goes between two poses. The shapes: `limb`, `egg`, `spike`, `loft` (a body through rings).
- `human.ts` — the stand-in: 1.70 m (`HEIGHT`; its measures are taken for 1.80 m and scaled, its sitting and lying
  poses worked out from its measure, so it sits on a 0.5 m edge with its feet on the floor at any height), bald,
  17 bones, a T-shirt, jeans, trainers, a face that shows where it looks.
  Its poses (stand, sit, sit with elbows on knees, fallen back, lie, kneel, look up, wave, think, arms crossed,
  point) and moves (idle, walk, wave, sit down). `standIn(pose)` gives one held in a pose for a world to place.
- `excavator-rig.js` — what every tracked excavator is rigged and moved with: a spec (its joints, its cylinder pins,
  its parts, the poses it digs between) becomes an actor — rigid parts on joints (the house slewing, a mini's boom
  swinging, boom, arm and bucket, a blade, the wheels) and each hydraulic ram as a barrel joint and a rod joint kept
  on the line between their pins. Its moves: dig, drive, doze (with a blade), idle. The machines on it:
  `excavator.js`, the 1.7 t mini (rubber tracks, a canopy, a blade, a swinging boom), and `crawler-excavator.js`, the
  14 t crawler — a bigger machine is a different kind, never a mini scaled up: steel tracks on rollers, an enclosed
  cab at a person's measure, a mono boom pinned to the house on two rams, no blade. Both dig with a backhoe bucket,
  its mouth towards the machine.
- `species/songbird.js` — five songbirds on the bird plan, to their measure (14–25 cm): the robin, the blackbird, the
  great tit, the house sparrow and the chaffinch. Two bones of their own: a `jaw`, which opens as it sings, and a
  whole wing riding each wing bone — folded along the flank, swung out flat and beaten to fly (`wingTurn`). Their
  moves: fly (bounding: beats, then the wings shut), hop (both feet together), peck, sing, sit, idle. In Sandbox 5
  they live round a few trees each (`src/lib/sandbox-2/interior/birds.js`).
- `animals.ts` — Sandbox 4's creatures, rigged: the hen (pecks, flaps), the goose (waddles, grazes, hisses), the
  goat and the sheep (walk, graze), the frog (croaks, hops), the bee (hovers, flies), the carp and the tilapia (swim).
- `crowd.ts` — how a world holds many of them (Sandbox 4's flocks, hives and ponds; Sandbox 3's): the nearest to the
  eye (the walker, or the film camera) as rigged actors moving every bone (at most a dozen or two of a kind), the rest
  as instances of the same model at rest in coarser shapes, its smallest parts left off — a hundred a draw call.
  Which is which is asked each frame from the eye alone, so a shot draws the same frame every time.
- `index.ts` — `ACTORS`, as `/app/actors` (admin) shows them: each on a turntable playing its moves; the stand-in also
  holds its poses, any joint turned by hand, and copies the pose out as data.

Pose a stand-in by turning bones: x forward is negative (a thigh forward, an arm forward), the left arm out is +z,
the right −z; a forearm's y twists it about itself. Check a new pose in the viewer, or measure it: pose a rig, update
its matrices, read the bones' world positions (an elbow on a knee, a hand at the chin).

## Building a model from photos

1. **Measure.** Take the real measure where it is known (a 140 bed, a 50 cm crate, the manufacturer's dimensions of a
   light); estimate the rest from the photos against those, and say which are estimates.
2. **Block it out in parts:** boxes for boards and beams (`part`), rounded boxes for soft things (`soft`), bars for
   legs and tubes (`bar`), lathes for turned shapes (a bulb's glass, a reflector bowl).
3. **Cloth is a displaced surface, never a slab.** The duvet is a thick sheet of 84 × 72 segments, flat on the
   mattress, bent round its edge with a radius and hanging down, crumpled by a few waves of different sizes, rolled up
   where it was thrown back. A rounded box only shows folds at its edges: its middle is one flat quad.
4. **Keep it on top of what it lies on.** Compute the lowest point of every soft thing (its middle minus its half
   thickness minus the deepest crumple) and keep it above the surface under it. A duvet whose folds dip below the
   mattress top vanishes into the mattress.
5. **Surfaces:** a canvas texture for anything with grain or pattern (seeded), roughness by material (oiled wood
   ~0.6, plaster ~0.93, cloth ~0.92 with sheen), a bump map for plaster. Repeat textures at their real size (the floor's
   boards are 18 cm wide).
6. **Check in the viewer** (`/app/models`): its measure, its silhouette from every side, how it reads in the grid.
7. **Place it in the world** with its rotation, and give it a solid box for the walker (`worlds.md`).
