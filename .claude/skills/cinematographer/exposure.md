# Exposure: metered like a camera, graded later

A world renders dawn, blue hour and night far darker than a film should show them. That is fixed at the source, like a camera, never by grading a finished image.

## Exposure and grade

The world renders dawn, blue hour and night far darker than a film should show them. That is fixed at the source,
like a camera, not by grading a finished image:
1. **Meter, don't grade:** a shot's `exposure: { meter: 'lock' | 'ramp' | 'fixed', stops }` meters middle grey on the
   lower 60% of the frame (the land and the domes; a bright sky does not count) and sets `stops` over or under it:
   pre-dawn and night about +1…+1.5, blue hour +0.5, a sunrise with the disc in frame −0.3 so the sky holds. The
   metered value is pinned into the shot, so a re-render is identical.
2. **Grade in the studio** after the edit is locked: first every shot's balance, levelled scene by scene to its
   master (`colorist`, `base-correction.md`), then the film's look for the arc (`dip` for the world as it was, `bright` for the city by
   day — `storyteller`, `retention.md`), judged on hero frames.
- **Brightness alone isn't a grade.** Match the black level of dark shots to the day shots (lift the offset, add
  contrast with power), and check the storyboard through the output transform, not the raw log still.
- `scripts/film/grade.mjs` is the old pre-grade on finished Rec.709 shots. It stays only for re-grading legacy shots
  shot before film mode; never use it for new shots.

## The iPhone in Apple Log

- **Apple Log's numbers** (Apple's white paper): 18 % grey → 0.488 (10-bit 500), 90 % white → 0.682 (697), black →
  0.150 (154); the curve reaches about +6 stops over grey. In ACEScct, 0.18 linear sits at about 0.414.
- **Protect the highlights, then expose as bright as they allow** (Lubezki underexposes digital to keep highlight
  detail; exposing to the right gives cleaner shadows); keep shadow detail rather than lifting the blacks (Morrison).
- **The Blackmagic Camera app** gives false colour, zebras (70–80 % for skin, 90–100 % for clipping), shutter control
  and an Apple Log → Rec. 709 preview.
- **Expose skin the same way every day** and protect windows and sky. Shoot a grey card once from −2 to +2 stops and
  grade the steps to learn where the phone gets noisy and where it clips.

### Apple Log 2 on the iPhone 17 Pro

The same curve as the first Apple Log, in a wider gamut (Apple Wide Gamut); the studio reads it from the file's tag
(`colorist`, the journey).
- **Set Log 2:** in the Camera app, Settings → Camera → Formats → ProRes Log Video Encoding → **Log 2** (the 17 Pro can
  also still record the first Apple Log). Blackmagic Camera (Apple Log 2 since 3.1) or Final Cut Camera 2.0 for manual
  control.
- **Codec:** ProRes 422 HQ (10-bit 4:2:2), UHD 3840×2160 — our grading stills are 3840 wide. HEVC log only when storage
  forces it (4:2:0). **No ProRes RAW yet:** the studio can't read it.
- **The numbers on a log waveform (video range):** grey card about **49 %** (10-bit 492); light skin +½ to +1 stop,
  **53–57 %**; 90 % white about 68 % (661); black 15 % (196); each stop about 8.5 %; hold a window or sky to about +5
  stops (91 %). Know whether the false colour reads the log or the preview LUT — these are the log's.
- **Under-expose by up to a stop in high contrast** to hold the highlights, then bring it up in the balance (Prolost);
  never more. Find the real clipping point once with a bright lamp: the code reaches +6 stops, the sensor may clip
  sooner.
- **Lock everything** — ISO (the lowest the light allows), shutter at 180° (1/50 at 25 fps, 1/60 at 30), Kelvin set by
  hand per scene (between the sources in mixed light, 4,000–4,500 K), focus — and don't touch the screen in a take:
  the iPhone's processing reacts to the scene, and its exposure jumped when the shutter changed (CineD).
- **A grey card (and a chart if there is one) at the start of every set-up:** they become the `regions` of the base
  correction.
- **Check on ingest:** every clip must read `apple-log-2 · log atom` in the studio; `apple-log` means the phone was on
  "Log", `unknown` that the file lost its tag.

## Shutter and frame rate

- The shutter angle ÷ 360° is the exposure time ÷ the frame interval; 180° is normal: 1/48 s at 24 fps, 1/50 at 25,
  1/60 at 30. A narrow shutter gives the stutter of a war film (Kamiński on *Saving Private Ryan*).
- **Match the world's frame rate** (the shot spec's `fps`, 30): 1/60 s at 30 fps, which needs ND in daylight. Under 50 Hz
  mains light some LEDs flicker at 1/60 — test first, or use 1/50 or 25 fps for the whole film.

## The worlds

Renders have no sensor noise, so ETTR doesn't apply: match middle grey to the live plates (the meter already holds 18 %
on the lower 60 % of the frame) and hold the sky. There is no depth-of-field pass: separate the planes with light and
haze (Block's tonal and diffusion cues).

Sources: Apple Log Profile white paper; prolost.com/blog/applelog; Lubezki (dpreview.com); Morrison (nofilmschool.com);
blackmagicdesign.com/products/blackmagiccamera; Wikipedia: Rotary disc shutter, Middle gray, Exposing to the right,
Zebra patterning.
