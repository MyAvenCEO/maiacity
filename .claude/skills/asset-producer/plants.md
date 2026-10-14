# Plants: what we learned growing them

Every plant is grown from code in `src/lib/plants` and shown in `/app/plants` (admin) at each stage, with its fruit
on its own (Show: Plant | Fruit). Trees for worlds, impostors and the ground cover (biomes) are in
`production-designer`'s `models.md`.

## A plant is a recipe that grows

- `src/lib/plants/index.js` lists each plant: `{ id, label, latin, note, from, stages, grow(stage, seed), layer }`.
  Ten stages from seed to ripe fruit, the last four the fruit's own (set, green, turning, ripe), each with its day and
  a note. A new plant is a file and a line there.
- Its food-forest `layer`: canopy, sub-canopy, shrub, herbaceous, ground, root, climber or fungi. The temperate
  forest garden's plants are grouped by layer (`wald-canopy.js`, `wald-lowtrees.js`, `wald-berries.js`,
  `wald-perennials.js`); the mini fields' crops are in `fields.js`.
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

## Fruit

- Mark every fruit a plant draws: `bag.fruit(key, at, dir)` … `bag.fruitDone()` around its stalk and body. Without
  the marks the Fruit view stays disabled. `src/lib/plants/fruit.js` varies one fruit by seed (size, shape, colour);
  `DETAIL.fruit` draws it as finely as the close-up needs. Check with `bun scripts/fruit-check.mjs [id]`.

## Many plants in a world

- `lite({ level, roots, thin, fill, finest }, make)` grows a plant for a crowd: fewer divisions, no roots under the
  soil, fewer but bigger leaves (`thin`, `fill`), no twigs thinner than `finest`. A forest draws near plants in full,
  further ones lighter, the far ones as impostors.

## Versions

- Plants carry versions like every asset (`versioned` and `HISTORY` in `index.js`, `src/lib/app/versions.js`): the
  old builder frozen beside the new one (`orchard.v1.js`, `APPLE_V1`, `avocado` v1 in `fruittrees.js` and v2 in
  `avocado.js`), and a world anchored to the version it was built with (`apple@1`, through `at`). Sandbox 5 stays on
  avocado v1.
