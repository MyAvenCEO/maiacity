# Our factories: how a factory joins maiaCITY

This file is ours, not AirSup's. `SKILL.md` and `references/` beside it stay AirSup's text word for word (`SOURCE.md`),
but for the one section at the end of `SKILL.md` that says where our library keeps a factory. They make one factory
as a standalone page or a film; this is what building the first factory into our own library taught us: the
BatteryPack line (2026-10-15), a line that builds our BatteryPack, 120 a day on two shifts, every station standing
in AirSup's kit machines until our own are built. The laws, the shared core (`$lib/assets`, refs, one version
control) and how we check are the asset producer's (`asset-producer`); this file has the same shape as every other
sub skill.

## Where it lives

- Listed in `src/lib/factories/index.js` (`FACTORIES`): a kind in `LIST` (`{ id, label, note, from, builds, build }`,
  `builds` the ref of the product, `build()` its spec) and its versions in `HISTORY`, shown in `/app/factories`
  (admin, full screen, the nav pill over it; `?factory=<id>` once there is more than one). Its ref:
  `factories/<id>@<v>`; `objectAt` throws for it, as for a biome: a factory is its spec, not an object.
- **The spec:** `src/lib/factories/<factory>.js`, a JS module exporting `SPEC` as AirSup's runtime reads it
  (`SKILL.md` "Spec": product, demand, calendar, sizing, release, stations, stages, look), plus what is ours on it:
  `standIn` on a station that runs on a kit machine, a `stages.x = { shape: 'asset', ref }` for a stage drawn as one
  of our assets, and one exported constant for the product's ref (`PACK_REF = 'machines/batterypack@9'`). The file
  opens with AirSup's workflow 1 and 2 as its research comment: the assumptions (volume, shifts, what is bought in),
  the route and where every cycle time comes from.
- **The runtime**, AirSup's, ported into `src/lib/factories/` (MIT notice kept at the head of each): `des.js` the
  engine, pure, the same equations (`plan`, `Sim`, `forecast`, the seeded RNG), `kit.js` the kit machines and
  products, `world.js` the hall, `look.js` the lens, `app.js` the page (`boot(spec, host, { assets })` instead of
  AirSup's `FactorySkill.define`, and `dispose()` for leaving the page), `hud.css` its HUD scoped to the host
  (`.fs-root`, `fixed` turned `absolute`, the foot above the nav pill by `--nav-room`). `three.js` gathers the app's
  three (`^0.186`) and the add-ons AirSup's vendored bundle put on `THREE` (EffectComposer, GTAO, bloom, Output,
  RoomEnvironment, OrbitControls, RoundedBoxGeometry, BufferGeometryUtils) under one `T`. `assets.js` turns one of
  our assets into a token (`tokenOf(ref)`).
