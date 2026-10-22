# Industrial hall

Experiment **15 / Build an industrial hall** is a steel portal-frame hall built part by part, in the order a steel erector and cladding crew would work. It uses the same laboratory controls as the other buildings: **Place next part**, **Build next stage**, **Build whole hall**, inspection, release, wind and export.

![The finished hall](docs/industrial-hall-complete.png)

## What gets built

| Stage | Parts | What happens |
|---|---:|---|
| 1. Foundation slab | 1 | 13 × 21 × 0.25 m reinforced concrete slab, resting on the ground |
| 2. Steel columns | 10 | HEA 250-type columns with welded base and cap plates on holding-down bolts. End-frame columns carry a welded full-height plate that the gable cladding fastens to |
| 3. Rafter pairs (lifted as units) | 10 | IPE 300-type rafters with welded eaves haunches and bolted end plates. Each pair is bolted at the apex on the ground and lifted as one unit, so no half-rafter ever cantilevers from a column |
| 4. Wall bracing | 4 | 100 × 12 mm flat bars in both end bays of both side walls, bolted inside the column flanges |
| 5. Gable posts & door header | 5 | Wind posts with sloped cap plates under the end rafters; a door header between the front posts |
| 6. Purlins | 40 | Galvanized C150 purlins, five rows per slope, bolted to the rafters |
| 7. Side walls & ribbon windows | 40 | 80 mm insulated sandwich panels spanning column to column, with a 16 mm polycarbonate ribbon window in row four |
| 8. Gable walls & windows | 32 | Gable panels on the end-frame plates and wind posts; the top panels are raked to the roof line; the front gable leaves the 5 × 4.4 m door opening |
| 9. Roof panels & rooflights | 40 | 100 mm insulated roof panels with visible ribs; every fifth panel is a translucent GRP rooflight |
| 10. Ridge, gutters, trims & downpipes | 20 | Ridge flashing, box gutters, corner trims and four downpipes |
| 11. Sectional door | 8 | Eight 45 mm insulated sections, one with a glazing strip, in guides on the gable posts |

The hall is 12 m span by 20 m long in four 5 m bays, with 5.7 m to the rafters at the eaves and a 10° duo-pitch roof. All 210 placements remain separate bodies: 180.4 t in total, of which 16.6 t is steel, cladding and door above the 163.8 t slab.

## Connections

Every connection in the hall has finite experimental strength. Each fastening point stands for a small bolt or screw group. These are illustrative laboratory values, **not design resistances**.

| Profile | Used for | Stiffness N/m | Withdrawal N | Shear N |
|---|---|---:|---:|---:|
| Holding-down bolt group | Columns → slab | 1 × 10⁷ | 60,000 | 50,000 |
| Bolted end-plate connection | Rafter → column, apex | 1 × 10⁷ | 80,000 | 90,000 |
| Bracing bolt | Flat bars → columns | 5 × 10⁶ | 20,000 | 30,000 |
| Gable post / header bolt | Posts → slab and rafter, header → posts | 5 × 10⁶ | 20,000 | 30,000 |
| Purlin cleat bolt | Purlins → rafters | 2 × 10⁶ | 8,000 | 10,000 |
| Sandwich panel fastener | Wall, gable and roof panels | 2 × 10⁶ | 1,500 | 2,500 |
| Flashing / gutter rivet | Ridge, gutters, trims, downpipes | 2 × 10⁵ | 600 | 1,000 |
| Sectional door roller / hinge | Door sections | 2 × 10⁶ | 1,500 | 2,500 |

Spring stiffness is matched to the mass of the parts joined. Stiffer springs on 21 kg purlins or light flat bars made the iterative solver chatter without making the model more accurate. Flashings are rigid bodies here, so their fixings are deliberately compliant: real sheet metal would flex instead.

Panels also rest on each other and on the slab by contact. Neighbouring panels, purlins and gutter lengths keep 4 mm butt joints, so only real bearing faces touch.

## How the build stays honest

- **No proximity joining.** Attachment targets are found once while authoring the recipe, from real shared faces with a usable area. Running parts never join because they are close.
- **No preloading.** From the bracing onward, each new part is fitted to the current pose of the parts it fastens to, as a fitter would. A frame that has settled by a few millimetres never stretches the fixings of the next part. Existing structure is never moved to meet a new part.
- **Robust bearing faces.** Every face that bears on another part is a box, axis-aligned or rotated. Rapier's box-box contact is reliable for exactly touching faces. Convex solids are used only for shapes that touch nothing else (haunches, tapered webs) or keep a small gap (raked gable panels, 2 mm below the roof).

## Verification

`npx vitest run tests/industrial-hall.test.ts` runs six checks:

- every part is separate, has positive volume, fastens only to earlier parts through a real shared face, and starts clear of every other part;
- each stage, including the bare portal frames, stands without any connection damage; the finished hall settles below 20 mm/s with anchor errors below 5 mm;
- supplied mass equals the authored recipe, only the ground is fixed, and the measured ground reaction matches total weight within 3%;
- columns bear on the slab and purlins on the rafters, and the ridge stays within 10 mm of its drawn height;
- steady 10 m/s wind causes no damage, while 100 m/s wind separates connections without deleting any part or changing any mass;
- a released roof panel stays on its purlins by contact and friction (10° is well inside μ = 0.6).

`npm run measure:hall` repeats the staged build and writes [industrial-hall-measurements.json](industrial-hall-measurements.json). On 13 October 2026 it recorded:

| Measurement | Result |
|---|---|
| Connection failures during construction | 0 at every stage |
| Ground reaction / total weight | 1.0000 (1,770 kN) |
| Settled vertical drift | rafter 4.2 mm, ridge purlin 7.2 mm, roof panel 3.7 mm, door 0.2 mm |
| Steady front wind, 0.4 s each | no damage at 10, 25 and 40 m/s; at 100 m/s 2,206 points failed and 489 connections separated, starting with wall and gable panel fasteners |

The settlement is real compliance in the bolted connection springs. It stays the same with heavier solver settings.

## Solver settings and speed

The hall uses 16 solver iterations with 8 internal PGS iterations per 1/120 s step. Fewer iterations left the purlins vibrating; more gave no measurable improvement. The finished hall costs about 33 ms per physics step in a quiet two-core headless run. That is close to the 8 m dome, so playback of the complete hall runs below real time.

## Limits

- Steel members are rigid: no bending, buckling, yield, bolt slip curves or connection rotation capacity.
- Sandwich panels use a declared average composite density (140 kg/m³ walls, 115 kg/m³ roof); skins and core are not separate materials.
- Wind is the lab's sampled steady drag, with no suction, internal pressure or gusts. The 100 m/s run is a destructive test of the model, not a wind rating.
- There is no rain, snow, thermal movement, weather sealing or condensation.
- Placement and fastening are laboratory operations. Cranes, people and temporary erection bracing are not simulated; the rafter-pair lift is represented by placing the pair in one operation.
