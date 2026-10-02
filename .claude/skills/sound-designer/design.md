# Sound design: beds, spots and hits

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

## The masters' principles

1. **Write a sound script from the story's beats before choosing a sound.** Per beat: what the viewer feels and hears,
   and where Samuel stops to listen. A sound chosen for a beat tells the story; one chosen for a picture cue decorates
   (Mark Mangini: why before how; Randy Thom: planned late, sound can only decorate a finished film).
2. **Decide, scene by scene, whose ears we are in.** Give Samuel moments to listen and let what he hears change. At a
   peak, go subjective: filter the world away to one inner tone (Thom: the great sound sequences are point-of-view
   sequences; Gary Rydstrom closed Omaha Beach down to a seashell roar).
3. **Count layers by colour, at most two and a half of one kind** (Walter Murch). Speech is the most *encoded*,
   music the most *embodied*; footsteps, effects and atmospheres lie between. Three alike fuse into a blur; five
   spread across the spectrum stay distinct. So: the narrator and Samuel's own voice never overlap; when the score
   swells, the spot sounds give way; a lone walker's steps are synced, a crowd's need not be. **Drop a layer rather
   than turn everything down.**
4. **Record the real thing and process it little.** A sound with a real acoustic basis is already half believed
   (Mangini); the best effects are the best raw recordings (Rydstrom). A familiar sound in a strange place keeps its
   feeling and loses its identity (Ben Burtt's foghorn in Cloud City).
5. **Worldize what plays inside the world.** A radio, a phone, music from a speaker: play it through a small speaker in
   a real room, record it at the camera's distance, blend it with the dry track (Murch). For the room world, re-record
   in the real bedroom.
6. **Build every place near, middle and far, over its air.** Close specifics, a middle texture, distant events spaced
   unevenly, on the room tone. Push a sound away with less direct sound, more reverb, fewer highs. Keep the bed out of
   350 Hz–2 kHz under a voice, where it masks speech; hold low end back so it still hits when it comes (Michael
   Theiler). Record 30–60 s of room tone for every set-up, same mic, same place.
7. **Give Samuel's body its sounds:** steps that match his shoes and the floor (limed oak boards), cloth when he sits,
   reaches or turns, each prop its own sound. Done well, Foley goes unnoticed.

## Silence, contrast and transitions in sound

| Tool | Use it for | From |
|---|---|---|
| A slow slope to silence | the last line: the viewer fills the gap with their own feeling | Murch |
| A hard drop-out to room tone | a shock, a cut into someone's head — never to digital zero | Murch, Rydstrom |
| The subjective muffle | at a peak, the world filtered to one inner roar | Rydstrom |
| Pulling the air out | one uncanny moment, the world's sounds fading away | Theo Green (*Dune*) |
| An unscored stretch | the sound design carries an action alone | Burtt |
| Establish, then off-screen | show the motorway once with its sound; later play it low and unseen, and it still reads | Thom |
| Near and far | less direct sound, more reverb, fewer highs | Theiler, Murch |
| A low drone for unease | the low only — and with audible harmonics, since phones can't play sub-bass | Theiler |
| An endless rise | pressure that never peaks (a Shepard tone), once, briefly | Zimmer, *Dunkirk* |
| A sound match | a sound in one scene becomes its double in the next (a scream into a train whistle; helicopter blades into a ceiling fan) | Hitchcock, Murch |
| A sound as metaphor | a sound meaning more than its source: whales for a hunted truck | Mangini |
| A river of sound | beds rise and recede on their own rhythm, not the picture's cuts | Skip Lievsay |
| A tuned drone | the score's drone on the pitch of the bed's hum, so the music grows out of the place | Carter Burwell |

Check every sound transition with your eyes closed: a bridge fails when it joins unrelated sounds or runs too long.

## Mistakes the pros avoid

- A music swell on top of a key sound effect: one of them gives way.
- Over-processed or synthetic sounds where a real recording exists; copying another film's sound instead of asking why.
- Dread carried only by sub-bass a phone cannot play.
- Judging density on the wrong screen: Murch's *THX 1138* track sounded right on a dim monitor and overwhelming when
  projected. Judge ours on a phone.

## Sources

Murch, *Dense Clarity – Clear Density* (transom.org/2005/walter-murch) and worldizing (filmsound.org/terminology/
worldizing.htm); Randy Thom, *Designing a Movie for Sound* (filmsound.org/articles/designing_for_sound_old.htm);
Rydstrom (usoproject.blogspot.com/2011/06/interview-with-gary-rydstrom.html); Burtt (starwars.com/news/empire-at-40-
ben-burtt-interview); Lievsay (designingsound.org/2013/03/29); Burwell (carterburwell.com/projects/NCFOM.html);
Mangini (the-talks.com/interview/mark-mangini); Theiler (designingsound.org/2012/12/29/creating-the-spaces-of-
ambience); room tone (izotope.com/en/learn/basics-of-room-tone-audio-editing.html).
