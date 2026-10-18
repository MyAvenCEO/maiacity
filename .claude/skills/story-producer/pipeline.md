# Production pipeline

From an approved story to a rendered film in the media library.

## Local first, in two steps

**Everything lives in Studio 2: avenDB, in The OS app.** Cuts, world shots, files, renders and their jobs are
entries of the Maia City vault; nothing goes to the old API's timelines or the legacy media vault (127.0.0.1:4545 and
its token are retired). `bun voice` and `bun media` bring files into avenDB's Library as the agent device
agentScripts (`scripts/film/vault.mjs`): no login, one approval in The OS app the first time. The render has no
command of its own: The OS app renders, as Studio 2's worker. Agents work through the avendb MCP ("Studio 2 through
avenDB" below).

Local setup: the site with `bun run dev` (:5173), The OS app open with avenDB unlocked. `FAL_API_KEY` lives in
`.env`. Film scripts need Node 22 (`~/.nvm/versions/node/v22.15.0/bin/node`).

**Step 1: the storyboard (cheap, fast, judge the whole film)**
1. The story: transformation, arching question, hook, arc (`storyteller`, `hook-writer`) — approved by Samuel.
2. Voice takes, one per line (`sound-designer`); each prints its BLAKE3 hash.
3. The shot list, `scripts/film/<film>.mjs` (its anatomy: `director`, `shot-list.md`).
4. The score, cues and sound effects (`sound-designer`).
5. Storyboard stills: `node scripts/film/shoot.mjs scripts/film/<film>.mjs --mid` (one frame from the middle of each
   shot) or `--stills` (first, middle, last).
6. The storyboard timeline: for Day 19 D, `bun api/scripts/.animatic.ts --local` (hard-wired to `day-19-d`; copy it
   for a new film). It grades each still like its shot, brings it into the library, and lays stills on V1, takes on
   A1, the score on A2, sfx on A3.
7. Play it at `http://localhost:5173/app/studio`, full screen. Run the audit (`editor`, `audit.md`). Repeat until approved.

**Step 2: the film (slow, expensive, only after approval)** — Edit → Grade → Render, like a real post house
1. World shots become data, not files: each shot of the list is a `shot` entry of the vault (camera, lens, hour,
   metered exposure, lights, cues as its `spec`; every version an entry of its own, `src/lib/studio/avenshots.js`),
   and the cut has a **world clip** in each shot's place (`shot: "shot:<entry>"`, `shotVersion`). It plays live in its
   world in the 3D and Edit tabs; a proxy is rendered only when asked (the `world-proxy` rule).
   (Old way, still works: `node scripts/film/shoot.mjs <list>` renders log plates you bring in as files.)
2. iPhone footage (HEVC Apple Log / Apple Log 2), other camera files and AI EXR sequences: `bun media add` / the
   Library in The OS app, tagged `media:original` (the rules make a probe, a proxy, a grading still, the words and an
   analysis only for those). The colour space is detected (set it in the Bin when a file doesn't say, e.g. an untagged Apple
   Log 2 clip); an HD proxy in the same log encoding is made. Originals are never re-encoded.
3. **Edit** tab: cut on proxies and the live world, then **Lock the edit** (the cut is then fixed; unlock = version
   n+1). **+ Variant** branches the edit under the project's next letter.
4. **Grade** tab: originals swapped in (conform); the base correction first (every shot balanced to its scene's
   master, `colorist` `base-correction.md`), then clip CDLs + the film's look (presets); **Hero frame**
   renders the frame at the playhead at full size, 16-bit, through the whole chain — judge the grade on it.
