# Studio plan

✅ done · 🔄 in progress · ⬜ to do. Updated as the work goes.

## Open
- ⬜ Approve the audio-proxy deletion in the studio's modal (108 files, 29.5 MB)
- 🔄 Base correction of Day 01 · Opening on the marked stills (the tools below): bedroom a touch warm (+0.25), garden
  clearly warm (+0.5), shots 7 and 8 with the garden; masters: the bed from the side, the walk through the garden
- 🔄 Whole vault on iroh's patterns, end to end: no exports out of the store anywhere (audit running)
- ⬜ De-sync one file from one device only (drop its holding here, keep it elsewhere): needs a per-device keep rule on top of iroh-docs' protection

## Done today
- **Base correction tools** (story-producer `grading.md`), natively in the Mac app over MCP, from the 4K grading
  stills only:
  - `grade_look`: blacks, whites, mids and the skin Apple Vision finds, in IRE and against the skin line
  - `grade_scopes`: a sheet per scene with the picture, waveform, parade and vectorscope, the master first
  - `grade_match`: a master to neutral plus the warmth asked for; every other shot matched to its master by those
    elements, proposed first
  - saturation in the balance
- **Grading SSOT:** the grade's maths only in Rust/Metal. The studio's viewer and the live world sample a cube the Mac
  bakes (`color_grade`), and the presets come from Rust (`color_presets`). No JS or GLSL copy is left.
- **Legacy `library/`:** all 856 files checked by BLAKE3 against the vault and moved to the Trash.
- **Music:** madeira confirmed
- **Playback:** a video's sound decoded from its proxy (it carries the sound) or its original, read by hash from iroh's store (vault://, BlobReader) — nothing copied out
- **Deleting:** MCP asks first (modal with every file + the files made of them + the why); yes = gone on every Mac (iroh GC prunes), in Object Storage and Postgres
- **Sound:** no audio proxies anywhere; played, measured and transcribed from the original
- **Shot 2 (C167):** grading still and preview picked at 12.5 s (sharp, to camera) — `still_at` wins over the analysis mark
- **Day 01 · Opening:**
  - two outside shots inserted: walking to the bench (C123), coffee from the bench's right (C130)
  - "Today I am alone…" starts outside; the mug lands on "…is this"; then the frontal bench
  - story structure written through MCP: thumbnail, hook, acts 1–3, cliffhanger, with tension
  - each shot's script (scene, size, description) written through MCP
  - shots levelled through MCP: each scene matched, balance only, no look
  - sound levelled through MCP: voice −18 to −21 LUFS, music −26
- **Script tab:**
  - a read-only screenplay (left) beside the picture (right)
  - the timeline shows the story track (sections and the tension line) and the captions
  - written only through MCP (story_arc, timeline_save)
- **Grade tab:**
  - the layers over V1 on the timeline: film look, grade, framing, lows, highlights, contrast, exposure, white balance
  - each collapsed to its values and open for its controls
  - no scopes; the picture full width; V1 compact
- **Grading stills and previews:**
  - measuring uses a still only when its frame is inside the clip
  - a preview thumbnail per clip, through ACES 2.0, in the library list; no colour badges there
- **J and L cuts:**
  - overlaps on a track drawn in two lanes and marked J / L / ×
  - linked sound that leads or trails its picture gets a badge
  - the story-producer skill (sound.md) cuts scenes with J and L
- **Timeline:**
  - follows the playhead while playing; at most half the window, scrolls inside
  - clips whose files aren't here yet stay on the timeline, marked
- **Top bar:**
  - the window's title bar is the studio's own
  - three columns with the title always in the middle; tabs centred
  - the timeline switcher top right on every tab
- **Deliverables tab** (placeholder); the timeline's frame lives there.
- **Sound:** 107 audio proxies linked to their videos, so video sound plays in the studio. The render reads transcripts and audio links too.
- **Shipping:** PR #42, #43, #44 and #45 merged by me and deployed through CI.

## Done before
- Every recording transcribed on-device (Nemotron), 309/309, self-healing in the Ingest flow.
- Captions come by themselves from the voice's transcript.
- The grade's balance layers, the same maths in JS, Rust and Metal; MCP grade_measure / grade_balance / grade_match.
- 4K 16-bit ACEScct grading stills at ingest.
- The Audio tab with the levels on the clips; MCP audio_measure / audio_mix / audio_level.
- One truth for a timeline: the studio sees outside edits within seconds, and the API refuses stale saves.
