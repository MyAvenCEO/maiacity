# Checking and looking: our toolkit

Law 5 says look at it like a critic. This is how we look, in the cloud container, without a login.

## Pictures

- A throwaway route, `src/routes/zz-shot/+page.svelte`, never committed: it imports the builder, makes a
  `WebGLRenderer` with `preserveDrawingBuffer: true` and ACES tone mapping, a hemisphere light and one key light, a
  floor, the asset, and a camera from the query (`cam=x,y,z&at=x,y,z&fov=30`, plus the asset's own options:
  `k=0.5`, `fr=1`, `light=night`). It renders once and sets `document.body.dataset.ready`.
- Vite on a port of its own (`bunx vite dev --port 5199`); restart it after creating or deleting the route.
- Playwright's Chromium at `/opt/pw-browsers/chromium` with `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`; wait for `body[data-ready]`; the viewport the size of the canvas, or the picture is
  cut.
- `/app/models` (the Things), `/app/machines` and `/app/actors` need a passkey login: to test the viewers, mount
  their component (`ModelsView.svelte`, `ActorsView.svelte`) in another throwaway route. Headless swiftshader draws
  nothing of a rigged machine or actor on their live turntable; render it once from the shot route instead.
- Shoot what the asset will be judged by: every step of a build, the whole thing beside a 1.8 m figure for scale,
  close-ups of every joint, the distance it is seen at in the game or film (a medium close-up for a face), by day, in
  shade and at night. Tile them (Pillow) and save them to `/mnt/project-files/<asset>/`.
- Read every picture yourself before saying it works.

## Numbers

- `bun test src/lib/models/sizes.test.js`: every model's outer box against `REAL_SIZES`.
- `timeout 300 npx svelte-check --threshold error`: 0 errors.
- Throwaway Bun tests that import three must live inside the repo (a `zz/` folder, deleted before the commit); give
  them a stub `document` when a builder paints canvas textures.
- **Fingerprint frozen versions.** Before a refactor, hash every older version's geometry (each attribute's bytes,
  each blend shape's, the groups) in a throwaway test; after it, the hashes must match. (The stand-in v6 man is not
  deterministic between calls; its other versions are.)

## Seen before

- Two thin layers stacked too close flicker (z-fighting): keep 0.1 mm or more between them at a face's scale.
- A detail placed by eye can hide behind a lid, a canvas or a wall from the camera that matters: check it from that
  camera.
- Something moving through something else only shows mid-move: shoot the in-between steps, not just the ends.
