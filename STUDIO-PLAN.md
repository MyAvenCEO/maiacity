# Studio plan

✅ done · 🔄 in progress · ⬜ to do. Updated as the work goes.

## Open
- 🔄 **Creative grade, step 1 done (the tools):**
  - looks per scene and film (live), secondaries, finishing, native stills and native playback in Grade
  - moodboard references (`look_reference`), the `look.md` skill
  - ✅ before step 2: the UI fixes; sound EQ (`audio_eq`, `audio_match`, spectra); the bench louder and clearer; the
    cut after the bench (the closing line, the stand-up, an empty-bench beat, its steps as an L-cut); the lighter
    score's downbeat on the cut
- 🔄 **Creative grade, step 2:** the teal/orange reference grade on the bench master and the bedroom MS (film look,
  per-shot trim, face and sun and sky secondaries, vignette, grain) — waiting for the person's eye; then every shot
  of Day 01 trimmed to the same key
- ⬜ **Sound, next:** the garden B-roll's own sound as the scene's background (unbroken into the bench); a voice
  compressor and de-esser; a room match (reverb) for lav against camera; music level automation over a clip
- ⬜ **Finishing:** halation/bloom put an orange haze on the bench shot's hands — find the value feeding the glow
- ✅ **Everything iroh-native, end to end** (the Mac does all media work; the server only stores and relays):
  - ✅ Shot analysis cues on the Edit timeline (coloured by kind, click to go there) and in the inspector
  - ✅ AVFoundation reads the vault in place (resource loader over iroh's BlobReader) — no export anywhere: transcription, proxies, stills, renders, probe
  - ✅ Plates are vault files (synced, read in place); the speech models load from their blobs; scope sheets and grade_measure retired
  - ✅ Shot analysis moves into the Mac's ingest: frames sampled natively, Prem's Qwen called from the Mac (through Prem's confidential proxy on loopback; its key in a 0600 file beside the session, not the Keychain), thumbnail + `analysis/<hash>` written by the Mac; the server's analyse.rs retired (the API's /api/analysis is left, uncalled)
  - ✅ Timecode (`sound/<hash>`) read by the Mac at ingest (the file's tmcd track / BWF bext); the server's sound.rs retired
  - ✅ The HTTPS gateway fetch removed: files come over iroh from whoever holds them
  - ✅ Every store rules-driven (keep.rs, Mac and drives alike): records-only download policy, wanted files fetched + pinned + announced, GC = tags + records — de-sync per store works; the server's author is a catalog record
  - ✅ The server serves its Object Storage files over iroh (brought up into its store on request, verified, a bounded cache; pushes refused)
  - ✅ Shot analysis in the source monitor (cues on its bar, Mark as In/Out) and the library list — one shared component

## Elsewhere, or later (not tasks of this session)
- The Day 01 base correction is reviewed in its own grading session.
- The SDD_A drive: set up and rules-driven; its first fetch is tested when it is plugged in again (not now).
- Later, when said: timelines and world shots out of Postgres into iroh, then git-like versions for every tool.

## Done today
- **LLM calls through our server:** the Mac samples the frames, the API asks Prem with the server's key (no key on a Mac)
- **Playback:** a sound that failed to load once is asked for again on the next play; a silent play says why in the log
- **Day 01 · Opening base-corrected** (every V1 shot, balance only, no look):
  - bedroom master (the bed from the side): a touch warm (+0.25); garden master (the walk): clearly warm (+0.5)
  - all faces 47.5–49 IRE on the skin line; blacks 5–10, mid-tones 40–50 IRE
  - measured on the 4K stills with `grade_look`, checked on `grade_scopes`
- **Grade tab:** the shots side by side in the timeline, one column each with its picture, the grade's layers aligned
- **Builds:**
  - one build folder for every checkout and worktree (`maiaCITY/.cargo/target`; each `vault/target` links to it),
    which freed about 25 GB
  - no LTO, so a change rebuilds in a fraction of the time
  - debug builds slimmer, with their dependencies optimised
- **Server serves its own made files over iroh** (pinned in its store; old ones read back from S3 once); native GC on the server
- **Drives:** an external disk is its own iroh vault device; each story's rules (per class) decide who keeps what; changes asked in the modal
- **Studio in dark marine**; one name per file class everywhere (working, original, proxy, delivery)
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
- Every recording transcribed on-device (Phonon-2, English), self-healing in the Ingest flow.
- Captions come by themselves from the voice's transcript.
- The grade's balance layers, the same maths in JS, Rust and Metal; MCP grade_measure / grade_balance / grade_match.
- 4K 16-bit ACEScct grading stills at ingest.
- The Audio tab with the levels on the clips; MCP audio_measure / audio_mix / audio_level.
- One truth for a timeline: the studio sees outside edits within seconds, and the API refuses stale saves.
