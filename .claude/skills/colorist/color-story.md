# Colour across the film

The base correction makes the shots one film (`base-correction.md`); the look gives it its feeling (`look.md`). This is
what carries colour through the story, makes a render sit beside an iPhone shot, gives a digital image a film's
density, and keeps the judgement honest.

## The colorist's principles (beyond balance and look)

1. **Lock one show look on tests of both sources before the edit, and keep it for the whole film.** The look is display
   preparation, separate from each shot's timing; fixed early, it keeps scene grades small and gives the iPhone and the
   renders one "stock". The arc is then carried by separation and brightness, not by swapping LUTs (Jill Bogdanowicz
   carried *Joker: Folie à Deux*'s grim scenes and its musical numbers on one LUT; Tom Poole builds one per show; Steve
   Yedlin settles display prep first). **Ours:** an Apple Log test (skin, a grey card, the hero colours) and a render of
   the same chart, graded together.
2. **Name the feeling in plain words before touching a control** — a one-word brief ("sad") and why the story needs
   it (Peter Doyle; Dado Valentic teaches perception before buttons; Stefan Sonnenfeld calls grading a team sport of
   interpreting the director).
3. **Build a look in order of impact:** curve → warm/cool split → saturation → saturation by brightness → density → hue
   (Cullen Kelly). Whatever time there is goes to what matters most.
4. **Contrast in the toe and the shoulder; the middle straight.** Film pairs strong mid-scale contrast with compressed
   ends. Walter Volpatto keeps about seven stops round 18 % grey and bends only the ends; Poole wants "texture to the
   highlights, texture to the black".
5. **Saturation is subtractive.** In print a colour can be bright or saturated, never both: saturated colours get
   denser, highlights go pastel. Additive saturation brightens colour and reads as video (Kelly).
6. **Separate colours instead of raising saturation.** Distinct hues read as more colourful than one saturated hue;
   cooler towards the shadows, warmer towards the highlights, the vectorscope's mass across at least two quadrants —
   push too far, then back off (Kelly). Natasha Leonnet cooled the shadows of warm scenes so they never read as an
   orange filter. A client asking for "more saturation" usually needs colour contrast (Van Hurkman).
