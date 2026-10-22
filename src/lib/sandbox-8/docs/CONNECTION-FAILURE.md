# Roof connection failure

Both roofs now use finite timber grips and felt adhesive. A connection can lose individual fastening points and eventually separate, while every supplied part retains its identity and mass. Red dots follow failed attachment points; the inspector lists their failure mode, load estimate and time. Reset rebuilds the experiment.

This is an experimental loss-of-grip model, not calibrated timber fracture. Wood meshes do not split or shed chips. Steel does not yield, and masonry bonds remain unlimited. Therefore the model can demonstrate timber-side failure, but cannot establish that wood would always fail before every competing material in a real structure.

## Mechanical model

Each group uses separated points inset into the actual common face of its two parts. Each point is a zero-rest-length Rapier spring with stiffness and viscous damping. Spacing the points lets a moment load one edge more strongly than another. Contact stays enabled for bearing; spring-connected parts are not merged into the house's rigid collision groups.

After each fixed physics step, elastic demand is calculated from the current separation of the two local anchors: **F = k × displacement**. Its positive normal component is withdrawal; its tangential magnitude is shear. Compression does not count as withdrawal damage. A point fails when:

`sqrt((withdrawal / withdrawalCapacity)^2 + (shear / shearCapacity)^2) > 1`

The spring at that point is removed permanently. Remaining points and alternate connections keep carrying load. Complete separation requires loss of all relevant load paths; a single failed point does not imply that the whole part must fall. Gravity, collision and wind continue acting on loose material.

| Profile, per point | Stiffness, N/m | Damping, N·s/m | Withdrawal, N | Shear, N |
|---|---:|---:|---:|---:|
| Wood grip | 500,000 | 1,000 | 1,500 | 2,500 |
| Felt adhesive | 100,000 | 500 | 300 | 600 |

These are illustrative lab parameters, **not manufacturer capacities or design values**. The inset point layout is also illustrative, not a screw schedule. Felt bonds must be finite too: otherwise the covering would permanently tie detached boards into one raft.

The displayed demand is elastic spring force, not the solver's complete reaction force. Damping force is deliberately excluded from the failure criterion. Impact failure, fatigue, progressive crushing, splitting along grain, edge distance, moisture, screw diameter, penetration and installation quality are not calibrated. The USDA [Wood Handbook chapter on fastenings](https://research.fs.usda.gov/treesearch/62253) describes the material and fastening considerations that a later calibrated model would need. Engine constraints use [Rapier joints](https://rapier.rs/docs/user_guides/javascript/joints/).

## Scope and geometry

- Brick house: timber plate connections, timber-to-strap grips, firrings, deck and felt bonds are finite. Steel-to-masonry anchors and mortar remain ideal.
- Wooden shed: top frame onward uses finite grips; lower frame, walls and doorway shoe connections retain the earlier ideal model.
- Cross firrings are 20 mm shorter, leaving 10 mm at each end. This avoids a spurious deep collision response where tapered convex supports met exactly at an edge. Removed volume is reflected in both geometry and supplied mass.
- Wind remains sampled surface drag, without roof suction, internal pressure or turbulent airflow. A 300 m/s run is an extreme numerical experiment, not a validated storm prediction.

Assembly and manual release remain laboratory interventions. Automatic construction stops after damage; the simulation continues. Exports record active groups, point capacities and anchor locations, failed groups, and per-point failure events. They do not provide a full solver checkpoint.

## Proofs

`tests/fasteners.test.ts` checks a modest axial load against its independently specified applied force, overload withdrawal at two timesteps, isolated shear, moment loading, uniform free fall, irreversible failure and unchanged material mass.

`tests/roof-failure.test.ts` checks both buildings at 1/120 s and 1/240 s. Each cold-assembled roof remains intact under gravity, transfers weight to ground and survives a brief 10 m/s trial. A subsequent 300 m/s trial breaks timber grips and multiple complete groups, produces physical anchor separation, preserves all body handles and masses, and keeps positions finite. These checks establish the declared behavior, not a converged physical wind threshold or identical fracture sequence across timesteps.

The existing shed, brick-house and building-wind tests explicitly select `breakableRoof = false` to retain the unlimited reference experiment. The browser and both staged measurement scripts use the new default finite model. The current staged measurements complete without failures: shed mass 1,543.8725 kg and house mass 10,354.0318 kg; their mean ground reactions agree with weight to within 0.02 N.

Implementation: [fasteners.ts](src/fasteners.ts), [shed.ts](src/shed.ts). Staged records: [shed](shed-measurements.json), [brick house](brick-house-measurements.json).

On 12 October 2026, all 63 tests passed and the production build succeeded. Browser verification completed the 466-part house without damage, then applied 36 steps of 300 m/s wind: 191 points failed and 45 groups fully separated. The first recorded failure was timber grip in shear at the front/left plate joint. Separate roof pieces and red failure markers were visible, and the export retained all 467 bodies including ground. These counts describe that particular run, not universal failure thresholds.
