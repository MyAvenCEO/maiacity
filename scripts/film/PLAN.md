# The post pipeline: log, proxies, a world that plays on the timeline, and Edit → Grade → Render

The execution plan for turning the studio (`/app/studio`) and the render worker (`bun film worker`) into a real
post-production pipeline, the way film is finished in the world: one standard colour space, lightweight log proxies
for editing, originals swapped in for grading, and a final render at the end. Sandbox 4 stops pre-rendering baked,
pre-graded clips; its shots become data that the timeline plays live and the worker renders only at the end.

Written 2026-09-29 from the design conversation. Each milestone lists its tasks and when it is done.

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
- [ ] `story-producer/pipeline.md` and `filming.md`: the new order (capture log → ingest + proxy → Edit → lock →
      Grade on originals → Render), the colour standard, how to record a camera move, the world clip record.
- [ ] Retire the pre-grade: `grade.mjs` stays only to re-grade legacy shots; its exposure logic lives in the film-mode
      meter, its looks in the grade presets.
- [ ] Keep old timelines working: legacy clips carry `legacy-graded` and render as before.

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
