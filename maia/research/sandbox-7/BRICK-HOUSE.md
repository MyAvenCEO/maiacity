# Brick house: the next assembly proof

Experiment **11 / Build a brick house** adds a small masonry shell to the same physical-world sandbox. Select **Place next part**, **Build next stage**, or **Build whole house**. The wooden shed and original contact experiments remain available.

The aim is to prove an inspectable load path through separate materials: roof → timber plates and steel straps → bonded masonry and supported lintels → concrete foundation → ground. This is a physical assembly experiment, not a structural design specification.

## What gets built

| Stage | Parts and support |
|---|---|
| Foundation | One 2.7 × 0.2 × 2.7 m concrete slab; also the interior floor. It rests on the ground and is movable. |
| Courses 1–8 | Individual clay bricks and mortar batches. Alternate courses turn the corners in opposite directions, shifting the bond by half a module. The front doorway and rear window remain open. |
| Window lintel | Two mortar bearing pads on the existing jambs, then a concrete lintel with 200 mm bearing at each end. |
| Courses 9–10 | Masonry continues above the window. No brick bridges its unsupported opening. |
| Door lintel | Another two bearing pads and concrete lintel on the doorway jambs. |
| Course 11 | Completes the level top of the walls alongside the doorway lintel. |
| Roof plates and straps | Timber plates bear on masonry. Four visible steel straps bridge from the top-course bricks to the side plates; their masonry anchors remain ideal, while the timber-side grip can fail. Cross members connect to the side plates. |
| Roof supports | Seven tapered timber firrings fill the gap between the level frame and pitched deck. |
| Roof boards | Ten separate timber boards on the firrings. |
| Roofing felt | A separate continuous sheet covers boards and gaps. The roof falls 5° toward the rear, away from the doorway. |

The wall footprint is 2.4 × 2.4 m, with 200 mm thick walls and a 2 × 2 m interior. The doorway opening is 0.8 m wide and 2 m high above the floor. The rear window opening is 0.8 × 0.8 m, starting 0.8 m above the floor. Openings do not yet contain a door, window frame or glazing.

This uses deliberately large-format bricks: full units between two head joints are 390 × 190 × 200 mm, on a 400 × 200 mm module. Supplied cuts fit jambs and corners; exposed ends extend to the edge of their module without a mortar cap. These dimensions are an illustrative recipe, not a claim about a standard local brick product.

There are **466 supplied bodies**: 215 bricks, 219 mortar batches, three concrete pieces, 24 timber pieces, four steel straps and one felt sheet. There are **1,223 declared connections**. Total movable mass is approximately **10,354.03 kg**. Only the ground is fixed.

## How the mortar works

Each brick placement has two steps: place its mortar batch, then place the brick. A batch contains a 10 mm bed and 5 mm end-joint halves only where another piece abuts. Adjacent halves form a 10 mm vertical joint; a return wall ends in a single 5 mm joint against the perpendicular brick face. Exposed corners and jamb ends remain bare clay. It is one compound rigid body whose visible geometry, collision geometry, mass and inertia use the same disjoint pieces. Mortar has its own identity and remains present when a neighboring brick is released.

Recipe generation lists the already placed surfaces each mortar batch touches over a positive area. Only those listed pairs receive bonds. The running simulation never welds things merely because they touch. Each batch must have bearing underneath when placed; a lintel has two separate bearing pads before it is installed.

Mortar is supplied **instantly cured**, with unlimited rigid bonds. This does not simulate spreading, slumping, curing time, tensile strength, crushing or crack propagation. A batch's shape is a coarse construction representation. Bricks, concrete and timber are also rigid and unbreakable. Densities are illustrative: clay 1,800, mortar 2,000, concrete 2,400, timber 600, steel 7,850 and felt 1,000 kg/m³.

Roof straps have actual visible steel geometry touching both timber and masonry. Their connections are named groups. Masonry anchors remain ideal; timber grip and felt adhesive now use compliant points with finite withdrawal/shear capacities. Individual holes, fastener bodies and visible timber splitting are not simulated. See [connection failure](CONNECTION-FAILURE.md) for the exact model and experimental parameters.

