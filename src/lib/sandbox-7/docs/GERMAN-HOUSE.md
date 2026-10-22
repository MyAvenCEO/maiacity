# German family house

Experiment **16 / Build a German family house** is a detached two-storey house with clinker facing brickwork and a bitumen-shingle gable roof, built in the order a German site would build it. It opens by default. Use **Place next part**, **Build next stage** or **Build whole house**; inspection, release, wind and export work as in the other buildings.

![The finished house](docs/german-house-complete.png)

## What gets built

The house is 10 × 8 m outside, with two full storeys of 2.5 m clear wall height, precast floor slabs, a 40° gable roof and a ridge about 9.45 m above ground. 277 placements stay separate bodies, 253.6 t in total.

| Stage | Placements | What happens |
|---|---:|---|
| 1. Foundation slab | 1 | 10.1 × 8.1 × 0.25 m reinforced concrete slab on the ground |
| 2. Ground-floor inner walls | 5 | 175 mm calcium-silicate inner leaf with openings and integral lintels, plus an interior bearing wall with a door opening |
| 3. Ground-floor clinker facing | 45 | 115 mm facing leaf of long-format clinker bricks (490 × 73 mm) in half bond, laid in lifts between the openings, with toothed corners and soldier-course lintels |
| 4. First floor slab | 4 | Precast lattice-girder slab elements bearing on the inner leaves and the interior wall |
| 5. Upper-floor inner walls | 5 | As the ground floor |
| 6. Upper-floor clinker facing | 43 | As the ground floor, continuing past the slab edges |
| 7. Top floor slab | 4 | Precast elements carrying the attic and the wall plates |
| 8. Gable walls | 22 | Stepped inner leaf under the end rafters; facing courses stepping up under the roof line, with an attic window and lintel in each gable |
| 9. Wall plates & rafter pairs | 15 | 120 × 160 mm spruce plates anchored to the top slab; 13 rafter pairs (80 × 200 mm) with bird's-mouth seats and collar ties, each assembled on the ground and lifted as one unit |
| 10. Roof boarding & underlayment | 26 | 24 mm boarding panels nailed to the rafters, 3 mm bitumen underlayment |
| 11. Shingles & ridge | 41 | 20 staggered laminated shingle courses per slope and a ridge cap |
| 12. Barge boards, gutters & downpipes | 8 | White verge boards, zinc box gutters on the eaves, two zinc downpipes on wall clips with swan necks |
| 13. Windows & doors | 58 | Anthracite frames, triple glazing, aluminium sills, an oak entrance door and a patio door |

The wall is a typical northern-German two-leaf wall: the inner leaf carries the slabs, and the facing leaf stands on the foundation and is bonded to it.

## How the masonry is modelled

- **Lifts, not single bricks.** Each facing lift (one band of courses between openings) is placed as one rigid body. That reflects a lift of bricks laid and cured, not a single crane placement.
- **Bricks and mortar are both drawn.** Every brick and every bed and head joint is drawn: red-brown clinker shades and grey mortar.
- **Joints are solid for physics.** Mortar fills the joints, so physically a lift is solid masonry. Its collision pieces merge each run of equal courses into one box, with exactly the same outer surface, volume and mass as the bricks plus joints. The drawing is a display-only subdivision of that same solid (`renderPieces`). This cut the finished house from about 6,600 to about 1,000 collision pieces without changing its physics.
- **Corners and openings.** Corners alternate ownership course by course, so the eaves walls and gables interlock. Openings and soldier-course lintels cut the courses exactly.
- **Ideal bonds.** Masonry, mortar, slabs and wall ties are ideal rigid bonds, as in the brick house. Their internal contacts are not computed. Core insulation is not modelled; the facing sits directly against the inner leaf.

## Connections

Everything from the wall plates outward has finite experimental strength. These are illustrative laboratory values, **not design resistances**.

