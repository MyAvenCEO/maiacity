# Grading: the base correction

How a maiaCITY film's shots are levelled to each other before any look: the **balance pass**, done the way a
colourist does it in DaVinci Resolve — scene by scene, against one master shot, by the key elements of the picture
(blacks, whites, contrast, skin), with the scopes and the eye together. Learned on **Day 01 · Opening**.

The film look, the scenes' looks, secondaries and finishing (`look.md`) come **later, on top**. This pass only removes what
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

## Before the balance: the input

1. **The journey.** An iPhone 17 Pro original must read `apple-log-2 · log atom (Apple Wide Gamut · Apple Log)`.
   `apple-log` is the first Apple Log (Rec.2020): right for an iPhone 15/16 Pro, wrong for a 17 Pro set to Log 2.
   `unknown` is never balanced: set it in the Bin first. (Apple's identifiers: `com.apple.apple-wide-gamut.apple-log`
   is Apple Log 2, `com.apple.rec2020.apple-log` the first Apple Log.)
2. **A wrong tag looks like a white-balance problem and isn't one.** Apple Log 2 read as Apple Log: skin about 7°
   towards red, blues and yellows 20–28 % paler, every hue a few degrees off (ΔE 3.5 on a ColorChecker). A LUT or a
   guide made for the first Apple Log does the same.
3. **The numbers on a 4K still.** A grey card exposed right reads ACEScct 0.414 and about 38 % on the Rec.709 display
   (10 nits through ACES 2.0). Apple Log's black (code 0.150) is ACEScct 0.073 and display 0.
4. **Saturated light** (LEDs, neon, a phone screen, the CB60 in HSI): Apple Wide Gamut records colours the working
   space can't hold. The journey doesn't compress gamut yet, so they arrive clipped, flat and a little off-hue: never
   neutralise or match on them.
5. **Colour edges:** frames are decoded 4:2:2, as the iPhone records ProRes: the colour at full height in the grading
   stills, the hero frames and the render. (Until 2026-10-03 they were 4:2:0; the app remade every older grading still
   by itself.)
6. **An unknown colour stops the render.** A source whose profile is `unknown` is never taken as Rec.709: the render,
   the frame and the hero still stop and name it. Set its profile in the Bin.

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

