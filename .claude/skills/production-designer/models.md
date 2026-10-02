# The 3D models: built once, placed anywhere

Every reusable thing — a bed, a chair, a crate shelf, a light on its stand, a truck — is a function in the 3D models
library, shown on its own in the 3D models viewer and placed in any world.

## Where they live

- `src/lib/models/furniture.ts` — the models: `bed`, `wineCrate`, `crateTower`, `chair`, `edisonBulb`,
  `framedPicture`, `sheepskin`, `truck`, and the fixtures (the CB60 light on its stand, `neewer-cb60`).
- `src/lib/models/textures.ts` — their surfaces, drawn once on a canvas and shared: limed oak, pine (fresh and aged),
  painted pine, plaster (as a bump map), wool, the face on the wall.
- `src/lib/models/index.ts` — `MODELS`: each model's id, label, note (its measure and what it is), where it is used,
  and the function that makes it. A new model is a function in `furniture.ts` and a line here.
- `/app/models` (admin) — the viewer: every model on a turntable on a grid of 10 cm squares, with its width × depth ×
  height in centimetres. Check every new model there before placing it.

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
