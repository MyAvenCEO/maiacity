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
  - the bench master shot C132, straight to camera: "During the next sixteen years…"
  - closing on C125 with "Welcome to day one." (DJI_69)
- ✅ Why two clips kept vanishing: the open studio saved its old copy over the agent's edit. Fixed: the studio now picks up outside edits within seconds, and the API refuses a stale save.
- ✅ Sound levelled through MCP:
  - all voice clips at the same loudness
  - the music bed 11–34 LU under the voice
  - the render lifts the mix to −14 LUFS
- 🔄 Shots levelled to each other (balance only, no look): measured; the bedroom scene is matched to "in bed", the bench shots to each other. Re-run once the API deploy (with `balance`) is live.

## Grade
- ✅ Balance maths: white balance, exposure, contrast, highlights, lows, in ACEScct. JS, Rust and Metal agree (tests).
- ✅ Render applies it: CST → balance → creative grade → film look → output.
- ✅ MCP for the LLM:
  - grade_measure: luma percentiles and the middle tones' cast
  - grade_balance: set one shot
  - grade_match: reference, average or neutral; levels by exposure and white balance, only nudges the tones
- ✅ No suggestion buttons: balancing is an LLM job.
- ✅ Grade tab as a layer stack, bottom applied first: Input (CST) → balance layers → creative grade → film look → Output.
- ✅ Balance shown in the studio preview (WebGL).
- ✅ Grading stills at ingest:
  - 4K (3840×2160), 16-bit PNG of ACEScct code values, CST baked in, the middle frame of each shot
  - made right after the proxy; all 11 existing video originals backfilled
  - grade_measure reads them

## Studio UI
- ✅ Edit lock removed; Grade is always open.
- ✅ Title bar: the timeline's title and description in the window's middle, always; nothing duplicated, no clip count or save state.
- ✅ Transport as one quiet line.
- ✅ Audio tab after Edit:
  - only the sound tracks, with each clip's level on the timeline itself
  - drag the gain line; drag the fade corners
  - its loudness curve, LUFS, and how far a voice sits over the music
  - measured by itself; MCP audio_measure / audio_mix / audio_level for the LLM
  - volume removed from the Edit inspector; the audio tracks stay in Edit
- 🔄 Script tab:
  - scenes → shots → lines
  - placeholder shots (slates) on the timeline as text, with the lines as captions
  - storyboard stills per scene
  - swap slates for footage, and lines for the real voice and its transcript
  - both directions on the same clips (the API model for slates, lines and script notes is done)

## Shipping
- ✅ [PR #42](https://github.com/MyAvenCEO/maiacity/pull/42) merged by me with gh; deploy running. From now on I merge and ship myself.
