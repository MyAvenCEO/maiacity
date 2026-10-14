---
name: actor-skill
description: The maiaCITY actor skill — people and animals rigged to move, in the Actors library (src/lib/actors, /app/actors): the stand-in a shot is blocked with and the animals of the worlds (chickens, rabbits, geese, goats, sheep, frogs, bees, ants, songbirds, fish), where an actor lives (a species on a body plan, a cast line, skins meshed off the page, crowds), clips and poses, how it composes (shared body plans, things in hands, actors placed in machines, buildings and worlds by ref), versions behind an argument or frozen files, the stand-in's face (always friendly with a slight sparkle; MakeHuman CC0 head, blend shapes joy and friendly from measured expression units, catchlights that survive the distance), checking and the lessons kept. Use it whenever a person or an animal is built, upgraded, posed or given an expression. Machines are machine-skill's (our notes in its ours.md). Part of asset-producer.
---

# Actors: people and animals

The Actors are the people and animals rigged to move, in `src/lib/actors`, shown in `/app/actors` (admin): the
stand-in a shot is blocked with, and the animals of the worlds kind by kind. The older machines are rigged the same
way in the same folder, but listed apart in `/app/machines` (`machine-skill`, our notes in its `ours.md`). The laws,
the shared core (refs, one version control) and how we check are the `asset-producer`'s; how the rig works, the
stand-in's poses, birds and animals are in `production-designer`'s `models.md` ("The actors"). This is what the
people and animals taught us since.

## Where it lives

- A kind in `LIST` in `src/lib/actors/index.ts` (`{ id, label, note, from, variants }`) with its `HISTORY` there: the
  stand-in, or an animal's breeds and coats, each a line `animal(id, label, note)`.
- An animal is its species (`./species/`: `goat.ts`, `goose.ts`, `songbird.js` …) on its body plan (`./plans/`:
  `quadruped.ts`, `bird.ts`) and a line in `./casts.ts`, which is what a world asks for and what the gallery lists.
- Its ref: `actors/<id>@<v>`, a variant after a colon.

## How it is built

- Its skin takes too long to mesh in a frame, so it is meshed in workers off the page (`./build.ts`, `prepare(id)`,
  the variant's `ready`); a film waits for every skin it asks for (`settled`).
- A move is a clip (`walk`, `graze`, `wave`) and a held state is a pose (`sit`, `kneel`); the gallery and a game play
  the same ones. The stand-in's joints can be turned by hand in the gallery and the pose copied out as data.
- Many of one kind are a crowd (`./crowd.ts`): the nearest rigged, the rest instances at rest in coarser shapes,
  chosen from the eye alone so a shot draws the same frame every time (`world-skill`).

## The stand-in's face

- **Every face is friendly, all the time.** Samuel (2026-10-14): "all the faces should be way more friendlier (not full
  smile but friendly gazes, with a slight sparkling eyes not the full smiling sparkle but a slightly sparkle) all the
  time". So every person, in every shot, game and gallery, wears the `friendly` shape and the catchlight by default:
  lower lids a little up, brows a little raised, a small glint in each eye. Never a full smile (`joy`) as the resting
  face, never a blank or stern one, never the full smiling sparkle; `joy` is only for a moment the story asks for.
  A new head, a new version or a new kind of person starts friendly; an animal with a face gets the same soft, bright
  eyes.
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

## Composable

- A body plan is the piece every species on it shares (`quadruped.ts`, `bird.ts`): a goat, a sheep and a rabbit are
  the same legs, spine and gait with their own measures. A new animal starts from a plan, never a copy of one.
- What goes into an actor: what it holds or wears comes from the Things (a jerrycan, a backpack, a plant stake), put
  in a hand's or the back's bone, never drawn into the body.
- What an actor goes into: a machine's seat or cab, a building's rooms, a world's crowds. A host names it by its ref
  (`actors/stand-in@9`) so a film keeps the person as they were cast. Samuel wants actors combinable (first said
  when the forklift went into the goods pod's rig, 2026-10-07; every asset since 2026-10-14).

## Versions

- The older builders frozen in files beside the live one (`human.v5.ts`, `plans/quadruped.v1.ts`, `plans/bird.v1.ts`)
  or kept behind a version argument (`human(look, height, v)`). Each upgrade one step, one version; fingerprint the
  old ones (the stand-in v6 man is not deterministic between calls, its other versions are).
- A body plan's change is a version of every kind on it (the grazing fix took goats, sheep and rabbits to v2 at once).


## Checking

Headless Chromium (swiftshader) draws nothing of a skinned actor in the gallery's live turntable: shoot a person or an
animal from a throwaway route that renders once (asset-producer's `checking.md`), at the distance it is seen at, by
day, in shade and at night. A face at a medium close-up, so the friendly gaze and the glint read. The versions test
and the type check.

## Lessons kept

- A face tuned by eye drifted into a squint: measure each expression unit first (above).
- A detail smaller than the distance can carry vanishes (the 0.8 mm glint): size it for the shot.
- Two full blend shapes together close the eyes: say how far to ease one when the other is full.
