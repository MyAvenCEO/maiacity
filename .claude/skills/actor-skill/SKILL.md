---
name: actor-skill
description: The maiaCITY actor skill — whatever moves, in the Actors library (src/lib/actors, /app/actors): machines in their parts (a bone and a card per part, LifeTrac, Power Cube, BatteryPack and BatteryCube), combinable kits (powerCubeParts, forkliftParts, clickLockPieces), hydraulic rams, clips and poses, research from open CAD, versions behind an argument or frozen files, and the stand-in's face (MakeHuman CC0 head, blend shapes joy and friendly from measured expression units, catchlights that survive the distance). Use it whenever an actor, a rigged machine or the stand-in is built, upgraded, posed or given an expression. Part of asset-producer.
---

# Actors: what we learned rigging them

Whatever moves is an actor in `src/lib/actors`, shown in `/app/actors` (admin). How the rig works, the stand-in's
poses, the excavators, birds and animals are in `production-designer`'s `models.md` ("The actors"). This skill is
what the machines and the stand-in's head taught us since.

## Machines as actors

- Every part a mechanic would name is its own bone (`p.<id>`) with a card: the LifeTrac v25 has 135, the Power Cube
  VII 28. `rig()` records which part each group is, and the cast's `catalog` names them, so `/app/actors` can tap a
  part and show it alone, assembled or exploded, and play its assembly step by step.
- Build machines from the shared kit (`machineKit` in `src/lib/actors/parts.js`) and make them **combinable**: a
  machine is also a function that adds its parts to any other rig (`powerCubeParts(kit, { at, joints, assembly,
  step })`, `forkliftParts` and `forkliftPose`, `clickLockPieces()`), so the LifeTrac carries a Power Cube on its
  cradle and a goods pod carries four forklifts. Samuel wants every actor combinable.
- A hydraulic ram is two joints, the barrel and the rod, kept on the line between their two pins every frame
  (`excavator-rig.js`).
- A bigger machine is a different kind, never a smaller one scaled up.
- A move is a clip (`'pull out'`, `'service'`) and a held state is a pose (`'drawer out'`, `'pulled out'`), so the
  viewer and a game both play them.
- Research the real machine from its open CAD and bills of materials (Open Source Ecology's GitHub). Their wiki,
  YouTube and Dozuki are blocked by the cloud proxy (403); search extracts and GitHub work. Say which numbers are
  inferred (the ElectroCube's alternator).

## Versions

- Same as models: an actor's `HISTORY` in `src/lib/actors/index.ts`, the older builders frozen in files beside it
  (`human.v5.ts`, `pod.v4.js`, `excavator.v2.js`, `batterypack.v1.js`) or kept behind a version argument
  (`batteryPack(v)`, `batteryCube(v)`, `human(look, height, v)`). Each upgrade one step, one version.
- When a cube carries packs, each cube version names the pack version it carries (cube v8 = packs v7).

## The stand-in's face

- The head (`head.js`) is MakeHuman's CC0 base mesh for a man or a woman (`face`), written into `head.data.js` by
  `scripts/make-head.mjs` from a sparse clone (`--filter=blob:none`; never `git ls-tree -l` on it). It is smoothed once
  (`subdivide.js`); per-vertex values that must follow the smoothing (region marks, a second blend shape) ride it as
  extra channels, since the subdivision is linear.
- Expressions are blend shapes built from MakeHuman's expression units at weights, plus a cheek lift: `joy` (the
  smile, recipe `SMILES`) and from v9 `friendly` (recipe `FRIENDLY`). The lashes and the brows follow the skin's
  offsets at their roots, so they move with every shape.
- **Measure a unit before tuning by eye.** `eye-*-slit` drops the upper lid 2.3 mm and lifts the lower 0.5 mm (a
  squint, not a smile); `eye-*-opened-up` lifts both lids; `eyebrows-*-up` lifts the brows about 2.3 mm. A friendly
  gaze is slit 0.25 + opened-up 0.4 (only the lower lids rise) + brows 0.35. Two shapes at full together (`joy` and
  `friendly`) nearly close the eyes: say how far to ease one when the other is full.
- Details must survive the distance they are seen at: a 0.8 mm glint vanished at a medium close-up; the catchlight is
  1.8 mm on the pupil's edge (clear of the upper lid), on its own slightly emissive material (index 3) so it shows in
  shade and at night.
- Seen from afar (`lowDetail`), parts under 12 % of the largest are left off: eyes, glints, toes.
