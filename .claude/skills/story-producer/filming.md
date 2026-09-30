# Filming and shots

How a maiaCITY film is shot from the sandbox worlds and cut: cinematic shots, cuts on the word, transitions, camera
moves, light and exposure. Learned on **Day 19 · A city in its own garden** (reference: `scripts/film/day-19-d.mjs`;
the weaker first cut `scripts/film/day-19.mjs` shows what not to do).

## Facts on screen

- **Never promise what the world can't show.** Sandbox 4 has **no people**: never narrate people doing things on
  screen. Say what the place gives them ("every home opens onto a wide terrace") and show the place.
- Dome words, spelled right: dome, dome cell, master dome, dome factory. The master dome is **the commons**
  (workshops, young and old learning from each other, the stone theatre) — not where everyone eats.

## Shot grammar

**Every line gets 2–4 shots:** establishing (EWS/WS) → MS → CU/ECU/macro inserts. Vary each:
- **Height:** drone (y 30–150), eye level (1.6), ground macro (0.05–0.3).
- **Lens:** long (fov 10–20) compresses space and gives close-ups from a distance (mango at 12, "picked ripe" at
  10); wide (45–55) shows space.
- **Movement:** push-in, pull-back, lateral dolly, crane, orbit — and never a dead locked-off frame (below).
- **Never cut two same-size shots in a row.** The one exception is a deliberate close-up montage (mango → fig →
  coffee).

## Cut on the spoken word

Every named thing is on screen as it is said: the mango on "mango", the hens on "hens", the bees on "and bees". Use
`cue: [line, 'words']`. `cueAt()` finds the phrase in the take's word timings and throws `cue not found` if the words
don't match the take's text.

## Hard cuts only

**No dissolves. Never black frames between cuts.** Fade up only at the very start and out only at the very end.
The cut types:
- **Scale smash:** ECU → EWS (dew → the whole cell before dawn).
- **Smash cut, warm ↔ cold,** into and out of the low.
- **Match cut on shape:** solar-cell lattice → dome; geodesic node → the whole dome.
- **Cut on action:** the move continues across the cut, in the same direction.
- **Cut on the music's swell.**
- **J-cuts:** the next scene's sound starts about 0.5 s before its picture.

## Motion never starts or stops on screen

Every shot is a slice of a move that was already going and goes on after it:
- Moves run at an **even speed from first frame to last** (`glide`, the default of `move`, `orbit`, `turn`, `fly`).
  No ease-in or ease-out inside a shot — a shot that sets off and comes to rest makes every cut feel like a stop.
- The only exception is the film's very last frame, which may settle (`landing`).
- A locked-off `still` is a stop too: give it a slow push or drift.
- **Hand the motion over at the cut:** the next shot moves in a related direction (continue east after an eastward
  flight), or answers it on purpose (a pull-back after a push-in, on a big turn of the story).
- A long line with one static, empty view dies. Break it into 3–5 moving shots cut on its words; if the world has
  nothing to show for the words, **build a set** (below).

## Cinematic transitions (here and there, never on every cut)

- **Match on motion:** the flight ends moving east, the sunrise shot goes on pushing east.
- **Whip pan:** `whip(path, { out })` flicks the end of one shot sideways, `whip(path, { into })` the start of the
  next, the same way round; give both `blur: 6` so the hard cut hides inside the smear. Use it to jump between places.
- **One continuous drone flight** for the hook: `fly([[pos, aim], …])`, a Catmull-Rom path through several points
  (up out of the forest floor, over the canopy, out to the overview).
- **Time-lapse in a shot:** `hour` → `hourTo` moves the sun during the shot (sunrise 5.05 → 5.4); `fov` → `fovTo`
  zooms.
- **Smash cut** into the low, with a hit on the cut (`sound.md`).

**Sound matches the picture:** you hear the geese when you see them (`sound.md`).

> The render (the Mac app, `vault/crates/vault-render`) cuts hard: shots that meet on V1 never crossfade.
> `scripts/film/assemble.mjs` is the older, pre-studio cut and still dissolves — don't use it for new films. Still
> check every render for black frames.

## The camera (`shoot.mjs`)

- Runs **on a Mac only** (Chrome on Metal, the Mac's GPU — no software renderer), against `bun run dev` or a pinned
  build, in Sandbox 4's **film mode** (`/games/sandbox-4/?film`, `window.__film`).
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

## Light in Sandbox 4 (`window.__interiorHour`)

| Hour | Light |
|---|---|
| ~5–6.5 | sunrise, in +x (east): hour 5 = azimuth 90° |
| 7–10 | low, warm morning |
| 12–13 | overhead (good for looking up into the glass) |
| 17–18.5 | golden hour |
| ~20 | blue hour |
| ~21 | night; the sun sets in −x |

- **Sunrise:** the sun sits on the horizon at hour 5.0, due east (+x); by 5.4 about 5° up. Before 5 the world is near
  black. Keep domes from covering the sun's direction (a dome at 100 m stands about 11° high). `__village.sun(hour)`
  sets the sun at once; `shoot.mjs` calls it every frame of a time-lapse. Film towards +x with the disc clear.
- Night skies read as a black bar in the square frame: prefer dusk, and fill the square with lit domes.
- Looks for the low and the night are grade presets in the studio (`cold`, `night`, `dip`, `bright`, `warm` in
  `game/film/color.js`, ASC CDL in ACEScct) — not filters on the shot.

## Exposure and grade

The world renders dawn, blue hour and night far darker than a film should show them. That is fixed at the source,
like a camera, not by grading a finished image:
1. **Meter, don't grade:** a shot's `exposure: { meter: 'lock' | 'ramp' | 'fixed', stops }` meters middle grey on the
   lower 60% of the frame (the land and the domes; a bright sky does not count) and sets `stops` over or under it:
   pre-dawn and night about +1…+1.5, blue hour +0.5, a sunrise with the disc in frame −0.3 so the sky holds. The
   metered value is pinned into the shot, so a re-render is identical.
2. **Grade in the studio** after the edit is locked: first every shot's balance, levelled scene by scene to its
   master (`grading.md`), then the film's look for the arc (`dip` for the world as it was, `bright` for the city by
   day — `retention.md`), judged on hero frames.
- **Brightness alone isn't a grade.** Match the black level of dark shots to the day shots (lift the offset, add
  contrast with power), and check the storyboard through the output transform, not the raw log still.
- `scripts/film/grade.mjs` is the old pre-grade on finished Rec.709 shots. It stays only for re-grading legacy shots
  shot before film mode; never use it for new shots.

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

## Stills pass

Always check `--mid` or `--stills` frames for: foliage filling the lens, walls or pillars in the way, black frames or
a black sky bar, a dome not built yet, a metered exposure that reads too dark through the output transform.
