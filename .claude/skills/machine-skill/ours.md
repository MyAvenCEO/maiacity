# Our machines: how a machine joins maiaCITY

This file is ours, not AirSup's. `SKILL.md` and `references/` beside it stay AirSup's text word for word (`SOURCE.md`).
They make one machine as a standalone page or a film; this is what building machines into our own library taught us:
the excavators, the pod and its forklift, the LifeTrac and its Power Cube, the ElectroCube, the BatteryCube and the
BatteryPack. The laws over both are the asset producer's (`asset-producer`).

## Where a machine lives

- Listed in `src/lib/machines/index.js` (`MACHINES`): a kind in `LIST` (`{ id, label, note, from, variants }`) and
  its versions in `HISTORY`, shown in `/app/machines` (admin) on the turntable it shares with the actors
  (`src/lib/app/ActorsView.svelte`).
- Built in `src/lib/actors/*.js`, beside the people and animals: a machine is rigged the same way (`rig.ts`), and the
  games import its builder from there (`$lib/actors/batterypack.js`). A new machine is a builder there and a kind in
  the machines' `LIST`; it never also goes into the Things (`thing-skill`).
- How the rig works, and the excavators' (`excavator-rig.js`), are in `production-designer`'s `models.md` ("The
  actors").
- Its real size in `REAL_SIZES` (`src/lib/models/units.js`) and the `BUILD` map of `src/lib/models/sizes.test.js`,
  at rest (`still(...)`), like the cubes and the pack.

## Built in its parts

- Every part a mechanic would name is its own bone (`p.<id>`) with a card: the LifeTrac v25 has 135, the Power Cube
  VII 28. `rig()` records which part each group is, and the cast's `catalog` names them, so `/app/machines` can tap a
  part and show it alone, assembled or exploded, and play its assembly step by step.
- Build from the shared kit (`machineKit` in `src/lib/actors/parts.js`) and make every machine **combinable**: it is
  also a function that adds its parts to any other rig (`powerCubeParts(kit, { at, joints, assembly, step })`,
  `forkliftParts` and `forkliftPose`, `clickLockPieces()`), so the LifeTrac carries a Power Cube on its cradle and a
  goods pod carries four forklifts. Samuel wants actors combinable (said when the forklift went into the goods pod,
  2026-10-07), and every machine is built so.
- A hydraulic ram is two joints, the barrel and the rod, kept on the line between their two pins every frame
  (`excavator-rig.js`).
- A bigger machine is a different kind, never a smaller one scaled up.
- A move is a clip (`'pull out'`, `'service'`) and a held state is a pose (`'drawer out'`, `'pulled out'`), so the
  viewer and a game both play them.

## Versions

- A kind's `HISTORY` in `src/lib/machines/index.js`, the older builders frozen in files beside the live one
  (`pod.v4.js`, `excavator.v2.js`, `batterypack.v1.js`) or kept behind a version argument (`batteryPack(v)`,
  `batteryCube(v)`). Each upgrade one step, one version; fingerprint the old ones (`asset-producer`'s `checking.md`).
- When a machine carries another, each of its versions names the version it carries (cube v8 = packs v7).

## Research

- Research the real machine from its open CAD and bills of materials (Open Source Ecology's GitHub). Their wiki,
  YouTube and Dozuki are blocked by the cloud proxy (403); search extracts and GitHub work. Say which numbers are
  inferred (the ElectroCube's alternator).
- AirSup's step 1 (`SKILL.md`) is the checklist: dimensions, parts with materials, 3 to 6 equations with real
  constants, the one number a viewer cares about, what breaks. Its solvers (`references/solvers.md`) are the ones to
  port when a machine of ours must show real numbers.

## From an AirSup page to our library

A machine made with AirSup's skill is one HTML file. When the same machine must live in `/app/machines` or a game,
port its parts and its solver into a builder in `src/lib/actors/` with the same measures and equations, give it a
kind in the machines' `LIST`, and follow the laws: real size without a scale, its parts as bones with cards, a
frozen version, the size test.