7. **Hero colours get their own pass.** A signature colour carries identity, and pushed too far becomes noise (Leonnet's
   day on *Mulan*'s red; Poole protecting Spider-Man's suit; Bogdanowicz holding *Wicked*'s pinks). Ours: the gold of
   the new world, the domes' glass, the forest's greens.
8. **Grain is felt, not seen.** Kelly and Volpatto lay negative grain before the look, over a slight pre-blur, at about
   30 % (our engine's grain sits last in the timeline look — a test worth making). Compression strips light grain and
   heavy grain strains the encoder.
9. **Treat every render as a photographed plate:** luminance first, then colour, then texture ("realism fails through
   accumulation"). Doyle treated every shot of *Dark City* as a visual effect; Siggy Ferstl adds diffusion, halation and
   softening in the grade.
10. **Judge only on a reference display in a reference room** (ITU-R BT.2035): BT.1886, white at 100 cd/m², D65, the
    wall behind the screen at about 10 % of white, the room at about 10 lux. On an Apple XDR display, the HDTV Video
    (BT.709-BT.1886) reference mode.
11. **Outrun your own adaptation.** After 45–60 s on one shot the eye has adapted. Grade in passes; look at a
    black/grey/white card for 15 s every 20–30 minutes; break every hour or two; leave late-night calls for the morning;
    compare against stored stills (Robbie Carman, Dan Moran, Van Hurkman).
12. **Check on the phone; never grade on it.** The master is Rec.709 BT.1886 (2.4) tagged 1-1-1. An iPhone shows SDR
    at up to 1,000 nits and decodes BT.709-tagged video with Apple's video curve (reported at about 1.96; recheck), so a
    2.4 grade looks lighter there. Our hero frames are tagged as Rec.709 video, so a Mac shows them the same, Apple's
    way: lighter than a BT.1886 reference monitor. Decide once which one we judge to — today, the Apple view — and check
    the uploaded file on the phone. Small pictures look less colourful, bright ones more. If a web or phone master is
    ever wanted, OpenColorIO's ACES 2.0 views on "Gamma 2.2 Rec.709" or "sRGB" are the same rendering on another
    display.
13. **Keep the story out of the deepest shadows.** Compression and lit rooms erase near-black detail ("The Long Night"
    of *Game of Thrones*).
14. **Re-judge every 9:16 crop as a new shot:** a bigger face reads as more colourful (trim saturation on push-ins), a
    vignette or a window gets stranded, and the interface covers the top and the bottom.

## A colour arc: from the cold old world to the warm new one

Start from the story's emotional journey (`storyteller`, `emotion.md`): the colour arc is its warmth. Draw a colour
script before grading: one small frame per story beat, a few colours each, side by side (Pixar's, begun by
Ralph Eggleston on *Toy Story*). Grade one hero still per beat and lay those out the same way. Give each beat a gamut
mask — the hues it may use (James Gurney): small and near the centre feels muted, large feels vivid.

Loss of colour reads as loss of life (Doyle). Holding colour back is a device: *Dark City* stays night until its last
sunrise; *Pleasantville* turns colour on as people awaken. A small patch of a foreign hue outweighs its size; warm
colours advance, cool ones recede. **Skin stays true in both worlds:** the world changes, the man does not.

| Beat (runtime) | The gamut | Saturation × the show look | Shadows / highlights | Blacks, contrast, texture | On the scope |
|---|---|---|---|---|---|
| The old world, the low (0–30 %) | small and analogous: slate, cyan-grey, dead olive | 0.65–0.75 | shadows towards cyan-blue (≈ 300°); highlights neutral to cool; no warm light | blacks at ≈ 2–4 %; mid contrast −10 %; heavier grain | the mass hugs the centre, one quadrant |
| A glimpse (≈ 30 %) | the same, plus one gold accent, ≤ 5 % of the frame | the accent full, the rest unchanged | warmth only in the accent | unchanged | the only warm thing in frame |
| The crossing (30–60 %) | widening towards gold | 0.8–0.9 | shadows stay cool; highlights begin to warm | blacks at ≈ 1–2 %; contrast to the show's norm | warmth arrives as light, not a wash |
| The new world, the high (60–90 %) | widest: gold, teal-blue and a third hue (green or rose) | 1.0–1.1, dense, not bright | shadows still cool; highlights golden (≈ 130–165°) | inky blacks at ≈ 0–1 %; full mid contrast; a soft shoulder; the cleanest texture | the mass across two quadrants or more |
| The coda (90–100 %) | settling slightly | ≈ 0.95 | as the high | as the high | lived-in, not an advert |

These are house starting points, tuned on the colour script. Get the high's colour from light and separation before the
saturation knob. The third hue keeps the high out of the two-colour formula of teal and orange. Our presets map onto
this: `dip`/`cold` for the low, `bright`/`warm` for the high (`game/film/color.js`).

## Making renders sit with iPhone footage

We intercut rather than composite, so match scene to scene, in this order:

0. **One gamut.** The renders are born in linear Rec.709, inside AP1. The iPhone's Apple Wide Gamut reaches outside it
   in saturated blue and violet; until the journey compresses gamut, keep such colours out of the shots you match.
1. **The grey anchor.** A metered 18 % grey is 0.18 linear (≈ 0.414 ACEScct) in both; through the ACES 2.0 100-nit
   output it lands at 10 nits. Check both on one waveform first.
2. **Plausible materials.** Non-metal albedo between about 0.02 (charcoal, fresh asphalt) and 0.81 (fresh snow); real
   surfaces never reach 0.0 (`production-designer`, `models.md`).
3. **Black and white points per channel.** Match the darkest render black to the plate's darkest at a similar depth,
   then whites, gamma, each channel, saturation. Real shadows take colour from the sky and the bounce; a render's shadows
   under a neutral ambient go grey.
4. **The highlight ceiling:** the brightest render speculars no brighter than the plate's (capped at its clip level).
5. **Saturation:** match the vectorscope's extent scene by scene.
6. **Softness:** a pinhole render is sharper than a phone lens — soften it (about 0.5 px at 1080, 1 px at 4K, as a
   start); compare one hard edge at 400 %.
7. **The lens:** measure the plate's distortion, corner fringing and falloff and copy them, subtly.
8. **Motion and focus:** the plate's shutter (`cinematographer`, `exposure.md`) and its deep small-sensor focus.
9. **Noise, then grain:** give the render the plate's measured noise per channel on a flat patch (blue noisier than red
   and green), then one grain over both at timeline level.
10. **Atmosphere:** depth haze lifts distant blacks and places things in depth.
11. **The same finishing** — halation, diffusion, vignette — in one layer over both sources.
12. **Judge at speed:** play the cut; mismatches accumulate.

## Film-like density and roll-off, in this order

Scene-referred, in ACEScct, before the ACES 2.0 output, on balanced shots:

1. A pre-blur, then negative grain, at timeline level.
2. **The curve:** straight through mid grey; the toe and the shoulder carry the contrast. ACES 2.0 already rolls off
   (at 100 nits: 0.18 → 10 nits, scene 1.0 → 45.8 nits), with slightly less mid contrast and a gentler shoulder than
   ACES 1 — add mid contrast in the look, never with exposure.
3. **The split:** cool shadows, warm or neutral highlights.
4. **Saturation by brightness:** highlights towards pastel, mids and shadows rich (ACES 2.0 rolls highlight saturation
   off later than ACES 1; a print-like pastel comes from the look).
5. **Density:** darken saturated hues colour by colour — raise a red patch's saturation and its luma must fall.
6. **Hue, last and small.** Digital footage pushed into a print emulation through a bare transform comes out with
   monotone skin, yellow-brown greens and orange reds: correct those, don't call them film (Juan Melara).
7. **The output, then the print-level texture** (`look.md`).

**Why print looks dense:** Kodak 2383 climbs from almost clear to a density of about 4.0 within roughly two log-exposure
units — rich blacks, neutral highlights. **Never stack:** a print LUT expects a log scan and outputs a display image;
after the ACES output it tone-maps twice. Build film behaviour scene-referred, before the output.

**HDR, only what matters:** at 1,000 nits ACES 2.0 maps 0.18 → 13.2 nits and 1.0 → 89.1 nits — the mids barely move,
HDR adds room above. A scene-referred SDR grade reaches HDR with a trim.

## Mistakes the pros avoid

- A new LUT per world instead of separation inside one look (Bogdanowicz).
- Answering "dull" with global saturation instead of colour contrast (Van Hurkman).
- Teal and orange by default; an orange wash on warm scenes instead of cool shadows (Leonnet).
- Grain mistaken for the film look, when contrast, colour and tone come first (Kelly); grain loud enough to see.
- A print LUT after the ACES output; Apple Log pushed into a print LUT through a bare transform (Melara).
- Render blacks at 0.0, renders sharper than the phone, heavy fringing.
- Grading on a consumer screen or under mixed room light.
- Trusting numbers over perception: a saturated blue sky makes neutral clouds look yellow — nudge them towards blue.
- The story in near-black for streamed or phone viewing.
- Tinting the protagonist's skin with the world's mood.

## Sources

Company 3 (Bogdanowicz on *Joker 2* and *Wicked*; Poole and Pawlak on Spider-Man; Sonnenfeld); Televisual (Poole; Doyle);
Doyle (vfxblog.com, *Dark City* at 20; postperspective.com, *Disclaimer*; the Color Timer podcast); Leonnet
(postperspective.com, *Mulan*); Ferstl (filmink.com.au); Volpatto (jonnyelwyn.co.uk); Kelly (cullenkellycolor.com/contour;
blog.frame.io: colour separation, roll-off, Film Look Creator, film grain); Valentic (colorgradingacademy.com); Yedlin
(yedlin.net/NerdyFilmTechStuff/OnColorScience); Van Hurkman, *Color Correction Handbook*; Pixar colour scripts
(hyperallergic.com); Gurney (gurneyjourney.blogspot.com, colour wheel masking); Melara (juanmelara.com.au); Kodak 2383
data sheet; CG integration (therookies.co; admvfx.com; mimicvfx.com; Foundry Nuke docs; Unreal PBR docs); ITU-R BT.2035;
Apple (support.apple.com 108321, 121031); ACES 2.0 (docs.acescentral.com). Apple Log 2: the ACES CSC
`CSC.Apple.AppleLog2_to_ACES` (github.com/aces-aswf/aces-input-and-colorspaces); OpenColorIO 2.6 "Apple Log 2"; the
ACES Reference Gamut Compression (docs.acescentral.com/rgc); Kelly on log vs linear (blog.frame.io, 2024-08-05); Prolost
on Apple Log (prolost.com/blog/applelog); Mostyn, *How to Grade Apple Log*; CineD's iPhone 17 Pro lab test.
