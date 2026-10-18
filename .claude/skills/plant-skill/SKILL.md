---
name: plant-skill
description: The maiaCITY plant skill — every plant grown from code in the Plants library (src/lib/plants, shown in avenDB's Assets): a plant as a recipe that grows from its seed through ten stages to ripe fruit, its food-forest layer, organs drawn by their own chance, swept tubes and sheets merged in a Bag, branching limbs and crowns, stamped leaves, fruit and leaves that keep clear (Space, Clear), fruit marks for the fruit view and fruit-check, lite detail for worlds of hundreds, how it composes (planted in biomes, buildings and worlds by ref, plants@v), versions a world anchors to, checking and the lessons kept. Use it whenever a plant, a tree, a crop, a herb or a fungus is grown, upgraded or planted in a world. Part of asset-producer.
---

# Plants: grown from a seed

Every plant is grown from code in `src/lib/plants` and shown in avenDB's Assets (`/app/avendb/#assets`) at each
stage, with its fruit on its own (Plant | Fruit in its bar). The laws, the shared core (refs, one version control) and how we check are the
`asset-producer`'s; this is what growing plants taught us on top of them. Trees for worlds, impostors and the ground
cover (biomes) are in `production-designer`'s `models.md`.

## Where it lives

- `src/lib/plants/index.js` lists each plant: `{ id, label, latin, note, from, stages, grow(stage, seed), layer }`,
  with its versions (`versioned` and `HISTORY` there). A new plant is a file and a line there.
- Its food-forest `layer`: canopy, sub-canopy, shrub, herbaceous, ground, root, climber or fungi. The temperate
  forest garden's plants are grouped by layer (`wald-canopy.js`, `wald-lowtrees.js`, `wald-berries.js`,
  `wald-perennials.js`); the mini fields' crops are in `fields.js`.
- Its ref: `plants/<id>@<v>`.

## How it is built

### A recipe that grows

- Ten stages from seed to ripe fruit, the last four the fruit's own (set, green, turning, ripe), each with its day and
  a note.
- **Grown, not redrawn.** A seed id (any text) is hashed, and every organ draws its own chance by name
  (`chance(seed, 'leaf', 3)`), so the third leaf is the same leaf at every stage and a plant tabbed from seed to fruit
  grows. Another seed is a sister plant: leaner or bushier, its leaves turned otherwise.
- Growth is one number `g`; each organ grows over its stretch of it (`span(g, from, to)`).
- Shapes are swept tubes (roots, stems, berries) and sheets (leaves, petals) painted by vertex colours, all merged per
  material in a `Bag` (`grow.js`), so a vine with hundreds of roots is a handful of draw calls.
- Branching is `limb()` in `tree.js`: each limb from its own chance, so a young tree is the first part of the old one.
  Fruit trees grow through `orchard.js` and `crown.js`.
- A full crown of thousands of leaves: make each leaf once and stamp it (`template`, `stamp`, in `wald-canopy.js`).
- Nothing pierces anything: fruit hangs where it touches nothing and leaves turn away from fruit and stems (`Space` in
  `grow.js`; a grid, `Clear`, for crowns of thousands). Not physics: a search, the same every time.

### Fruit

- Mark every fruit a plant draws: `bag.fruit(key, at, dir)` … `bag.fruitDone()` around its stalk and body. Without
  the marks the Fruit view stays disabled. `src/lib/plants/fruit.js` varies one fruit by seed (size, shape, colour);
  `DETAIL.fruit` draws it as finely as the close-up needs.

### Many plants in a world

- `lite({ level, roots, thin, fill, finest }, make)` grows a plant for a crowd: fewer divisions, no roots under the
  soil, fewer but bigger leaves (`thin`, `fill`), no twigs thinner than `finest`. A forest draws near plants in full,
  further ones lighter, the far ones as impostors.

## Composable

- A plant's organs are its own pieces, shared across plants the way a machine's parts are: `limb`, `crown`, the
  stamped leaf, the fruit of `fruit.js`. A new tree grows its limbs and fruit through them, never a copy.
- What it goes into: a biome's cover (at a light detail, `biome-skill`), a dome's food forest and a building's
  planters (`building-skill`), a field, a world. Each names it by its ref, stage and seed (`plants/apple@1`, its
  stage, a seed), so the same tree grows in the same place every time and a later version changes nothing there.

## Versions

- The old builder frozen beside the new one (`orchard.v1.js`, `APPLE_V1`, `avocado` v1 in `fruittrees.js` and v2 in
  `avocado.js`), and a world anchored to the version it was built with (`apple@1`, through `at`). Sandbox 5 stays on
  avocado v1.
- A change to a shared organ (`limb`, `crown`, `fruit.js`) is a new version of every plant that grows through it, or
  the old organ kept for the old versions: fingerprint them.

## Checking

- `bun scripts/fruit-check.mjs [id]`: every fruit marked and clear of the leaves and stems.
- avenDB's Assets on the dev feed (asset-producer's `checking.md`): every stage in order (it must grow, not be
  redrawn), the fruit view, a sister seed; then planted in its world at the distance it is seen at. The versions test
  and the type check (asset-producer's `checking.md`).

## Lessons kept

- A plant that is redrawn at each stage reads as ten plants: every organ by its own chance, so it grows.
- Fruit inside leaves or stems shows the moment the camera comes close: keep them clear by search, not by eye.
