# Studio: requests and where they stand

Updated as the work goes. ✅ done · 🔄 in progress · ⬜ to do · 👤 yours

## Transcription and captions
- ✅ Every recording transcribed on this Mac (Nemotron, on-device): 309/309 final. 65 with words, 197 no sound track, 47 no speech (checked).
- ✅ Self-healing in the Ingest flow: Words/Tags columns, live %, ↻ retries, ✗ to start again, open steps on top, compact source cards.
- ✅ Captions come by themselves from the voice's transcript (monitor and render); the button is gone.

## Day 01 · Opening
- ✅ Voice-over swapped to "The moment I woke up today…" (DJI_80, three cuts on pauses).
- ✅ Extended to 57 s:
  - "Today I am alone, tomorrow we will see, but what I know for sure deep in my heart is this" (DJI_81)
  - the bench master shot C132, straight to camera: "During the next sixteen years, one million humans and founders… a new world, a better blueprint of society to live"
  - closing on C125 with "Welcome to day one." (DJI_69)
  - two of these clips went missing once, cause unknown; restored. Watching it.
- 🔄 Level the shots to each other (balance only, no look):
  - measured: the rising shot is 1.4 stops over and flat; the bench shots are outdoors, darker and more contrasty
  - bedroom scene matched to "in bed" (C161); bench C132 and C125 to each other
  - blocked: the deployed API doesn't keep `balance` until PR #42 is merged and deployed

## Grade
- ✅ Balance maths: white balance, exposure, contrast, highlights, lows, in ACEScct. JS, Rust and Metal agree (tests).
- ✅ Render applies it: CST → balance → creative grade → film look → output.
- ✅ MCP for the LLM:
  - grade_measure: luma percentiles and the middle tones' cast, from the full originals
  - grade_balance: set one shot
  - grade_match: fit to a reference, the average or neutral; levels by exposure and white balance and only nudges the tones
- ✅ No suggestion buttons in the studio: balancing is an LLM job.
- ✅ Grade tab as a layer stack, bottom applied first:
  - Input (CST)
  - Balance layers
  - Creative grade
  - Film look
  - Output (top)
- ✅ Balance shown in the studio preview (WebGL), in Grade and in Edit with "Grade" on.
- 🔄 Grading stills at ingest: 4K, 16-bit PNG of ACEScct code values, CST baked in, one per shot from the original. They sit next to the proxy; existing shots get theirs by a backfill; the measuring reads them.

## Studio UI
- ✅ Edit lock removed: no lock button or stages; Grade is always open.
- ✅ Title bar: one read-only title and description, centred; no duplicates.
- ✅ Transport as one quiet line (play, clock · Grade, ⛶, zoom, ? for keys).
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
- 👤 Merge [PR #42](https://github.com/MyAvenCEO/maiacity/pull/42): `gh pr merge 42 --merge`. It now carries all of the above, and the balances only persist once it is deployed. The permission check blocks me from merging.
- ⬜ Rebuild and restart the studio app after each batch; push the branch.
