---
name: movie-producer
description: How maiaCITY makes films from the sandbox worlds, learned on the first documentary ("Day 19 · A city in its own garden", Sandbox 4). Use it whenever the work is making, planning, scripting, shooting, scoring, cutting or exporting a maiaCITY film, reel or documentary from the sandbox worlds. Also use it for voice-over takes, film music, sound design, shot lists, storyboards, the studio editor (/app/studio) and the render worker (bun film worker).
---

# Movie producer

This is how a maiaCITY film gets made: from the story, through voice takes, a composed score, a shot list cut to the spoken word, a storyboard, full shots and the studio, to a rendered film in the media library. Everything here comes from producing **Day 19 · A city in its own garden**. The reference is variant D, `scripts/film/day-19-d.mjs`. The weaker first cut, `scripts/film/day-19.mjs`, shows what not to do.

Before writing any narration, load the `writer` skill for voice and read `blog/STORYTELLING.md`. The film follows the same rules: one transformation, a hook made of parts, rehooks, full conviction and true facts.

## 1. The pipeline: local first, in two steps

**Work locally unless the user explicitly says production.** `bun voice` and `bun media` talk to `https://api.maia.city` by default. Only `--local` points them at `http://localhost:3100`. Pass `--local` on every command. (`bun film worker` works the same way.)

Local setup: the API and Postgres run from `docker compose up` (API on :3100), the site runs with `bun run dev` (:5173), and the terminal is signed in with `bun media login --local`. `FAL_API_KEY` lives in `.env`.

**Step 1: the storyboard (cheap, fast, judge the whole film)**

1. Write the script: one transformation, a hook and a four-act arc (section 2).
2. Record voice takes, one per line: `bun voice say "<line>" --eleven NOpBlnGInO9m6vDvFkFC --stability 0.5 --name <take> --local`. This puts the take into the media library (`library/<cid>.mp3`, its word timings in `library/<cid>.json`; then the database) and prints its CID. The shot list names each take by that CID.
3. Write the shot list, `scripts/film/<film>.mjs`. It sets each take with the pause before it, the shots with `cue`/`after`/`at`, the sfx per shot, and `music.chunks` (section 6).
4. Make the score and cues: `bun scripts/film/score.ts scripts/film/<film>.mjs --local` (a new score or cue replaces the old one's CID in the shot list; `--take b` prints a second take's CID). A sound effect: `--sfx <name>` makes it from its recipe and prints its CID, which goes into the shot list by hand.
5. Shoot storyboard stills: `node scripts/film/shoot.mjs scripts/film/<film>.mjs --mid`. This gives one frame from the middle of each shot, `studio/film/<name>/NN-<shot>-b.jpg`.
6. Build the storyboard timeline. For Day 19 D this was `bun api/scripts/.animatic.ts --local`. It is hard-wired to `day-19-d`, so copy it and point it at the new film. It grades each still like its shot, brings it into the library (tags `Day 19`, `role:storyboard`, `cut:<variant>`, `shot:…`), puts the stills on V1 at their cuts, takes on A1, the score on A2 at 0.5 and sfx on A3 (normalized), and saves it as a project/variant timeline.
7. Play it live at `http://localhost:5173/app/studio`, in full screen. Run the audit (section 9) and fix the shot list. Repeat until the user approves.

**Step 2: the film (slow, expensive, only after approval)**

1. Shoot the full shots: `node scripts/film/shoot.mjs scripts/film/<film>.mjs` produces `studio/film/<name>/NN-<shot>.mp4`. Useful variants:
   - `--stills` writes the first, middle and last frame (`-a/-b/-c.jpg`) for a framing check of a whole move.
   - `--only 3,7` reshoots just those shots (1-based).
