# Building a wooden shed in the sandbox

The second experiment builds a rectangular shed from **72 individual timber parts, two steel post shoes and one roofing-felt sheet** in the same world as the original contact experiments: bottom frame, boarded floor, framed and boarded walls with an open doorway, top frame, and a rectangular boarded roof falling 5° toward the back, covered with felt. **141 explicitly installed connection groups** connect the parts. Only the ground is fixed.

This is a staged assembly experiment with breakable roof connections and ideal lower-frame connections. Placement is an external laboratory action; workers, tools, screw installation and material delivery are not simulated yet. Roof timber grips and felt adhesive have experimental finite capacities; other joints retain unlimited strength. See [connection failure](CONNECTION-FAILURE.md). A standing shed here is not evidence that the represented timber and fasteners would make a safe real building.

## Try it

Run `npm run dev` in the lab directory and open the printed URL. Select **10 / Build a wooden shed**; the brick house opens initially.

- **Place next part** adds exactly one supplied part and its specified connections, preserving existing bodies and simulation time.
- **Build next stage** places that stage's remaining parts one at a time, then stops assembly. Physics continues so the stage can settle.
- **Build whole shed** proceeds through every stage, placing a part every 0.4 simulation seconds. **Stop assembly** stops further placement.
- **Pause**, **Run**, **Step** and speed control physical time. Pausing also pauses automatic construction.
- **Show remaining plan** displays unbuilt parts as wireframes without mass or collisions. The next part has a brighter outline.
- **Show framing only** hides floor, wall and roof boards and felt visually; tapered roof supports remain visible. Their bodies and loads remain in the simulation.
- Select a part to inspect its state, contacts and installed connections. **Release selected part** removes its incident joints without removing material. Contact may still support it. Reset before continuing construction after release.
- **Reset** starts again with just the ground. The nine earlier contact presets remain available.

The doorway is open; there is no hinged door. Each doorway post now sits in a separate steel shoe mounted directly on the front bottom rail through a floor cutout. There is no post-to-floor joint. Screw and bolt groups are still rigid approximations; physical fastener strength and installation are not simulated.

The roof has a separate continuous felt covering. Its geometry directs the downhill component of gravity toward the back, away from the doorway. Water impermeability is a declared material assumption; rain, runoff, leakage and edge dripping are not simulated.

## Construction recipe

| Stage | New parts | Total parts | Total connection groups | Total mass |
|---|---|---:|---:|---:|
| Bottom frame | Four perimeter rails and three floor joists | 7 | 6 | 180.79 kg |
| Floor | Eight boards | 15 | 22 | 349.29 kg |
| Wall frame | Four corner posts, two steel shoes, two doorway posts and a header | 24 | 36 | 476.45 kg |
| Wall boards | Five horizontal courses around the sides, back and doorway sides, plus one board above the opening | 50 | 87 | 1,002.46 kg |
| Top frame | Four perimeter rails and three roof joists | 57 | 104 | 1,167.88 kg |
| Roof supports | Seven tapered firrings on the level top frame and joists | 64 | 111 | 1,302.09 kg |
| Roof boards | Ten pitched boards with an overhang | 74 | 131 | 1,508.93 kg |
| Roofing felt | One continuous 4 mm sheet | 75 | 141 | 1,543.87 kg |

The bottom footprint is 3.0 × 2.4 m. The floor is 0.19 m above ground, corner posts extend 2.39 m from ground level and doorway posts extend 2.234 m from their shoe plates at 0.156 m above ground, and the finished roof rises from approximately 2.59 m at the rear edge to 2.82 m at the doorway edge. The roof surface measures 3.24 × 2.696 m, with approximately 235 mm fall over its depth. Timber uses the existing illustrative density of 600 kg/m³. Exact dimensions and connection targets are in [src/shed.ts](src/shed.ts).

Every connection target is explicitly named in the recipe and touches the new part. Proximity does not install a joint. The bottom frame rests on ground contacts. Floor boards connect to the side rails, with additional contact support from joists. Roof boards connect to the tapered side firrings, with additional contact support from the cross firrings. Corner posts connect to both adjoining bottom rails; doorway posts connect to their shoes, which connect to the front bottom rail. Cladding connects to posts and the upper frame to uprights.

Placement supplies a part at its intended relative pose and installs its joints in one laboratory operation before the next physics step. It does not leave the part floating between placement and fastening. There is no simulated route from a stockpile, lifting equipment, or fastening duration. Placement follows the current bottom rail's coordinate frame without repositioning existing parts.

Each event records the tick, supplied part, incoming mass and new connections. Supplied mass is checked against movable mass. Fasteners have no separate mass or inventory yet. Released joints are recorded, and their parts remain in the world.

## Open corners and post fit

The first four placements are independent perimeter rails resting on the ground. Adjacent rails meet only along their inner vertical edges; they have no direct corner joints. Each outer corner leaves a 120 × 120 mm square opening. Side rails are 2.16 m long and front/back rails are 2.76 m long, all with a 120 × 150 mm section.

