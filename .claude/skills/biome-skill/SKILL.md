---
name: biome-skill
description: The maiaCITY biome skill — the floor a world stands on, in the Biomes library (src/lib/biomes, /app/biomes): a biome as a recipe of surfaces (leaf litter, humus, needles, moss, the living mat, bare soil) blended by one shader and cover kinds in colonies on the surface they belong on, why a forest floor looks the way it does, mixing two biomes, streaming dense cover in tiles round the eye without edges or pops, and versions. Use it whenever a world's ground, a forest floor, a meadow, a lawn or the ground under a dome is made, changed or tuned. Part of asset-producer.
---

# Biomes: the floor a world stands on

A biome is a recipe, not a mesh: which surfaces the ground is made of and how much of each, and what grows and lies
on it, kind by kind. It is shown in `/app/biomes` (admin) on a patch of ground, every layer to show or hide, and mixed
with another. Today's: `food-forest`, `warm-food-forest`, `beech-forest`, `spruce-forest`, `meadow`, `clover-lawn`
(`src/lib/biomes/index.js`).

## Where it lives

- `surfaces.js`: the surfaces (`SURFACES`: litter, humus, needles, moss, green, soil), each a texture at its real
  size, blended by one shader in patches of their own size (`groundMaterial(weights)`, `surfacesAt`).
- `cover.js`: the kinds that grow or lie on it (`COVER`: grasses, sedge, moss cushions, low flowers, woodruff, wood
  sorrel, ramsons, strawberries, blueberry, ferns, leaves and twigs, deadwood, stones, mushrooms), each built once
  from a seed.
- `index.js`: a biome is surface weights plus colonies; `mix(a, b, t)` runs two together (a forest edge is half the
  beech wood and half the meadow); `coverAt` says what stands where; `BIOMES` is versioned like every asset.
- `stream.js`: `coverStream({ recipe, open, tile, reach, near, thin, perFrame, origin })` → `{ object, update(x, z),
  rebuild(recipe, hidden) }`.

## Why it looks so (keep it true)

A temperate forest floor is litter over humus over soil: under a closed canopy mostly whole fallen leaves, dark humus
where they are thin; mosses on what rises out of it (stones, roots, deadwood); the herb layer in clonal colonies
rather than sprinkled evenly (a carpet of anemones, a stand of ramsons); grasses, sedges and flowers only where light
reaches the floor. A forest garden keeps its soil covered on purpose: a living mulch of clover and wild strawberries
between the plants, leaf litter under the trees. A new floor starts from what really lies on that ground.

## Colonies, not sprinkles

- Each cover kind grows in colonies of its own size, on the surface it belongs on: woodruff and anemones carpet
  patches several metres across, ferns stand in groups, deadwood and stones lie here and there, moss sits on what
  rises, clover in the green.
- An even sprinkle of everything reads as a render. If the floor looks like confetti, the colonies are too small or
  every kind is everywhere.

## Dense cover over a whole world

- Six or ten plants to a square metre is too much to lay out over a world at once, so the cover is streamed in small
  tiles round the eye: each tile worked out from its place alone (the same tile, the same plants every time), a tile
  or two a frame so walking never stutters, tiles left behind let go, new ones built beyond where the cover shows.
- One instanced mesh a kind for all tiles: a handful of draw calls however many tiles.
- No edge, no pop: every plant has a rank (0…1); near the eye all of them stand, further off fewer (`near`, `thin`),
  and each grows up out of the ground or sinks back on the graphics card as the eye comes and goes.
- `origin` lays a biome in a dome's own ground; a slower device takes a lower `density`.

## Where they are used

Sandbox 5's floor is the food forest's (`src/lib/sandbox-2/interior/village.ts`), and under its domes' glass the warm
food forest's (`interior.ts`). The plants that stand on a biome are grown by `plant-skill`; the trees of a whole
forest (near in full, far as impostors) are in `production-designer`'s `models.md`.

## Checking

Look at a new biome in `/app/biomes` alone and mixed, then in its world at walking height while walking (tiles must
not show, nothing may pop) and from above (colonies, not confetti). Shots and checks: `asset-producer`'s `checking.md`.
