# Physical world laboratory

A local, inspectable first experiment for the [physical world foundation](../physical-world-foundation.md): a board rests on movable blocks because of contact, slips when friction is inadequate, and tips when its center of mass lies beyond support. Rapier supplies the rigid-body mechanics; Three.js renders the same state tested headlessly.

The [shed experiment](SHED.md) now adds step-by-step assembly: bottom frame, floor, walls, top frame, tapered roof supports, a wooden roof falling toward the back, and a separate felt covering. Use **Place next part**, **Build next stage** or **Build whole shed**. It retains 72 separate timber bodies, two steel doorway-post shoes and one felt sheet joined by explicit connections; the roof now has finite timber grips and felt bonds.

The [brick-house experiment](BRICK-HOUSE.md) is experiment 11. Build its movable foundation, 11 alternating brick courses, supported window and door lintels, strapped timber roof and felt covering. All 466 supplied pieces stay separate, including 219 mortar batches. The same inspection, release, wind and export controls apply.

Two more [building experiments](METAL-SHED-AND-DOME.md) add a sheet-metal shed (12) and a geodesic dome (13). Both use individual parts, finite fixings, staged construction, wind and damage inspection. The dome has opaque cladding, 12 transparent windows and a five-sided entrance panel with a real rectangular doorway cutout. It uses prefabricated braced support stands, represented by one rigid compound body per stand, with an inspectable workshop recipe. Their inward-facing feet clear the ring and their hub attachments retain finite strength. Stands retire progressively after all permanent struts at their supported hub are installed. Withdrawal removes them from rendering and physics and records their mass leaving the site.

The [industrial hall](INDUSTRIAL-HALL.md) is experiment 15: a 12 × 20 m steel portal-frame hall with haunched rafters lifted in pairs, flat-bar bracing, gable wind posts, purlins, insulated wall and roof panels, a polycarbonate ribbon window, GRP rooflights, gutters and an eight-section door. All 210 placements have finite fixings.

The [German family house](GERMAN-HOUSE.md) is experiment 16 and opens by default: a two-storey, 10 × 8 m house with a calcium-silicate inner leaf and a clinker facing leaf of long-format bricks drawn brick by brick, precast floor slabs, stepped gables, a 40° rafter roof with boarding, underlayment and bitumen shingles, zinc gutters and downpipes, and anthracite windows and doors. It has 277 placements.

The [technology decision](../physical-world-technology.md) records what we reuse, what we must implement, and which specialist tools might help later.

## Run the experiment

Use Node.js 22.12 or newer; this trial was checked with Node.js 24.8.0 on Linux x64.

```bash
cd /home/daniel/Documents/ChatGPT/sim/physical-world-lab
npm ci
npm run dev
```

Open the Local URL printed by Vite, normally `http://127.0.0.1:5173/`. The development server is local to this computer. Stop it with Ctrl+C.

```bash
npm test          # Physical acceptance checks
npm run build    # TypeScript checking and a static production build
npm run measure  # Regenerate original contact measurements
npm run measure:shed # Regenerate the shed assembly measurements
npm run measure:brick # Measure and check every brick-house construction stage
npm run measure:buildings # Historical detailed-stand reference, including wind failure
npm run measure:shoring # Current staged stand retirement measurements
npm run measure:hall  # Staged industrial hall: settling, ground reaction, wind failure
npm run measure:house # Staged German house: settling, ground reaction, wind failure
```

The browser starts paused in the German family house (experiment 16). Select an experiment and press **Run** or **Step**. **Reset** restores its current setup; selecting a preset restores the original parameters. Drag to orbit, scroll to zoom, or select a camera view. Select a part through the dropdown or by clicking its geometry. The inspector reports mass, shape, pose, velocities and principal inertia; dots mark centers of mass and squares mark contact points.

Expand **Setup / start a new run** to change the selected part's dimensions, position, rotation about Z, density or friction. Applying changes validates overlap, resets time and rebuilds the entire world. Setup controls are laboratory interventions. Arbitrary custom setups lie outside the tested preset envelope. A failed overlapping edit leaves the existing experiment unchanged.

