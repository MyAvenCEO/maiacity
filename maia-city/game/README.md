# @maia-city/game

The new MaiaCity game, on its own: plain HTML and JavaScript, no build step and no dependencies. Bun serves it.

```bash
cd maia-city/game
bun run dev     # the Resource Library at the address it prints
bun test        # the resources and their pixels
```

## What's in it

- `resources.js`: the base resources of the world, everything it gives before anything is made from it (76 in 7
  groups: earth, stone, ores, wood, plants, animals, fluids). Each says where it's found, what it's gathered with and,
  for a block, its real weight: a block is 1 m on a side, so it weighs the material's density in kg/m³.
- `pixels.js`: the pixel art, drawn by code. Every texture and item is 16 × 16, painted from a short recipe and the
  resource's id, so the same resource always looks the same and no image file is kept.
- `index.html` and `library.js`: the Resource Library, which shows every resource (a block as a cube, an item flat),
  with a search, group filters and a card per resource. A link to `#<id>` opens that resource.

Nothing crafted, smelted or cooked is in the list yet: that comes with the recipes.
