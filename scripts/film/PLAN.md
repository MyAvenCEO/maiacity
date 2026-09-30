# The post pipeline: log, proxies, a world that plays on the timeline, and Edit → Grade → Render

The execution plan for turning the studio (`/app/studio`) and the render worker (then `bun film worker`, now the Mac
app) into a real post-production pipeline, the way film is finished in the world: one standard colour space, log proxies
for editing, originals swapped in for grading, and a final render at the end. Sandbox 4 stops pre-rendering baked,
pre-graded clips; its shots become data that the timeline plays live and the worker renders only at the end.

Written 2026-09-29 from the design conversation. Each milestone lists its tasks and when it is done.

**Now (2026-09-30): the render is native, and the Mac app is the render worker.** The bun/ffmpeg worker
(`scripts/film/worker.ts`, `picture.mjs`, `plates.mjs`, `qc.mjs`, `sources.mjs`, `color/ffmpeg.mjs`, `color/bake.py`,
`color/measure.mjs`, `bun film worker`) is gone. maiaCITY Studio claims the jobs of this plan's queue (C6: `render`,
`frame`; leftover `proxy`/`lut` rows closed as history) with its own key and renders them with
`vault/crates/vault-render` — Core Image on Metal, VideoToolbox, AVFoundation, Core Text; the colour from vault-media's
`cst` (journeys into ACEScct) and `aces2` (the ACES 2.0 output transform, 129³); EBU R 128 loudness levelled to −14
LUFS / −1 dBTP; the same deliveries, QC and job report (see `vault/app/src/render.rs`). World plates (C4) are rendered
by the app's own unseen world (`vault/app/src/world.rs`, `world_driver.js`), cached in `<vault>/plates`; hero frames
likewise. `scripts/film/world/render.mjs` stays for `shoot.mjs` (plates and storyboard stills by hand) and the parity
test. Wherever this plan says "the worker", "ffmpeg filters" or "bake.py" below, it describes how it was first built;
the maths is the same in Rust (vault/PLAN.md, 14b–c).

**State (2026-09-29, PR #9):** M0–M9 built and merged into one branch; checks green (api 100 tests, svelte-check,
film typecheck). End-to-end run on a local stack: an Apple Log 2 HEVC original (detected "unknown", set to
`apple-log-2` → HD log proxy re-made), a world shot (its HD log proxy auto-queued and rendered), a timeline of both
plus a voice, locked (a cut change refused, 409), graded (clip CDLs + film look), a 4K 16-bit hero frame of the iPhone
clip rendered through IDT → grade → look → ODT. World plates render **only on a Mac (Metal)** — decided the same
day; the full 4-shape delivery of a cut with world clips is therefore run on the Mac worker. M10 docs done. Open: the
Day 19 world timeline (`bun api/scripts/world-timeline.ts --from G --variant W`, on the Mac against production);
nothing else in the container. Colour accuracy, measured and improved: Apple Log 2 now goes to ACEScct by exact
maths (1D curve → one 3×3 → the PQ-shaped encoding, within 0.05 code values of OCIO; no 3D LUT), and the render's
output transform is baked at 129³ (realistic colours p99 2.6 → 0.8 code values; colours at the display gamut's edge,
where ACES 2.0 bends hard, p99 91 → 63 — the limit of any 3D LUT there; previews stay 65³).

---

## 1. The target workflow in one picture

```
 INGEST                        EDIT tab                     GRADE tab                      RENDER tab
 ──────                        ────────                     ─────────                      ──────────
 iPhone Apple Log 2 (HEVC) ─┐  proxies (HD, ACEScct log)    edit locked → conform:          grade applied (ACEScct)
   detect colour space      │  + the live world at proxy     originals swapped in           → output transform (Rec.709)
   → HD log proxy           ├─ level, one clock for          (4K Apple Log 2 via its IDT,   → graphics on top (captions,
 world shots (data) ────────┤  picture, sound and cues       world shots rendered as          hook, title card)
   → HD log proxy (bg)      │  → cut, trim, keyframe,        4K log plates per shape)       → every shape, every codec,
 legacy/sRGB/Rec.709 media ─┘    record camera, lock         → whole-film look + per-clip     tagged, QC'd, into the
   → HD log proxy                                              grades, presets, scopes         library
```

The three tabs are working steps, like DaVinci Resolve's pages: **Edit** (picture and sound, on proxies), **Grade**
(colour, on originals, after the edit is locked), **Render** (deliveries). Each tab only shows what its step needs.

## 2. Decisions (settled in the conversation)

