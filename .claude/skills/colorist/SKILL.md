---
name: colorist
description: The colorist of maiaCITY's films, in the ACES pipeline over MCP (the Mac app's grade tools — the maths only in Rust and Metal). First the base correction (each scene levelled to its master by blacks, whites, contrast, colour, saturation and skin, judged on the 4K grading stills through the ACES 2.0 output), then the look (film and scene looks, teal and orange without ruining skin, secondaries, finishing), colour that follows the story's arc, and rendered 3D-world shots made to sit with iPhone footage. Use it whenever a timeline is balanced, graded or given a look, or when shots don't match.
---

# Colorist

The grade makes a cut of many shots, cameras and worlds read as one film, then gives the film its feeling. Like a real
post house: balance first, the look on top, never the other way round.

## The colorist's laws

1. **Judge only the real thing:** the 4K grading stills and hero frames through the ACES 2.0 output — never a preview,
   a thumbnail or a proxy (`base-correction.md`).
2. **Base before look.** Every shot balanced to its scene's master (blacks, whites, contrast, colour, saturation,
   then skin) before any look (`base-correction.md`).
3. **Skin never jumps** across a cut, and is never pushed teal (`look.md`).
4. **A look sets which colours are possible, not how bright a shot is:** no exposure or contrast in a look; the low
   key lives in each shot's trim (`look.md`).
5. **Less is more.** A look, a trim, a quiet vignette and grain — no face-tracked lifts, no faked light shapes, no
   relighting what the footage didn't have (`look.md`).
6. **Colour follows the arc.** The low cold and desaturated, the new world warm; every change of look has a reason in
   the story (`color-story.md`).
7. **One world, many sources.** Rendered shots and iPhone footage meet in the same blacks, roll-off, grain and softness
   (`color-story.md`, "Making CG sit with real footage").
8. **The maths lives in Rust and Metal only.** The studio samples cubes the Mac app bakes; nothing is baked into a
   source.
9. **The journey before the balance.** Every iPhone 17 Pro shot must read `apple-log-2` from its log atom in the
   studio: the Apple Log curve, Apple Wide Gamut into AP1 (Bradford), ACEScct. A shot that reads `apple-log` or
   `unknown` is fixed at its tag (or the phone's setting), never with the balance: Apple Log 2 taken as Apple Log turns
   skin about 7° towards red and takes up to a quarter of the colour out (`base-correction.md`).

## The sub-skills

| File | The skill | Use it for |
|---|---|---|
| `base-correction.md` | the balance pass | scene masters, the warmth asked per scene, blacks, whites, contrast, colour, skin; the tools (`grade_scopes`, `grade_look`, `grade_match`, `grade_stack`); Day 01's lessons |
| `look.md` | the creative grade | the stack order, teal and orange without ruining skin, interiors that read real, finishing as a kiss, rolling a reference out to the timeline |
| `color-story.md` | colour across the film | a colour arc for the story, harmony and contrast, film-like density and roll-off, CG beside camera footage, judging on phones |

The research behind law 9 — Apple Log 2's facts, the gurus, an audit of our journey with its fixes, the grading tools
to add, the capture checklist — is `APPLE-LOG-2-RESEARCH.md` at the repository's root.

## The order of work

1. The edit is locked (`editor`); the originals are conformed.
2. Survey every scene's shots on one scope sheet, **and each shot's journey (its profile and where it was told
   from)**; pick each scene's master; ask Samuel the warmth per scene.
3. Base correction, scene by scene, then scene to scene (`base-correction.md`).
4. The colour arc: which scenes are cold, which warm, where the turns are (`color-story.md`).
5. The film look against the references, then scene looks, then trims, then secondaries only where still needed,
   finishing last (`look.md`).
6. Hero frames at 4K either side of every cut; play it in the Grade tab; nothing may jump.
