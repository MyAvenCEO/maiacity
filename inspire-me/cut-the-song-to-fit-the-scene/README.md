---
title: Pick the feeling first, then cut the song to fit the scene
source: https://www.youtube.com/watch?v=SII_dSf1_hw
type: video
author: Tim Runia
authorUrl: https://www.youtube.com/@TimRunia
added: 2026-10-10
categories: [filmmaking, self]
hook: >-
  A 40-second scene, and a song with a 40-second build-up before anything happens. He doesn't look
  for another song. He takes eight seconds of the build, eight of the middle, four of the break, and
  jumps straight to the climax.
shift:
  from: Music is a track you pick by genre at the end and lay under the edit as it was made.
  to: Music is part of the edit from the first rough voiceover; you choose it by feeling and energy, take it away for contrast, and reshape it to your scene.
quote: "You don't have to use a song exactly the way it was made."
---

## The story

He has been editing for over fifteen years, and before he opens a music library he asks one question. What should this part feel like?

Not which genre. Most people search by genre, scroll an endless list, find a track that sounds good and leave it running under the video. The song can be fine. It still fails, because the feeling and the energy are what a viewer takes in, and genre tells you almost nothing about either.

His own first YouTube video shows the trap from the other side. In the opening shot his face is already a little quirky. Put playful music under it and the image and the sound both make the same joke, and the moment turns into one. Put something dramatic under it and the whole thing becomes too dramatic. He wanted action that still felt light, so the music had to sit in between, adding what the picture didn't already say.

It works in a tutorial too. While he explains why something is broken, the music is a little mysterious, a little tense, the feeling of investigating. When the fix arrives it turns lighter and more energetic. The information is the same; the viewer feels the release.

Knowing the feeling doesn't end it.

The track that fits perfectly starts to wear off if it stays too long. If everything is energetic, nothing feels energetic anymore. So he thinks in contrast, and the strongest contrast is often no new song at all, only silence. He takes the music out under one sentence and that sentence stands out. When the music comes back it feels bigger than before, because there was a gap.

Even with the feeling named, finding the track is slow when you only have one word for it. He searches with three: a feeling, an energy and a style. Mysterious, subtle, electronic. Then he listens and narrows it down, a little more tense, more beat, until it works against the footage.

The bigger change is when the music comes in. Usually before he has filmed anything.

Once part of the script exists he records a rough voiceover, drops it on the timeline and lays tracks under each section. He calls it the audio blueprint. Before a single shot he can hear the video: where the energy rises, where it slows, where the music should drop out. For a fast run through camera moves (top-down, point of view, snorricam, gimbal, Dutch angle, push in, push out) a quick track made him picture the shots shorter and more playful, so he filmed for that rhythm. He also knew that stopping all that energy would make the next moment land harder. Sometimes the music even shortens the script: the same sentence in fewer words flows with the track.

What's left is the track itself, and that's no longer fixed either. A song with a 40-second build, two even minutes, a break and a climax becomes eight, eight, four and a finish, at the speed the scene needs. It doesn't have to fade in and out every time, which makes every change feel alike. A reverb tail lets it end naturally; an abrupt stop on a transition sound makes the change hit.

The song is part of the edit. You choose it by feeling, you shape it like footage, and you are allowed to take it away.

## Beliefs that shift

- *You pick music by genre once the edit is done.* → Name the feeling and the energy first, and bring the music in with a rough voiceover before you film, so it shapes the shots.
- *A track that fits should run as long as it fits.* → Any feeling wears off; contrast keeps it alive, and the strongest contrast is often a moment of silence.
- *A song has to be used the way it was made.* → Cut its build, middle, break and climax to the length of your scene, and end it with a reverb tail or a hard stop rather than the same fade every time.

## What we learn

- **Write the score prompt as feeling, energy, style.** Our films don't search a library; `score.ts` composes each one with ElevenLabs Music, a style list per chunk. Day 19's chunks already read like his search ("mysterious, intimate", "60 bpm"). Writing every chunk in his order would make the prompts more consistent.
- **His song surgery is our composition plan.** He cuts a found song down to 8 + 8 + 4 seconds and a climax. We can compose it that way from the start: `music.chunks` gives each section its `until` on the film's clock, so the build, the break and the peak are wherever the scene needs them.
- **The audio blueprint is already our order of work.** The sound designer's first step is the narrator's takes before the shot list is timed, and the editor cuts voice and music first, then renders the world shots to fit. A world camera can be rendered again to the bar, which is more than a filmed shot allows.
- **Silence before the line.** Day 19 drops its dread cue to silence on "Here…" and brings the breakfast cue in 0.35 s later, the same contrast he uses. Plan the silences in the spotting pass, as decisions, before any music.
- **Don't let the music repeat the picture.** His quirky face under playful music became a joke. Music carries a feeling the scene has already earned; when Samuel's face or a world already says it, the score should add what's missing or step back.
- **Stop fading.** The score rules end a cue on a real ending or a button and keep the fade for last. His reverb tail and hard stop on a transition hit belong in the same toolbox, and our hits list (few, on purpose) is where they go.
- **The devlog half of a Day can use the tutorial arc.** Each journal day is half devlog: a bug or a problem has the tense, investigating sound, the fix the release.

## Open questions

- The video's title isn't in the transcript, and YouTube is blocked from here. The author is inferred: a filmmaker from the Netherlands chasing a YouTube dream, who starts from the feeling and makes "videos that flow", as Tim Runia does in his other card. Check the channel, and add `originalTitle` and the thumbnail when YouTube can be reached.
- He picks and cuts existing tracks; we generate ours. Can ElevenLabs Music hold one melody across chunks so a reshaped score still sounds like one piece? The score rules mark this as untested.
- Would a rough-narrator audio blueprint (voice takes plus a draft score, no picture) be worth adding to the studio as a first step, so Samuel can listen to a Day before anything is rendered?
- The Hans search tool, Audiio Pro and his sound pack are sponsors or his own products; the method doesn't depend on them.
