# Lenses and shot sizes

## Read a field of view as a lens

The angle of view is α = 2·atan(d / 2f). On full frame a 16:9 image is 36 × 20.25 mm, so for a vertical field of view
**f ≈ 10.125 / tan(vfov / 2)** mm. (three.js's `fov` is the vertical angle; `filmGauge` is the larger axis.)

| Full-frame mm | 16:9 vertical fov | 16:9 horizontal fov (= 9:16 vertical) |
|---|---|---|
| 13 | 75.8° | 108.3° |
| 18 | 58.7° | 90.0° |
| 24 | 45.7° | 73.7° |
| 28 | 39.8° | 65.5° |
| 32 | 35.1° | 58.7° |
| 35 | 32.3° | 54.4° |
| 40 | 28.4° | 48.5° |
| 50 | 22.9° | 39.6° |
| 85 | 13.6° | 23.9° |
| 120 | 9.6° | 17.1° |
| 135 | 8.6° | 15.2° |

**Our world camera:** a shot's `lens.fov` is the short side's angle of the shape it is composed for (wider shapes keep
the height, taller shapes keep the width; check `game/film/shot.js`). So the default **fov 45 ≈ 24 mm** — the iPhone's
main lens — and **fov 10 ≈ 116 mm**, the 5× tele. The old rule of thumb (wide 45–55, long 10–20) skips the band the
masters live in: **fov 23–35 (≈ 50–32 mm)** is the band for faces and the room.

## The masters' lenses

- **Deakins:** mostly 32/35, 40 and 50 mm; the over-shoulder on 32/35, the closer single on 40/50, nearer to human
  vision. *Shawshank*: 28–32 mm for groups, 40–85 mm closer. *1917*: 40 mm on large format (≈ 32–35 mm on Super 35),
  35 mm in the tunnels for claustrophobia. "Best not to get obsessed with numbers."
- **Lubezki:** inches from the actor on very wide lenses, keeping the subject and the world present at once.
- **Van Hoytema (*Oppenheimer*):** 50 and 80 mm on IMAX, about 26 and 41 mm full-frame by width.
- **Ozu's cameraman Yuharu Atsuta** reportedly shot everything on one 50 mm (secondary source).

## Distance for a shot size

d ≈ H × f / 20.25 (16:9, full-frame equivalent), with the frame height H: close-up 0.35 m, medium close-up 0.6, medium
1.0, full figure 2.2. For native 9:16 divide by 36 instead.

| Lens | Close-up | Medium close | Medium | Full figure |
|---|---|---|---|---|
| 24 mm | 0.4 m | 0.7 m | 1.2 m | 2.6 m |
| 35 mm | 0.6 m | 1.0 m | 1.7 m | 3.8 m |
| 50 mm | 0.9 m | 1.5 m | 2.5 m | 5.4 m |
| 120 mm | 2.1 m | 3.6 m | 5.9 m | 13 m |

## Samuel's iPhone

- **The 24 mm main** at arm's length (0.4–0.7 m) gives Lubezki's immersive close-up — and swells the nearest features.
  For a calm Deakins single: the tripod and a step back, a 24 mm medium at about 1.2 m, or a 5× close-up from about 2 m.
- **The 2× crop (≈ 48 mm)** sits in Deakins's close-up range — check that the phone records 4K Apple Log with it.
- **The 0.5× (13 mm)** for arm's-length vlogging and the tightest corners of the room (LifeOfRiza's 11 mm "vlog lens").

## The world's lens set

- Fix three or four per film so the renders cut with the phone, e.g. **fov 45 / 32 / 23 / 10 ≈ 24 / 35 / 50 / 116 mm.**
- Any world shot that intercuts with iPhone footage wears the iPhone's equivalent focal length.
- **The room (3.10 × 4.50 m):** the longest throw is about 4–5 m. fov 23 gives a medium from about 2.5 m, fov 10 a
  close-up from about 2 m, fov 45 the full figure from about 2.6 m. fov 32 (35 mm) when the room should feel tight.
  Keep the virtual camera inside the walls, at heights a tripod could reach, on lenses the phone has.
- **The dome city:** calm exposition in flat, frontal, long-lens frames; deep space, diagonals and a wide fov at the
  peaks; one big jump in scale (ECU → EWS) saved for the climax (Block).

## Shot sizes

The wide gives place, scale and isolation; the medium relationship and action; the close-up emotion and emphasis; the
insert the detail. Earn close-ups with wider shots; build a sequence as progressive (wide → medium → close), regressive,
repetitious or contrasting — never a hodge-podge; contrast in size between cuts adds intensity (Mascelli, Block).

## Sources

Deakins forum (rogerdeakins.com/forums: ots-to-close-up-move-closer-or-longer-lens, focal-lengths, camera-movement);
theasc.com (1917, Shawshank); Lubezki (dpreview.com interview); Wikipedia: Angle of view, Oppenheimer; three.js
PerspectiveCamera source; reyfilm.com (wide, standard and telephoto lenses).