A corner post has a matching 120 × 120 mm section and extends to ground level through the opening. The two adjoining rail ends touch two perpendicular post faces over the full rail height. Its connections target those two rails, rather than a floor board. The inspector identifies these connections as post-to-rail screw groups with rigid approximation.

The two end floor boards have corner cutouts so they cannot block the posts. Each remains one physical part: the back board uses three non-overlapping cuboids; the front board uses six to include the two additional shoe cutouts. Rendering uses the same shape; mass and inertia come from the remaining material. These are supplied pre-notched boards, not a simulated cutting operation, so removed material is not silently created or discarded inside the experiment. The cladding and doorway alignment follow the revised corner-post faces without overlap.

At 15 placed parts the next upright is still a wireframe preview. Once placed, the two screw groups use fixed constraints that restrain translation and rotation. This revision establishes the fit and attachment surfaces. Screw counts, dimensions, pullout/shear limits, installation work and temporary handling are not yet represented, so the revised geometry still does not prove a realistic erection sequence or connection strength.

## Doorway post shoes

After the four corner posts, placement 20 supplies and fastens the left steel shoe to the front bottom rail. Placement 21 seats and attaches the left doorway post. Placements 22 and 23 repeat this on the right; placement 24 installs the header. This replaces the previous unexplained post-to-floor restraint.

Each U-shaped shoe is one dynamic compound body: a 112 × 120 × 6 mm base plate and two 6 mm thick, 294 mm tall side plates, with 100 mm clear space between them for the post. The base bears on the rail at Y = 0.15 m. Two 112 mm wide open-front cutouts in floor board 8 expose these mounting surfaces. The post rests on the plate at Y = 0.156 m; its top remains at Y = 2.39 m. Steel uses an illustrative density of 7,850 kg/m³, giving 3.9564 kg per shoe. The extra post length and removed floor volume are included in the material ledger.

The connection graph is **post → shoe → front bottom rail → ground contact**. The shoe-to-rail connection represents a screw group; the post-to-shoe connection represents a bolt group on a vertical side plate. Compound-shape attachment points are chosen on actual touching material, never in the shoe's empty bounding-box space. The inspector identifies both connection types and permits their removal.

The bracket geometry, bearing surfaces, separate material and connection path are explicit. Fastener quantities, holes, separate fastener bodies/mass, bolt preload, withdrawal/shear capacity, steel yielding and temporary handling during installation remain unmodeled. The bolt and screw groups still use ideal fixed constraints with unlimited strength. This revision proves fit and assembly behavior, not that this illustrative shoe is a rated moment-resisting connection or a safe erection method.

## Pitched roof and covering

Front is +Z (the doorway); back is −Z. The illustrative 5° pitch is a sandbox parameter, not a manufacturer-specific roof specification. The existing horizontal top frame is retained. Seven supplied tapered timber pieces, called firrings, sit on its four perimeter rails and three joists. Their flat bottoms bear on the level frame; their top faces share the roof's inclined plane. The long side firrings taper from 20 mm at the back to approximately 225 mm at the front. No roof member is held across an unexplained gap.

Firrings use actual convex hulls for both rendering and collisions. Their mass is calculated from the tapered volume rather than their bounding boxes; Rapier derives their center of mass and inertia. Pitched boards and felt retain their authored orientations during placement and simulation. Connection anchors are on touching surfaces and expressed in each part's local coordinates.

Ten 40 mm boards form the deck with 4 mm gaps. The final stage supplies a single 4 mm felt sheet covering the deck and every gap. Its illustrative density is 1,000 kg/m³, or 4 kg/m², giving 34.94 kg. It is a separate dynamic body with ten breakable adhesive groups to the boards. Releasing these bonds preserves the sheet and its mass.

The sheet is represented as rigid, continuous and impermeable by declaration. This verifies coverage, placement and material accounting, not waterproof performance. Flexibility, calibrated adhesive behavior, seams, laps, edge terminations, punctures, wind uplift, weathering and water flow remain unmodeled. There is no gutter. These limitations also mean the model cannot yet prove that real drops detach at the back edge or that the whole building is weather-tight.

## Connection and solver model

The roof uses [compliant, breakable fastening points](CONNECTION-FAILURE.md). Cross firrings have 10 mm end clearances to avoid degenerate convex edge contact. Roof contacts remain active for bearing. The lower frame still uses Rapier fixed impulse joints that restrain relative translation and rotation. They transfer force and torque but do not model calibrated screws, nails or brackets. Collisions are disabled between each directly joined pair to avoid redundant contact constraints there; other contacts remain physical. Removing the joint restores the pair's normal collision behavior. [Rapier joint documentation](https://rapier.rs/docs/user_guides/javascript/joints/).

The shed uses a 1/120 s timestep, **8 solver iterations and 12 internal PGS iterations**. Earlier contact scenarios retain their original settings. Increasing the work done inside each constraint iteration resolved assembly instability found under different placement timings and timestep sizes. Appearance alone was insufficient to choose the settings.

Declared acceptance limits are joint-anchor separation below 15 mm, settled part-height error below 20 mm, settled linear speed below 0.04 m/s, and ground penetration below 5 mm at stage checkpoints. These bound this experiment rather than establishing structural engineering accuracy.

