# Production pipeline

From an approved story to a rendered film in the media library.

## Local first, in two steps

**Work locally unless the user explicitly says production.** `bun voice` and `bun media` talk to
`https://api.maia.city` by default; `--local` points them at `http://localhost:3100`. Pass `--local` on every command.
The render has no command of its own: maiaCITY Studio (the Mac app) renders, against the API it is signed in to.

Local setup: the API and Postgres run from `docker compose up` (API on :3100), the site with `bun run dev` (:5173),
the terminal is signed in with `bun media login --local`. `FAL_API_KEY` lives in `.env`. Film scripts need Node 22
(`~/.nvm/versions/node/v22.15.0/bin/node`).

**Step 1: the storyboard (cheap, fast, judge the whole film)**
1. The story: transformation, arching question, hook, arc (`arc.md`, `hooks.md`) — approved by Samuel.
2. Voice takes, one per line (`sound.md`); each prints its CID.
3. The shot list, `scripts/film/<film>.mjs` (anatomy below).
4. The score, cues and sound effects (`sound.md`).
5. Storyboard stills: `node scripts/film/shoot.mjs scripts/film/<film>.mjs --mid` (one frame from the middle of each
   shot) or `--stills` (first, middle, last).
6. The storyboard timeline: for Day 19 D, `bun api/scripts/.animatic.ts --local` (hard-wired to `day-19-d`; copy it
   for a new film). It grades each still like its shot, brings it into the library, and lays stills on V1, takes on
   A1, the score on A2, sfx on A3.
7. Play it at `http://localhost:5173/app/studio`, full screen. Run the audit (below). Repeat until approved.

**Step 2: the film (slow, expensive, only after approval)** — Edit → Grade → Render, like a real post house
1. World shots become data, not files: `bun api/scripts/world-timeline.ts --local --from G --variant W` turns each shot
   of the list into a shot record (`/api/shots`: camera, lens, hour, metered exposure, lights, cues) and builds a
   variant with a **world clip** in each shot's place. Each shot version a timeline plays gets an HD log proxy
   automatically — rendered by the Mac app in its own (unseen) world, no Chrome (`vault/app/src/world.rs`).
   (Old way, still works: `node scripts/film/shoot.mjs <list>` renders log plates you bring in as files.)
2. iPhone footage (HEVC Apple Log / Apple Log 2), other camera files and AI EXR sequences: `bun media add` / upload
   in the studio. The colour space is detected (set it in the Bin when a file doesn't say, e.g. an untagged Apple
   Log 2 clip); an HD proxy in the same log encoding is made. Originals are never re-encoded.
3. **Edit** tab: cut on proxies and the live world, then **Lock the edit** (the cut is then fixed; unlock = version
   n+1). **+ Variant** branches the edit under the project's next letter.
4. **Grade** tab: originals swapped in (conform); the base correction first (every shot balanced to its scene's
   master, `grading.md`), then clip CDLs + the film's look (presets); **Hero frame**
   renders the frame at the playhead at full size, 16-bit, through the whole chain — judge the grade on it.
