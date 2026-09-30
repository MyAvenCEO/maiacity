# Studio: requests and where they stand

Updated as the work goes. ✅ done · 🔄 in progress · ⬜ to do · 👤 yours

## Transcription and captions
- ✅ Every recording transcribed on this Mac (Nemotron, on-device): 309/309 final. 65 with words, 197 no sound track, 47 no speech (checked).
- ✅ Self-healing in the Ingest flow: Words/Tags columns, live %, ↻ retries, ✗ to start again, open steps on top, compact source cards.
- ✅ Captions come by themselves from the voice's transcript (monitor and render); the button is gone.

## Day 01 · Opening
- ✅ Voice-over swapped to "The moment I woke up today…" (DJI_80, three cuts on pauses).
- 🔄 Extend it: "Today I am alone, tomorrow we will see, but what I know for sure is this…", then cut to the bench master shot, straight to camera, "during the next sixteen years…". A background agent is doing this now.
- ⬜ Level all the shots to each other through MCP (grade_match), once the bench edit is in.

## Grade
- ✅ Balance maths: white balance, exposure, contrast, highlights, lows, in ACEScct. JS, Rust and Metal agree (tests).
- ✅ Render applies it: CST → balance → creative grade → film look → output.
- ✅ MCP for the LLM:
  - grade_measure: luma percentiles and the middle tones' cast, from the full originals
  - grade_balance: set one shot
  - grade_match: fit shots to a reference, the average or neutral
- ✅ No suggestion buttons in the studio: balancing is an LLM job.
- 🔄 Grade tab as a layer stack, bottom applied first:
  - Input (CST)
  - Balance layers
  - Creative layers
  - Film look
  - Output (top)
- 🔄 Balance shown in the studio preview (WebGL).
- ⬜ Grading stills at ingest: 4K, 16-bit PNG, ACEScct, CST baked in, one per shot. They go next to the proxy, tags and thumbnails; the measuring reads them.

## Studio UI
- ✅ Edit lock removed: no lock button or stages; Grade is always open.
- ✅ Title bar: one read-only title and description, centred; no duplicates.
- ⬜ Audio tab after Edit:
  - sound design, with the levels of voice, music and effects
  - fades, and the balance between tracks
  - MCP auto-levelling for the LLM, shown on that screen
  - level controls leave Edit; the audio tracks stay
- ⬜ Script tab:
  - scenes → shots → lines
  - placeholder shots on the timeline as text, with the lines as captions
  - storyboard stills per scene
  - swap placeholders for footage, and lines for the real voice and its transcript
  - both directions on the same clips (the API model for slates, lines and script notes is done)

## Shipping
- 👤 Merge [PR #42](https://github.com/MyAvenCEO/maiacity/pull/42): `gh pr merge 42 --merge`. The permission check blocks me from merging.
- ⬜ Rebuild and restart the studio app after each batch; push the branch.