2. Put the shots into the library, e.g. `bun media add studio/film/<name>/NN-<shot>.mp4 --title "Day 19 · 05 the edge" --tags "Day 19,role:shot" --local` (it prints the CID; `studio/film/` is only the shooting's scratch folder — delete it once the shots are in).
3. In the studio, open the storyboard timeline and press **+ Variant**. That copies the edit under the project's next letter. Swap the stills for the shots.
4. Export: press **⤓ Render** in the studio, and run `bun film worker --local` in a terminal. The worker claims the job, renders the timeline exactly as edited, and brings every delivered file into the library (`library/<cid>.<ext>`, tagged `role:render`, `cut:`, `aspect:`, `codec:`; then the database). The studio shows its progress.

**Projects and variants.** Timelines are grouped by `project` (e.g. "Day 19") with variants A, B, C… This is metadata only: each variant is its own timeline in the database. **+ Variant** branches the open one, and the project and variant fields sit in the studio's top bar.

Shot list anatomy (verified in `day-19-d.mjs` and `shoot.mjs`):

| Field | Meaning |
|---|---|
| `name`, `size` | slug for the file; EWS · WS · MS · CU · ECU · macro (the grammar the stills are judged by) |
| `cue: [line, 'words']` | cut 0.12 s before those words are spoken in that take |
| `after: [line, s]` | cut s seconds after a line ends (the music plays on it) |
| `at: s` | cut at an absolute time (the cold open) |
| `hour` | sun position for the shot |
| `fov` | lens: 10–20 long, 40–55 wide (default 45) |
| `stand: [x, z]` | where the walker stands, which decides which dome is built and shown |
| `dome: i` | wait until dome i is built and shown before filming |
| `grade` | extra ffmpeg filter (e.g. `COLD`, `NIGHT`) |
| `sfx: [[path, level]]` | sounds under the shot, looped for its length |
| `path: (t) => pose` | camera pose over t = 0…1 (from `camera.mjs`) |

Each shot runs from its start to the next shot's start. The last shot runs to `total` = the last line's end + `TAIL`. The export is `{ name, size, fps, voices, music, total, cuts, shots }`.

## 2. Story first

**One transformation.** For Day 19 it went from *a good life depends on things brought from far away* to *a good life grows where you live, built by the people who live there*. Every line walks toward that.

**A spoken hook in the first seconds.** It states the end state plus the contrast, and the last line pays it off:

> [quietly] Two hundred and thirty-three people live here… and almost nothing they eat comes from further than a few minutes' walk.

**The arc.** The acts rehook at each change, so every act opens with a line that asks a new question:

| Act | Lines | Beat |
|---|---|---|
| I | hook, sunrise | the end state, then awe: "a small city wakes inside its own garden" |
| (dip) | "Not long ago…" | the old life: trucks, a tired land |
| II | here, terraces, layers, glass, food forest, health | abundance, food that heals |
| III | the ring, the commons, "Nothing here was handed down" | together, and pride |
| IV | evening, nightfall | tenderness, then hope and the payoff |

**Facts must be right.**
- 233 people per dome cell.
- The master dome is **the commons**: workshops, young and old learning from each other, the stone theatre. It is not a place where everyone eats.
- Never promise what the world can't show. Sandbox 4 has **no people**, so never narrate people doing things on screen. Say what the place gives them ("every home opens onto a wide terrace") and show the place.
- Dome words, spelled right: dome, dome cell, master dome, dome factory.

## 3. Emotional arc and contrast

The intensity curve for Day 19, on a scale of 1–5:

| hook | sunrise | dip | warmth | wonder | breath | pride | tender | silence | hope |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 5 | 1 | 3 | 5 | 3 | **5 (highest)** | 2 | – | 4 |

End lower than the peak but warmer than the start. **Contrast creates the feeling.** Build it on every axis:

- **Pacing:** calm holds against fast montages.
- **Light:** a day-to-night arc, plus one cold, desaturated grade for the dip (`COLD`). The world never looks grey otherwise.
- **Audio:**
  - a cold open of birds only (dawn chorus);
  - for the dip, the music drops to a single cello drone and cold wind;
  - animals are heard on their words (hens, geese, bees);
  - near silence with frogs and crickets before the last line (a 3.0 s pause).
- **Music:** each section switches with the arc, so the swell lands on the sunrise and the drop lands on the tired land (section 6).

## 4. Pace that holds attention

- **The visual hook comes within 3 s** (Day 19 opens on an ECU of dew). **The spoken hook comes within about 10 s** (the first word lands at 3.5 s, `COLD_OPEN`).
- Change something every 4–8 s: the shot, the size, the movement, the sound.
- Never cut two same-size shots in a row. The one exception is a deliberate close-up montage (mango → fig → coffee).
- Shot length varies by act, so alternate rather than making every shot 2–5 s:
  - calm: 5–6 s;
  - montage: 1–2.5 s;
  - awe holds: 10–14 s.
- **Breath beats** carry no voice: the pause after the sunrise line, the 3.8 s before "Thirteen domes", the frogs before the ending. The pacing lives in `lines[].pause`.
- Captions are always on: two lines at most, short phrases.
- The feed format is 1:1 (1080 × 1080).
- **Loop ending:** the last frame lands on the dome from shot 3, so the replay flows on.

## 5. Shot grammar and cutting

**Every line gets 2–4 shots:** establishing (EWS/WS) → MS → CU/ECU/macro inserts. Vary each of these:
- **Height:** drone (y 30–150), eye level (1.6), ground macro (0.05–0.3).
- **Lens:**
  - long (fov 10–20) compresses space and gives close-ups from a distance (mango at 12, "picked ripe" at 10);
  - wide (45–55) shows space.
- **Movement:** push-in, pull-back, lateral dolly, crane, orbit, locked-off (`still`).

**Cut on the spoken word.** Every named thing is on screen as it is said: the mango on "mango", the hens on "hens", the geese on "geese", the bees on "and bees". Use `cue: [line, 'words']`. `cueAt()` finds the phrase in the take's word timings and throws `cue not found` if the words don't match the take's text.

**Hard cuts only. No dissolves.** The cut types:
- **Scale smash:** ECU → EWS (dew → the whole cell before dawn).
- **Smash cut, warm ↔ cold,** into and out of the dip.
- **Match cut on shape:** solar-cell lattice → dome; geodesic node → the whole dome.
- **Cut on action:** the move continues across the cut, in the same direction.
- **Cut on the music's swell.**
- **J-cuts:** the next scene's sound starts about 0.5 s before its picture.

**Never put black frames between cuts.** Fade up only at the very start and fade out only at the very end.

**Motion never starts or stops on screen.** Every shot is a slice cut out of a move that was already going before it and goes on after it:
- Moves run at an **even speed from the first frame to the last** (`glide`, now the default of `move`, `orbit`, `turn`, `fly`). No ease-in or ease-out inside a shot — a shot that sets off and comes to rest makes every cut feel like a stop.
- The only exception is the film's very last frame, which may come to rest (`landing`: already moving, softly settling).
- A locked-off `still` is a stop too. Give it a slow push or drift instead.
- **Hand the motion over at the cut:** the next shot moves in a related direction (continue east after an eastward flight, rise after a rise), or answers it on purpose (a pull-back after a push-in, on a big turn of the story).
- A long line with one static, empty view dies. Break it into 3–5 moving shots cut on its words, and if the world has nothing to show for the words, **build a set** (below).

**Transition tactics, here and there (never on every cut):**
- **Match on motion:** the flight ends moving east, the sunrise shot goes on pushing east.
- **Whip pan:** `whip(path, { out })` flicks the end of one shot sideways, `whip(path, { into })` the start of the next, the same way round; give both `blur: 6` (the frame is exposed over its time, so the flick smears) and the hard cut hides inside the blur. Use it to jump between places (inside the master dome → the food forest; the walk → the ring).
- **One continuous drone flight** for the hook: `fly([[pos, aim], …])` — a Catmull-Rom path through several points, e.g. up out of the forest floor, over the canopy, out to the overview.
- **Time-lapse in a shot:** `hour` → `hourTo` moves the sun during the shot (the sunrise: 5.05 → 5.4, the disc clears the horizon); `fov` → `fovTo` zooms.
- **Smash cut** into the dip, with a hit on the cut (sound, §7).

**Sound must match the picture:** you hear the geese when you see them. Each shot carries its own spot `sfx`; the place's sound is a bed that runs under the cuts (§7).

> The render worker (`scripts/film/worker.ts`) cuts hard (`XF = 0`): shots that meet on V1 never crossfade, so there is never a dip to black between them. `scripts/film/assemble.mjs` is the older, pre-studio cut and still dissolves (`xfade`, 0.6 s); don't use it for new films. Still check every render for black frames.

## 6. Voice

- **Model:** ElevenLabs v3 through fal, `fal-ai/elevenlabs/tts/eleven-v3`, about $0.10 per 1000 characters. `timestamps: true` returns per-character timings, and `wordsOf()` in `api/scripts/voice.ts` joins them into words and drops audio tags.
- **Audio tags** go in the text: `[softly] [warmly] [wistfully] [chuckles] [whispers] [with wonder] [proudly] [firmly] [quietly] [delighted]`. Use "…" for a breath.
- **Narrator:** "Grandpa Spuds Oxley" from the ElevenLabs Voice Library, a friendly grandpa storyteller. Voice id `NOpBlnGInO9m6vDvFkFC`, kept as `spuds` in `studio/voices.json`. fal needs the **voice ID, not the name**. `--eleven` passes it straight through, so use the id.
- **Record each line as its own take**, with a name like `day-19-d-hook`, `day-19-d-01`, …:
  ```
  bun voice say "[quietly] Two hundred and thirty-three people live here… and almost nothing they eat comes from further than a few minutes' walk." --eleven NOpBlnGInO9m6vDvFkFC --stability 0.5 --name day-19-d-hook --local
  ```
  Then the pause before each line is set in the shot list, not by the reading speed. One long take for the whole script sounded rushed.
- **Rejected voices:**
  - Brian (an ElevenLabs preset) was the first choice.
  - MiniMax Speech 2.8 HD (`fal-ai/minimax/speech-2.8-hd`, with voices designed by `fal-ai/minimax/voice-design` via `bun voice design "<description>" --name narrator`) sounded too sleepy.
- **Never clone a real person's voice** (e.g. Attenborough). Describe the qualities instead.

## 7. Music and sound effects

**Compose an original score for each film:** `bun scripts/film/score.ts scripts/film/<film>.mjs --local [--only music|sfx] [--take b]`.

- The model is ElevenLabs Music v2.5 on fal, `elevenlabs/music/v2.5`, called with a `composition_plan` of chunks. Each chunk is 3–120 s and there are at most 30.
- `music.chunks` in the shot list gives each section's `until` (on the film's clock, e.g. `voices[i].speechStart - 0.4`) and its `styles`. The script turns those into `duration_ms` and `positive_styles` (plus "instrumental", "film score"). It adds negative styles (vocals, lyrics, singing, drum machine, EDM) and uses no lyrics.
- `force_instrumental` can't be combined with a composition plan. Keep the score instrumental with the negative styles.
- Make an A and a B take and choose between them. Take A goes to `music.path`, take B to `…-b.mp3`. Both also land in `studio/film/<name>/score-<take>.mp3`.
- Day 19's sections, in order:
  1. pre-dawn pad;
  2. sunrise swell (brass, strings, choir);
  3. a drop to a lone cello drone;
  4. warm piano;
  5. marimba and pizzicato entering;
  6. full, joyful;
  7. the epic peak (the pride);
  8. a sudden quiet (piano and cello);
  9. a final hopeful swell that fades.