| Topic | Decision |
|---|---|
| Timeline colour space | **ACEScct** (ACES AP1 primaries, ACEScct log curve), processed in float RGB end to end. Open standard, made for mixing camera log with CG, and grading controls behave as colourists expect in its log. |
| Output transform | ACES Output Transform to **Rec.709, BT.1886 gamma 2.4, SDR 100 nits** for every delivery today (ACES 2.0 if its OCIO config bakes cleanly, else ACES 1.3). HDR (Rec.2100 PQ for YouTube) is a later second output of the same timeline. |
| Transforms in ffmpeg | Input and output transforms as **3D LUTs baked with OpenColorIO** from the official ACES config (`ociobakelut`) or computed from published formulas (sRGB, Rec.709, ACEScct). Every LUT is a library file with a CID, so a render always uses exactly the same transform. Linear/gamma/matrix steps with `zscale` (zimg). |
| Game footage | Sandbox 4 in **film mode** renders scene-linear light, meters exposure like a camera, and writes **ACEScct 10-bit** itself: log at the source, no pre-grade. Players' view of the game is unchanged. |
| World shots | A world clip on the timeline is **data** (camera keyframes, hour, exposure, lights, props, cues, world position, game build) — rendered to pixels only for proxies and at conform/render. |
| Proxies | **Auto proxy on ingest**: HD, **in ACEScct log**, 10-bit HEVC, short GOP for scrubbing. Every source's proxy is already in the timeline's colour space, so the preview needs one view transform. The live world plays at the same proxy level (HD, same log encode, same view transform), so proxy clips and live world look alike. |
| Originals | After **edit lock**, the Grade tab **conforms**: proxies are swapped for the 4K originals (iPhone files through their input transform; world shots rendered as 4K log plates per shape). Grading happens on originals only, as in real post. |
| Graphics | Captions, the hook and title cards are display-referred graphics: composited **after** the output transform, never graded. |
| Legacy footage | Existing sRGB, already-graded clips enter through the **inverse output transform**, so they look exactly as they do today. |
| Files | 10-bit HEVC for log masters, plates and proxies (like the iPhone's own Log files); no ProRes (5 GB/min at 4K is too heavy for a library that lives in the database). |
| Machine | Proxies, plates and final renders on the Mac worker (VideoToolbox; one GPU family, so preview and final agree). |

### Revised rules (Samuel, 2026-09-29) — these win over anything above

1. **Never bake anything in.** Media stays in its original encoding for ever (an iPhone file stays Apple Log, an AI
   generator's EXR stays linear ACES). Colour transforms and grades are **configs** (which transform, from which OCIO
   config, which CDL numbers). LUTs are made only **during the render step** (by the worker, from the configs, cached
   by a hash of the config) and are never committed and never an asset of their own. The only exception is a
   *preview* LUT the worker bakes for the studio's viewer — a cache, keyed by the same config hash.
2. **Proxies are HD and in log.** Log sources keep their own log (Apple Log stays Apple Log, world renders stay
   ACEScct); linear and HDR sources (EXR, HLG, PQ) are encoded into ACEScct for the proxy (pure maths, reversible);
   display-referred sources (Rec.709, sRGB) stay as they are. No grade and no output transform is ever in a proxy.
   The viewer applies each proxy's input transform, the grade and the output transform live, from the configs.
3. **Generated footage is a first-class source.** Luma Ray 3 (HDR · EXR export), Kling 3.0 / O3 (16-bit linear EXR)
   and LTX HDR (16-bit EXR) deliver **scene-linear ACES2065-1 (AP0)** or linear EXR frames. They come in as EXR
   sequences (one tar per clip in the library) with the profiles `aces2065-1`, `acescg` or `linear-rec709`, and go
   into ACEScct by exact maths (a 3×3 matrix and the ACEScct curve) — no LUT, no clipping. Their plain 8-bit MP4
   downloads are display-referred Rec.709 (`rec709`).
4. **Background jobs.** The build runs as parallel background agents, one per work stream (section 7).

## 3. What is wrong today (fix first)

- `scripts/film/worker.ts` takes every picture clip straight to `format=yuv420p` (8-bit) before the cut: the 4K
  "10-bit" HEVC master is 8-bit picture in a 10-bit container, and nothing converts colour on the way in. It only tags
  the output bt709 at the end.
- Game shots: sRGB JPEG frames → `yuv420p` without a matrix: ffmpeg's default BT.601 maths, then tagged bt709 — a small
  hue/saturation drift.
- `scripts/film/grade.mjs` bends gamma on 8-bit tone-mapped frames to rescue dark shots (banding), and bakes the look
  (COLD, NIGHT, moods) into each shot before the edit.
- The worker's `EXT` map has no `video/quicktime`: an iPhone `.mov` is cached as `.bin`.
- Motion blur (`blur` shots) is averaged in 8-bit display space on a 2D canvas, not in linear light.

---

## 4. Milestones and tasks

Order and dependencies: **M0 → M1 → M2**, **M3 → M4 → M5**, then **M6 → M7 → M8**; **M9** as soon as the Apple Log 2
sample exists (after M2); **M10** closes each milestone's docs as it lands.

### M0 — Quick fixes in today's pipeline
- [ ] Correct matrix and range everywhere RGB becomes YUV (`colorspace`/`zscale` with bt709, tv range) in `shoot.mjs`,
      `grade.mjs`, `assemble.mjs`, `worker.ts`; tag every intermediate.
- [ ] Keep 10 bits from the first filter to the HEVC master (`p010le`/float in the graph); 8-bit only for the H.264
      copies, with dither.
- [ ] `video/quicktime` → `.mov` in the worker's `EXT`.
- **Done when:** a colour chart through the old path comes out with the same values it went in with (±1 code value),
  and `ffprobe` shows correct tags on every output.

### M1 — The colour-managed timeline (worker core)
- [ ] `scripts/film/color/` module: working space ACEScct; the table of input transforms (IDTs) by colour profile:
      `acescct` (identity), `srgb` (game legacy, stills, images), `rec709`/`bt1886`, `hlg`, `pq`, `apple-log`,
      `apple-log-2` (M9), `legacy-graded` (inverse output transform); the output transforms (ODTs): `rec709-sdr`
      (default), `rec2100-pq` (later).
- [ ] Bake the LUTs with OpenColorIO from the ACES config; store them in the library by CID; a manifest
      (`scripts/film/color/transforms.json`) names each transform's CID and its source (config version, formula).
- [ ] Worker graph: every clip → its IDT → float RGB in ACEScct → scale/crop/fps/concat in float → (grade, M7) →
      ODT → graphics (captions, hook, title card) in display space → encode. Correct YUV matrix/range, 10-bit master,
      tags on every file.
- [ ] Verify the worker's ffmpeg has `zscale` and `lut3d` (Homebrew build); fail loudly with the fix if not.
- [ ] Round-trip tests: sRGB chart → IDT → ODT = the chart; ACEScct ramp → ODT matches OCIO's own output; legacy
      graded clip renders identical to today.
- **Done when:** an existing timeline (Day 19) renders through the new graph and looks the same as before; the master
  is truly 10-bit; every transform used is pinned by CID in the render's report.

### M2 — Ingest: colour detection and auto proxies
- [ ] On upload (`api/src/media.ts` + `bun media` client): `ffprobe` the colour tags (primaries, transfer, matrix,
      range, bit depth, codec, frame rate) and Apple's QuickTime camera metadata → `media.meta.color`
      `{ profile, primaries, transfer, matrix, range, bitDepth, detectedFrom, override? }`.
- [ ] Detection table with a fallback for untagged files by source (game renders = `srgb`; world plates =
      `acescct`), and an "unknown" state the studio asks about instead of guessing.
- [ ] Override in the studio: a colour badge on every clip and library item; changing it re-queues its proxy.
- [ ] Worker job type `proxy`: HD (long edge 1920), IDT applied → **ACEScct 10-bit HEVC**, short GOP (keyframe every
      ~15 frames) for scrubbing; stored in the library with `meta.proxyOf` / the original's `meta.proxy` CID.
- [ ] Proxy status in the library and on the timeline (queued / rendering / ready / failed).
- **Done when:** dropping an iPhone clip, a game clip and a Rec.709 clip into the library gives each a correct badge
  and an HD log proxy, and the Edit timeline plays proxies only.

### M3 — Sandbox 4 film mode: log at the source
- [ ] Film mode (only under `scripts/film`; players unchanged): render into a half-float render target, so three.js
      skips tone mapping → scene-linear light (linear sRGB primaries), highlights above 1.0 kept.
- [ ] Exposure like a camera: a meter on the linear frame (the lower 60% of the frame, as `grade.mjs` measures today,
      or centre-weighted), middle grey at 18%. Per shot: `meter: 'lock'` (metered once, held) or `'ramp'` (follows a
      time-lapse); `exposure` becomes an offset in stops. The per-hour brightness targets of `grade.mjs` become meter
      targets in stops (night deliberately under). The in-game `toneMappingExposure` day formula is bypassed.
- [ ] Log shader pass: linear sRGB → AP1 matrix → ACEScct curve → 10 bits per channel (RGB10_A2 target).
- [ ] Readback without JPEG: `readPixels` of the 10-bit target; frames posted as binary (`fetch` of an ArrayBuffer)
      to a small local server in `shoot.mjs`, piped into ffmpeg stdin as raw video → **10-bit HEVC, tagged ACEScct**.
- [ ] Oversampling in linear light (render at 1.5×, filter down on the GPU) and **shutter blur accumulated in linear
      light** before the log encode (a shutter angle per shot instead of `blur: n`).
- [ ] Preview stills (storyboard) through the same view transform, so they are not grey.
- **Done when:** a Day 19 shot captured in film mode has clean shadows at pre-dawn (no banding), unclipped sun and
  windows, and matches the old graded look after the output transform plus its look preset.

### M4 — Deterministic, pinned world renders
- [ ] One clock: the virtual `__film` clock drives everything (already in `shoot.mjs`); audit timers, `Date.now`,
      `performance.now` and animation loops in `src/lib/sandbox-2/interior/*` so none escapes it.
- [ ] Seeded randomness: replace `Math.random` (one call in the interior code today) with a seeded generator from
      the shot record.
- [ ] A readiness barrier instead of sleeps: domes built and shown, textures uploaded, shadow maps and PMREM
      environment settled, far LODs loaded, props placed — `__village.ready(shot)` resolves only then; warm-up frames
      run on the virtual clock.
- [ ] Game build pinning: the built Sandbox 4 bundle is stored in the library by CID; a world clip names the build it
      was made on and renders with it; switching a clip to a newer build is an explicit action.
- [ ] Parity test: the same record rendered twice (and on preview vs worker) gives identical frame hashes.
- **Done when:** re-rendering any world shot a week later on the same build gives bit-identical frames.

### M5 — World shots as data (clips, cues and configs)
- [ ] `shots` table (versioned JSON records) and a world clip kind on the timeline (`kind: 'world'`, `shot` id +
      version), next to media clips (`kind: 'media'`, `cid`).
- [ ] The shot record:
  - **World config:** game build CID, seed, where the world is loaded (`stand`), domes and sets that must be ready
    (`dome`, `props`), film clock start.
  - **Camera track:** keyframes `{ t, position, aim | yaw/pitch, fov }` with interpolation (Catmull-Rom / eased),
    plus presets from `scripts/film/camera.mjs` (`move`, `orbit`, `turn`, `glide`, `ease`, `landing`, `drift`).
  - **Light tracks:** hour curve (sun position and colour follow it), exposure (meter mode + stops), per-light
    intensity/colour curves by light id (window glow, lamps), fog.
  - **Event cues:** props and set events on the film clock (the trucks, animals, doors), each with an optional linked
    sound cue (sfx CID, volume) that lands on A3 at the event's time — today's per-shot `sfx` list becomes these.
  - **Shutter:** shutter angle / samples for motion blur.
  - **Framing per shape:** a native camera per delivery shape (16:9, 9:16, 1:1, 4:5): an fov change, offset or tilt
    per shape, or an automatic rule (keep the subject, widen for vertical) — no more centre crops.
- [ ] Record by flying: in Sandbox 4, record the walker's flight as camera keyframes (smoothed, thinned), optionally
      while the timeline plays with sound so a move is timed to the voice.
- [ ] Migrate the existing shot lists (`scripts/film/day-19.mjs` and the others) into records, so old films live on
      the new system.
- **Done when:** Day 19's thirteen shots exist as records, render identically to their film-mode captures, and a new
  camera move can be flown, recorded and edited as keyframes.

### M6 — Studio: three tabs, and the Edit tab
- [ ] Tabs **Edit · Grade · Render**, each its own working step; a timeline has a stage (`edit` → `locked` →
      `graded` → `rendered`) shown at the top.
- [ ] Edit plays **proxies only**, through the view transform (ACEScct → Rec.709, WebGL shader with the ODT LUT);
      optionally with the current grade previewed (read-only).
- [ ] The **world viewer**: a live Sandbox 4 instance slaved to the timeline clock at proxy level (HD, pixel ratio 1,
      no shutter accumulation, the same log encode and view transform as the proxies). Scrub = set clock + camera +
      lights to that frame; play = run the world in real time; each cut switches to the next shot's camera, lights and
      cues.
- [ ] One clock for picture, sound and cues: voice, music and sfx play from the timeline clock; world event cues fire
      on it.
- [ ] **Prepare playback:** before playing, load everything the timeline touches (every dome, set and area) and keep
      it loaded; while editing, preload the shots ahead of the playhead. A shot that is not ready plays its proxy until
      the world catches up — playback never stops. If the GPU cannot keep up, drop resolution, never frames.
- [ ] Editing the world on the timeline: keyframe lanes for camera, hour, exposure, lights and cues under a world
      clip; pause on a frame, change the hour, a light or a keyframe, see it at once; record a camera move over the
      playing timeline.
- [ ] World proxies render in the background whenever a world clip changes (worker `proxy` job from the record).
- [ ] **Edit lock:** locks picture and sound; the Grade tab opens. Unlocking makes a new version and keeps per-clip
      grades attached by clip id (they follow trims).
- **Done when:** Day 19 cuts together in Edit from proxies and live world, plays in real time with sound, and locks.

### M7 — The Grade tab (on originals)
- [ ] **Conform** on entering Grade: every media clip's proxy is swapped for its original (through its IDT); every
      world clip is rendered as a **4K ACEScct plate per delivery shape** (worker job `plate`), cached by fingerprint
      `hash(build CID, shot record version, in/out, shape, resolution, transform CIDs)`. The tab shows conform
      progress and never grades on proxies.
- [ ] Grade as data on the timeline: a **whole-film look** plus **per-clip grades**, each an ASC CDL (slope, offset,
      power, saturation) with optional `.cube` LUT, applied in ACEScct, in this order: clip grade → film look → ODT.
- [ ] Presets from today's looks: `COLD`, `NIGHT`, the moods (`dip`, …) ported from `grade.mjs`/`filming.md` so
      existing films keep their look.
- [ ] Viewer: accurate hero frames (a 16-bit frame rendered by the worker for the current position) plus real-time
      playback of the graded result (GPU preview); switch between delivery shapes to check each plate.
- [ ] Scopes: waveform, vectorscope, RGB parade, a false-colour exposure check; compare against a reference still.
- **Done when:** a graded Day 19 in Grade matches its render frame for frame, and changing a grade never re-renders a
  plate.

### M8 — The Render tab
- [ ] Deliveries as today, per shape: 16:9 4K HEVC 10-bit master (YouTube) + 1080 H.264 (X, LinkedIn); 9:16 1080
      H.264 (Reels, Shorts, TikTok); 1:1 and 4:5 1080 H.264 (feeds) — each from its **native plate**, graded, through
      the ODT, graphics on top.
- [ ] Graphics after the ODT: captions from the voice clips' word timings, the hook layer over the first 2.5 s of the
      social copies, the title card — never graded.
- [ ] Sound: the existing mix (voice ducks music, fades, limiter) plus a loudness check (integrated LUFS and true
      peak) reported per delivery.
- [ ] Render queue with progress per shape; plate cache reuse (only changed shots render again); the render report
      names every transform, build and plate CID used.
- [ ] QC before a delivery goes to the library: `ffprobe` tags (bt709 primaries/transfer/matrix, tv range), bit
      depth, frame count vs timeline, duration, platform limits (Instagram ≤ 90 s Reels, bitrates), loudness.
- **Done when:** Day 19 renders every delivery from the Render tab, passes QC, and a re-render after a grade change
  reuses every plate.

### M9 — iPhone Apple Log 2
- [ ] Needs a short Apple Log 2 HEVC clip in the library (from Samuel) to read its real tags and metadata.
- [ ] Detection rule for Apple Log 2 (and Apple Log v1) from those tags; the IDT from Apple's published transform /
      LUT for Apple Log 2 (its own gamut, not Apple Log v1's), pinned by CID.
- [ ] A test clip with a chart or grey card: through IDT → ACEScct → ODT it lands where the same scene lands from
      the world at the same exposure.
- **Done when:** iPhone footage and world shots cut side by side in Edit and match after conform in Grade.

### M10 — Docs and retiring the old path
- [x] `story-producer/pipeline.md` and `filming.md`: the new order (capture log → ingest + proxy → Edit → lock →
      Grade on originals → Render), the colour standard, how to record a camera move, the world clip record.
- [x] Retire the pre-grade: `grade.mjs` stays only to re-grade legacy shots; its exposure logic lives in the film-mode
      meter, its looks in the grade presets.
- [x] Keep old timelines working: legacy clips carry `legacy-graded` and render as before.

---

## 5. Data model changes (summary)

- `media.meta.color` (profile, primaries, transfer, matrix, range, bit depth, detected from, override),
  `media.meta.proxy` / `meta.proxyOf`, `meta.plateOf` (fingerprint) for world plates.
- `timelines`: `stage` (`edit` / `locked` / `graded` / `rendered`), `version`, `color`
  (`{ working: 'acescct', output: 'rec709-sdr' }`), `grade` (film look + per-clip CDLs by clip id); clips gain
  `kind: 'media' | 'world'` and, for world clips, `shot` + `version` and per-shape framing.
- `shots`: versioned world shot records (world config, camera, lights, cues, shutter, framing).
- Render jobs: `kind: 'proxy' | 'plate' | 'render'`; a plate cache `fingerprint → CID`.
- `scripts/film/color/transforms.json`: every IDT/ODT/view LUT by CID with its source.

## 6. Open questions

- The Apple Log 2 sample clip (blocks M9 only).
- ACES 2.0 vs 1.3 output transform: decided by which bakes cleanly and looks right on the Day 19 test (M1).
- Grade-tab viewer precision: worker-rendered 16-bit hero frames plus 8-bit GPU playback is the plan; revisit if
  browsers give us 10-bit video textures.
- Which other sandboxes get film mode after Sandbox 4.
- HDR delivery (Rec.2100 PQ) — when YouTube HDR becomes worth it.

---

## 7. Contracts and work streams (for the parallel build)

Three work streams run at once, each in its own worktree and branch, each owning its files. Anything another stream
owns is read, never edited; a missing piece is asked for in the stream's report, not patched in. The orchestrator
merges the three branches into `studio-post-pipeline-plan` (PR #9).

### C1 · A timeline clip (api/src/timelines.ts — owned by stream B) · built

```js
Clip = {
  id, track: 'V1' | 'A1' | 'A2' | 'A3', start, in, dur, vol, fin?, fout?,
  kind?: 'media' | 'world',      // absent = 'media'; written back only for world clips (existing timelines unchanged)
  cid?: string,                   // media clips: the library file (required); world clips: none
  shot?: string, shotVersion?: number,   // world clips: shots.id and the version cut in (V1 only; must exist)
  grade?: Cdl,                    // this clip's own grade, ACEScct, cleaned by cleanCdl (a neutral one is dropped)
  frame?: { [shape]: { x, y, zoom } }    // media clips only: x, y in −1…1 of the free room, zoom 1…8
}
Timeline += {
  stage: 'edit' | 'locked' | 'graded' | 'rendered',   // default 'edit'
  version: number,                                     // server-managed: +1 when the stage goes back to 'edit'
  color: { working: 'acescct', output: 'odt-rec709' | 'odt-rec2100-pq' },
  grade: { look: Cdl | null, preset?: string } | null  // the whole film's look; preset ∈ color.js PRESETS names
}
```
Routes: `GET /api/timelines`, `POST /api/timelines`, `GET|PUT|DELETE /api/timelines/:id`. While the stage is past
`edit`, a PUT that changes the cut (anything in a clip but `grade` and `frame`) is refused with 409 "The edit is locked";
PUT `{ stage: 'edit' }` unlocks (version + 1). Migration `0026-timeline-stages`.
A world clip's shot-local time is `t = clip.in + (timelineTime − clip.start)` seconds; the shot's progress is
`t / spec.seconds`. Trimming never changes a move's speed.

### C2 · A world shot record (game/film/shot.js, game/film/camera.js, `shots`, `/api/shots` — stream B) · built

`shots (id uuid, name, project, version int, spec jsonb, founder_id, created, updated)` holds the current version;
`shot_versions (shot_id, version, spec, founder_id, created)` keeps every version (migration `0025-shots`).
Routes (media:admin): `GET /api/shots[?project=]`, `POST /api/shots { name, project, spec }` (→ v1),
`GET /api/shots/:id[?version=n]`, `PUT /api/shots/:id { name?, project?, spec? }` (a changed spec → version + 1, the
same spec → no new version), `GET /api/shots/:id/versions`.
```js
spec = {
  world: { sandbox: 'sandbox-4', build: { commit, hash, cid? } | null, seed, stand: [x, z], dome?, props?: 'tired-land', clock },
  seconds, fps: 30, aspect: '1:1',          // aspect: the shape it was composed for (the framing rule starts there)
  camera: { kind: 'move' | 'orbit' | 'turn' | 'fly' | 'whip' | 'keys', ...its arguments, curve?: 'glide' | 'ease' | 'landing' | 'drift' },
          // keys: [{ t (shot seconds), position, aim | yaw+pitch, fov? }] — what __film.record gives back
  lens: { fov, fovTo? },  time: { hour, hourTo? },
  exposure: { meter: 'lock' | 'ramp' | 'fixed', stops: number | [t, v][], ev? },  // ev pins a metered lock / is the fixed gain
  lights: [{ id: 'sun' | 'fill' | 'glow' | 'lamps' | 'sky', intensity?: number | [t, v][], color?: '#rrggbb' }],  // × the hour's
  cues: [{ at, kind: 'sound', cid, level } | { at, kind: 'event', name, args }],
  shutter: { angle: 180, samples: 1 },
  framing: { [shape]: { fov?, yaw?, pitch?, dx?, dy? } },   // absent: wider shapes keep the height, taller keep the width
  look?: presetName,           // the grade it was lit for (a suggestion for the Grade tab, never applied by itself)
  meta?: { name, size, scene, legacyExposure … }             // notes, not part of the picture
}
```
game/film/shot.js exports `normalize(spec)` (validate + defaults; throws ShotError), `evaluate(spec, t, shape?) →
{ pose: [x, y, z, yaw, pitch], fov, hour, stops, lights, cues, clock, progress }`, `shutterTimes`, `fovFor`,
`fingerprint(spec, extra?)` (SHA-256 of the picture-relevant spec + extra; `look`, `meta` and sound cues left out),
`sameSpec`, `stable`, `sha256`, `fromLegacy(shot, { seconds?, clock?, fps?, aspect?, build?, seed? })`,
`legacyStops`, `legacyLook`, `SHAPES`, `LIGHTS`, `SETS`, `LOOKS`. game/film/camera.js: `pathOf(camera, seconds)`,
`checkCamera`, `fovOf`, `keysFromFlight`, `look`, the curves. scripts/film/camera.mjs builds on it and attaches
`.spec` to every path. `scripts/film/worlds/day-19-d.json` holds Day 19's 42 shots (untimed: seconds and clock
come from the timeline).

### C3 · Film mode in Sandbox 4 (src/lib/film/**, the sandbox-4 routes — owned by stream B) · built

`/games/sandbox-4/?film` (no sign-in; the old address) mounts the world alone under the film's clocks
(src/lib/film/FilmWorld.svelte) and exposes `window.__film`; every method takes a spec as stored (it is normalized):
```js
__film = {
  ready(spec?): Promise<void>,                     // world up; with a spec: its dome, set and the domes near it built
  prepare(specs): Promise<void>,                   // stage every shot (pins its domes) and meter it
  show({ spec, t, shape, width, height, view, quality }): Promise<void>,
      // draws that frame on the page's canvas (width×height, shown letterboxed): view = { lut, grade } where
      // lut = .cube text | { size, data (RGB or RGBA per texel, red fastest) } | null (a stand-in filmic view),
      // input ACEScct code values 0–1, output display 0–1; grade = Cdl | [clipCdl, lookCdl] | null.
      // quality 'proxy' (default: 1×, no shutter blur) | 'final' (1.5× oversampled, shutter blur)
  capture({ spec, t, shape, width, height, oversample = 1.5 }): Promise<ArrayBuffer>, // 10-bit ACEScct, x2bgr10le, top row first
  still(ask): Promise<Blob>,                       // show() then the canvas as PNG (storyboard)
  meter(spec): Promise<number>,                    // the metered EV (stops of gain; a ramp's mean)
  exposure(spec): Promise<number | [t, ev][]>,     // what the render uses (a ramp is keyed every 0.5 s)
  record: { start(), stop(): keys },               // walk/fly by hand; keys for { kind: 'keys', keys }
  release(),                                       // give the canvas and clocks back to the world
  build: { commit, hash } | null,                  // this page's build (/film-build.json), null on a dev server
  legacy(ask): Promise<Blob>,                      // diagnostics: the old tone-mapped 8-bit frame
  enter(), leave(), step(ms), virtual              // the page clock, as scripts/film had it
}
```
Exposure: log-average luminance of the lower 60% of the linear frame, rendered at a fixed 160 px wide in the
composed aspect (so every size and shape gets the same exposure) → `ev = log2(0.18 / L)`; lock = five moments
averaged, ramp = keyed every 0.5 s, fixed = spec.exposure.ev; gain = 2^(ev + stops). The studio embeds it in an
iframe (same origin) and drives it frame by frame from the timeline clock.

### C4 · The plate renderer (scripts/film/world/render.mjs — owned by stream B, called by stream A's worker) · built

```js
renderPlate({ spec, from, to, shape, width, height, fps, out, site,
              world?, oversample = 1.5, gop?, quality = 10, allowBuildMismatch?, progress?, log? })
  → { file, frames, ev, build, fingerprint, codec }
openWorld({ site }) → { page, browser, build, close }   // reuse one browser for many plates: renderPlate({ world })
```
One world clip's frames from shot-time `from` to `to` (`round((to − from)·fps)` frames at `from + k/fps`),
rendered offline (oversampled, shutter blur in linear light), as **ACEScct, 10-bit HEVC (yuv420p10le), bt709 matrix,
tv range, tagged `comment=maiacity:color=acescct`**; libx265 or hevc_videotoolbox (FILM_HEVC), Chrome from CHROME,
ANGLE on Metal: **world plates render only on a Mac's GPU — no software renderer** (openWorld refuses off a Mac). A spec naming `world.build` renders only on that
build (throws otherwise). Builds: `node scripts/film/world/build.mjs` (vite build + film-build.json + tar to store
with `bun media add`), `site.mjs` `buildDir(cid, { api, key })` + `serveSite(dir)` for the worker. Plates are
render-step intermediates, cached by `fingerprint`, never library assets. Same function makes the HD world proxies
(smaller `width`/`height`, `gop: 15`).

### C5 · Colour (game/film/color.js, game/film/transforms.js, scripts/film/color/** — owned by stream A)

- Profiles: `acescct`, `rec709`, `srgb`, `legacy`, `hlg`, `pq`, `apple-log`, `apple-log-2`, `aces2065-1`, `acescg`,
  `linear-rec709`, `unknown`. `detect(ffprobe stream, format, kind)` → `media.meta.color`
  `{ profile, primaries, transfer, matrix, range, bitDepth, detectedFrom, override? }`.
- Transforms are **configs** in game/film/transforms.js: OCIO (config name + colour space or display/view +
  direction) or exact maths (matrix + curve). The worker bakes LUTs from them only while rendering
  (`python3 scripts/film/color/bake.py …`), cached by a hash of the config and the OCIO version.
- Grade: `Cdl = { slope: [r,g,b], offset: [r,g,b], power: [r,g,b], sat }` in ACEScct; order: clip grade → film look →
  output transform. `cdl()`, `PRESETS` (COLD, DIP, BRIGHT, NIGHT, WARM as CDLs), `cleanCdl()` in color.js; the
  browser applies them in a shader, the worker as ffmpeg filters — the same maths.
- Display-referred clips with no grade and a neutral look skip both transforms: they render bit for bit as before.
- The studio viewer's LUTs (odt-rec709 and each profile's IDT) are baked natively by the Mac app (`color_lut`:
  vault-media's cst and aces2). The worker's old preview LUTs (`role:lut` files, `lut` jobs, `GET /api/film/luts`)
  are gone; their files and job rows remain only as history.

### C6 · Jobs (api/src/renders.ts, migration — owned by stream A)

`render_jobs` gains `kind: 'render' | 'proxy' | 'lut'` (default 'render'), `media_cid`, and `timeline_id` becomes
nullable. Every new video/image upload (and EXR tar) is queued for a `proxy` job; the worker detects its colour,
writes `meta.color`, makes the HD log proxy (C7 of the plan: source encoding kept) and links it (`meta.proxy` on
the original, `meta.proxyOf` on the proxy, tag `role:proxy`). The claim endpoint returns the job's kind.

### C7 · The studio (src/routes/app/studio/**, src/lib/studio/**, src/lib/auth/client.ts — owned by stream C)

Tabs **Edit · Grade · Render**. Edit: proxies + the world viewer (C3) on one clock, keyframe lanes for world clips,
edit lock. Grade: conform status, film look + clip grades (C5), presets, scopes, hero frames. Render: deliveries,
queue, QC report. Consumes C1–C6; never edits their files.

### Migrations and ports (no two streams collide)

| Stream | Scope | Migration ids | Local ports (Postgres · API · Vite) |
|---|---|---|---|
| **A · colour and the worker** | M0 (worker, grade.mjs, assemble.mjs), M1, M2, M9, the worker side of M7/M8 | `0024-film-jobs` | 5434 · 3101 · — |
| **B · the world as data** | M0 (shoot.mjs), M3, M4, M5, C1–C4, the Day 19 world timeline script | `0025-shots`, `0026-timeline-stages` | 5435 · 3102 · 5174 |
| **C · the studio** | M6, M7 and M8 in the studio, M10 docs for the studio | none (asks B) | 5436 · 3103 · 5175 |

Environment for every stream: ffmpeg 6.1 (zscale, lut3d, lut1d, libx265) from apt; OpenColorIO 2.5 + numpy from
pip; Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` for studio UI tests only, `playwright-core` in `/tmp/pgmaia/pw`;
Postgres binaries in `/usr/lib/postgresql/*/bin` (run as the `postgres` user, data under `/tmp/<stream>`). On the Mac
the worker uses VideoToolbox (`hevc_videotoolbox`) and Chrome with Metal. World rendering is Mac-only (decided 2026-09-29):
no SwiftShader fallback; a Linux box can run media proxies, LUT bakes and tests, never world plates.
New standalone files are plain JavaScript (JSDoc types); existing TypeScript files stay TypeScript.