**Export setup + current state** opens a readable, selectable JSON preview with a save-file link, containing the scenario, engine version, timestep, tick count, body state and contacts. It is an inspection record, not a complete Rapier checkpoint: there is no import UI or promise that restoring poses alone would preserve cached solver state. Original presets and fixed tick counts reproduce the tested runs.

## Original contact experiment model

| Property | Choice |
|---|---|
| Units | Metres, kilograms, seconds, newtons and radians; setup angle shown in degrees |
| Engine | `@dimforge/rapier3d-compat` 0.21.0, pinned in package-lock.json |
| Bodies | Uniform-density rigid cuboids, independently identified |
| Gravity | 9.81 m/s² along −Y |
| Timestep | 1/120 s; comparison checks at 1/240 s |
| Solver | 12 solver iterations; remaining settings use this pinned engine's defaults |
| Collision | Cuboid colliders; continuous collision detection enabled for dynamic bodies |
| Restitution | Zero on all colliders |
| Friction | Coulomb friction; pair coefficient is the smaller of the two collider coefficients |
| Damping and sleep | No explicit damping; sleeping disabled to keep contact measurements active |
| External boundaries | Fixed ground; fixed ramp in incline cases |
| Rendering | Reads authoritative poses, without snapping or hidden support |

Mass is density × volume. Rapier derives center of mass and rotational inertia from uniform cuboids. We test these against the cuboid equations. Fixed boundaries are external supports and are excluded from the movable-mass total. Friction and impacts dissipate mechanical energy; this model does not account for dissipated heat.

The standard board is 2.4 × 0.08 × 0.3 m at 600 kg/m³, giving 34.56 kg. Each support is 0.35 × 0.6 × 0.6 m at 2,000 kg/m³, giving 252 kg. Their centers are at X = ±0.8 m. These heavy supports intentionally provide a stable reference fixture while remaining movable. The load is a separate 0.3 m cube at 2,000 kg/m³, giving 54 kg, placed slightly off center at X = 0.15 m. The baseline board is also offset by 0.03 m.

Wood and concrete are material labels with illustrative densities and friction coefficients, not calibrated material laws. The board cannot bend, split or crush. Supports cannot fail in bearing. There are no fasteners, people, tools, wheels, terrain deformation, water or fire.

## Scenarios and acceptance criteria

Criteria were declared before accepting the trial. Distances below are in metres. Passing means agreement within the stated numerical/model bounds, not exact physical truth.

| Scenario or check | Acceptance |
|---|---|
| Free fall, 0.5 s from 5 m | Position error <0.025 m and velocity error <0.002 m/s; halving timestep reduces position error |
| Drop onto ground | Every sampled corner remains above −0.005 m during six seconds; resting center within 0.005 m of its geometric height; speed <0.01 m/s |
| Subsequent resting drift | Displacement <0.005 m over the next four seconds |
| Board on two supports | Height within 0.005 m; speed <0.01 m/s; positive-force contacts connect board → both supports → ground |
| Separate load | Same support requirements; separate load → board contact; unchanged object IDs and masses |
| Ground reaction | Mean vertical normal reaction over one second after settling agrees with total movable weight within 3% |
| Tipping left and right | Initial rotation has the expected sign; a board corner reaches the ground within six seconds; final speed <0.03 m/s |
| Stability near an edge | Board centers 0.05 m inside the support's outer edge remain stable; centers 0.05 m outside tip, on both sides and at both timesteps |
| Low-friction 20° incline | At one second, downhill speed agrees with `g(sin θ − μ cos θ)t` within 0.04 m/s, displacement within 0.025 m |
| High-friction 20° incline | Horizontal drift <0.01 m over four seconds; speed <0.01 m/s |
| Unconnected pieces | A neighbor initially touching the supported board falls away; relative vertical position changes by >0.05 m; no joints or merged identities |
| Initial configurations | Pair penetration no greater than 0.0001 m, allowing floating-point representation error |
| Mass and inertia | Uniform cuboid references agree within 0.0001 kg or kg m² |
| Timestep refinement | Stable part positions differ by <0.005 m; impact, incline, tipping and boundary criteria pass at both timesteps |
| Repeatability | Exact exposed body-state equality for repeated runs of four representative presets in the tested runtime |
| Playback | Paused time does not step; 30/60/144 Hz rendering schedules, single stepping and 2× playback give the same state at equal tick counts; reset reconstructs the initial state |