**Sound design is three layers** (`sound` in the shot list, built into A3 by `scripts/film/sound.ts`):
- **Beds, one per scene,** from its first shot to its last (`{ path, from, to, level, loop }`): dawn chorus → cold wind → soft nature → forest → the commons → evening → crickets. A bed runs on under the picture cuts and crossfades (1.2 s) into the next scene's. **Never restart a bed at every cut** — that makes the sound pump. Loops are chained seamlessly.
- **Spot sounds** on their shot (`sfx`): the hens on the hens, a truck on the highway. Cut in with the picture.
- **Hits, few and on purpose** (`{ path, peak, level }`): the script finds the sound's loudest moment and puts it on `peak`. Day 19: a reverse swell + low boom on the smash cut into the dip, a distant lorry on "carried by trucks", a soft whoosh on the orbit, a sub hit after the last word. No whooshes on ordinary cuts, **no riser fading up over the final frames**, and **no riser into the sunrise** (both sounded wrong; let the score and the dawn chorus carry it).
- **Cues: the score's own turns, without composing it again.** `music.cues` in the shot list, composed by `score.ts --only cues`, cut into A2 by `musicClips()` (sound.ts). A cue with `replace: true` takes the score's place for its stretch — the score stops just before it and comes back at `music.back`; any other cue lies on top. Day 19: a dread cue over the dip (a dissonant orchestral impact on the cut — it lands 0.13 s into the file, so it starts that much early — then low string clusters and a machine pulse, no melody) that ends in silence on "Here…"; 0.35 s later a **breakfast** cue bursts in (a sunburst major chord, then a bouncy rhythmic piano with pizzicato and light percussion, 92 bpm) and runs until the score's marimba section. Replacing cues less than a second apart leave silence between them. The rest of the score is untouched. A cue's `blend` (breakfast: 2.5 s) overlaps its end with the score's return, fading one up under the other in a pause of the voice — the first version switched in 0.8 s and the change of key and tempo sounded abrupt.
- **A turn needs energy, not just warmth.** The score's soft "warm piano" after the dip was ~8 dB quieter and too gentle: the contrast didn't land. Joy after the dip means a lift in loudness, rhythm and brightness at once — a soft return reads as more of the same.
- **Also make the turns in the sound, not only the music.** Keep the score; change what's under it. Day 19's dip layers a motorway drone (`traffic-drone`) under the cold wind, a truck passing close on the cut in, a distant air horn on "far away", a lorry on "trucks". Both dip beds have `hardOut: true` — they stop dead on "Here…" — and the next bed comes in `after: 0.35` s, so there is a beat of silence, then close morning birds (a hit) and the soft garden.
- Clips carry their own fades (`fin`, `fout`).
- **The music steps back under the voice:** the worker ducks A2 with the voice as the key (sidechain, about −6 dB, 120 ms attack, 900 ms release) and lets it swell in the pauses; the studio plays it the same way. Set the score around 0.6.
- Match the sound to the place: a workshop's tools under the commons made it sound like a factory. Choose what the scene *means* (birds under glass, a fountain, distant voices).

