# The shot list: a film as data

A world film is written as a shot list (`scripts/film/<film>.mjs`) before anything is rendered; Studio 2 then holds each shot as a `shot` entry in avenDB (every version an entry of its own, `src/lib/studio/avenshots.js`) that a cut plays live.

## Shot list anatomy (`day-19-d.mjs`, `shoot.mjs`)

| Field | Meaning |
|---|---|
| `name`, `size` | slug for the file; EWS · WS · MS · CU · ECU · macro |
| `cue: [line, 'words']` | cut 0.12 s before those words are spoken in that take |
| `after: [line, s]` | cut s seconds after a line ends |
| `at: s` | cut at an absolute time (the cold open) |
| `hour`, `hourTo` | sun position, and a time-lapse to |
| `fov`, `fovTo` | lens: 10–20 long, 40–55 wide (default 45) |
| `stand: [x, z]`, `dome: i` | where the walker stands; wait for dome i |
| `exposure`, `mood`, `grade` | legacy: read by `fromLegacy` as metered stops and a suggested look — the plate itself stays log, the grade is done in the studio |
| `sfx: [[cid, level]]` | sounds under the shot, looped for its length (by CID) |
| `props` | a set built into the scene while filming |
| `path: (t) => pose` | camera pose over t = 0…1 (`camera.mjs`) |

Voice takes and music are named by CID (`{ take, cid, pause }`, `music: { cid, chunks, cues }`). Each shot runs from its
start to the next shot's start; the last to `total` = the last line's end + `TAIL`.

## The shot list in avenDB: a story's Movie tab

Before a shoot, a story's planned shots live in its script (`src/lib/studio/scripts.js`, the Movie tab in
`src/lib/avendb/StoryMovie.svelte`; the storyteller skill names the record). Each scene's `shots` are rows, in order:
`{ id, size, angle, move, shows, line, take, shot }`. `size` is one of `ews`, `ws`, `ms`, `mcu`, `cu`, `ecu`, `insert`;
`angle` one of `eye`, `high`, `low`, `overhead`, `dutch`; `move` one of `static`, `pan`, `tilt`, `push`, `pull`,
`track`, `handheld`, `orbit`. `shows` is what the frame holds, in a sentence; `line` is the id of the scene's line it
covers. `take` (the artifact or Library file of the footage) and `shot` (a world shot, `shot:<entry>`) are set once
something covers it. Propose the shot list as the storyteller proposes scenes: `{ op: "propose", ... name: "Shots:
<angle>" }`, then `{ op: "insert", entry, line, path: ["scenes", { id }, "shots"], value: <row> }` for each shot.
Each scene is drawn from a beat of the story and says what happens (`action`): plan the shots that show it. A cut
made from the script (the Movie tab's "Make a cut of this script") lays each shot as a slate on V1, its number
`<scene>.<shot>`, its size, and its angle and move as notes, for the studio to fill with takes.
