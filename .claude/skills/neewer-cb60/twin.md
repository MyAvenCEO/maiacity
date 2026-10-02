# Its twin in the room

The CB60 stands in the room world too: the 3D model on its stand (`neewerCb60` in `src/lib/models/furniture.ts`, built
to Neewer's measures, in the 3D models viewer) and its beam at the reflector (`src/lib/worlds/room.ts`), so a world shot
is lit the way the real room is.

## Where it stands

- **By the door, towards the front corner** (`CB60_AT`: x −1.05, z 2.0) — where it stands in the photos, by the door and
  the tall shelf; the beam at 1.55 m, tilted 0.22 rad down, turned to look at the bed's foot.
- The walker keeps 0.4 m off its stand.
- To move it for a shot: `CB60_AT` (x, z, pan) and the model's `height` and `tilt`; the beam follows the reflector.

## Switching it on in a shot

A shot's lights lane names it: `lights: [{ id: 'cb60', intensity: k, color? }]` (`game/film/shot.js`; the studio's
Inspector lists it).
- **Off** unless a shot names it.
- **`intensity`** is its dimmer: 1 = full, 0.1 = 10 %; a curve (`[[t, k], …]`) fades it during the shot.
- **`color`**: a Kelvin's colour for CCT, or any hue for HSI. Kelvins as linear sRGB with a D65 white, the brightest
  channel 1 (written as sRGB hex for `color`): 2700 K `#ffad59`, 3200 K `#ffbe7a`, 4300 K `#ffdab3`, 5600 K `#ffefe4`,
  6500 K `#fff9fe`. With a camera balanced at 5600 K, 3200 K reads as (1, 0.60, 0.25) and 2700 K as (1, 0.49, 0.13).
  G/M: roughly green × (1 + 0.004 · G/M). HSI: HSV(h, s, 1) — a saturated colour is much dimmer than white.
- Its LED glows with it (the disc's emissive follows the same dimmer and colour).

## Its beam

- **The stock reflector, as two spotlights:** the hotspot (half-angle 0.28 rad, penumbra 0.5, 0.93 of it, shadows on) —
  about 25° between the half-power points — and the spill (half-angle 0.77 rad, penumbra 0.4, 0.07 of it) out to about
  88°.
- **Its strength is in the room's scale,** not in lux: the room's window and bulb are tuned by eye. Where its hotspot
  lands, at full it is several times the north window's noon light — as a real 18,000-lux-at-1-m head is against a
  north window. Match ratios, not numbers (`gaffer`, `world-light.md`, "Matching the real room and its twin"). The room's
  bulb reads brighter against it than a real filament would, so a warm match to the bulb (`recipes.md`, 5) sits higher
  on the twin's dimmer than on the real one.
- **Through a softbox or bounced** the real light's edge is far softer: for those set-ups widen the beam towards the
  bare head's (half-angle about 1.4 rad, penumbra 1, about a fourteenth of the reflector's strength on its axis), or aim
  it at the wall as a bounce. A softbox is better as an area light (`RectAreaLight`, its luminance about 1,300 nits for a
  70 cm octa at full).
- **Shadows:** a 4 cm source bare, about 18 cm with the reflector, the modifier's size with one.

## Setting a world shot like the real one

1. Read the real set-up from the shoot's notes: where the stand was, the head's height and tilt, the modifier, the mode,
   the Kelvin or the hue, the dimmer.
2. Put the twin there (`CB60_AT`, `height`, `tilt`) and set the shot's `cb60` light to the same colour, its dimmer by the
   ratio against the window or the bulb.
3. Compare a hero frame with a frame of the footage through the same ACES output: the ratio to the window and the bulb
   first, then the colour, then the level.
