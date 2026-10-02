# The shot list: a film as data

A world film is written as a shot list (`scripts/film/<film>.mjs`) before anything is rendered; the studio then holds each shot as a record (`/api/shots`) a timeline plays live.

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