- The tools' output stays out of the repository: `spec.js` for AirSup's scripts (generated from the module, the stage
  shapes mapped to their kit's), `check.mjs`'s text and JSON, the built page and the shots in
  `/mnt/project-files/factories/<factory>/`.

## How it is built

### Research first: AirSup's workflow 1 to 3

- Say the assumptions before any number: the volume (120 packs a day = 30 BatteryCubes), the shifts (2 × 8 h,
  57,600 s a day, takt 480 s), what is bought in (cells in trays, shells, drawer plates, holders, copper plates,
  bare BMS boards), and what the simulation does not model (the pack's parts beyond the three flows: cells, drawers,
  BMS boards). The spec's header says them; the HUD can only be as honest as that list.
- Cycle times from the product, not from a table: the pack has 280 cells, so sorting is 280 × 0.8 s and loading
  280 × 1.2 s; the EOL test is the charge-discharge step; the SMT line is a board's reflow pitch. Every station's
  `note` says where its number comes from and ends with its stand-in. Breakdowns and yields only where the real
  station has them (testers and robots fail, benches do not; a 3 % board scrap at flash, 1.5 % at EOL).
- Two branches join the main line with `after: [...]` (the drawer joins at the loading robot, the BMS at its
  fitting); the tree ends in one sink, the last station's stage is the finished product.
- Read `check.mjs` like an engineer before building any page: the sizing rule per station, the bottleneck and why
  (busy + down 100 %, the stations before it blocked, those after it starved), the forecast against the target, the
  scrap. The loading robot is sized at a need of 0.87 of one machine, so it is the constraint by design at 165 a
  day; a second robot (`servers: 2` on it) gives 188 a day and the constraint moves to the plate-and-clamp bench
  (300 s, 192 a day); a second drawer bench on top changes nothing. Say so in the report.

### Stand-ins

- Samuel (2026-10-15): the whole line first, every station on AirSup's kit machine (`machine: 'tester' | 'bench' |
  'robot' | 'smt' | 'packer'`), each later rebuilt as our own Machine. The station says so: `standIn: { kit, for,
  label }` with `for` the ref our machine will have (`machines/cell-sorter`), and the inspector shows "Stands here:
  AirSup's tester, standing in for our Cell sorter (not built yet)". Nothing else pretends.
- When a stand-in is replaced: build the machine first (`machine-skill`, its `ours.md`), then name it at the station
  by its ref and draw it there; the spec's numbers do not change for it, only its cycle time if the machine's solver
  says so (one version).

### The product on the line

- The tokens on the belts, in the machines and on the pallets are one `InstancedMesh` per stage (AirSup's world).
  A stage drawn as one of our assets names it: `stages.pack = { shape: 'asset', ref: PACK_REF }`; the page builds it
  once with `objectAt` and `tokenOf` makes the token: every visible mesh in its rest pose, skin weights dropped,
  merged into one geometry with vertex colours, its first material with `vertexColors`. The world takes it in
  `opts.assets` by ref (`_stageGeo`) and throws when the page gave none. So every pack on the line is the real
  BatteryPack at its real size (0.46 × 0.48 × 0.125 m), the instance cheap enough for hundreds.
- Our own intermediate shapes (the cell tray, the loaded drawer with 280 cells, the holder and plates, the BMS board
  bare and populated) are `K.shapes` in `kit.js`'s "maiaCITY additions": built with the same `add(geo, color, …)`
  as AirSup's shapes, at real size, with no 1.2 scale. AirSup's own shapes keep their scale.
- Pallets are our Euro pallet (`$lib/actors/pallet.js`, `K.europallet`), the raw stacks on the feeders and the
  finished stacks at the shipping door laid out by `K.stackOf` and `K.palletLayout` (a stage's `pallet: { nx, nz,
  dx, dz, dy, ny }` for the real stacking of the product; 2 × 6 packs a pallet).

### The page

- `src/routes/app/factories/+page.svelte`: `prerender`, no SSR; imports `FACTORIES` and `hud.css`; on mount imports
  `boot` and `tokenOf` lazily, builds every `asset` stage's token, boots into one `fixed; inset: 0` host; on leaving,
  `dispose()` (the rAF loop, the resize observer, the renderer, the composer, the DOM, `globalThis.factory`).
  AirSup's queries work as they did (`?select=load`, `?assemble=0`, `?film=1`, `?speed=`, `?ao=0`).
- The new-app checklist of `asset-producer`'s `checking.md`: `FACTORIES_TILE` in `gameAt` (draft: an admin's),
  `placeOf`, the `immersive` list of `src/routes/app/+layout.svelte`, its address in `ASSET_PAGES`, and the
  `factories` group first in `GROUPS` of `$lib/assets/index.js`. (Its Game Assets tile and cover went with the
  dashboard's Game Assets, #942.)

## Composable

- **What goes in:** the product by its ref (one constant, `PACK_REF`), the pallet from the actors, and, once built,
  our machines at each station by their refs (`standIn.for` says which). AirSup's people, forklifts and AMRs stay the
  world's: they are cheap, and they are not ours to version.
- **What it goes into:** a game or a world anchors to a line as it was: `factories/batterypack-line@1`
  (`assetAt` gives its spec). The simulation is a plain module: a game can run `plan` and `Sim` on the spec without
  the page.
- A machine the line needs that we do not have is built first as a machine, then placed; the pack on the line moves
  to its next version by changing one constant and one version note.

## Versions

- A kind's `HISTORY` in `src/lib/factories/index.js`; every version but the latest has its own frozen `build` (the
  older spec as a file beside the live one). One ask, one version, one dated note: the pack on the line to v10 is a
  version, a station replaced by our machine is a version, a cycle time changed from a measurement is a version.
- The versions test (`bun test src/lib/assets/versions.test.js`) covers the group with every other asset.

## Checking

- `bun test src/lib/factories/des.test.js`: the ported engine runs the spec 5 days with AirSup's seed and must give
  `check.mjs`'s numbers to the digit (packs a day, scrap, bottleneck, WIP, lead time, every station's servers,
  failures, busy, blocked, down and starved), and the what-if. Regenerate `spec.js` and rerun `check.mjs` when the
  spec changes, then move the numbers in the test.
- The real page as a mocked admin (`checking.md`: `/api/me` answered, everything else 404) with Playwright under
  swiftshader: the whole, the HUD with numbers, the bottleneck, a station's inspector, a what-if, a close look at the
  product; a founder with no capability must see "Not released yet". Then the type check and the asset tests.
- Shots are read like a critic: the fold of the line, the stacks on the pallets, the product's size and way up on the
  belts, the HUD against the nav pill.

## Lessons kept

- The stages never enter the simulation: changing what a stage looks like, or what it is drawn as, changes no
  number. The engine's numbers are pinned by the test, so a port that drifts is caught.
- Under a software renderer a frame with AO and bloom takes seconds, and the first frame's stamp lies before the
  build: the clock stepped back and the hall never assembled. The loop clamps `dt` to `[0, 0.05]` and starts at the
  first frame. Shots wait for frames (`factory.t` gains at most 0.05 s a frame), not for seconds; `?assemble=0`
  skips the assembly; the screenshot itself needs a long timeout.
- AirSup's own page has no such clamp: under that renderer its HUD never paints and `factory.t > n` never comes.
  Shoot it with `?film=1` and step the frames from the script (`window.__film.step(dt)`, the recorder's way): every
  step paints the HUD and renders once.
- A rigged asset (a skinned mesh) draws as nothing on that renderer and cannot be instanced: the token is its
  rest-pose geometry, merged, with vertex colours; one material for every instance. Check it headless first (its box,
  its colours) and then ask the page where its instances are (`world.stageMesh.pack.count`, the instance matrices):
  a black pack inside a tester or on a dark belt reads as a flat slab in a shot; the outgoing pallets, stacked 2 × 6,
  are where it shows.
- Vite in a worktree did not see the edited `hud.css` (the watcher): a shot that ignores a CSS change means restart
  the dev server, not another edit.
- AirSup's runtime is ported word for word under `// @ts-nocheck` (`checkJs` strict would flood it); our own files
  are typed. In a JSDoc comment `@10` reads as a tag: write "version 10".
- A token is drawn once for every product on the line: count its triangles before moving the product to a more
  detailed version (`tokenOf` of the BatteryPack: 28,364 at version 9, 139,560 at version 10, the same outside). A
  detailed machine goes on the line only as what shows outside.
- The world folds a line of more than six columns into a U; look before setting `layout.maxCols`.
- The HUD is scoped to its host: `:root` and `body` become `.fs-root`, `fixed` becomes `absolute`, the foot keeps
  above the nav pill by `--nav-room`; AirSup's class names stay so their `app.js` finds them.

## From an AirSup page to our library

A factory made with AirSup's skill is one HTML file. When the same line must live in `/app/factories` or a game, the
spec becomes `src/lib/factories/<factory>.js` (the same numbers, the stages mapped to our shapes or our assets, the
stand-ins said), a kind in the factories' `LIST`, a frozen version, the engine test, the versions test; the AirSup
tools' output stays in `/mnt/project-files/factories/<factory>/`.
