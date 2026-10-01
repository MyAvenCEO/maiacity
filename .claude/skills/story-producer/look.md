# The look: the creative grade

What comes after the base correction (`grading.md`): the look of the film and of its scenes, the secondaries that
protect or lift a part of a shot, and the finishing that gives the film its texture. It is done the way top colourists
build a look in DaVinci Resolve (Cullen Kelly, Juan Melara, Walter Volpatto): **balance per shot first, the look on
top, never the other way round.**

## The order: every shot goes through these, in this order

| Layer | Level | What | Where it lives |
|---|---|---|---|
| Balance | shot | the base correction (`grading.md`) | `clip.balance` |
| Secondaries | shot | a part of the shot (a key, a window, the face) given its own balance | `clip.secondaries` |
| Grade | shot | a trim of that one shot | `clip.grade` (CDL) |
| Scene look | scene | inside/outside, day/night: a scene's own look | `grade.scenes[scene]` |
| Film look | film | the film's look, the same on every shot | `grade.film` |
| Finishing | film | pop, halation, bloom, grain, vignette | `grade.finish` |
| Output | — | ACES 2.0 to Rec.709 | fixed |

- **No exposure or contrast in the look.** Those belong to each shot: its balance (the base) and its trim (the
  Grade layer, where a low-key mood goes). A look sets which colours are possible, not how bright a shot is (Kelly:
  exposure and contrast are "not allowed in look development").
- **A scene's look goes under the film's.** Use it where the light really differs: inside against outside, day
  against night. The film look is what every shot shares.
- **Secondaries are the last resort,** after the balance and the look. If skin needs a key, the balance or the look is
  wrong (Volpatto).
- **The maths lives only in Rust and Metal.** The looks bake into one cube per shot, so the studio plays them live.
  Secondaries and finishing are spatial, so the Mac shows them natively: in the Grade tab's stills and its playback,
  and in the render.

## The tools (MCP, in the Mac app)

- **`look_reference { hashes }`** reads the moodboard's stills:
  - levels and contrast
  - **zones**: shadows, middle and highlights, each with its level, its cast (warm, green) and its hue and chroma
  - where the colour lies: warm, green and teal/blue shares
  - saturation and skin
- **`grade_look { looks: true }`** and **`grade_scopes { looks: true }`** read the same things on the shots, through
  their whole chain. Compare them zone by zone with the references.
- **`looks`** shows the film's look, each scene's, and the scenes with their shots in order. **`look_set { scene?,
  look }`** sets one of them. Without a scene, it sets the film's.
  - A look has: `cdl` or `preset`, `contrast` (around `pivot`), `split: { shadows: { hue, amount }, highlights: {
    hue, amount }, balance }`, `hue: [[hue°, shift°]…]`, `hue_sat: [[hue°, factor]…]`, `hue_lum: [[hue°, stops]…]` (density: darker foliage or
    sky, −2…2), `sat`, `lut` (a `.cube`'s
    hash, ACEScct in and out) and `strength`.
  - Hues are the vectorscope's, as the display shows them: the skin line at 123°, orange about 110–140°, foliage
    green about 200–240°, teal and cyan about 270–300°.
