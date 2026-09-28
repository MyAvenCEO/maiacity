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

> The render worker (`scripts/film/worker.ts`) cuts hard (`XF = 0`): shots that meet on V1 never crossfade.
> `scripts/film/assemble.mjs` is the older, pre-studio cut and still dissolves — don't use it for new films. Still
> check every render for black frames.

## The camera (`shoot.mjs`)

- Needs `bun run dev` and Chrome, and loads the sandbox page.
- Takes over the world's clock (a virtual `performance.now` and `requestAnimationFrame`), so every frame is exactly
  1/30 s after the last — no stutter, whatever the render cost.
- Frames are drawn at 1.5× and scaled with lanczos; `FILM_SIZE` sets the size. Base grade: contrast 1.05,
  saturation 1.06, gamma 0.98, vignette, plus the shot's `grade`.
- The first frame warms up 45 steps so the sun and shadows settle.

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
- Grades: `COLD = 'eq=saturation=0.45:gamma=0.96:contrast=1.04,colorbalance=bs=0.10:ms=0.04:hs=0.02'` for the low;
  `NIGHT = 'eq=gamma=1.2:saturation=1.08'` for evening and night.

## Exposure, shot by shot (`scripts/film/grade.mjs`)

The world renders dawn, blue hour and night far too dark, and a grade alone can't rescue near-black without banding.
1. **Open the lens at render time:** `exposure: n` multiplies the renderer's exposure. Day 19: pre-dawn flight 9,
   sunrise 1.3 (more burns the sky), night 6–8.
2. **Grade to a target brightness, measured finished:** `exposureFor(shot, samples, chain)` measures the lower 60% of
   the frame through the shot's whole chain and corrects gamma until it hits the hour's target (pre-dawn 100,
   sunrise 106, day 108, blue hour 88, night 72, or the shot's `bright`).
- Check the storyboard *graded*: the vignette takes another 20–40 off a raw still.
- **Brightness alone isn't a grade.** Also match the **black level** (the darkest 10% of the lower frame) to the day
  shots' ≈ 45 (dawn 38, blue hour 32, night 24) by adding contrast, never taking it away.
- **Moods carry the arc in the grade:** `'dip'` (brightness 86, blacks 26, `DIP`: desaturated to 0.58, a sick
  green-grey, grain, heavier vignette) for the world as it was; `'bright'` (118, blacks 34, `BRIGHT`: saturation
  1.14) for the city by day. Push the contrast until it lands (`retention.md`).
- **Keep the ungraded master:** `shoot.mjs` writes `NN-name.raw.mp4` (crf 12) and grades from it, so
  `node scripts/film/grade.mjs <list> [--only …]` re-grades without rendering.

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
a black sky bar, a dome not built yet, too dark once graded.