**Exposure and white balance in linear light.** A balance's `linear` switch sets white balance and exposure as gains
in linear light, the way Cullen Kelly sets them; contrast, highlights, lows and saturation stay in the log. Every new
balance starts with it on, and `grade_match` proposes it on. Above ACEScct 0.155 (about 4.5 stops under grey) a gain
and a log offset are the same thing, so the numbers mean what they always meant. On the Rec.709 display that line is
about 8 IRE: only what lies under it changes. There, the log offset of a balance without `linear` lifts and tints the
deepest blacks; with `linear` on, black stays black and neutral. A balance saved without the switch keeps working the
old way until it is switched on (Day 01's were switched on on 2026-10-03).

## The tools

All of them run natively in the Mac app (maiaCITY Studio, over MCP). The grade's maths lives only in Rust
(vault-render `grade`, the same maths in Metal for the render). The studio's viewer samples a cube that Rust bakes,
so it never computes the grade itself.

- **`grade_scopes`** `{ timeline, clips: [master, …], regions? }`: the scope sheet, one row per shot with the master
  first. Each row has the picture after its balance (the skin box drawn in magenta), its waveform (5/10/50/90/100
  IRE), RGB parade, and vectorscope with the skin line, drawn from the 4K grading stills. It comes back as the picture
  itself, shown inline (never a file). **Look at it** before every decision and after every write.
- **`grade_look`** `{ timeline, clips?, regions? }`: the elements in numbers, as shot and balanced:
  - the levels p1 … p99 in IRE, contrast, clipped %, saturation
  - the **blacks**, the **whites** (unclipped, not strongly coloured) and the **mids**: each one's level and cast
    (warm = R − B, green = G − (R + B) / 2, in IRE)
  - the **skin** of the face Apple Vision finds (cheeks and forehead): its level, hue, `off_skin_line` in degrees,
    and chroma
  - any **regions** named by hand
- **`regions`** `{ <clip>: { white, grey, black, skin } }`, each a box [x0, y0, x1, y1] from the frame's top left
  (0…1). Use them when the eye knows better than the finder: a white wall known to be neutral, a real black, the key
  side of a face Vision misses.
- **`grade_match`**:
  - **The master:** `{ clips: [master], neutral: true, warmth }`. Its neutrals go to grey (the white or grey named,
    else its whites and mids), then it gets `warmth` stops warmer. Its exposure and the rest stay as they are, and
    are set by hand.
  - **The others:** `{ reference: master, clips: [the scene's shots], skip?, regions? }`. Each shot is fitted to the
    master by the blacks, whites, mids and skin that both have. Blacks count only when the shot has real ones
    (under 15 IRE), and whites only above 50 IRE. `skip: { <clip>: ["blacks"] }` leaves out what a shot has only
    by content.
  - Run **`apply: false`** first. The answer gives each shot's balance, `matched_by`, and `predicted`: its elements
    after that balance.
- **`grade_stack { stack: "base", clip, set: { tools: [{ tool: "balance", linear: true, ... }] } }`**: one shot's
  balance by hand (**linear**, temp, tint, exposure, contrast, highlights, shadows, **sat**; all 0 = as shot).
  Always with `linear: true`.
- **`render_frame`**: a hero frame through the whole chain, for checking either side of a cut.

## The pass, scene by scene

1. **Survey.** Put every V1 shot's 4K still, through ACES 2.0 with its scopes, on one sheet. Group the shots into
   scenes and pick each scene's master (rule 4). Note the motivated light, the clipped skies and the faces.
2. **Ask** Samuel per scene: warmer, neutral or cooler, and how much (rule 5). Nothing is written before the answer.
3. **The master:**
   - Set exposure on the key side of the face (or on the middle when there is no face), with a `balance` tool on its base stack (`grade_stack`).
   - Put the blacks and whites where they belong.
   - Run `grade_match` with `neutral: true, warmth` so the neutrals are neutral and the agreed warmth sits on top.
   - Use contrast only if the shot is flat or harsh.
   - Check it on `grade_scopes`.
4. **The other shots of the scene:**
   - Run `grade_match` with `reference: <master>` and `apply: false`.
   - Read `predicted` against the master, then look at `grade_scopes` with the master's row first.
   - Correct by the table above (blacks, whites, contrast, colour, saturation, then skin): name regions, skip what
     is content, or set a shot by hand (a `balance` tool on its base stack, `grade_stack`).
   - Write the result, then look at the scope sheet again.
5. **Across every cut:** make hero frames either side and flick between them, then play the scene. Nothing may jump.
6. **Scene to scene:** compare the masters with each other. Allow a change only where the light really changes
   (inside to outside, morning to noon), never a jump without a reason.
7. **Report:** give each shot's balance with its numbers before and after. List anything balance alone could not
   match, such as mixed light with a different cast in the whites and in the blacks. Those go to the grade, later.

## Learned on Day 01

- **Name the neutrals by hand.** The mid-tones found by themselves hold content: skin and yellow pillows in a
  bedroom, leaves in a garden. Neutralised on them, the master went cool and its skin 11° toward pink. A white shelf,
  a grey pillow, an overcast sky, a concrete table or a white house wall named as `regions` are what to neutralise
  on.
- **Leave tint at 0 unless a neutral really is green or magenta.** A tint of 0.06 against a +0.8 IRE green moved skin
  4° toward pink.
- **Raising exposure raises the blacks: that is exposure, not the log.** +0.6 took the bedroom's blacks from 7 to
  9 IRE. Measured again with `linear` on (2026-10-03), the same move gives the same 9 IRE: those blacks sit just above
  the toe, where a log offset and a linear gain are the same. The lows that held them down while the face came up
  (−0.35 to −0.8) are a shadow-contrast choice, and they stay. The log offset showed only where a shot has real
  near-black content: c765990b at +1.3 stops, and the veranda shot, whose black went from 3.5 IRE (a little warm) to
  2.9 IRE (neutral) once linear. Where a shot is flat, like the overcast garden, contrast around mid grey (0.15) does
  it.
- **Skin moves with tint, far.** On the garden faces, tint −0.1 → −6.6°, −0.15 → −1.5°, −0.2 → +4.2°. Set it in steps
  of 0.05 and read the skin after each.
- **Same light, same balance.** The feet on the rug took the bedroom master's balance unchanged: the rug's whites
  landed on the master's. The bench wide took the garden master's. Start every shot of a scene from the master's
  balance, then move only what its own light needs.
- **Face and feet aren't the same level.** Feet on a bright rug read 68 IRE against the face's 49. Match the feet's
  colour, not their level (`skip: { <clip>: ["skin.level"] }`).
- **The quickest loop:** `grade_stack` (the base's balance), then `grade_look` with the same regions, 15–20 s per step, reading the
  skin, the named neutrals and the blacks against the reference. `grade_match` gives the starting point and
  `grade_scopes` the check.
- **Where Day 01 landed:**
  - All faces 47.5–49 IRE, within 5° of the skin line.
  - Blacks 5–10 IRE, mid-tones 40–50 IRE.
  - Bedroom neutrals +2 to +4 warm (+0.25). Garden masters temp +0.53, faces +0.53 to +0.85 with tint −0.15 to −0.2
    (+0.5).
  - Garden skin is paler than bedroom skin (saturation 5.5 against 8.5): overcast light, and left so.

## Don't

- Don't judge on previews, thumbnails or proxies (rule 1).
- Don't trust an automatic match on its own, and don't match whole-frame averages across different content.
- Don't neutralise skin or a warm morning to grey.
- Don't lift a clipped sky or crush a black to make the numbers agree.
- Don't change the look during the balance, and don't grade before the warmth for each scene is agreed.
- Don't balance a shot whose journey isn't the camera's (an Apple Log 2 clip told `apple-log`, `rec709` or `unknown`).
