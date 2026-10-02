# Light in the worlds

How the 3D worlds are lit: the sun by the hour, the sky, the practical lamps, and what a shot can change.

## Light in Sandbox 4 (`window.__interiorHour`)

| Hour | Light |
|---|---|
| ~5–6.5 | sunrise, in +x (east): hour 5 = azimuth 90° |
| 7–10 | low, warm morning |
| 12–13 | overhead (good for looking up into the glass) |
| 17–18.5 | golden hour |
| ~20 | blue hour |
| ~21 | night; the sun sets in −x |

- **Sunrise:** the sun sits on the horizon at hour 5.0, due east (+x); by 5.4 about 5° up. Before 5 the world is near
  black. Keep domes from covering the sun's direction (a dome at 100 m stands about 11° high). `__village.sun(hour)`
  sets the sun at once; `shoot.mjs` calls it every frame of a time-lapse. Film towards +x with the disc clear.
- Night skies read as a black bar in the square frame: prefer dusk, and fill the square with lit domes.
- Looks for the low and the night are grade presets in the studio (`cold`, `night`, `dip`, `bright`, `warm` in
  `game/film/color.js`, ASC CDL in ACEScct) — not filters on the shot.

## The room's light (`src/lib/worlds/room.ts`)

- **The sky is turned to the room's north** (`createSky({ north: π/2 })`): the window looks north and never gets the
  sun. The sun rises behind the bed, stands over the door's side at noon and sets behind the front wall; its shadows
  use a room-sized depth (`lightDistance` 40, `shadowNear` 5, `shadowFar` 80, bias −0.0002), so it can't leak in over
  the walls.
- **The window** is a RectAreaLight the size of its glass. Its strength and colour follow the hour: cool and bright at
  noon, warmer when the sun is low, blue and faint at dusk, almost nothing at night. The open sky's fill drops at night
  too, so the bulb has the room.
- **The Edison bulb** is a PointLight at its glass, warm (`#ffad55`), brighter at night: the shot's **`lamps`** light.
- **The CB60** on its stand is a spotlight from its reflector: the shot's **`cb60`** light, off unless a shot turns it on
  (`neewer-cb60`).
- The time control (Auto/Manual) moves the hour by hand in the room's page; a shot pins its own `time.hour`.

## three.js light units (physically correct lighting)

- DirectionalLight and HemisphereLight intensity act as illuminance in **lux**.
- PointLight and SpotLight intensity is in **candela**; their `power` is in **lumens** (lm = 4π × cd): give a bulb the
  lumens printed on its box.
- RectAreaLight intensity is in **nits** (`power` = π × width × height × nits). It casts **no shadows** and lights only
  standard and physical materials — add a shadow-casting light through the opening where shadows matter.
- **Reference levels:** clear midday sun about 100,000 lx against a sky of 20,000–25,000 lx (2–2.3 stops); late
  afternoon about 81,000 against 9,000 (about 3.2 stops). EV at ISO 100: full sun 15, cloudy bright 13, overcast 12,
  sunset 12, just after sunset 9–11, home interiors 5–7, full moon −3 to −2 (lux ≈ 2.5 × 2^EV).
- **A window's luminance** is about the sky it sees: heavy overcast (EV 12) is a uniform sky of roughly 3,300 nits.
  Check the light at the face with E ≈ L × A × cosθ₁ × cosθ₂ ÷ d², minus the glass.
- **Bounce:** three.js has no real-time global illumination, yet most of a small white room's fill is bounce. Fake it
  with a dim, wall-tinted area light opposite the window (or baked light), and set the fill to the ratio measured in the
  real room.
- **Shadows:** the sun's edge blurs about 0.9 cm per metre; window shadows soften with distance from the window; a clear
  filament is a small source and casts crisp shadows.
- **Exposure:** meter a virtual 18 % grey card at the face to 0.18 scene-linear, like the real card; let dusk and night
  sit a few stops under day, not the real 8–18. Render scene-linear through the same ACES output as the iPhone footage
  — three.js's `ACESFilmicToneMapping` is only an approximation.

## Matching the real room and its twin

1. Film a grey card and a colour chart at the face; place the same virtual targets in the 3D room.
2. Measure in stops (false colour or a meter app): the key cheek, the shadow cheek, the background, the window, the
   bulb. Rebuild the **ratios first** and the absolute level second.
3. Match Kelvin: the same white balance on the iPhone and in the 3D camera's transform; the bulb's colour from its box.
4. Match the geometry — the window's size and place, the subject's distance to it, the camera's height and field of
   view — and the surfaces, because wall, bedding and floor are the bounce.
5. Compare stills side by side through the same ACES output: fix the ratio first, then colour, then level.

Sources: three.js docs (PointLight, RectAreaLight; PR 8260 on physical units); Filament's reference values
(google.github.io/filament/Filament.md.html); Wikipedia: Exposure value, Blue hour.