**Sound effects** come from `fal-ai/elevenlabs/sound-effects/v2` (at most 22 s; `loop: true` makes a seamless loop). Any `/studio/sfx/<name>.mp3` a shot uses that isn't in the library yet is made from its recipe in `SFX` in `score.ts`: `dawn-chorus`, `cold-wind`, `commons`, `crickets`, `goats`, `truck-pass`, `riser-sunrise`, `drop-hit`, `whoosh-orbit`, `sub-hit`, … For a new sound, add a recipe there with `text`, `seconds` and `loop`.

**The game's own recordings** live in `/sounds/` (forest_nature, soft-nature, chickens, geese, bees, frog, sheep, water_stream). They are not equally loud. Multiply the level by: sheep ×22.1, frog ×0.35, bees ×0.66, geese ×1.5. The same factors are used in `assemble.mjs`, `.animatic.ts` and `src/lib/sandbox-2/interior/ambience.ts`.

**Levels:**
- music bed about 0.25–0.5 under the voice (the storyboard uses 0.5; the studio's default for A2 is 0.3);
- sfx about 0.1–0.35 (the studio's default for A3 is 0.2).

## 8. Framing and light in Sandbox 4

**The camera** (`shoot.mjs`):
- It needs `bun run dev` and Chrome, and loads `/games/sandbox-4/`.
- It takes over the world's clock (a virtual `performance.now` and `requestAnimationFrame`), so every frame is exactly 1/30 s after the last. There is no stutter, whatever the render cost.
- Frames are drawn at 1.5× and scaled to 1080 with lanczos. The light grade is contrast 1.05, saturation 1.06, gamma 0.98, plus a vignette, and the shot's `grade` is added.
- The first frame warms up 45 steps so the sun and shadows settle.

**Light by `hour`** (`window.__interiorHour`):

| Hour | Light |
|---|---|
| ~5–6.5 | sunrise, in +x (east): hour 5 = azimuth 90° |
| 7–10 | low, warm morning |
| 12–13 | overhead (good for looking up into the glass) |
| 17–18.5 | golden hour |
| ~20 | blue hour |
| ~21 | night; the sun sets in −x |

Night skies read as a black letterbox bar in the square frame. Prefer dusk, and frame the domes so they fill the square. Grades from day-19-d:
- `COLD = 'eq=saturation=0.45:gamma=0.96:contrast=1.04,colorbalance=bs=0.10:ms=0.04:hs=0.02'` for the dip;
- `NIGHT = 'eq=gamma=1.2:saturation=1.08'` for the evening and night shots.

**`stand` and `dome`.** Only the dome nearest the walker is built inside and shown in full. Set `stand` near the dome you film, and set `dome: i` to wait for it.

**Dome indices:**
- 0 is the master dome.
- 1–6 are the large domes at `polar(150, k·60°)`, so 1 = (0,150) and 2 = (130,75).
- 7–12 are the medium domes at `polar(200, 30°+k·60°)`, so 8 = (200,0).

**World coordinates** (x, z in metres):
- **Master dome** (0,0), R 68 (diameter 136): the commons, its gallery ring, the stone theatre at the centre, workshops at its foot (ring r ≈ 60).
- **Large domes** at 150 m, e.g. (0,150), (130,75), (130,−75): R 35. The terrace is at 5 m and runs from r 34 to 41, with arches every 7.5° centred on 45°.
- **Medium domes** at 200 m: R 20.
- **Animals** (the spots day-19-d used): hens (49,77), bees/hives (57,104), frogs (69,96), goats (135,120), geese (94,316) by the stream. The live positions are in `window.__village.herds` (hens, bees, frogs, goats, geese).
- **Playgrounds** at 118 m. The stream runs by (100–110, 290–315).

**Camera helpers** (`scripts/film/camera.mjs`; a pose is `[x, y, z, yaw, pitch]`):
- `move(from, to, aimFrom, aimTo, curve)` travels from one position and aim to another.
- `orbit(centre, a0, a1, r0, r1, y0, y1, aim)` circles a centre.
- `turn(at, yaw0, yaw1, pitch0, pitch1)` turns in place, e.g. looking up into a dome.
- `look(p, q)` gives the pose at p looking at q.
- `fly(keys)` flies a smooth path through several `[position, aim]` points (a drone shot in one move).
- `whip(path, { out | into, d })` adds a whip pan at the end or start (pair them across a cut, with `blur`).
- `glide` (even speed) is the default curve. `landing` settles softly — only the film's last frame. `ease` and `drift` start and stop on screen: don't use them inside a film.
- The shot lists define these locally: `ring(c, r, a, y)` for a point on a dome's ring, `still(p, q)` for a locked-off shot, and `R(deg)`.
- `cuts()` in camera.mjs is the old pause-centred, dissolve-overlap cutter. Don't use it. Cut on words instead.

**Sets** (`scripts/film/props.mjs`): when the story needs something the world doesn't have, build it into the scene while filming — never into the game. A shot names it (`props: 'tired-land'`); `shoot.mjs` builds it once and calls `window.__props(clock)` on every frame with the film's time, so what moves (the trucks) is exactly where the shot list expects. Day 19's `tired-land`, west of the city's edge (x < −398): ploughed monoculture fields, a highway at x = −470 running north–south, power lines, dead trees, eight trucks (`z32` = where each is at 0:32). The empty green plain beyond the edge showed nothing and read as a dead, static shot.

**Sunrise:** the sun sits on the horizon at hour 5.0, due east (+x); by 5.4 it is about 5° up. Before 5 the world is near black. Keep domes from covering the sun's direction (a dome at 100 m stands about 11° high). The dev hook `__village.sun(hour)` sets the sun at once; `shoot.mjs` calls it on every frame of a time-lapse.

**Exposure, shot by shot** (`scripts/film/grade.mjs`). The world renders dawn, blue hour and night far too dark (a night frame measured 4–15 of 255), and a grade alone can't rescue near-black without banding. Two steps:
1. **Open the lens at render time** for dark shots: `exposure: n` multiplies the renderer's exposure (`window.__exposure`). Day 19: the pre-dawn flight 9, the sunrise 1.3 (more burns the sky white and loses the disc), night 6–8.
2. **Grade to a target brightness, measured finished.** `exposureFor(shot, samples, chain)` measures the lower 60% of the frame (the land, not the sky), runs the shot's whole filter chain (exposure, base grade, look, vignette) and corrects the gamma until the result hits the target for its hour: pre-dawn 100, sunrise 106, day 108, blue hour 88, night 72 (or the shot's `bright`). `shoot.mjs` does it on five frames of every shot, the storyboard builder on its stills, so a still and its shot match. The looks (`COLD`, `NIGHT`) carry colour only, never brightness.
- Always check the storyboard *graded*: measuring the raw still hid that the vignette took another 20–40 off.
- **Brightness alone isn't a grade.** Lifting with gamma raises the shadows, and a lifted shot goes flat and milky beside the day shots. The grade also matches the **black level** (the 10% darkest of the lower frame) to the day shots' ≈ 45 (dawn 38, blue hour 32, night 24) by adding contrast, never taking it away, while holding the brightness. The pre-dawn flight went from blacks at 74 and a range of 64 to 51 and 112.
- **Moods carry the arc in the grade.** A shot's `mood` sets its targets and `extra` adds a look on top: `'dip'` (brightness 86, blacks 26, `DIP`: desaturated to 0.58, a sick green-grey cast, grain, a heavier vignette) for the world as it was; `'bright'` (118, blacks 34, `BRIGHT`: saturation 1.14) for the city by day from "Here… breakfast" to the evening. Push the contrast between them until it lands — the first, subtler dip read as merely grey.
- **Keep the ungraded master.** `shoot.mjs` writes `NN-name.raw.mp4` (crf 12) and grades `NN-name.mp4` from it, so `node scripts/film/grade.mjs <list> [--only …]` re-grades without rendering again. (Shots without a master get a correction on top of their grade.)
- **Fill the timeline as it renders:** `api/scripts/.live-timeline.ts` starts the full variant from the storyboard and swaps each shot in the moment it is written.

**Always do a stills pass** (`--mid` or `--stills`) and check each frame for:
- foliage filling the lens;
- walls or pillars in the way;
- black frames or a black sky bar;
- a dome that isn't built yet.

## 9. The audit: run it before every render

Variant B failed on every one of these points. Check each one on the storyboard and again on the full cut.

- [ ] **Does each shot show what the words say, at the word?** (B showed generic forest while the line named mango, hens, geese.)
- [ ] **Does each line get 2–4 shots,** not one monotone shot per line?
- [ ] **Does the framing vary:** no two same-size shots in a row, and a mix of heights, lenses and moves?
- [ ] **Is the lens clear:** no leaves filling the frame, no pillar in the way?
- [ ] **Does the sound match the picture:** animals audible when seen, cold wind in the dip, frogs at night?
- [ ] **No black flashes between cuts,** and no dissolves?
- [ ] Is the hook spoken within ~10 s, with the visual hook in the first 3 s?
- [ ] Does the intensity curve hold: the dip is really cold, the pride is the peak, the end is warm?
- [ ] Are the captions on, at most two lines, and in sync?
- [ ] Is every fact true, and is nothing promised that the world can't show (no people)?

## 10. The studio and the library

**Studio** (`/app/studio`, `src/routes/app/studio/+page.svelte`):
- The tracks are **V1 Picture**, **A1 Voice**, **A2 Music**, **A3 Sound** and **T1 Captions**.
- T1 is built from the A1 takes' `meta.words`, phrase by phrase, broken at punctuation, and never more than two lines.
- Drag a file from the library onto a track (double-click drops it at the playhead). Drag a clip to move it, drag its edges to trim, and click it for the inspector (volume).
- Keys: Space plays, ←/→ seek 0.1 s (1 s with Shift), Home goes to the start, Delete removes the clip.
- The frame can be 1:1, 16:9, 9:16 or 4:5.
- Playback is one Web Audio clock, sample-exact. Safari only makes sound after a click, so start playback with the Play button.
- **⛶ Play full screen** plays the picture alone from the start. **⛶ Full screen** fills the screen with the whole editor.
- Timelines are saved in the database (`/api/timelines`) and listed on the left, grouped by project with lettered variants.
- **⤓ Render** queues a job for `bun film worker`.

**Media library** (`/app/media`, `api/scripts/media.ts`):
- **`library/` is the single source of truth**: every file once, as a real copy named `<cid>.<ext>`, and beside it `<cid>.json` — title, description, tags, meta, `public`. No paths, no folders. The databases (local, later production) are seeded from it; the site, the studio and the servers only read the database (in production the CDN copies of the public files).
- **Everything references a file by its CID** — articles (`cover: <cid>.jpg`), shot lists, `thumbnail.json`, `derivatives.json`, code. **Tags only sort**; they never find a file.
- Commands (`--local` for the local database):
  - `bun media status` — what `library/` holds, and how the database differs from it.
  - `bun media seed` — make the database match `library/` (uploads, descriptions, public copies, the site's manifest).
  - `bun media add <file> [--title "…"] [--description "…"] [--tags a,b] [--replaces <cid>] [--public]` — copy a file in, describe it, seed it; prints its CID. `--replaces` marks the old one superseded.
- `public: true` only for what the site or a platform shows (articles' pictures, title cards, the blog's film); working files (shots, takes, raws, renders) stay private — only public files get a copy on Bunny.
- Scripts use `api/scripts/library.ts`: `put()` (into `library/`), `bring()` (into `library/` and the database), `get(cid)`, `fileOf(cid)`.

## 11. Thumbnail and first frame

The first frame is a **hook title card** set over the film's best hero still (for Day 19, the dome at sunrise or the terrace over the canopy). Build the title like a post title: subject + action + end state + contrast, e.g. *"233 people grow almost everything they eat a few minutes from home."* Keep it short enough to read in one second at feed size, and no colon subtitles.

## 12. Checklists

**Before recording**
- [ ] The transformation (from → to) is written down.
- [ ] The hook has an end state and a contrast, and the last line pays it off.
- [ ] Every fact is checked: 233 people per dome cell, the commons, no people on screen.
- [ ] Each line has its audio tag and "…" breaths.
- [ ] Each line is its own take with `--local` and the voice **id**.

**Before shooting**
- [ ] Every line has 2–4 shots, with sizes varied and no same-size neighbours.
- [ ] Every named thing has a `cue` on its word, and every `cue` resolves (the list imports without `cue not found`).
- [ ] Each shot has its `sfx`, the dip has the `COLD` grade and the night shots have `NIGHT`.
- [ ] The `music.chunks` boundaries sit on the arc's turns. The score and sfx are made, and the A/B takes are chosen.
- [ ] The `--mid` storyboard has been played in the studio and approved by the user.

**Before rendering**
- [ ] The `--stills` pass is clean: no leaves in the lens, no walls in the way, no black sky bars.
- [ ] The full shots are in the library, and the variant was branched with **+ Variant**.
- [ ] The audit (section 9) passes.
- [ ] The worker is run with `--local`, and the render is checked frame by frame at every cut for black flashes.

**Before publishing**
- [ ] The first frame is the title card, the captions are on and the frame is 1:1.
- [ ] The loop ending lands on shot 3's dome.
- [ ] The user explicitly asked for production. Only then drop `--local` (`bun media add`/`sync` to production). Never deploy locally; pushing to main deploys.

## Lessons learned

- **One take for the whole script sounded rushed.** Record one take per line and set the pauses in the shot list.
- **Generic forest shots under specific words** lose the viewer. Show the named thing on its word.
- **Words promising what isn't on screen** (people eating, children playing) break trust. Sandbox 4 has no people.
- **The master dome was once described as where everyone eats.** Wrong: it is the commons.
- **Dissolving, and dipping to black, between shots** read as slideshow and caused black flashes. Use hard cuts.
- **One shot per line** (`day-19.mjs`: 13 shots for 13 lines, cut in the pauses with `cuts()`) felt monotone. D has 40 shots cut on words.
- **A licensed stock track** (`/music/kulakovka-cinematic-promo.mp3`) couldn't follow the arc. Compose a score to the film's clock instead.
- **Uploading to production when the user wanted local.** Always pass `--local`.
- **Cold open and hook order:** the first version opened on a sunrise line with 2.5 s of music. D opens on a 3.5 s visual (dew, dawn birds), and the spoken hook states the end state before the sunrise.
- **Shots that eased in and out** made every cut feel like the camera stopping and starting. Moves now glide at an even speed through the cut.
- **"The sun rises" and "the glass glows" never showed the sun:** the camera looked west with the sun behind it, and the hour was fixed. Film towards +x, keep the disc clear of domes, and run the hour as a time-lapse.
- **Dark shots in the storyboard** (the sunrise, the flight, the night): exposure is now set per shot (above). Long shots show their start, middle and end stills in the storyboard, so a flight is readable.
- **An 11-second dip on one static view of an empty plain:** nothing happened. Five moving shots on a built set (fields, highway, trucks) carry the words.
- **The studio monitor flashed black and froze at cuts** because it swapped one `<video>`'s file at each cut. It now keeps the shot on screen and the next two loaded, paused on their first frame.
- **Night frames** show a black sky band. Shoot at dusk and fill the square with lit domes.
- `day-19-d.mjs` comments still say `score.mjs`, but the script is `scripts/film/score.ts`.