The incline board is 1 × 0.12 × 0.5 m, aligned with a 20° ramp. Low friction is 0.1; high friction is 0.8, above `tan(20°) ≈ 0.364`. Its short height limits tipping in this test. Incline references are checked before the board reaches a ramp edge. Tipped boards can come to rest leaning against a support; reaching ground contact does not require lying flat.

The 5 mm geometric limits are intentionally small compared with the board's 80 mm thickness. They bound this prototype's contact error; they do not establish suitability for millimetre-scale fasteners. Analytical fall and incline checks use independent equations. Reaction checks compare the solver measurement with independently calculated weight.

## Original contact experiment results

On 12 October 2026: **22 tests passed**, TypeScript checking passed, and the production build succeeded. The successful dependency installation reported zero known vulnerabilities in that audit snapshot. The browser was checked for rendering, run/pause, single step, reset, scenario selection, side view, overlap rejection and a density edit that reset time and correctly changed load mass. The JSON preview was parsed through the browser and its save link checked; completion of a file download was not confirmed by the embedded browser, so the preview also allows direct selection and copying.

[measurements.json](measurements.json) contains reproducible body/contact records. Selected results:

| Case | Result |
|---|---|
| Free fall | Center Y = 3.77204 m at 0.5 s; analytical error 1.71 mm |
| Board on ground | Center Y = 0.03988 m at 4 s; geometric reference 0.04 m |
| Board on supports | Center Y = 0.63976 m; reference 0.64 m |
| Supported ground reaction | 5,283.27 N against 5,283.27 N weight |
| Loaded ground reaction | 5,813.01 N against 5,813.01 N weight |
| Low-friction incline | Downhill speed 2.43338 m/s against 2.43338 m/s reference at 1 s |

Forces in the inspector are instantaneous estimates of the contact normal impulse divided by the timestep. Tangential friction force is not displayed. Contact points within 2 mm or carrying positive impulse are included; the existence of a displayed contact does not automatically prove a load path. Automated support checks additionally require positive force. The ground-reaction comparison uses settled, horizontal contacts and averages across a second.

Replay checks cover this Node runtime and package version. Cross-platform identity, browser-to-Node bitwise equality, large-world performance, physical material calibration and all custom setups are not established. The browser runs its physics at fixed steps; wall time only controls the number of steps. A per-frame work cap retains backlog rather than changing the timestep. Hidden tabs suspend advancement; there is no promise of matching wall-clock time under overload.

## Code structure

- `src/simulation.ts`: scenarios, physical bodies, contact measurements and playback timing; no renderer dependency.
- `src/main.ts`: Three.js view, selection, controls, setup editing and export.
- `src/physics.worker.ts` / `src/worker-runtime.ts`: authoritative physics, construction and wind in a dedicated worker.
- `src/worker-client.ts`: ordered commands and read-only render/inspector snapshots.
- `src/prefab.ts`: compound stands with preserved workshop component geometry and densities.
- `src/industrial-hall.ts` / `src/german-house.ts`: the hall and house recipes (parts, stages, fixing profiles).
- `src/style.css`: responsive laboratory layout.
- `tests/physics.test.ts`: physical acceptance criteria and repeatability checks.
- `scripts/measure.ts`: repeatable measurement export.

The [shed experiment](SHED.md) now introduces explicit connections, staged assembly and release checks while preserving these original tests. Roof strength now has a declared experimental model; installation remains a laboratory action. See [connection failure](CONNECTION-FAILURE.md) for capacities, failure modes and proofs.

