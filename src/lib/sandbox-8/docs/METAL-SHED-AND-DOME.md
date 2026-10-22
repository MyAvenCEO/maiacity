# Sheet-metal shed and geodesic dome

Experiments **12** and **13** extend the same sandbox. Use **Place next part**, **Build next stage**, or the whole-building button. Select the dome from the experiment list; the stand laboratory currently opens by default. **Show structure only** hides cladding visually without removing its mass or wind load. Inspect, release, wind, red failure markers and JSON export work on both buildings.

## Two different construction systems

| | Sheet-metal shed | Geodesic dome |
|---|---|---|
| Structure | Timber bottom frame, posts, top frame and tapered roof supports | 2V icosahedral hemisphere, 25 installed steel hubs and 60 timber struts; a five-sided entrance bay |
| Size | 3 × 2.4 m bottom footprint | 8 m diameter, approximately 4.24 m shell height above the slab |
| Cladding | 26 galvanized steel wall sheets, three roof sheets and two seam covers; 1.5 mm steel | 35 triangular 6 mm polycarbonate panels (12 clear windows) plus a 24 mm plywood pentagonal entrance panel |
| Support | Bottom timber frame bears on ground | Movable 8.6 × 8.6 × 0.2 m concrete slab |
| Assembly | Eight stages, 69 supplied bodies | Seven stages, 233 permanent bodies plus 15 compound prefabricated stands; 248 placements |
| Supplied mass | Approximately 1,139.36 kg | Supplied mass includes slab and stands; withdrawn stand mass is recorded separately |
| Connection behavior | Timber grip, sheet fixings and shoe connections have finite strength | Timber-to-hub grips, hub base bolts, panel brackets and panel fixings have finite strength |

These are supplied parts assembled in a laboratory. Workers, cutting, drilling, welding, lifting, deliveries and actual tool use remain outside this experiment. Dimensions, densities and connection parameters are illustrative.

## Sheet-metal shed

This recipe reuses the wooden shed's proven geometry, including open corner sockets, doorway shoes, notched floor and a roof falling 5° toward the back. The cladding is replaced with thin steel sheets. Three longitudinal roof sheets bear on the tapered supports. Two raised cover strips bridge their 2 mm seams and attach to both adjoining sheets. Every attachment is declared on actual contacting material.

The frame is timber, not a simulated light-gauge steel frame. Sheets are flat rigid bodies: no corrugation, bending, buckling, visible hole tear-out or corrosion. Wall-course gaps remain visible and unsealed; roof overlap geometry alone does not establish watertightness. Sheet-fixing failure represents loss of attachment, without choosing whether a particular real screw, washer, sheet or wood substrate would fail first.

## Current calculated dome settings