5. **Render** tab: **⤓ Render** (or the MCP tool `render_queue`). **The Mac app is the render worker**: maiaCITY
   Studio claims the job with its key and renders it natively (`vault/app/src/render.rs` → `vault/crates/vault-render`:
   Core Image on Metal, VideoToolbox, AVFoundation, Core Text — no bun, no ffmpeg, no Chrome, nothing to install). It
   takes its turn with the proxies (one heavy GPU job at a time, after an ingest, only while memory is normal; uploads
   wait while it renders) and shows its progress on the job and in Ingest → Activity. World clips first become ACEScct
   plates at each delivery's size, rendered in the app's own unseen world and cached beside the vault (`plates/`, by
   the hash of what they are made of); then the timeline goes into every shape (16:9 4K HEVC Main10 master + 1080
   H.264 in one pass, 9:16, 1:1, 4:5), the hook text over the social copies' first seconds, the sound mixed (voice
   ducks the music) and levelled to −14 LUFS / −1 dBTP (`LOUDNESS` in render.rs), and each file into the vault as a
   delivery (in the timeline's story) and onto the content board; the timeline's stage becomes "rendered".
   Colour-managed: each picture clip — the conformed original, never the proxy — goes through its journey into ACEScct
   (vault-media's cst, the same maths as the proxies), its grade and the film's look, the ACES 2.0 output transform to
   Rec.709 (vault-media's aces2, a 129³ cube), then the captions. EXR sequences render frame by frame from their tar,
   at their own rate. Every delivery is QC'd (BT.709/TV tags, 10-bit master, frames, limits, EBU R 128 loudness)
   before the vault; the report names every transform by its hash. Hero frames (`render_frame` over MCP) are the same
   chain, one frame, a 16-bit PNG. Nothing is ever baked into a source or committed.
   EXR sequences (Luma, Kling, LTX exports) come in with `bun media add-sequence <dir> --profile aces2065-1 --fps 24`.

**Projects and variants:** timelines are grouped by `project` ("Day 19") with variants A, B, C…; each variant is its own
timeline.

## Shot list anatomy (`day-19-d.mjs`, `shoot.mjs`)

| Field | Meaning |
|---|---|
| `name`, `size` | slug for the file; EWS · WS · MS · CU · ECU · macro |
| `cue: [line, 'words']` | cut 0.12 s before those words are spoken in that take |
| `after: [line, s]` | cut s seconds after a line ends |
| `at: s` | cut at an absolute time (the cold open) |
| `hour`, `hourTo` | sun position, and a time-lapse to |
| `fov`, `fovTo` | lens: 10–20 long, 40–55 wide (default 45) |
| `stand: [x, z]`, `dome: i` | where the walker stands; wait for dome i |
| `exposure`, `mood`, `grade` | legacy: read by `fromLegacy` as metered stops and a suggested look — the plate itself stays log, the grade is done in the studio |
| `sfx: [[cid, level]]` | sounds under the shot, looped for its length (by CID) |
| `props` | a set built into the scene while filming |
| `path: (t) => pose` | camera pose over t = 0…1 (`camera.mjs`) |

Voice takes and music are named by CID (`{ take, cid, pause }`, `music: { cid, chunks, cues }`). Each shot runs from its
start to the next shot's start; the last to `total` = the last line's end + `TAIL`.

## The studio and the library

**Studio** (`/app/studio`, code in `src/lib/studio/`): three working steps like DaVinci Resolve's pages, over one
timeline, its stage shown at the top (edit → locked → graded → rendered, and its version).
- **Edit** — tracks **V1 Picture**, **A1 Voice**, **A2 Music**, **A3 Sound**, **T1 Captions** (built from the A1 takes'
  word timings, phrase by phrase, two lines at most). Drag files onto tracks, drag clips to move, edges to trim; Space
  plays, ←/→ seek. One Web Audio clock, sample-exact. Pictures play from their **HD log proxies** (a "no proxy yet"
  badge when there is none), through the viewer's colour path on the GPU: the proxy's input transform → (optionally
  the grade, "Grade preview") → the output transform to Rec.709, through LUTs the Mac app bakes natively (each
  profile's journey in, the ACES 2.0 output transform; a formula fallback, labelled, while they are missing). Every picture shows its colour profile; click the badge to set it by hand (the
  proxy is made again). **World clips** (shots as data, `/api/shots`) sit on V1; the live world (Sandbox 4 in film
  mode, `__film`) draws them on the timeline's clock, their HD proxy plays while it is not ready, a stand-in without
  either. Selected, a world clip opens its lanes — camera keys (double-click adds, drag moves, Delete removes), hour,
  exposure, lights, cues (a sound cue lands on A3) — and **● Record a move** flies the camera over the playing
  timeline. Every change is a new version of the shot; the clip follows it. **◎ Prepare playback** loads every world
  the timeline touches. **🔒 Lock the edit** ends the step.
- **Grade** (the locked cut, on originals) — conform status (originals swapped in, plates per shape, from the last
  render's report), the **film look** and each clip's **grade** as ASC CDL in ACEScct (slope · offset · power per
  channel, saturation), presets, a world shot's "lit for" look, **scopes** (waveform, RGB parade, vectorscope, false
  colour), and the **shape switcher** (16:9 · 9:16 · 1:1 · 4:5) with each media clip's framing per shape. Grades are
  data on the timeline; nothing is baked. **Unlock** makes version n+1 and keeps every clip's grade.
- **Render** — **⤓ Render every delivery** queues the job for the Mac app; the job's stage, progress and report
  (transforms by config hash, conformed clips, plates, warnings); the last render's deliveries per shape with QC and
  loudness, each viewable; the render queue.

**Media library** (`/app/media`, `api/scripts/media.ts`): `library/` is the single source of truth — every file once as
`<cid>.<ext>` with `<cid>.json` (title, description, tags, meta, public). **Everything references a file by its CID;
tags only sort.** `bun media status | seed | add <file> [--title] [--tags] [--replaces <cid>] [--public]`. Only public
files get CDN copies. Scripts use `api/scripts/library.ts` (`put`, `bring`, `get`, `fileOf`).

## Title card and first frame

Every day's title cards and hook layers come from `scripts/film/thumbnail.mjs` (`content-derivatives` skill): four
ratios, the hook set big like a YouTube thumbnail (`hooks.md`), the day's badge. The social copies carry the hook as
text over their first 2.5 s of moving picture — never a still card at the start.

## The audit — before every render

- [ ] Each shot shows what the words say, at the word
- [ ] Each line gets 2–4 shots; no two same-size shots in a row; heights, lenses and moves vary
- [ ] The lens is clear: no leaves filling the frame, no pillar in the way
- [ ] The sound matches the picture: animals audible when seen, the low sounds cold, frogs at night
- [ ] No black flashes between cuts, no dissolves; motion never starts or stops on screen
- [ ] The visual hook within 3 s, the spoken hook within ~10 s
- [ ] The intensity curve holds: the low is really cold, the peak is late and highest, the end is warm
- [ ] Captions on, at most two lines, in sync
- [ ] Every fact true; nothing promised that the world can't show (no people)

## Checklists

**Before recording:** the transformation and the arching question are written down; the hook is as extreme as the
facts allow and the last line pays it off; every fact is checked; each line has its audio tag and "…" breaths; each
line is its own take with `--local` and the voice **id**.

**Before shooting:** every line has 2–4 shots; every named thing has a `cue` on its word and every `cue` resolves; each
shot has its `sfx`, `mood` and `exposure`; the `music.chunks` boundaries sit on the arc's turns; the score and cues are
made and chosen; the storyboard was played in the studio and approved.

**Before rendering:** the stills pass is clean; the shots are in the library; the variant was branched; the audit
passes; the Mac app is open and signed in to the local API, and the render is checked at every cut.

**Before publishing:** the title cards and hook layers are made; captions on; the loop ending lands; Samuel explicitly
asked for production — only then drop `--local`. Never deploy locally; pushing to main deploys.

## Lessons learned

- **One take for the whole script sounded rushed.** One take per line; pauses in the shot list.
- **Generic forest under specific words** loses the viewer. Show the named thing on its word.
- **Words promising what isn't on screen** (people eating) break trust. Sandbox 4 has no people.
- **The master dome was once "where everyone eats".** Wrong: it is the commons.
- **Dissolves and dips to black** read as slideshow and flashed black. Hard cuts.
- **One shot per line** felt monotone. D has 40 shots cut on words.
- **A licensed stock track** couldn't follow the arc. Compose the score to the film's clock.
- **Uploading to production when local was meant.** Always `--local`.
- **Cold open:** open on a 3.5 s visual (dew, dawn birds), then the spoken hook states the end state before the
  sunrise.
- **Shots that eased in and out** made every cut feel like a stop. Moves glide through the cut.
- **"The sun rises" never showed the sun:** film towards +x, keep the disc clear, run the hour as a time-lapse.
- **Dark shots:** exposure set per shot, graded to target brightness and black level.
- **An 11-second low on one static empty plain:** nothing happened. Five moving shots on a built set carry the words.
- **A soft return after the low** didn't land. The turn needs loudness, rhythm and brightness at once.
- **A still title card at the start of the film** stopped it in the second that decides whether people stay. The hook
  is text over moving picture.
- **Night frames** show a black sky band. Shoot at dusk and fill the square with lit domes.
