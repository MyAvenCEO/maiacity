# The look: the creative grade

What comes after the base correction (`base-correction.md`): the look of the film and of its scenes, the secondaries that
protect or lift a part of a shot, and the finishing that gives the film its texture. It is done the way top colourists
build a look in DaVinci Resolve (Cullen Kelly, Juan Melara, Walter Volpatto): **balance per shot first, the look on
top, never the other way round.**

## The order: every shot goes through these, in this order

| Stack | Level | What | Where it lives |
|---|---|---|---|
| Base correct | shot | the balance (`base-correction.md`) | `clip.stacks.base` |
| Clip look | shot | a trim of that one shot, its secondaries (masks), its framing beside it | `clip.stacks.clip` (`clip.frame`) |
| Scene look | scene | inside/outside, day/night: a scene's own look | `grade.scenes[scene]` |
| Timeline look | film | the film's look, the same on every shot; its texture (pop, halation, bloom, grain, vignette) as its last tools | `grade.timeline` |
| Output | — | ACES 2.0 to Rec.709 | fixed |

- **No exposure or contrast in the look.** Those belong to each shot: its balance (the base correct) and its trim (the
  clip look, where a low-key mood goes). A look sets which colours are possible, not how bright a shot is (Kelly:
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
- **The grade is stacks of tools** (game/film/grade-tools.json, one registry; the maths in Rust only). **`grade_tools`**
  lists every tool, its controls, their ranges and defaults. **`grade_stacks { id }`** shows a timeline's whole grade;
  **`grade_stack { timeline, stack, clip?, scene?, set? }`** reads or sets one stack:
  - `base` (a shot's base correct), `clip` (a shot's clip look), `scene` (a scene's look: by `scene`, or a `clip` of
    it), `timeline` (the timeline's look, the finishing textures last on it). They apply in that order.
  - A stack: `{ strength?, tools: [{ tool, on?, ...controls }] }`, the tools in the order they apply. Colour tools:
    `balance`, `cdl`, `contrast`, `split`, `hue` (hue/hue_sat/hue_lum curves and `sat`), `hi_sat`, `lut`. Textures:
    `pop`, `halation`, `bloom`, `grain`, `vignette`.
  - **Masks are groups:** a `window` (ellipse or rect, x, y, w, h, angle, feather, invert, `track: "face"`) or a `key`
    (hue, width, sat_lo/hi, luma_lo/hi, soft) holds its own `tools`, applied only inside it, by `mix`. Any tool goes
    in; a key inside a window applies where both are. A mask can sit in any stack (a sky held in a scene's look, a
    face lifted in a shot's).
  - Hues are the vectorscope's, as the display shows them: the skin line at 123°, orange about 110–140°, foliage
    green about 200–240°, teal and cyan about 270–300°.
- **A `lut` is ACEScct in and ACEScct out.** Never an Apple Log or Apple Log 2 → Rec.709 LUT, a LUT made for Apple Log
  (iPhone 15/16 Pro, Rec.2020) or another camera, or anything that outputs a display picture. On Apple Log 2 the first
  two are the wrong gamut; the last tone-maps twice.
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

## Coloured light: LEDs, neon, the CB60 in HSI

Apple Wide Gamut records blues, violets and cyans beyond the working space, and the journey doesn't compress them yet:
they arrive clipped, flat and a little off-hue. Don't push saturation or hue curves into those colours; a `hue_sat`
pull on that hue, or `hi_sat`, hides a flat patch better than a key. Judge them on a 4K still.

## Finishing: always a kiss

Kelly uses film effects at a fraction of their full strength: grain about 35 %, halation about 50 %.
- **Grain:** amount about 0.2–0.35, luma only (chroma 0), size 1–1.5, "felt rather than seen".
- **Halation:** amount about 0.2–0.4, threshold 0.55–0.7, radius 10–20 at 1080. A red-orange glow around lights.
- **Bloom:** less, or none.
- **Pop:** 0.1–0.3. Negative softens. It goes brittle on faces, so keep it low when faces fill the frame.
- **Vignette:** amount 0.2–0.4, size about 0.9, soft. It frames the picture without being seen.

## The pass

1. **Base correction done** (`base-correction.md`). Never look before balance.
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
2. **Per-shot trim (a linear `balance` on the shot's clip look, `grade_stack { stack: "clip" }`): the low key.** About
   a stop down and a contrast of 0.3 around mid grey: `{ tool: "balance", linear: true, exposure: −1, contrast: 0.3 }`.
   The base balance stays the base correction; the mood lives here, per shot, so every shot can land on the same key.
   Day 01's trims were first one CDL each (slope k, offset 0.414·(1 − k) + stops / 17.52): the same picture above the
   toe, but its exposure a log offset and its numbers unreadable. Rebuilt on 2026-10-03 as linear balances with the
   same numbers (slope 1.35, offset −0.2134 is exposure −0.89, contrast 0.35). A balance runs on its own exact kernel,
   so the trim no longer rides inside the look's cube: near-neutral surfaces moved by up to 1 IRE.
3. **Finishing:** vignette 0.65 (size 0.85, soft), grain 0.12 (0.25 read as noise on the 4K master).
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

## Interiors: teal and orange that still reads real

Day 01's bedroom went wrong three ways before it went right. The person called the first tries "magenta", then
"unrealistic":

- **A cooled room white balance.** A warm lamp-lit room pulled blue, so faces went grey-pink and the walls lavender.
- **Big hue rotations** (25–30°) on skin's neighbours. Wood, hair and lips slid into a single plastic orange.
- **Teal in the middle tones.** It reached the walls and the half-lit side of the face, which read as bruising.

What the Hollywood colourists do, and what held:

1. **A natural base first.** The balance only neutralises: the room stays as warm as it was, and a green-magenta
   cast is taken out with `tint` (positive is magenta; Day 01's bedroom wanted −0.04 … −0.2). Never cool the room in
   the balance to "make room" for teal.
2. **Teal only in the shadows.** The split's crossover sits at mid grey (balance 0), so skin is never on the teal
   side. The engine fades the shadow tint out in the blacks (from about 6 to 20 % luminance), so true black stays
   black. Tinted blacks read as video.
3. **A skin bumper.** The `hue` points at 105°, 123° and 145° are held at 0, so the skin line cannot move. Only the
   hues around it move, and gently: reds −10°, yellow-greens −12°, blues and cyans +20…+25°, magentas −15…−20°.
4. **Walls low chroma.** Pull yellows (about 60°) and oranges outside skin (about 30°) to about 0.6–0.65 saturation.
   Skin 1.1–1.15, magenta `hue_sat` low and `hue_lum` −0.15. The contrast then lives between the person and the room,
   not across the whole frame.
5. **Interiors darker than exteriors:** −1.1 … −1.7 stops in the trim with a slope of 1.35–1.5, and the vignette
   does the rest. The highlights get a light warm tint (about 0.2 at 128°), not the exterior's 0.5.

Day 01's interior look, on both inside scenes:
`split` shadows 290° @ 0.55, highlights 128° @ 0.2, balance 0; `sat` 0.95.

Pink blotches on skin or a white rug in the Edit tab's preview were the 8-bit HD proxy's decoder, not the grade.
Judge on the Mac's frames (native playback, `render_frame`) before chasing them.

## Don't

- Don't put exposure or contrast in a look, or put a look under the balance.
- Don't let teal into skin, or push orange until skin reads sunburnt.
- Don't cool a warm room in the balance, rotate hues more than about 20°, or tint the blacks.
- Don't crush blacks or clip whites for "contrast".
- Don't put windows, grain or blur in a LUT: the `lut` of a look is colour only.
- Don't leave a finishing effect at full strength.
- Don't grade an Apple Log 2 shot through anything made for Apple Log or another camera.
