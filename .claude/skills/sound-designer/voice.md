# Voice: the narrator and the takes

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

## Writing for the ear

- **Write the narration for one hearing.** The listener can't turn back the page, and a viewer with captions off gets
  one pass: short declarative sentences, one idea each, plain words; read every line aloud and rewrite what trips
  (Alex Chadwick, Rob Rosenthal).
- **Never step on the tape.** The narrator sets up Samuel's on-camera lines and never repeats them: script and tape work
  as a team (Nancy Updike).
- **No print-style narration:** no stacked titles and ages, no clauses the ear must hold.

## Directing a voice

- **To one listener.** Understated and conversational, so the viewer leans in. Samuel's own voice-over can be spoken to
  a person and improvised rather than read (Frank Langfitt).
- **Eleven v3** has no SSML breaks, and "…" and dashes pause unevenly: where a pause must land, split the line into
  two takes. Capitals add emphasis. Speed spans about 0.7–1.2 (unverified through fal).

## Recording Samuel's own voice in a small room

- 15–20 cm from a directional mic gives warmth (proximity effect); 25–30 cm is clearer; 15–30° off-axis tames harsh
  consonants.
- Face soft things — hanging clothes, the duvet — away from corners and with no bare wall behind the mic. In a small
  room the first reflections arrive almost with the voice and make it boxy; a closer mic raises the voice over the
  room.

Sources: transom.org (Updike 2006, Chadwick 2015, Rosenthal 2017 and 2025, Langfitt 2015);
elevenlabs.io/docs/best-practices/prompting/eleven-v3; sonarworks.com (recording vocals at home).
