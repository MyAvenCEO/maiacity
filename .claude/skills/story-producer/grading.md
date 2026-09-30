# Grading: the base correction

How a maiaCITY film's shots are levelled to each other before any look: the **balance pass**, done the way a
colourist does it in DaVinci Resolve — scene by scene, against one master shot, by the key elements of the picture
(blacks, whites, contrast, skin), with the scopes and the eye together. Learned on **Day 01 · Opening**.

The film look (`grade_film`, the presets) and any creative grade come **later, on top**. This pass only removes what
the camera got wrong from shot to shot, so the cut stops jumping.

## The rules

1. **Only the real thing: the 4K grading stills.** Every look and every number comes from the shot's grading still
   (a frame of the original, 3840×2160, 16-bit ACEScct) through the ACES 2.0 output the render uses. Never a
   preview, a thumbnail or a proxy. On Day 01 the library previews read far warmer than the stills: the bed shot's
   middle tones were +25 warm on the preview and +1 on the still. A balance judged on the previews would have been
   wrong.
2. **Balance, never look.** Only a shot's balance nodes (white balance → exposure → contrast → highlights / lows).
   No preset, no film look, no clip CDL, no saturation for taste. If a shot only matches with a look, stop and say so.
3. **One scene at a time.** A scene is one place in one light (the V1 clips' `script.scene`). Level the shots inside
   a scene first, then scene to scene.
4. **One scene master.** Take the wide shot that shows the scene's light (the WS, or the widest MS). Balance it
   first. Match every other shot of the scene **to it**, never to the shots' average: `grade_match` without a
   reference averages, so don't use it that way. When the master shows no face, the scene's closest face shot is
   matched to the master first and then becomes the skin reference for the rest of the scene.
5. **Ask before every scene:** a warmer, neutral or cooler base, and how much. Samuel decides the warmth. It is set
   on the master's white balance and written down with the scene (see "The pass" below). A touch is about 0.25 stop
   of `temp`, clearly is about 0.5. Set temperature first. Use tint only to remove a green or magenta cast, never
   for taste.
6. **Match what the eye matches, not the frame's average.** A garden is green, a pillow is yellow, and a sheepskin
   fills the frame with bright: that is content, not a cast. Read the neutrals (a white wall, the rug, an unclipped
   grey sky), the blacks and the skin. Never use whole-frame means when the shots show different things.
7. **Keep motivated light.** A warm morning room, a lamp or golden hour stays warm. "Neutral" is relative to the
   light the scene is in. The base takes out the camera's error, not the light's character.
8. **Skin never jumps.** Across a cut the audience looks at a face before anything else. Its level, hue and
   saturation must match inside a scene even when the rest of the frame can't. A good balance gets skin right
   without a key. Needing a key means the balance is wrong (Volpatto).

## What to compare, in this order

Tone first, then colour, then saturation, then the exceptions (Van Hurkman, *Color Correction Handbook*, ch. 9).
The eye is more sensitive to contrast than to colour, and a black level that wanders jumps out first.

| # | Element | Scope | What matches |
|---|---|---|---|
| 1 | **Blacks** | waveform, parade bottoms | the level of the real blacks (not in a frame that has none) and their colour: the R, G, B bottoms level with each other and with the master's |
| 2 | **Whites** | waveform, parade tops | the level of the brightest real whites (a clipped sky doesn't count) and their colour: a neutral white has R = G = B |
| 3 | **Contrast** | waveform | the spread between blacks and whites, and where the middle sits |
| 4 | **Colour balance** | parade | the whites' colour first, then the blacks', then the middle neutrals'. A red or blue cast in the blacks mismatches two shots fastest |
| 5 | **Saturation** | vectorscope | the overall spread, once 1–4 match |
| 6 | **Exceptions: skin, sky** | vectorscope and waveform on the face | skin hue on the skin line, its saturation, its level; the sky's colour |

**Judge each cut twice.** First the literal match: the same thing reads the same, flicked back and forth. Then the
contextual match: play the cut at speed and ask whether it bumps (Cullen Kelly). No colourist publishes a numeric
tolerance; the cut playing smoothly is the test.

Rules of thumb on the Rec.709 display (through the ACES 2.0 output, 0–100 IRE):
- **Skin (Samuel's light complexion):** about 45–60 IRE on the key side of the face. Van Hurkman's range for the
  lightest skin is 50–70 IRE; common shorthand is 40–70. A face under about 35 IRE is under-lit unless it is meant
  to be.
- **Skin hue:** within a few degrees of the skin line (≈123° on the vectorscope). Pale and ruddy skin leans a
  little toward red. Well off toward magenta or pink reads cold or ill; toward green reads sick.
- **Skin saturation:** clearly off the centre of the vectorscope. A face near grey is a white balance problem.
- **Blacks:** the real blacks at a few IRE, never crushed to 0. Milky blacks at 10+ IRE jump against a normal shot.
- **Whites:** real whites high but under 100, and a clipped sky left clipped.
- **Our tolerance inside a scene** (a house rule, not an industry number): blacks and skin level within about
  3 IRE of the master, skin hue within about 5°.

**Watch the toe.** The balance's exposure and white balance are offsets in ACEScct: in log, a constant equals a
change in linear light, which is why colourists balance with offset or printer lights. Below about 0.155 ACEScct
the curve is linear, so a big offset there turns the deep shadows milky (Cullen Kelly). After a big exposure move,
check the blacks again.

## The tools

- **The eye first:** the 4K still through the ACES 2.0 output, the master beside the shot. Name what you see: where
  the whites are, what is black, where the skin is, what the light is.
- **Scopes** from the 4K still: waveform, RGB parade, and a vectorscope with the skin line. Isolate the face as well
  (a box on the cheeks and forehead, not the beard or a cap's shadow).
- **The elements in numbers**, before and after the balance:
  - blacks p1 and whites p99 in IRE
  - the middle (p50)
  - the casts of the blacks, the neutral middle tones and the unclipped neutral whites
  - skin: level, hue against the skin line, saturation
  - how much of the frame is clipped
- **`grade_measure`:** every shot in ACEScct from its grading still (luma percentiles, `mid_rgb`, `to_grey`), as shot
  and balanced. The numbers are whole-frame, so read them next to the picture (rule 6).
- **`grade_match`** with `reference: <master>` and `clips: <the scene's shots>`. Run it with **`apply: false`
  first**: it gives a proposal to start from, never the answer. It fits whole-frame percentiles and the middle
  tones' cast, and like Resolve's Shot Match it doesn't know what a face is.
- **`grade_balance`** sets one shot's balance by hand, after reading the scopes and the picture.
- **`render_frame`** makes a hero frame through the whole chain, for checking either side of a cut.

## The pass, scene by scene

1. **Survey.** Put every V1 shot's 4K still, through ACES 2.0 with its scopes, on one sheet. Group the shots into
   scenes and pick each scene's master (rule 4). Note the motivated light, the clipped skies and the faces.
2. **Ask** Samuel per scene: warmer, neutral or cooler, and how much (rule 5). Nothing is written before the answer.
3. **The master:**
   - Set exposure on the key side of the face (or on the middle when there is no face).
   - Put the blacks and whites where they belong.
   - Set the white balance so the neutrals are neutral, then add the agreed warmth on top.
   - Use contrast only if the shot is flat or harsh.
4. **The other shots of the scene:**
   - Run `grade_match` against the master with `apply: false`.
   - Look at both 4K stills and their scopes.
   - Correct by the table above: blacks, whites, contrast, colour, saturation, then skin.
   - Set the result with `grade_balance`.
5. **Across every cut:** make hero frames either side and flick between them, then play the scene. Nothing may jump.
6. **Scene to scene:** compare the masters with each other. Allow a change only where the light really changes
   (inside to outside, morning to noon), never a jump without a reason.
7. **Report:** give each shot's balance with its numbers before and after. List anything balance alone could not
   match, such as mixed light with a different cast in the whites and in the blacks. Those go to the grade, later.

## Don't

- Don't judge on previews, thumbnails or proxies (rule 1).
- Don't trust an automatic match on its own, and don't match whole-frame averages across different content.
- Don't neutralise skin or a warm morning to grey.
- Don't lift a clipped sky or crush a black to make the numbers agree.
- Don't change the look during the balance, and don't grade before the warmth for each scene is agreed.
