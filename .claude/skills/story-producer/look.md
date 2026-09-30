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

- **No exposure or contrast in the look.** Those belong to each shot's balance. A look sets which colours are
  possible, not how bright a shot is (Kelly: exposure and contrast are "not allowed in look development").
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
    hue, amount }, balance }`, `hue: [[hue°, shift°]…]`, `hue_sat: [[hue°, factor]…]`, `sat`, `lut` (a `.cube`'s
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

## Don't

- Don't put exposure or contrast in a look, or put a look under the balance.
- Don't let teal into skin, or push orange until skin reads sunburnt.
- Don't crush blacks or clip whites for "contrast".
- Don't put windows, grain or blur in a LUT: the `lut` of a look is colour only.
- Don't leave a finishing effect at full strength.
