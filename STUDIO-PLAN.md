# Studio plan

✅ done · 🔄 in progress · ⬜ to do. Updated as the work goes.

## Open

### Day 01 · Opening (the cut)
- 🔄 Two shots between the bedroom and the bench:
  - him walking towards the bench
  - from the bench's right side, placing the coffee
- 🔄 The cut around them:
  - "Today I am alone…" already outside
  - "…what I know for sure is this" ends on the coffee mug
  - then back to the frontal bench shot
- 🔄 The bench voice ("During the next sixteen years…") played silent in the studio. Fixed: 107 videos had audio proxies that were not linked. It needs checking by ear after the restart.
- ⬜ Level the shots to each other again (balance only, no look). The API keeps balances now; this waits for the new cut.
- ⬜ Level the sound again with the new clips. Gain above 0 dB is allowed now: voice −18, music −26, sounds −30 LUFS.

### Script tab (story development)
- ⬜ Layout: script on the left (50%), the preview on the right (50%), the timeline full width below.
- ⬜ The timeline in Script shows only:
  - the story structure: thumbnail (1 frame) · hook · Act 1 · Act 2 · Act 3 · cliffhanger
  - the tension / release curve across all sections
  - the captions
- ⬜ The script is read-only and styled as a screenplay: scene headings, action, the speaker and their line (V.O. or on camera). An LLM edits it through MCP.
- ⬜ Timeline version picker above the script, to switch between timelines.
- ⬜ Story sections and tension saved on the timeline, set through MCP.

### Edit and timeline
- ⬜ J and L cuts: overlapping clips on one track shown side by side (not hidden under each other), each overlap marked J (sound leads the picture) or L (sound trails it).
- ⬜ The story-producer skill cuts sound at scene transitions with J and L cuts.
- ⬜ Library list (left): preview thumbnails for every clip; remove the "A-Log2 → CCT" badges.
- ⬜ Title bar: less space above it, closer to the window's top edge.
- ⬜ During playback every timeline follows the playhead.

## Done
- ✅ Every recording transcribed on-device (Nemotron): 309/309, self-healing in the Ingest flow.
- ✅ Captions come by themselves from the voice's transcript (monitor and render).
- ✅ Opening: new voice-over ("The moment I woke up today…"), extended with "Today I am alone…" and the bench monologue, closing on "Welcome to day one."
- ✅ One truth for a timeline: the studio sees outside edits within seconds, and the API refuses a stale save.
- ✅ Grade:
  - balance layers (white balance, exposure, contrast, highlights, lows) in ACEScct; JS, Rust and Metal agree
  - layer stack UI; balance shown in the preview
  - MCP grade_measure / grade_balance / grade_match
  - 4K 16-bit ACEScct grading stills at ingest (11 backfilled)
- ✅ Audio tab:
  - the levels on the timeline itself (gain line, fade corners, loudness, voice over music)
  - MCP audio_measure / audio_mix / audio_level
  - volume removed from the Edit inspector
- ✅ Script tab, first version: scenes → shots → lines on the same clips; slates and lines; swapping. It is being redone as above.
- ✅ Studio UI: no edit lock; a centred read-only title; transport as one quiet line.
- ✅ Shipping: PR #42 and PR #43 merged by me with gh and deployed (API with balance, script clips and the stale-save guard).