The live controls now accept any finite diameter of at least 6 m, with no upper ceiling. You choose target cell size and lower / middle / upper timber sizes. Mesh subdivisions are calculated from those settings. Strength limits remain unchanged; oversized structures may fail. The common telescopic stand design, compact reusable hub pad, equipment reuse records and limits are described in [the current README](README.md#calculated-domes-and-reusable-telescopic-stands).

The geometry and measurements below document the earlier size variants and braced supports retained as explicit reference modes. They are historical baselines, not the current live recipe.

## Historical configurable dome sizes

**Dome size → Frame diameter → Apply size & reset** rebuilds the recipe for any diameter from 6 to 16 m. Applying a size stops and resets construction; ordinary Reset retains the selected diameter, as does switching away from and back to the dome. The export includes the diameter, mesh frequency and timber size schedule. Diameter describes the frame sphere; the slab extends 0.3 m beyond its radius on each side. Camera framing, ground and support geometry adapt to the size.

The recipe changes at two thresholds rather than stretching every part:

| Diameter | Triangular cladding cells | Installed hubs / struts | Square timber sections |
|---|---:|---:|---|
| 6–8 m | 35 | 25 / 60 | 80 mm throughout |
| Above 8–10 m | 35 | 25 / 60 | 120 mm lower, 100 mm middle, 80 mm upper |
| Above 10–16 m | 140 | 85 / 225 | 120 mm lower, 100 mm middle, 80 mm upper |

For the finer mesh, each original triangle is subdivided into four triangles and new nodes are projected to the sphere. Nodes on the five-sided entrance boundary stay in its plane. This is a 4V-derived mesh with a modified entrance, not an unmodified regular 4V hemisphere. The longest supplied strut is about 2.20 m at 16 m diameter, compared with 2.17 m in the original 8 m dome. A member touching the lower 35% of the frame rise uses the lower section; one touching the next band up to 75% uses the middle section. Remaining members use the upper section. This is an explicit experimental stock schedule, not an automatic stress optimizer or a structural design calculation.

Larger entrance brackets hold the plywood clear of the enlarged hub cores. Panels are placed against the current bracket poses after the frame settles, without reshaping either panel or frame. Hubs and tabs fit the chosen timber section; larger timber ends have additional clearance from hub cores. Panel thicknesses remain 6 mm polycarbonate and 24 mm entrance plywood. Windows remain physical panes: 12 in the coarse mesh and 52 in the fine mesh, in the same normalized side regions. The doorway remains 1 m wide with 2.1 m vertical headroom above the retained sill. Larger entrance panels have more separate steel brackets (28 in the fine mesh) and use through-bolts with washers instead of the light panel-clip profile. Individual triangular panes still use the original finite panel fixings.

The fine mesh needs 65 prefabricated stands. Their compact 0.40 × 0.45 × 0.08 m steel feet provide counterweight for offset heads; they remain unanchored contact bodies. The timber upright and braces are workshop assembled onto a steel shoe, using the declared heavy through-bolt profile. Heads have 0.32 m side plates. Lower-row heads reach outward while the feet and uprights stay clear of the base ring. All seven components form one rigid compound body with an inspectable workshop recipe. Stands are progressively removed from the world after withdrawal; their outgoing mass remains recorded. Handling the heavy feet is still an external laboratory operation. Smaller coarse domes use narrower timber feet to avoid crowding at the crown.

This verifies the model's rigid bodies and finite attachments under the tested conditions. It does **not** establish timber bending or buckling strength, panel deflection, snow capacity, foundation bearing capacity, or a wind rating. A uniform timber section remains possible if sized for the governing load; the graded schedule explores using less material in the upper frame.

## Geodesic dome: original 8 m recipe

A vertex-up icosahedron is subdivided once at edge midpoints and projected onto a sphere. The underlying hemisphere mesh has 26 vertices, 65 edges and 40 triangular faces. At the front, the five triangles around one original icosahedron vertex are replaced by one flat pentagonal entrance panel. The centre hub and its five spokes are omitted from construction, leaving 25 hubs and 60 struts. The pentagonal boundary remains connected to the rest of the frame; the ground-level ring remains as a threshold. Gravity and staged-construction checks include this changed frame after the temporary stands are withdrawn.

The entrance is one supplied 24 mm plywood panel with a real rectangular cutout: **1 m clear width and 2.1 m vertical headroom above the sill**. It lies in the inclined plane of the pentagonal dome bay. Three disjoint convex regions represent the material around the opening; they belong to one rigid body. This preserves the hole in rendering, collision, mass and wind calculations instead of covering it with an invisible collision surface. Six steel brackets attach the panel to the five surrounding struts, with two sill attachments placed to either side of the opening. A doorway clearance test casts rays through the full assembled structure. There is no door leaf, hinge, seal or separate door jamb frame yet.

The remaining 35 triangles receive 6 mm polycarbonate cladding. Twelve side panels are clear windows; the other 23 are opaque. Transparent panels retain their full mass, solid collision and finite-strength attachments. They also take wind loads and shelter other parts like any solid panel. Transparency is a rendering approximation, not a model of light transmission, refraction, solar heating or glazing performance. Clear panes do not cast opaque shadows in the current renderer.

The mesh construction follows the subdivision concept described by [Three.js's polyhedron geometry documentation](https://threejs.org/docs/pages/PolyhedronGeometry.html).
Each 80 × 80 mm timber strut sits on steel bolting tabs extending from its two hubs. The tabs provide a long side attachment rather than a moment connection hidden at the end grain. Hubs are compound bodies: a convex steel center plus 6 mm steel tabs. An 11 mm end clearance keeps wood ends away from the convex center as the finite joints deflect; the load-carrying tab faces actually touch the timber. Each panel has three separate steel brackets. Their bottom faces bear on struts; their sloped top faces meet the panel underside. Panel mass and wind area come from its triangular prism, not its bounding box.

Fifteen orange support stands are supplied **already assembled**. One placement operation installs a complete stand; construction of the stand itself is not animated. Its seven component shapes and densities form one rigid compound body. Mass distribution and contact surfaces are retained, while internal fastening failure is omitted. Components and workshop fastening instructions remain inspectable as a recipe; the hub attachment is still a finite-strength connection. The inspector includes the workshop recipe:

1. Start with a single 0.80 × 0.90 × 0.08 m timber sole plate.
2. Screw the steel shoe to the plate and bolt the 80 × 80 mm upright into its side plates.
3. Fasten two lateral diagonal braces and one inward diagonal brace to both the sole plate and upright. Their ends are cut to meet the actual attachment faces.
4. Bolt the steel head's side plates to the upright. A 1 mm end clearance avoids an interference fit; its side attachments carry the head.

The foot extends inward, clear of the bottom ring in plan as well as in three dimensions. The three braces also remain clear of the completed permanent frame and panels. Each hub has an integral steel mounting stem with a flat bearing face on the stand's head. This avoids trying to hold an upper hub by a tiny strip of its faceted underside.

Permanent structure connections and hub-to-stand attachments are finite fastening groups. Internal workshop joints within each compound stand are represented by rigidity and are not separate failure sites. Stand feet are unanchored: weight and friction act through contact with the slab, so stands can slide or tip. Isolated tests check the contact load path, sliding under a lateral impulse and fastening failure under a larger impulse. Collision checks independently compare the convex components of all temporary parts against the entire building and other supports.

Each stand is withdrawn after all permanent struts meeting its supported hub have been installed. A crown-completion cleanup handles any remaining stands before cladding. The tested 8 m sequence needs at most 10 of its 15 stands active at once; the 16 m sequence needs at most 23 of its 65. This is a recipe-specific retirement schedule verified under staged gravity, not a general structural stability inference.

Withdrawal disconnects the finite hub attachment and removes the stand body, colliders and visible mesh from the world. `withdraw-shoring` events record outgoing mass; the export retains the original component recipe, supplied mass, withdrawn parts and total withdrawn mass. The material has left the simulated site, rather than remaining as offsite physics bodies. Lifting, extraction paths and handling forces remain external laboratory operations. Releasing a part or damaging the assembly before completion stops further construction, including automatic withdrawal. The completed dome is supported by its struts, hubs, base bolts and ground contact; only the ground is fixed in space.

Panels have small perimeter clearances. The dome is not declared weatherproof: no seam gaskets, flashing, interior pressure, runoff, thermal behavior, panel flexibility or strut buckling is modeled.

## Connection profiles

The [existing failure model](CONNECTION-FAILURE.md) now supports general convex faces and oriented components of compound bodies. Each group places separated springs within its actual shared attachment face; moment, withdrawal and shear can overload individual points. Parameters below are per point and are **experimental, not real product ratings**.

| Profile | Stiffness, N/m | Damping, N·s/m | Withdrawal capacity, N | Shear capacity, N |
|---|---:|---:|---:|---:|
| Shed timber grip | 500,000 | 1,000 | 1,500 | 2,500 |
| Sheet fixing | 1,000,000 | 700 | 400 | 800 |
| Dome timber grip | 5,000,000 | 5,000 | 8,000 | 12,000 |
| Dome base bolt | 5,000,000 | 5,000 | 12,000 | 18,000 |
| Temporary support screw / bolt | 5,000,000 | 5,000 | 1,500 | 2,500 |
| Dome panel fixing | 1,000,000 | 2,000 | 400 | 800 |
| Large entrance plywood through-bolt / load-spreading washer | 1,000,000 | 2,000 | 2,400 | 4,800 |
| Heavy support through-bolt / head | 5,000,000 | 5,000 | 8,000 | 12,000 |

The dome uses 16 solver iterations and 24 internal PGS iterations, with contact natural frequency 120 and allowed linear error 0.1 mm. The metal shed retains eight and twelve iterations. These are numerical settings, not material properties. Timber, hubs and panels remain rigid even after their attachments fail. Wind remains sampled drag with sheltering, without suction or resolved airflow; extreme-speed results are qualitative experiments.

## Verification

The earlier detailed-stand implementation passed 106 tests. It remains available through `domeDefinition(diameter, {detailedShoring: true})` for the original geometry, clearance and construction reference suites below. After the worker and compound-stand changes, 54 targeted tests and the production build passed; see the current checks below. Test files are run individually in this environment.

The original detailed-stand 8 m acceptance suite includes the existing regression checks, `tests/new-buildings.test.ts`, the isolated support checks in `tests/shoring.test.ts`, and the doorway/window checks in `tests/dome-panels.test.ts`:

- Underlying dome topology, a continuous ten-edge base ring, and an unobstructed pentagonal entrance bay.
- Ordered dependencies, positive shared attachment faces, positive material volume and separate dynamic bodies.
- Independent triangular-prism and cutout-panel volumes; doorway ray clearance through the full structure; window collision and unchanged mass/wind response under transparency.
- Both completed buildings at 1/120 s and 1/240 s: intact under gravity and a brief 10 m/s wind; mean ground reaction within 3% of weight and attachment displacement below 5 mm.
- Failure under a brief 100 m/s trial, with finite positions and unchanged body identities and mass.
- Staged construction with no damage, disconnection of the stands from the dome, retained assembled stands beside the slab, and stability after withdrawal.

The detailed-stand size-specific reference checks cover diameter validation, a closed base ring through the threshold, unchanged doorway clearance, attachment faces, section sizes, mass accounting, and storage outside the resized slab. Independent convex separating-axis checks cover stand clearance and intersections within the permanent frame, including values on both sides of the recipe thresholds. Gravity checks exercise 6, 8.01, 10, 10.01, 12 and 16 m. The 10 and 16 m staged checks advance one tick per placement, pause between stages, and verify the frame after withdrawal and the final cladding. The 16 m wind check uses brief 10 and 100 m/s trials. These protocols are automated laboratory experiments, not a proof of arbitrary installation speeds or a wind rating. That detailed reference has 1,355 supplied component bodies at 16 m and 338 at 8 m. The current compound recipe has 965 and 248 placement operations respectively; after all stands leave, the worlds contain 901 and 234 bodies including ground. Playback may still run below real time. Convex parts explicitly retain authored volume × density during Rapier mesh cooking; inertia follows the cooked collision shape.

The strength parameters have not been calibrated, and these tests do not establish a real wind rating, exact failure sequence or construction safety. The saved [new-building-measurements.json](new-building-measurements.json) covers the historical detailed-stand 8 m dome and metal shed; regenerate that snapshot with `npm run measure:buildings`. The size sweep is covered by the dedicated tests rather than that default-size snapshot. TypeScript checking and the production build also pass.

Implementation: [metal-shed.ts](src/metal-shed.ts), [dome.ts](src/dome.ts), [geometry.ts](src/geometry.ts). The shared simulation, wind sampler and renderer now handle convex polyhedra and rotated components consistently.

The measurement file records the observed failures during a 100 m/s, 0.3-second wind trial. These are results of a particular run, not wind resistance ratings.


### Current compact-stand and worker checks

`tests/compact-shoring.test.ts` compares all compound geometry and authored mass against the seven original workshop components at 6, 8, 10, 12 and 16 m. Isolated checks compare actual mass and center of mass, ground reaction, sliding and finite hub fastening failure. Staged builds at all five sizes settle between stages and after each withdrawal: no connection failures, attachment displacement below 5 mm, fewer concurrently active stands than supplied, and no stand body remaining before cladding. World mass plus recorded outgoing mass agrees with supplied material; no remaining contact or connection refers to a withdrawn body.

`tests/compact-dome-wind.test.ts` checks completed 8 and 16 m domes under gravity and brief 10/100 m/s wind trials. `tests/worker-runtime.test.ts` compares a command-driven shed replay exactly against the direct simulation, and checks pause, stepping, reset validation, snapshots and export. `tests/worker-client.test.ts` covers command backpressure, stale reset replies and worker errors. Existing physics and wind-equivalence checks also pass. The current staged measurement can be repeated with `npm run measure:shoring`.

The original detailed supports are a reference model, not a promise that merging their internal degrees of freedom produces identical motion. The deliberate tradeoff is confined to temporary stand internals; permanent structural parts and finite connections retain their previous model. More on the worker and measured body/constraint reduction: [README](README.md#worker-and-temporary-stand-changes-13-october-2026).
