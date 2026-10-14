# Our machines: how a machine joins maiaCITY

This file is ours, not AirSup's. `SKILL.md` and `references/` beside it stay AirSup's text word for word (`SOURCE.md`),
but for the one section at the end of `SKILL.md` that says where our library keeps a machine. They make one machine as
a standalone page or a film; this is what building machines into our own library taught us: the excavators, the pod
and its forklift, the LifeTrac and its Power Cube, the ElectroCube, the BatteryCube and the BatteryPack, the Power
Cube v3 (the first built with AirSup's own kit inside the app). The laws, the shared
core (`$lib/assets`, refs, one version control) and how we check are the asset producer's (`asset-producer`); this
file has the same shape as every other sub skill.

## Where it lives

- Listed in `src/lib/machines/index.js` (`MACHINES`): a kind in `LIST` (`{ id, label, note, from, variants }`) and
  its versions in `HISTORY`, shown in `/app/machines` (admin) on the turntable it shares with the actors
  (`src/lib/app/ActorsView.svelte`). A machine never also goes into the Things (`thing-skill`).
- **A new machine, or a new version built from scratch:** `src/lib/machines/<machine>.js`, built at AirSup's realism
  with `$lib/assets`. Its variant's `make` hands the turntable `castOf(root)` (`$lib/assets/parts.js`), and the
  turntable shows it on the asset stage: running, its hero number read out, its sliders, "How it is computed", and
  Explode, Cut away, X-ray, Labels, Slow and its break on the bar.
- **The older machines** are rigged meshes in `src/lib/actors/*.js` (`rig.ts`, flat vertex colours, a bone per part),
  where the games import them from (`$lib/actors/batterypack.js`). They stay as they are, frozen; how their rig works
  is in `production-designer`'s `models.md` ("The actors").
- Its real size in `REAL_SIZES` (`src/lib/models/units.js`) and the `BUILD` map of `src/lib/models/sizes.test.js`:
  a new machine's root as built (its moving parts placed by its first `tick`), an old rigged one at rest (`still(...)`).
- Its ref: `machines/<id>@<v>`, a variant after a colon (`machines/powercube@1:powercube-electric`).

## How it is built

### Research first

- AirSup's step 1 (`SKILL.md`) is the checklist: dimensions, parts with materials, 3 to 6 equations with real
  constants, the one number a viewer cares about, the input, what breaks. Its solvers (`references/solvers.md`) are
  the ones to port.
- Research the real machine from its open CAD and bills of materials (Open Source Ecology's GitHub). Their wiki,
  YouTube and Dozuki are blocked by the cloud proxy (403); search extracts and GitHub work. Say which numbers are
  inferred.
- Never name the brand or startup that inspired a machine, nor an engine's maker.

### The Power Cube v3 pattern (`src/lib/machines/powercube.js`)

- The file opens with AirSup's step 1 as its research comment: the machine's measures, its parts and materials, the
  equations, the one number, the input, the break, and every inferred value said so (`[inferred]` on its card too).
- One `materials()` palette from `MAT` presets: cast aluminium fins, cast-iron liners, forged crank and rods,
  zinc-plated steel, braided hose, copper and aluminium, oil and petrol as fluids, natural polyethylene that shows the
  petrol's level.
- Every part a mechanic would name, real solids with their insides (hollow tubes, a liner in its fins, the gears in
  their housing, the oil in the tank), so the cut shows them. Thin parts light (`plate`, `slab`: no bevels): the cube
  is about 180,000 triangles.
- Moving parts in groups at their pivots, set in `onTick` from the solver: the crank, the flywheel and the coupling
  turn, the pistons slide on slider-crank kinematics, the pump's gears mesh, the gauge's needle and the throttle follow.
- `solver(ctl)`: its state, `step(dt, env)` in fixed substeps, named constants, the sliders as `lab.controls`
  (`{ label, min, max, value, step, unit, ends }`), the hero (`lab.hero`, `lab.read`), `lab.how` (plain words and the
  equations), `lab.breakIt` (decided by the solver: dead-headed with the relief stuck, the engine stalls),
  `lab.cut` (the planes' normals at what is cut away, and where they sweep from). Show slow things faster and fast
  things slower, and say so (heat 20×, the engine 40× slowed).
- The oil's paths as `Flow` streaks, coloured by its temperature, shown when cut or x-rayed.

## Composable

- Samuel (2026-10-14): every asset composable, the parts and moving pieces of one reusable in the others; things go
  into machines, machines into factories and buildings, everything into worlds and biomes.
- **Whole:** a machine built with the kit carries another sealed asset with `kit.carry(guest, { at, prefix, assembly,
  step, explode })`: its parts (ids under the prefix), labels, x-ray shells and solver become the host's, so the
  host's explode, x-ray, cut and break reach into it (a Power Cube v3 in a vehicle's bed, its engine running).
- **A piece:** what several machines share is one builder in one file, each machine with its own measures (a road
  vehicle's wheels, doors and load bed, shared by every vehicle). The older
  rigged machines do it by functions that add their parts to another rig (`powerCubeParts(kit, { at, joints,
  assembly, step })`, `forkliftParts`, `clickLockPieces()`): the LifeTrac carries a Power Cube, a goods pod four
  forklifts.
- **By ref:** a building, a factory or a world names a machine at its version (`machines/powercube@3`) and builds it
  through `assetAt`.
- A hydraulic ram is two joints, the barrel and the rod, kept on the line between their two pins every frame
  (`excavator-rig.js`). A bigger machine is a different kind, never a smaller one scaled up.

## Versions

- A kind's `HISTORY` in `src/lib/machines/index.js`; every version but the latest has its own frozen `build` (the
  older builders in files beside the live one, `pod.v4.js`, `batterypack.v1.js`, or behind a version argument,
  `batteryPack(v)`; the Power Cube's v1 and v2 are `$lib/actors/powercube.js`). Each upgrade one step, one version;
  fingerprint the old ones.
- When a machine carries another, each of its versions names the version it carries (cube v8 = packs v7).
- A machine that was a Thing starts at v1 in the Machines; the Thing stays as it was for the games that use it
  (the V1 travel van and pickup).

## Checking

- Headless first: a throwaway Bun script inside the repo builds it, ticks it once, steps its solver through slider
  settings and the break, and prints the hero's reading, the labels' values and its outer box.
- Then the real page as a mocked admin (asset-producer's `checking.md`): the whole, every mode, a close cut, the back
  and the break, like a critic.
- The size test, the versions test and the type check.

## Lessons kept

- Moving parts placed only by the solver sit at their origin until the first tick: tick once after `seal`.
- On a slow renderer the modes and the build must run by the wall clock, or they never finish.
- A ghost or cut clone needs the original's clipping planes.

## From an AirSup page to our library

A machine made with AirSup's skill is one HTML file. When the same machine must live in `/app/machines` or a game,
port it into `src/lib/machines/<machine>.js` with `$lib/assets`: its parts through `part(...)` with the same measures
and cards, its solver and its lab as they were, its root at real size; then a kind in the machines' `LIST`, a frozen
version, the size test, the versions test.
