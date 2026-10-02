# The virtual camera: filming the 3D worlds

The film camera of the sandbox worlds: how it captures, its helpers for moves, and the stills pass before anything is rendered.

## The camera (`shoot.mjs`)

- Runs **on a Mac only** (Chrome on Metal, the Mac's GPU — no software renderer), against `bun run dev` or a pinned
  build, in a sandbox's **film mode** (`/games/<sandbox>/?film&area=…` — Sandbox 4's cell, Sandbox 3's domes, Sandbox 1's
  island, Sandbox 2's planet and city islands; the shot names its world in `world.sandbox`/`world.area`; `window.__film`).
- A deterministic clock (seeded, a readiness barrier), so every frame is exactly 1/fps after the last.
- Film mode captures **log, never graded**: scene-linear half-float, metered like a camera (middle grey 18% on the
  lower 60% of the frame; `exposure.stops` over or under), shutter blur in linear light, 1.5× oversampled, then
  ACEScct 10-bit. No tone mapping, no contrast, no vignette — the look is made in the studio's Grade tab.
- A shot is a record (`game/film/shot.js`): the studio plays it live on the timeline and the Mac app renders the plate
  only at the final render.

**Camera helpers** (`scripts/film/camera.mjs`; a pose is `[x, y, z, yaw, pitch]`):
- `move(from, to, aimFrom, aimTo, curve)`; `orbit(centre, a0, a1, r0, r1, y0, y1, aim)`; `turn(at, yaw0, yaw1,
  pitch0, pitch1)`; `look(p, q)`; `fly(keys)`; `whip(path, { out | into, d })`.
- `glide` (even speed) is the default curve; `landing` settles softly — the last frame only. `ease` and `drift` start
  and stop on screen: don't use them inside a film.
- Shot lists define `ring(c, r, a, y)`, `still(p, q)` and `R(deg)` locally.
- `cuts()` in camera.mjs is the old pause-centred, dissolve cutter. Don't use it. Cut on words.

## Stills pass

Always check `--mid` or `--stills` frames for: foliage filling the lens, walls or pillars in the way, black frames or
a black sky bar, a dome not built yet, a metered exposure that reads too dark through the output transform.