| Profile | Used for | Stiffness N/m | Withdrawal N | Shear N |
|---|---|---:|---:|---:|
| Wall-plate anchor bolt | Plates → top slab | 5 × 10⁶ | 12,000 | 15,000 |
| Rafter tie-down bracket and nails | Rafter pairs → plates | 2 × 10⁶ | 3,000 | 5,000 |
| Roof boarding nails | Boarding → rafters | 1 × 10⁶ | 600 | 1,200 |
| Underlayment staples / batten | Underlayment → boarding | 2 × 10⁵ | 150 | 300 |
| Shingle nails and self-seal strip | Shingle courses, ridge cap | 2 × 10⁵ | 120 | 250 |
| Barge board / gutter bracket screw | Verge boards, gutters, downpipe clips | 5 × 10⁵ | 500 | 900 |
| Window / door frame anchor | Frames → inner leaf, sills → facing | 2 × 10⁶ | 1,500 | 2,500 |
| Glazing bead and setting blocks | Glass → frames | 1 × 10⁶ | 800 | 1,500 |
| Door hinges and lock | Door leaf → frame | 2 × 10⁶ | 2,000 | 3,000 |

From the wall plates onward, each new part is fitted to the current pose of the parts it fastens to, so settled timber never preloads the next fixings.

Shingle courses, underlayment, downpipes and sills keep small clearances (3–15 mm) from neighbours they are not fastened to. The downpipes bear on the brickwork only through three clips.

## Verification

`npx vitest run tests/german-house.test.ts` checks that:

- every part is separate, fastens only to earlier parts through a real shared face, and starts clear of every other part;
- the facing and lintels draw more than 10,000 bricks and joints, which fill exactly (to 10⁻⁹) the volume of fewer than 1,000 collision boxes;
- every stage goes up without connection damage, and the finished house settles below 20 mm/s with anchor errors below 5 mm;
- supplied mass equals the recipe, only the ground is fixed, and the ground reaction matches the weight within 3%;
- the rafters bear on the wall plates and the shingles on the underlayment;
- 10 m/s wind causes no damage, while 100 m/s wind breaks fixings without deleting any part or changing any mass.

`npm run measure:house` repeats the staged build and writes [german-house-measurements.json](german-house-measurements.json).

On 13 October 2026 it recorded:

| Measurement | Result |
|---|---|
| Connection failures during construction | 0 at every stage |
| Ground reaction / total weight | 1.0000 (2,488 kN) |
| Settled vertical drift | upper inner leaf 0.7 mm, top slab 0.8 mm, rafter pair 0.9 mm, top shingle course 1.2 mm |
| Steady front wind, 0.4 s each | no damage at 10 or 25 m/s; at 40 m/s (144 km/h) the lowest shingle courses start to lift (211 points, 52 connections); at 60 m/s rafter tie-downs on the windward wall plate pull out; at 100 m/s roof boarding nails and the entrance door's hinges fail |

The failure order (shingles, then rafter anchorage, then boarding) is a property of the declared experimental capacities, not a rating of any real product.

## Solver settings and speed

The house uses 8 solver iterations with 4 internal PGS iterations. The rigid masonry needs few, and the light timber roof settled without damage at this setting. The finished house costs about 44 ms per physics step in a two-core headless run, close to the industrial hall. Playback runs below real time.

## Limits

- All parts are rigid: no masonry cracking, timber bending, creep or shrinkage, and no settlement of the ground.
- Masonry bonds are ideal and unbreakable. The facing does not separate from the inner leaf, and wall ties and insulation are not represented individually.
- Rafter pairs, collar ties and window units are lifted as finished assemblies. Cranes, scaffolding and people are not simulated.
- There is no interior fit-out: no stairs, floors, partitions beyond the bearing wall, or services.
- Wind is the lab's sampled steady drag, with no suction or gusts. The 100 m/s run is a destructive test of the model, not a rating.
- There is no rain, snow, thermal or moisture model.
