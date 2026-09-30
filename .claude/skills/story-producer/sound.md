# Sound: voice, score, sound design

## Voice

- **Model:** ElevenLabs v3 through fal, `fal-ai/elevenlabs/tts/eleven-v3`, about $0.10 per 1000 characters.
  `timestamps: true` returns per-character timings; `wordsOf()` in `api/scripts/voice.ts` joins them into words and
  drops audio tags.
- **Audio tags** go in the text: `[softly] [warmly] [wistfully] [chuckles] [whispers] [with wonder] [proudly] [firmly]
  [quietly] [delighted]`. Use "…" for a breath.
- **Narrator:** "Grandpa Spuds Oxley" from the ElevenLabs Voice Library, voice id `NOpBlnGInO9m6vDvFkFC`, kept as
  `spuds` in `studio/voices.json`. fal needs the **voice ID, not the name**.
- **One take per line**, named like `day-19-d-hook`, `day-19-d-01`:
  ```
  bun voice say "[quietly] Two hundred and thirty-three people live here… and almost nothing they eat comes from further than a few minutes' walk." --eleven NOpBlnGInO9m6vDvFkFC --stability 0.5 --name day-19-d-hook --local
  ```
  It prints the take's CID; the shot list names the take by it. The pause before each line is set in the shot list,
  not by reading speed — one long take for a whole script sounded rushed.
- Rejected: Brian (an ElevenLabs preset), MiniMax Speech 2.8 HD (too sleepy).
- **Never clone a real person's voice.** Describe the qualities instead.

## Music: an original score per film

`bun scripts/film/score.ts scripts/film/<film>.mjs --local [--only music|cues] [--take b]`

- ElevenLabs Music v2.5 on fal (`elevenlabs/music/v2.5`) with a `composition_plan` of chunks (3–120 s each, at most
  30). `music.chunks` in the shot list gives each section's `until` on the film's clock and its `styles`; negative
  styles keep it instrumental (vocals, lyrics, singing, drum machine, EDM). `force_instrumental` can't be combined with
  a plan.
- Make an A and a B take and choose. A new score replaces the old one's CID in the shot list; take B prints its CID.
- **Each section switches with the arc** so the swell lands on the high and the drop on the low. Day 19: pre-dawn pad →
  sunrise swell (brass, strings, choir) → a drop to a lone cello drone → warm piano → marimba and pizzicato → full,
  joyful → the epic peak (the pride) → a sudden quiet (piano and cello) → a final hopeful swell that fades.
- **Cues** (`music.cues`, `score.ts --only cues`, cut into A2 by `musicClips()` in `sound.ts`): the score's own turns
  without composing it again. `replace: true` takes the score's place for its stretch (it comes back at
  `music.back`); others lie on top; a cue's `blend` overlaps its end with the score's return. Day 19: a dread cue over
  the low (a dissonant impact on the cut, low string clusters, a machine pulse) ending in silence on "Here…", then
  0.35 s later a **breakfast** cue bursting in (a sunburst chord, bouncy piano, pizzicato, 92 bpm).
- **A turn needs energy, not just warmth:** joy after the low is a lift in loudness, rhythm and brightness at once
  (`retention.md`).
- **The music steps back under the voice:** the render ducks A2 with the voice as key (sidechain, about −6 dB, 120 ms
  attack, 900 ms release). Score around 0.6.

## Sound design: three layers (A3, built by `scripts/film/sound.ts`)

- **Beds, one per scene,** from its first shot to its last: dawn chorus → cold wind → soft nature → forest → the
  commons → evening → crickets. A bed runs under the cuts and crossfades (1.2 s) into the next; **never restart a bed at
  every cut** (the sound pumps). Beds can end `hardOut` and the next come in `after` a beat of silence.
- **Spot sounds** on their shot (`sfx`): the hens on the hens, a truck on the highway.
- **Hits, few and on purpose** (`{ cid, peak, level }`): the loudest moment lands on `peak`. Day 19: a reverse swell +
  low boom on the smash cut into the low, a distant lorry on "carried by trucks", a soft whoosh on the orbit, a sub hit
  after the last word. No whooshes on ordinary cuts, **no riser over the final frames**, **no riser into the sunrise**.
- **Make the turns in the sound too:** keep the score, change what's under it (a motorway drone under the cold wind,
  a truck passing close on the cut in, then a beat of silence, then close morning birds).
- Match the sound to what the scene *means* — a workshop's tools under the commons made it sound like a factory.
- Sound effects: `fal-ai/elevenlabs/sound-effects/v2` (≤ 22 s; `loop: true` for a seamless loop):
  `bun scripts/film/score.ts <list> --sfx <name> --local` makes one from its recipe in `SFX` and prints its CID.
- The game's own ambience recordings are not equally loud: multiply sheep ×22.1, frog ×0.35, bees ×0.66, geese ×1.5
  (`NORMALIZE` in `sound.ts`, `assemble.mjs`, `ambience.ts`).

**Levels:** measure, don't guess. MCP `audio_measure` (BS.1770, the render's own meter) and `audio_level` bring
every clip to its track's aim before the render levels the whole mix to −14 LUFS / −1 dBTP:
- voice (A1) −18 LUFS
- music (A2) −26 LUFS, and the render ducks it 6 dB more under the voice; keep voice over music 12–18 LU
- sounds and beds (A3) −30 LUFS

Adjust single clips with `audio_mix` (gain in dB, up to +12). Clips carry their own fades (`fin`, `fout`): a voice at
least 0.05 s so it never clicks, the music 1 s in and 2.5 s out at the film's ends. The Audio tab shows it all on the
clips themselves.

## Cutting sound across scenes: J and L cuts

A scene change never cuts picture and sound at the same frame. That hard cut is what makes an edit feel like a
slideshow. The sound crosses the picture cut:

- **J-cut:** the next scene's sound comes in before its picture — a voice, a room tone, a mug on wood heard while we
  still see the last shot. It pulls the viewer forward, a question the cut answers. Use it into a new scene, into a
  speaker on camera, and into the payoff of a line.
- **L-cut:** the last scene's sound runs on past the cut into the next picture — the sentence finishes over the new
  shot, the bed fades under it. It carries a thought across and lets the picture react. Use it out of a line that
  lands, and for reaction shots.

How much: a word or two (0.3–1.5 s) for the voice, 1–3 s for beds and ambience. Beds crossfade over the cut (the
overlap is the J or L); the voice usually leads the picture into a talking head (J), and trails out of one (L).

In the timeline:
- An overlap of two clips on one track is the J or L itself. The studio draws the two clips in two lanes and marks
  the overlap **J** or **L** by where the picture cut falls in it (× where there is none).
- A video's linked sound that starts before its picture is a J; one that ends after it is an L. The badge is on the
  clip.

Build them on purpose at every scene transition, never by accident inside a scene.