## Inspect, release and apply wind

Click a part or select its ID to inspect its material, dimensions, mass, pose, contacts and installed connections. **Show structure only** hides the deck and felt so the roof supports remain visible. **Show remaining plan** reveals the unplaced geometry.

**Release selected part** removes every installed connection incident to that part. Its material remains in the world, with gravity, collision and wind still active. For example, releasing the window lintel immediately after placing it leaves it resting on the two mortar beds. Pushing it clear in the headless proof makes it fall. Release is a laboratory intervention, not a simulation of a worker dismantling masonry or a bond breaking under load. Reset before continuing construction after a release.

The existing wind model works on the new shapes, including openings and sheltering. Speed remains uncapped. It models steady sampled drag, not pressure-driven airflow, turbulence or roof suction. Roof timber grips and felt bonds can break under load, allowing the roof to separate into parts. Unlimited masonry bonds still prevent wall cracking and strap-anchor failure; sufficiently strong forces can also move the whole foundation. Extreme inputs are outside any validated physical regime.

The clock reports simulation time. A house contains many more collision shapes and joints than the shed, so a large build, especially with wind, can run slower than the requested playback speed. Each browser frame processes a bounded number of fixed physics steps; backlog is retained rather than changing the timestep. Contact inspection queries neighboring colliders instead of all possible pairs.

## Verification

Run `npm test`, `npm run build`, and `npm run measure:brick` from this directory. The measurement command writes [brick-house-measurements.json](brick-house-measurements.json), including stage measurements, the full recipe, connection/event ledger and final body state.

The original house checks explicitly retain the unlimited roof as a reference. New default-model tests cover intact roofs under gravity and low wind, then wood grip failure and separation under extreme wind at both timesteps. The staged measurement command also uses the default finite roof model.

Reference acceptance checks cover:

- Separate accounted mass, dynamic foundation, no overlapping axis-aligned construction pieces, and connections on actual positive-area surfaces.
- Bearing under every mortar placement; clear openings; lintels resting on two 200 × 200 mm pads; alternate corner ownership and half-module bond.
- Roof straps touching both brick and timber; roof connections validated on their actual pitched surfaces by the shared builder.
- Completed-house stability and weight transfer at both 1/120 s and 1/240 s: ground reaction within 0.5% of weight, anchor error below 2 mm, height drift below 5 mm and settled speed below 10 mm/s after three seconds.
- Released window lintel retaining contact with both beds, penetration below 3 mm, then falling when pushed clear; unchanged mass and disabled subsequent construction.
- Finite applied drag at 100 m/s, separately released felt retaining its identity and mass.
- Every construction stage below 2 mm anchor error and 10 mm/s settled speed, plus mean final ground reaction within 3% of total weight.
- Original contact, wooden-shed and wind regression checks; fixed-step backlog preservation under bounded browser work.

Both buildings use eight solver iterations and 12 internal PGS iterations. The house additionally uses contact natural frequency 120 and allowed linear error 0.1 mm. The default contact softness let the heavy released lintel penetrate its light 10 mm mortar pads excessively; the bearing/release check guards the corrected setting. These are numerical settings, not calibrated mortar properties. Exported construction records include them.

Within a group already connected by unlimited fixed bonds, internal collision responses are suppressed: they would duplicate constraints that already prevent any relative movement. Bodies keep separate mass, geometry, identity and joints. Contacts between different groups, including the foundation and ground, remain active. Releasing a part rebuilds the groups and restores collision against the rest of the house. Compliant roof grips are excluded from these rigid groups, preserving contact between roof pieces before and after failure. The inspector therefore reports external contact forces; it does not measure internal mortar-bond stresses.

Felt is declared watertight and its coverage is geometric. Rain, leakage, foundations in soil, brick fracture, fresh mortar, manufacturing, delivery, human handling, lifting equipment and tool use remain future proofs.
