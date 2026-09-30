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

Adjust single clips with `audio_mix` (gain in dB, up to +12), their tone with `audio_eq` / `audio_match` (below). Clips carry their own fades (`fin`, `fout`): a voice at
least 0.05 s so it never clicks, the music 1 s in and 2.5 s out at the film's ends. The Audio tab shows it all on the
clips themselves.

## Tone: EQ, measured and matched

Every sound clip can carry an EQ: bands in order, each a biquad from the Audio EQ Cookbook (`highpass`, `lowshelf`,
`peaking`, `notch`, `highshelf`, `lowpass`; `f` Hz, `gain` dB, `q`). The render's mix (Rust) and the studio's playback
(Web Audio) make the same filters from the same data, so what you hear in the studio is what renders. It is driven
through the MCP; the Audio tab only shows it on the clip (`EQ HP 90, +3 dB 4k`).

- **`audio_measure`** gives each clip's `spectrum`: octave bands 63 Hz–16 kHz, each one's share of the energy where it
  speaks (dB), through its EQ. Compare two voices band by band, the way `grade_scopes` compares two shots.
- **`audio_eq { clips | track, eq }`** sets an EQ by hand (replaces; `[]` takes it off).
- **`audio_match { clips, reference }`** is the sound's `grade_match`: it builds the EQ that gives the clips the
  reference's tone (`amount` 0.8, `limit` ±6 dB by default) and, with `level`, the gain that makes them play as loud.
  It works in broad strokes: the differences are smoothed over neighbouring octaves, the bands are wide, and moves
  under 1 dB are left out. Propose first (`apply: false`), read the residual, then decide.
- **One EQ per mic setup, not per clip.** Two clips cut from one take (a talking head split for a cutaway) get the
  same EQ and the same gain, or the cut between them jumps. Base it on the longer clip: a short one's spectrum is
  mostly its few words.

Rules for a voice:
- **High-pass** under the voice: 70–100 Hz for a low voice, 100–120 Hz for a higher one. Wind, rumble and handling
  live there.
- **Cut narrow, boost wide.** Mud sits at 200–400 Hz (cut 2–4 dB, q 1–1.4); presence at 2.5–5 kHz (boost 2–4 dB,
  q 0.7–1); air above 8–10 kHz (a high shelf, 1–3 dB). Never more than about 6 dB on any band.
- **One reference voice per film:** the cleanest recording (the lav, the voice-over). Match every other voice to it,
  so a cut from voice-over to a talking head doesn't change the room the voice is in.
- **A camera's voice is further away:** more room, less presence, duller. `audio_match` against the lav or voice-over
  brings its tone back; it cannot take the room's echo out. Only a closer mic can do that, so record a lav on every
  talking head. Pros match dry to wet: they add the room to the lav rather than strip it off the camera (iZotope
  Dialogue Match only adds reverb). Take EQ match at a fraction, never 100 %.
- **Where a voice goes wrong** (iZotope, Carpenter): 100–250 Hz tubby, 250–800 Hz boxy, 800 Hz–4 kHz clarity (a
  telephone when overdone), 4 kHz and up polish; esses at 4–10 kHz.
- **Make a pocket for the voice in the music** instead of pushing the music down further: a wide cut of 2–3 dB at
  2–4 kHz on the music clip under a dense voice.

The pass: `audio_measure` → choose the reference voice → `audio_match` the other voices (level on) → check each voice
clip's `voice_over_music_lu` (12–18) → listen through the cuts in the studio. Nothing may jump in tone or loudness from
one voice clip to the next.

## Mixing: how the pros finish a film

Dialogue is the anchor: set the voice with the meter, then blend music and sound under it by ear (AES TD1009, Rob
Byers). The numbers, from the research on Day 01 (AES, EBU R 128, iZotope, Production Expert, Purcell, Murch):

**Voice**
- Every voice clip at one loudness, voice-over and sync sound alike: within ±1 LU of each other. Viewers reach for the
  volume when dialogue drifts +2 / −5 dB.
- A talking head may sit about 1 LU above the voice-over: it is further from the mic and has to feel present.
- Pros compress dialogue gently (2:1 to 3:1, a few dB, never more than 6) and de-ess. **The mix has neither yet:**
  level by clip gain, and keep the voice-over and the sync sound close in dynamics by choosing takes.

**Music under the voice**
- At least **10 LU** below the voice (Torcoli et al., AES). Ordinary viewers want about 4 LU more than engineers do,
  so aim for **14–16 LU**. `audio_measure`'s `voice_over_music_lu` is the number.
- No lyrics and no busy percussion under speech. Heavy bass masks a voice more than anything else.
- Let it breathe: up in pauses of 1.5 s or more, down again before the next word. The render's ducker does this per
  word (ratio 4, 120 ms attack, 900 ms release).
- **A second score comes in on a beat that matters:** find its first strong downbeat (onsets in its first seconds)
  and put that beat on the picture cut. Pre-lap it 0.5–2 s under the outgoing shot.
- **The first score leaves under the action:** a 2–3 s fade that starts as the closing line lands, over the
  movement. A cue that has a real ending is back-timed so its button lands on the out point instead.
- Crossfade two cues over 0.5–2 s.

**Someone leaves the frame**
- Let the action finish (Murch: emotion, story, rhythm): keep the stand-up and the steps.
- Hold 0.5–1 s after they clear frame.
- Carry their sound 0.5–1 s into the next shot as an L-cut.
- Land the new music's beat on the first frame of the next scene.

**Backgrounds**
- A background runs unbroken through its scene. Silent B-roll between two shots with birds makes the birds pop in at
  the cut, so give the B-roll its own sound: a video's sound on V1 at a volume plays in the studio and the render.
- At least 15 LU under the voice. No one-off sounds on top of a line, no audible loops.

**Delivery** (the render does this): −14 LUFS integrated, −1 dBTP. Keep the loudest short-term moments within about
+5 LU of that, and dialogue's loudness range within 6–7 LU. If the limiter takes more than 3–4 dB, fix the mix
instead.

**The pass, in order:**
1. Voice clips: EQ (match) and gain to one loudness.
2. Backgrounds under every scene, unbroken.
3. Music: edit it first (where it starts and leaves, on the beats), then its level under the voice.
4. Transitions: J/L cuts, pre-laps, crossfades.
5. `audio_measure` again.
6. Listen through every cut in the studio.

QC before the render: voice to music ≥ 12 LU everywhere, voices within ±1 LU, no clip without fades, nothing silent
where a scene has air.

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
