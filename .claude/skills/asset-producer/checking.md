# Checking and looking: our toolkit

Law 6 says look at it like a critic. This is how we look and measure, in the cloud container, without a login, for
every asset group.

## Numbers first (headless)

- `bun test src/lib/models/sizes.test.js`: every thing's and machine's outer box against `REAL_SIZES` (12 %).
- `bun test src/lib/assets/versions.test.js`: every group's versions in order and dated, every older one with its own
  frozen builder, every one found again by its ref.
- `timeout 300 npx svelte-check --threshold error`: 0 errors. JSDoc types in JS: annotate what it calls implicit
  `any`, cast with `/** @type {any} */ (x)` where three's types are narrower than the code.
- **A machine's solver**: a throwaway Bun script inside the repo builds it, ticks it once (so its moving parts are
  placed), steps its solver through the slider settings and the break, and prints the hero's reading, the labels'
  values and its outer box. Compare the operating point with the public figure from the research.
- Throwaway Bun scripts and tests that import three must live inside the repo (a `zz/` folder, deleted before the
  commit); give them a stub `document` when a builder paints canvas textures (the versions test shows the stub, and
  `globalThis.$state` for a module with runes).
- **Fingerprint frozen versions.** Before a refactor, hash every older version's geometry (each attribute's bytes,
  each blend shape's, the groups) in a throwaway test; after it, the hashes must match. (The stand-in v6 man is not
  deterministic between calls; its other versions are.)
- Composed assets: build the host and check that the guest's parts are in its catalog under the prefix, and that the
  host's outer box still matches its real size with the guest in it.

## Pictures

- **The real page as a mocked admin** (`/app/models`, `/app/machines`, `/app/actors`, `/app/plants`, `/app/biomes`,
  `/app/buildings`): in dev the site asks `http://localhost:3100/api/me`, so a Playwright
  `context.route('http://localhost:3100/**', …)` answers `/api/me` with `{ id, number, name, since, role: 'admin',
  caps: ['media:admin'] }` and everything else with a 404, both with `access-control-allow-origin:
  http://localhost:5199` and `access-control-allow-credentials: true`. With `caps: []` the same pages must say "Not
  released yet".
- Vite on a port of its own (`bunx vite dev --port 5199`, in the background); restart it after creating or deleting
  a route.
- Playwright from `/opt/node-tools/node_modules/playwright/index.mjs`, Chromium at `/opt/pw-browsers/chromium` with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; the viewport the size of the canvas, or the
  picture is cut.
- **Swiftshader draws about one frame a second.** On the asset stage, wait 8 to 10 seconds after picking a kind and 5
  to 8 seconds per mode; the stage eases its modes and plays its build by the wall clock, so they finish while frames
  are few. Click the bar's chips by their exact name (a version's note can carry the same word). A run that fails
  midway usually passes when run again.
- Write the shoot as a list of steps (pick a kind, click, drag to orbit, wheel to zoom, wait, shot) so the same
  script shoots every mode of every asset.
- **A throwaway shot route** for what the pages cannot show: `src/routes/zz-shot/+page.svelte`, never committed. It
  imports the builder, makes a `WebGLRenderer` with `preserveDrawingBuffer: true` and ACES tone mapping, a hemisphere
  light and one key light, a floor, the asset, and a camera from the query (`cam=x,y,z&at=x,y,z&fov=30`, plus the
  asset's own options: `k=0.5`, `fr=1`, `light=night`). It renders once and sets `document.body.dataset.ready`;
  wait for `body[data-ready]`. Headless swiftshader draws nothing of a rigged (skinned) machine or actor on the live
  turntable (its panels, parts and moves still work and can be read from the page): render it once from this route.
- Shoot what the asset will be judged by: the whole beside a 1.8 m figure for scale, every mode (labels, cut,
  x-ray, explode, the break), close ups of every joint and the cut, the back, every step of a build, the distance it
  is seen at in the game or film (a medium close-up for a face), by day, in shade and at night. Tile them (Pillow)
  and save them to `/mnt/project-files/<group>/<asset>/`.
- Read every picture yourself before saying it works.

## Seen before

- Two thin layers stacked too close flicker (z-fighting): keep 0.1 mm or more between them at a face's scale.
- A detail placed by eye can hide behind a lid, a canvas or a wall from the camera that matters: check it from that
  camera.
- Something moving through something else only shows mid-move: shoot the in-between steps, not just the ends.
- Moving parts placed only by the solver sit at their origin until the first tick: tick once after `seal` before
  measuring the box or shooting.
- `Box3` counts invisible meshes, so a hidden part still grows the size test's box; after moving vertices reset
  `geo.boundingBox = geo.boundingSphere = null` and recompute the normals.
- A clone made for a ghost or a cut keeps its own material: give it the original's clipping planes, or the cut shows
  the whole part through it.
- A new asset app needs every place that names one: its route (`+page.js` prerendered, `+page.svelte`), a line in
  `GAME_ASSETS` with a cover in `static/app/covers/` (force-added, the folder's jpgs are ignored), a tile in `gameAt`
  and a title in `placeOf` (`src/lib/app/places.ts`), the full-screen list `immersive` in
  `src/routes/app/+layout.svelte` (Machines first opened inside the page frame without it), and a group in `GROUPS`
  of `src/lib/assets/index.js`.