5. **Render** tab: **⤓ Render** (a `render` task on the cut, below). **The Mac app is the render worker**: The OS
   app claims the task and renders it natively (`vault/app/src/render.rs` → `vault/crates/vault-render`:
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
   before the vault; the report names every transform by its hash. Hero frames (a `frame` task with `t` and `shape`) are
   the same chain, one frame, a 16-bit PNG. Nothing is ever baked into a source or committed.
   EXR sequences (Luma, Kling, LTX exports) come in with `bun media add-sequence <dir> --profile aces2065-1 --fps 24`.

**Projects and variants:** timelines are grouped by `project` — the story's name ("233 settlers, how it starts"), never a day — with variants A, B, C…; each variant is its own
timeline.

## The studio and the library

**Studio** (`/app/studio`, code in `src/lib/studio/`): three working steps like DaVinci Resolve's pages, over one
timeline, its stage shown at the top (edit → locked → graded → rendered, and its version).
- **Edit** — tracks **V1 Picture**, **A1 Voice**, **A2 Music**, **A3 Sound**, **T1 Captions** (built from the A1 takes'
  word timings, phrase by phrase, two lines at most). Drag files onto tracks, drag clips to move, edges to trim; Space
  plays, ←/→ seek. One Web Audio clock, sample-exact. Pictures play from their **HD log proxies** (a "no proxy yet"
  badge when there is none), through the viewer's colour path on the GPU: the proxy's input transform → (optionally
  the grade, "Grade preview") → the output transform to Rec.709, through LUTs the Mac app bakes natively (each
  profile's journey in, the ACES 2.0 output transform; a formula fallback, labelled, while they are missing). Every picture shows its colour profile; click the badge to set it by hand (the
  proxy is made again). **World clips** (shots as data, `shot` entries) sit on V1; the live world (Sandbox 4 in film
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

**Media library** (avenDB's Library of Maia City, `api/scripts/media.ts`): every file is a `file` entry, named by its
BLAKE3 hash (its `legacy:<hash>` tag when it came from the legacy vault, `blake3:<hash>` when added since), its
description and meta in a JSON "about" beside it (`about:<entry>`). **Everything references a file by its hash;
tags only sort.** `bun media status | add <file> [--title] [--description] [--tags] [--replaces <hash>] |
add-sequence <dir>`. Scripts use `scripts/film/vault.mjs` (`list`, `meta`, `fileOf`, `add`, `describe`, `wordsOf`).
Where avenMAIA may only suggest, each add is a draft in an AIP of its own, and lands when Maia City accepts it.

## After the ingest: every step on the Mac

The Mac app does all media work, reading every file in place from its own iroh store. The server only stores and
relays. After a file comes in, each step runs by itself, one file at a time. Each one shows in Ingest and heals by
itself: three tries, then it waits for a person.

- **Proxy:** ACEScct HEVC, with a grading still and a preview (`proxies.rs`).
- **Words:** Phonon-2 on-device (`transcripts.rs` → `transcript/<hash>`).
- **Sound record:** does the file have sound, how long it runs, and its start timecode. The timecode comes from the
  file's own `tmcd` track, or a WAV's BWF time reference (`sound.rs` → `sound/<hash>`).
- **Shot analysis:** tags, cues, takes and the thumbnail (`analyse/` → `analysis/<hash>`, plus a thumbnail file).
  - The proxy's frames are sampled natively, through the ACES output like the previews: one a second, plus every
    picture change.
  - Frames and words go in stretches to our server (`POST /api/analysis`, the app's own key), which asks Prem's
    confidential Qwen (`qwen38-27b`) with the server's key. The prompt, the vocabulary, the validation, the model's
    pick, the rate limit and the pause after a Prem failure live there, once. No LLM key is ever on a Mac.
  - In Studio 2 it is the `analysis` rule: every `media:original` video, once its proxy and words are made; a vault
    turns it off or narrows its `when` with a rule entry of its own (`src/lib/studio/jobs/rules.js`).

## Studio 2 through avenDB (agents)

An agent (Claude, Codex, a script) is a device of the coop's aven, avenMAIA, through the avendb MCP
(`avendb-device agent <harness>`): it acts with avenMAIA's rights, by default a **Suggester on Maia City**, which
proposes and drafts and never lands anything itself. Call `avendb_vaults` first; the Maia City vault's id is there.

- **Read a cut:** `avendb_ask` `{"op": "world"}` and take the entries of type `cut` (`record.kind` `cut`, not tagged
  `avendb:deleted`). Its record holds `name`, `project`, `variant`, `stage`, `version`, `legacy` and **`timeline`**:
  the rest of the studio's timeline as one JSON text — `clips` (each `id`, `track` V1/A1/A2/A3/T1, `start`, `in`,
  `dur`, `kind`, `hash` or a world clip's `shot` and `shotVersion`, `vol`, `eq`, `fin`/`fout`, `script`, a picture
  clip's `stacks` `{base, clip}` of grade tools and `frame` per shape), `grade` (`scenes`: each scene's look tools),
  `color` (working and output), `aspect`, `tags` (`src/lib/studio/cuts.js` `timelineOf`). A clip's `hash` is a
  legacy 64-hex hash or an avenDB file's `aven:<root>:<size>:<len>:<media>`. `{"op": "get", "entry"}` reads one
  entry; `{"op": "history", "entry"}` its versions.
- **Propose an edit:** `avendb_run` `{"op": "propose", "entry": <cut>}` answers its `line`; then write the whole new
  timeline on that line, `{"op": "batch", "ops": [{"op": "set", "entry", "line", "path": ["timeline"], "value":
  "<the timeline JSON>"}, {"op": "set", "entry", "line", "path": ["at"], "value": <unix seconds>}]}`. The timeline is
  one value: read it, change only what the edit is about (a clip's trim, its `stacks`, a scene's look, a `vol`),
  write all of it back. Never change a locked cut (`stage` past `edit`) but its grade; a new edit of a locked cut is
  a new cut.
- **Draft a new cut** (a variant, a Reel cut): `avendb_run` `{"op": "create", "draft": true, "vault": <Maia City>,
  "type": "cut", "value": {"kind": "cut", "name", "project", "variant", "stage": "edit", "version": 1, "timeline":
  "<JSON>", "at": <unix seconds>}}` answers its `entry` and `line`.
- **Put it to Maia City:** `{"op": "aip_open", "vault", "title", "note", "proposals": [{"entry", "line"}, …]}`, then
  `{"op": "aip_promote", "entry": <the aip>}` (AIP-n). The note says why, what changes, and what to make once it lands
  (a render, hero frames). Samuel answers it whole in The OS app (/app/aips/?aip=<entry>); an agent never reviews or
  merges. After a revise, write again on the same lines and promote again.
- **Renders, hero frames, stills, proxies** are `task` entries the rules make (`src/lib/studio/jobs/rules.js`, done by
  the Mac's worker, `vault/app/src/aven.rs`), keyed by the rule, the inputs' versions and the params
  (`jobs/tasks.js` `newTask`, `keyOf`):
  - by themselves, for every `media:original` file on main: `probe`, `proxy` (HD ACEScct), `still` (the 4K grading
    still and its preview), `transcript`, `analysis`;
  - asked, never missing: `render` of a cut (`delivery` "youtube-4k" or every delivery), `frame` of a cut (a clip's
    graded still `clip`, or a hero frame at `t` in a `shape`), `world-proxy` of a shot version. The Studio asks them
    (⤓ Render, Hero frame, a save that changes a clip's look: `cuts.js` `renderCut`, `frameCut`, `restill`); a
    Suggester's draft task never runs, so an agent names what it wants made in its AIP's note, and Samuel asks it
    once the AIP lands. (An aven with Editor on the vault could create the task as `cuts.js` `ask` does.)
  - Read them in the world: entries of type `task` whose `record.inputs[0].entry` is the cut or the file, by `rule`
    and `status` (queued, claimed, done, failed, held); a done one's `outputs` are file entries (`media:delivery`,
    `media:preview`, `media:still`, `media:proxy`), its `result` JSON (a long one spilled into a JSON file, `file`).
- **Files:** read one with `avendb_read_file` (`entry`, an absolute `path`); judge a grade on the `still` and `frame`
  outputs (4K, through the output transform), never a proxy. Bring one in with `bun media add` (or `put_file`, a
  draft `create` with `file` where it only suggests).

## Building the Mac app

- **One build folder for every checkout and worktree:** `maiaCITY/.cargo/target`, set by `maiaCITY/.cargo/config.toml`
  (this Mac only, not in git). Each worktree's `vault/target` links to it. The app is always
  `maiaCITY/.cargo/target/release/maiacity-studio`: whichever branch built it last.
- **Build:** `bun run build`, then `cargo build --release --features custom-protocol -p maiacity-studio` in `vault/`.
  There's no LTO, release is incremental, and sccache (`~/.cargo/config.toml`) serves the dependencies. A change in
  the app or vault-render rebuilds in about 15 s; a change of profile or toolchain costs one full build of ~12 min.
- **Start it:** `RUST_LOG=info,iroh=warn,iroh_docs=warn,iroh_gossip=warn maiaCITY/.cargo/target/release/maiacity-studio`.
  Agents reach it only through avenDB (the avendb MCP), never a port of its own.
- **Studio UI work needs no Rust build:**
  - Run `bun run dev` and `cargo run -p maiacity-studio` in `vault/` (debug, without `custom-protocol`: the window
    loads the dev server on localhost:5173).
  - Svelte changes then show at once.
  - Debug builds keep line tables only and optimise their dependencies, so measuring and iroh stay usable.

## Checklists

**Before recording:** the transformation and the arching question are written down; the hook is as extreme as the
facts allow and the last line pays it off; every fact is checked; each line has its audio tag and "…" breaths; each
line is its own take with `--local` and the voice **id**.

**Before shooting:** every line has 2–4 shots; every named thing has a `cue` on its word and every `cue` resolves; each
shot has its `sfx`, `mood` and `exposure`; the `music.chunks` boundaries sit on the arc's turns; the score and cues are
made and chosen; the storyboard was played in the studio and approved.

**Before rendering:** the stills pass is clean; the shots are in the library; the variant was branched; the audit
passes; The OS app is open with avenDB unlocked, and the render is checked at every cut.

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