- **`grade_secondary { clip, secondaries }`** sets up to 4 per shot. Each has a `key` (hue [centre°, width°], sat
  [lo, hi] × 100, luma [lo, hi] IRE, soft) and/or a `window` (ellipse or rect, x, y, w, h, angle, feather, invert, or
  `track: "face"`), plus an `adjust` (the balance's controls) and a `mix`.
- **`grade_finish { finish }`** sets `pop`, `halation`, `bloom`, `grain` and `vignette`.
- **`render_frame`** makes a hero frame through everything.

## Teal and orange, without ruining skin

The look splits warm from cool on two axes at once: by luma (warm highlights, cool shadows) and by hue (skin and
warm things towards orange, foliage and sky towards teal). Two hues at different places on the luminosity ramp, not
one cool tint (Melara).

1. **The split:**
   - Shadows towards teal (`hue` about 280°) and highlights towards warm (about 120–130°, on the skin line).
   - Amounts about 0.2–0.5. Look at the vectorscope: the trace should straddle two quadrants (Kelly).
2. **Greens towards teal:** a `hue` point on the foliage (about 200–230°) shifted towards teal, about +10–25°.
   Leave the skin line alone: put a point at 123° with a shift of 0.
3. **The skin "bumper"** (Kelly):
   - Hues just beside skin are pulled onto the skin line: orange-yellow a few degrees down, red-orange a few up.
   - Skin itself stays on its line and is never pushed teal.
4. **Contrast and saturation:**
   - Contrast brings the blacks and whites back after the tint. A look's `contrast` is gentle (0.1–0.2). A shot's
     own exposure stays in its balance.
   - Saturation last. If a shot needs much more, its balance is wrong.
5. **Check every scene** with `grade_scopes { looks: true }`:
   - Skin within about 5° of 123° and about 45–60 IRE.
   - Shadows cool, highlights warm, the blacks not crushed, the whites not clipped.

## Finishing: always a kiss

Kelly uses film effects at a fraction of their full strength: grain about 35 %, halation about 50 %.
- **Grain:** amount about 0.2–0.35, luma only (chroma 0), size 1–1.5, "felt rather than seen".
- **Halation:** amount about 0.2–0.4, threshold 0.55–0.7, radius 10–20 at 1080. A red-orange glow around lights.
- **Bloom:** less, or none.
- **Pop:** 0.1–0.3. Negative softens. It goes brittle on faces, so keep it low when faces fill the frame.
- **Vignette:** amount 0.2–0.4, size about 0.9, soft. It frames the picture without being seen.

## The pass

1. **Base correction done** (`grading.md`). Never look before balance.
2. **References:** read the moodboard with `look_reference`. The scene or film to get close to names its zones:
   where the shadows sit and their hue, the middle, the warm highlights, the warm and teal shares, the skin.
3. **The film look first,** built against the references and checked on every scene's master with
   `grade_scopes { looks: true }`.
4. **Scene looks where the light needs one:** inside warmer, outside cooler, night bluer. Each one is small.
5. **Secondaries only where a shot still needs one:** a face lift, a sky held.
6. **Finishing last,** a kiss of each.
7. **Play it** in the Grade tab (native playback: exactly what the render makes). Nothing may jump; skin reads the
   same across the cuts.

## Learned on Day 01: the teal/orange reference

A look alone gave a flat, tinted picture: the colours moved but the image stayed bright and airy. The banner is
**low-key and dense**: its middle at about 17 IRE, blacks at 1, whites at 85. What got there, and what the person kept:

1. **Film look: colour only.**
   - `split`: shadows 285° at 0.65, highlights 126° at 0.5, balance −0.25. The meeting point sits low, so skin in the
     middle tones lands on the warm side, never the teal.
   - `hue`:
     - Deep greens (215–240°) towards teal (+26…+32°).
     - Yellow-greens (165°) towards gold (−12°).
     - Blues and purples (320–345°, hoodies, jeans) towards teal (−10…−18°).
   - `hue_sat`: skin 1.2; blues and purples 0.6.
   - `hue_lum`: greens −0.7 stops, yellow-greens −0.35. Denser foliage, but not so much that the person pops off it.
2. **Per-shot trim (`grade_clip`, the Grade layer): the low key.** About a stop down and a slope of 1.3 around mid
   grey, as one CDL: slope k, offset 0.414·(1 − k) + stops / 17.52. The balance stays the base correction; the mood
   lives here, per shot, so every shot can land on the same key.
3. **Finishing:** vignette 0.65 (size 0.85, soft), grain 0.25.
4. **Secondaries: only quiet holds.** A sky kept from clipping (a luma key over 72 IRE in a band at the top). Nothing
   else.

**Less is more: no relighting.** The person turned down every shape that relit the shot:
- a face-tracked lift (a halo round the head);
- a warm "sun" window;
- an inverted ellipse darkening the edges (a spotlight: they sat brighter than their garden).

The subject and their surroundings keep the light the footage has, and the key comes down for the whole frame
together. A reference with a flare, or a face far brighter than its surround, was relit: say so, don't fake it.

**Measure the reference by zone, on the pixels,** not only by its percentiles. Take the median of the top and bottom
thirds, the sides, the ground and the face (level and RGB), for the reference and for a hero frame. Then judge the
difference by eye before chasing it: a gap that comes from light the reference invented stays a gap.

Judge it the way the person will see it: `render_frame` hero frames at 4K next to the reference, and zoomed crops of
the face and hands. The scope sheet's 640 px picture hides halos, blotches and banding. Playback is checked with
`player_frame`, which plays the very composition the Grade tab plays; 30 fps is real time.

## Rolling the reference out to the whole timeline

1. **Every shot belongs to a scene** (`script.scene`), so it gets its scene's look. A shot without one silently misses
   it.
2. **Start every shot from its scene reference's trim.** Shots from one camera setup share one trim: two clips of
   one take, one grade.
3. **Measure each shot against its reference through the whole chain** (`grade_look { looks: true }`): blacks (p5),
   the middle (p50), the whites, the skin, clipping. Then look at the scope sheet. A white rug or a wide without
   sky moves the numbers without being wrong.
4. **Move only exposure and contrast per shot** (the trim). Skin within about 4 IRE of the reference's. Close-ups keep
   the red channel off the ceiling: lower the trim's saturation, not the look's.
5. **A big sky:** pull the shot's balance `highlights` (a primary curve, no shape) until the clipping is no worse than
   the reference's. First check the camera file: a sky that is a flat plateau in the grading still (p90 = p99 in
   ACEScct) was clipped when it was shot. Keep it a soft off-white (85–90 IRE); no grade brings it back.

Day 01's trims (exposure stops, slope): bedroom −0.85…−1.5, 1.35–1.5; garden −0.65…−1.5, 1.12–1.35, saturation
1.05 (the close-up 1.0); highlights −0.8…−1.0 on the shots with big skies.

## Don't

- Don't put exposure or contrast in a look, or put a look under the balance.
- Don't let teal into skin, or push orange until skin reads sunburnt.
- Don't crush blacks or clip whites for "contrast".
- Don't put windows, grain or blur in a LUT: the `lut` of a look is colour only.
- Don't leave a finishing effect at full strength.