## Verification and results

The earlier rigid-reference revision passed 37 checks: 22 original contact checks and fifteen shed checks. These shed checks now explicitly select the unlimited reference model; separate roof-failure tests exercise the default finite model at both timesteps. The added checks cover the unjoined inner-edge rail contacts, exact corner sockets, post-to-rail targets, and the notched boards’ clearance and material accounting. Doorway checks cover shoe-before-post ordering, rail bearing, side-plate attachment, floor clearance, steel mass and tipping after unbolting while the shoe remains attached. Roof checks additionally cover bearing-face alignment, rearward geometric fall, preservation of pitch after settling, felt coverage over the entire deck and gaps, sheet mass and bonds, and falling after release and a lateral test impulse. TypeScript checking and the production build passed.

The shed checks cover dependency order, touching joint surfaces, non-overlapping geometry, a clear doorway, and stability of all stages at both 1/120 s and 1/240 s. Existing part handles survive insertion, supplied mass accounts for all material, and all supplied materials remain dynamic. Final ground reaction must agree with weight within 3%.

An isolated joint test shows that connected parts can fall together: a joint does not anchor them in space. Releasing a joint permits separation. A released wall plank keeps its mass and can fall after an explicitly applied outward test impulse clears the plank below. Disconnection alone need not cause falling when valid contact support remains.

Stage scheduling stops at its boundary and operates on simulation ticks. Repeated schedules reproduce the state. Uninterrupted, rapid manual and varied-pause assembly sequences are also checked for final stability.

The current staged run, with finite roof grips and no failures, produced:

| Measurement | Result |
|---|---:|
| Final movable mass | 1,543.8725 kg |
| Calculated weight | 15,145.3888 N |
| Mean ground reaction after completion | 15,145.3799 N |
| Largest group-anchor separation at final stage | 0.4181 mm |
| Largest part speed at final stage | 0.00538 m/s |

Run `npm test` for all checks and `npm run measure:shed` to regenerate [shed-measurements.json](shed-measurements.json). The measurement file includes the recipe, per-stage results, placement events, connection records and body states. Browser JSON exports also include the construction plan and solver settings. These results apply to this recipe, tested timings and runtime; they do not prove stability for arbitrary structures or loads.

## Next physical question

The doorway-post shoes now provide explicit physical attachment geometry. A useful next experiment is to hold a part in a temporary fixture while installing a connection, then release the fixture. Roof grip compliance and finite strength now have an isolated proof. Extending calibrated strength to the lower frame, installation effort, bracing, timber bending and human handling still needs further models and checks.

## Wind experiment

The **Wind** controls below the experiment list enable a steady horizontal wind, set any finite non-negative speed in m/s (no configured upper limit), and choose the side it blows **from**. “Doorway → back” pushes toward −Z; “Left → right” pushes toward +X. Cyan arrows show the airflow direction. Run or Step advances its physical effects; changing a setting while paused previews the load without advancing time. Reset turns wind off. Wind works in the original contact experiments too.

The inspector reports the selected part's wind force, torque about its center of mass, and exposed/sheltered projected areas. The sidebar reports the magnitude of the total force on movable parts. Measurements reflect the last wind evaluation. JSON exports include the model parameters, settings changes with simulation ticks, and per-part loads.

The approximation uses **F = ½ ρ Cd A v²**, with illustrative air density 1.225 kg/m³ and a uniform drag coefficient of 1.2. Velocity is relative to each moving surface point, including angular motion. The drag-equation form follows [NASA Glenn's explanation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/); our coefficient and sheltering approximation are not calibrated building aerodynamics.

Each cuboid or tapered convex piece has four sample points on each face. Windward samples contribute their projected area. A 100 m upstream ray checks actual colliders, including other pieces of the same compound body; blocked samples contribute no load. New parts and moved blockers affect shelter immediately. Wireframe plans do not block wind; visually hiding boards does not remove their shelter or load. The four samples per face are deliberately coarse: narrow gaps, small obstructions and partial shadows can be missed or overrepresented.

Forces are applied at their surface points as impulses F × timestep before each physics step, allowing both translation and torque. Disabling wind stops further wind impulses without deleting velocity or resetting parts. Existing external forces remain untouched. Air is an external momentum/energy source, not a conserved mass of simulated gas.

This models steady drag and approximate geometric shelter. There is no resolved airflow, gusting, turbulence, wake recovery, pressure inside the building, roof suction/lift, aeroelasticity or weather-driven damage. Roof grips and felt bonds can now fail under wind; lower-frame ideal connections still cannot. A surviving shed is therefore not evidence of real storm resistance.

Nine wind checks supplement the 37 earlier checks: analytic panel load and speed/area scaling, orientation and relative velocity, moving blockers and asymmetric torque, compound self-sheltering, disabling wind, timestep refinement and render-cadence replay, an unbolted post falling in the open shoe direction, side-plate restraint in the other direction, and loading/shelter/mass preservation on the completed shed. Run `npm test` for all checks.