Wind is available below the experiment list: enable it, enter a non-negative speed in m/s (no configured upper limit), choose the direction, then Run. It applies sampled surface drag with sheltering and shows per-part force/torque in the inspector. It can move and tip released parts. See [the wind experiment and its limits](SHED.md#wind-experiment); this is not a simulation of turbulent airflow or roof suction.

The dome diameter has no upper limit (minimum 6 m). **Apply size & reset** calculates the mesh from diameter and target cell size and uses your lower / middle / upper timber sections. It does not increase attachment strengths to make larger designs pass. See [calculated dome settings](METAL-SHED-AND-DOME.md#current-calculated-dome-settings).

## Performance without reducing the physical model

Wind sheltering uses a bounding-volume tree over the current collider poses. Local shape vertices are cached, but the tree is rebuilt for each measurement, including newly placed parts and moved supports. A sample first checks its previous blocker as a search hint; it still performs a fresh Rapier ray test. If that collider no longer shelters it, the tree searches the other candidates. Sampling density, relative air velocity, force/torque calculation and per-sample impulse order remain unchanged.

The tree conservatively encloses the original bounding spheres and retains the original sphere prefilter. Tight bounds around authored vertices proved insufficient to preserve Rapier's near-edge convex ray hits. The regression checks therefore compare every exposed sample, force, torque and sheltered area against a frozen copy of the original search, including both dome sizes, changed wind directions, moved parts and newly added blockers. A destructive shed replay also compares every body's state and each failure event at every tick.

Fastener measurements reuse each body's pose within a connection check. The view skips invisible preview transforms and hidden center-of-mass markers, updates rendered poses only when simulation state or selection changes, and reuses contact measurements while paused. These are display caches; physics and export still use the authoritative world.

The wind optimization alone leaves timestep, solver iterations, CCD, sleeping policy, material properties, fastener capacities, physical part counts and damage checks unchanged. The subsequent temporary-stand simplification is described below. The large dome's solver remains expensive; these optimizations do not guarantee real-time playback.

Run `npm run measure:performance` for an 8 m / 16 m headless comparison using the historical detailed stands retained beside the slab with the previous wind search. It reports median timings across five changing world states, asserts identical sample forces and loads, and separately measures gravity steps. Rendering is excluded; timings depend on the machine and other running work. `npx vitest run tests/wind-equivalence.test.ts` runs the equivalence checks.

On 13 October 2026, a local run with a completed dome and 10 m/s wind measured:

| Diameter | Previous wind search | Optimized wind search | Wind speedup |
|---|---:|---:|---:|
| 8 m | 130.46 ms | 43.04 ms | 3.0× |
| 16 m | 1,336.64 ms | 197.65 ms | 6.8× |

These are wind-calculation times per measurement with warmed search hints, not frame rates or whole-simulation speedups. Gravity steps still took about 38 ms and 185 ms respectively in that run. The five comparison states returned exactly equal sample forces and total loads at both sizes.


## Worker and first compound-stand baseline (13 October 2026)

Physics, wind, assembly and connection failure now run in a dedicated Web Worker. The main thread renders transferred pose snapshots and sends ordered commands. Only one advancement request is in flight; elapsed time is coalesced instead of queuing a request for every animation frame. Reset epochs reject stale replies. Export comes from the authoritative worker world. Contact display refreshes at most every 100 ms during playback; the underlying contact and damage calculations still run on fixed steps.

The worker advances up to eight 1/120 s steps per request, yielding after roughly 8 ms of work (one expensive step may exceed that budget). Backlog is retained. This separates camera/UI work from the solver; it does not make a large physics step instantaneous or guarantee real-time playback. Solver iterations, CCD, sleeping policy, permanent geometry and connection capacities are unchanged.

In the first compact-stand baseline, each prefabricated stand has one dynamic body instead of seven and no internal joint constraints. Its original component shapes and material densities preserve its mass distribution and contact surfaces. The inspector retains the seven-component workshop recipe. **Internal stand deformation and fastening failure are deliberately omitted** in this simplification; contact, sliding, tipping and the finite hub-to-stand attachment remain active. `domeDefinition(diameter, {detailedShoring: true})` retains the original detailed implementation for reference tests and historical measurements.

A stand is withdrawn after the last permanent strut meeting its supported hub is installed. This is a recipe-specific rule verified by staged gravity tests, not a general stability detector. Construction damage or manual release stops further assembly. Withdrawal removes the body, colliders, hub attachments and rendered geometry; the event records `massOutKg`, while the build record retains supplied/withdrawn material totals and the original recipe. No offsite stand is still simulated. Physical lifting and extraction paths remain laboratory interventions.

| Measurement | 8 m dome | 16 m dome |
|---|---:|---:|
| Peak active stands during tested sequence | 10 (15 supplied) | 23 (65 supplied) |
| Completed world bodies, including ground | 234 (previously 339) | 901 (previously 1,356) |
| Completed joint constraints | 1,408 (previously 1,954) | 5,464 (previously 7,822) |
| Stands remaining before cladding | 0 | 0 |
| Stand mass recorded leaving the scene | 957.3 kg | 9,765.1 kg |

Validation: 54 targeted tests passed across physics, original detailed shoring, worker runtime/client, wind equivalence, compact shoring and compact-dome wind files; TypeScript and production build passed. Compact staged checks cover 6, 8, 10, 12 and 16 m, with settling between stages and after each withdrawal, no connection failures and maximum attachment displacement below 5 mm. Geometry/mass checks compare the compound stands with the original components; isolated checks cover ground reaction, sliding and hub fastening failure. Completed 8 and 16 m domes remain intact in the brief 10 m/s trial and suffer finite attachment failures in the 100 m/s trial. These are bounded regression protocols, not construction or wind ratings.


## Calculated domes and reusable telescopic stands

The live dome recipe now has **no upper diameter ceiling**. Set diameter, target cell size and three square timber sizes in the left panel. Cell subdivision is `max(1, ceil(0.618033988749895 × diameter / (2 × targetCellSize)))`; each original triangular cell is divided into that many rows, then projected back to the sphere. This permits any positive integer subdivision, rather than switching among diameter variants. Target cell size is approximate because projection changes edge lengths. The pentagonal entrance perimeter stays planar and the doorway stays 1 × 2.1 m. Defaults are 2.5 m target cells and 120 / 100 / 80 mm lower / middle / upper timber. The lower bands still end at 35% and 75% of frame rise.

The existing finite fastening capacities, timestep and solver settings are retained. A huge dome can collapse or run slowly; there is no automatic strength upgrade or claim that every set of dimensions is viable. Positive finite inputs are required; cells too short to fit the support head are rejected with a geometry message. The old size variants remain only in explicit historical reference-test modes.

Temporary supports use **one common telescopic stand specification per recipe**, calculated to cover its lowest and highest support positions. Every instance has the same foot, sleeve count, sleeve lengths, wall thickness and top adapter; only the extension and placement differ. The inspector shows its range, overlap, asset ID and workshop component list. A new build settings reset can calculate a different equipment specification; existing inventory is reused during a build, not persisted between resets.

Select **Set height & place stand** to perform one laboratory operation: extend, lock and place the stand. Hollow steel sleeves have fixed stock dimensions and retain the same mass at every height. Pins/collars are declared in the workshop recipe; the locked stand is a single rigid body, so sleeve bending, buckling and lock failure are not simulated. The foot still rests through contact and can slide/tip; the hub attachment retains finite strength.

The head adapter leaves with the stand. The hub retains an **MP-80 service pad**, with an 80 × 80 mm face and a 48 × 48 mm four-point pattern matching the current fastening-group model. Its local position, orientation, normal and intended uses are exported for later interior framing, insulation battens and decoration. Those later assemblies are not implemented yet. Bolt holes and threads are specified, not resolved as small collision shapes. The pad follows the existing core surface instead of retaining the long downward stem.

Retirement still follows completion of all incident permanent struts. Withdrawn stands leave rendering and physics and return to an equipment pool. Later placements reuse available asset IDs and record an `adjust-stand` event with the new height. The inventory records unique equipment mass and use count. Supplied/withdrawn material totals remain **cumulative site inflow/outflow**, so a reused stand appears in both flows on each visit; it is not counted as a newly acquired asset each time. Extraction, transport and extension are external laboratory operations, not animated handling.

Current checks live in `tests/telescopic-shoring.test.ts` (stock/mass consistency, clear geometry, bearing/sliding/finite failure, staged retirement and identity reuse), `tests/parametric-dome.test.ts` (general subdivisions, valid mesh boundaries, unbounded diameter validation and custom settings), and the existing worker, contact and wind regression files. Historical seven-piece supports remain available with `detailedShoring: true`; their former compound version is available with `legacyCompactShoring: true`.


## Stand laboratory and stability revision

Experiment **14 / Telescopic stand laboratory** isolates one stand. Set the height with the slider or number field and choose **Set extension & reset trial**. This changes extension in one operation and resets time; it is not a powered actuator lifting an existing load. The same 11 hollow sleeves, each 0.82 m long, cover 1.253–8.45 m without changing stand mass.

Choose a simple test fitting, lower dome hub, upper dome hub or crown hub. The three dome choices are actual parts from the current 8 m dome recipe, reoriented to the common MP-80 mounting face, with their geometry and mass preserved. Add a loose top weight in kilograms, adjust foot friction, use wind, or apply an instantaneous head impulse in either horizontal direction. The live readout shows tilt and failed fastening points. Loads rest through contact and can fall off. Pushes are recorded as `test-impulse` events; reset settings, hub choice and material inventory are included in export.

The initial narrow foot tipped under the offset mass of the lower/upper hubs. The revised solid steel foot is **0.60 × 0.1125 × 0.50 m**, weighs **264.94 kg**, and is shifted forward under the offset head. The complete laboratory stand weighs **359.78 kg** at every extension. This is heavy equipment requiring handling machinery; it is not represented as hand portable. Its wider footprint and lower, better-positioned mass improve resistance to tipping without anchoring it to the ground or disabling contact.

The isolated checks settle all four fittings at 1.3, 4 and 8.4 m for three seconds. The simple fitting additionally carries a loose 100 kg weight. In these runs all head bolts remained intact and tilt stayed below 0.001°. Ground-reaction checks verify the load path through the foot, and a destructive impulse still separates the finite head attachment. `npm run measure:stand` repeats the 12 settling measurements. These are prototype regression checks: the stand is still a locked rigid assembly with no sleeve bending, buckling or lock-pin failure, so this is **not a real equipment load rating**.

## Assembly parts gallery

The **Assembly / Parts gallery** tabs above the viewport switch between the live build and a separate inspection scene. The gallery covers the wooden shed, brick house, sheet-metal shed, dome, and stand trial (and the smaller contact experiments). It reads the complete recipe, so unplaced and withdrawn parts remain inspectable. Fixed environmental ground is excluded. Gallery geometry is generated only on first opening after a reset. Browsing holds simulation time; returning resumes the previous playback state without rebuilding the world.

Each tile is one supplied part type, with a quantity. Identical geometry and material are grouped independently of placement; proper rotations can match inclined parts, while mirrored fittings remain distinct unless the solid is actually rotation-equivalent. Dimension changes greater than the 1 nm grouping precision remain distinct. Prefabricated stands remain one item, with a peak concurrent equipment count calculated from recipe withdrawals and a separate placement count. Their instance selector exposes the extension settings. Compound regions are detail geometry, not additional inventory items.

Select a tile or catalogue card for overall dimensions, material, mass, instance IDs, and dimension lines; focus it for orbit inspection. Search filters both the scene and cards. Gallery selection highlights matching installed parts in Assembly; selecting an installed part selects its catalogue group once the gallery has been opened. Dimensions are in millimetres (display rounded to 0.001 mm). Inclined panels are aligned to a face for useful thickness measurements. Compound regions expose their dimensions, local positions and rotations; convex solids expose full vertex/edge/face tables. No physics or construction recipe is modified by the gallery.

**Download part geometry (.json)** exports full-precision solid regions in millimetres, faces, material densities, quantities, and the original source specification in metres. This preserves hub cores, tabs, pads, panel cutouts, and other modeled details for a future CAD / CNC / 3D-print export. It is reference geometry, not a fabrication-ready toolpath or guaranteed printable mesh: contacting/overlapping regions still require boolean union and mesh validation, and unmodeled holes, hardware, fits and tolerances remain unspecified.

Validation: `npx vitest run tests/parts-catalog.test.ts` checks recipe coverage, repeated versus cut parts, pose-independent grouping, actual compound bounds, mixed density mass, reusable equipment peaks, true 6 mm dome panel thickness, settings changes, and full-precision hub export. The normal production build also type-checks the gallery.
