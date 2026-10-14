# The simulation

`runtime/des.js` is a classic event driven discrete event simulation with a binary heap of events.

- **Stations** have `servers` identical machines; each takes `batch` units from every input buffer
  (one buffer per predecessor), works for a lognormal time with mean `ct` and coefficient of
  variation `cv`, then tries to hand its output to the next station's input buffer.
- **Blocking after service**: when that buffer is full the machine holds its output and is BLOCKED
  until space frees. Upstream machines block in a chain; this is what makes buffers matter.
- **Starving**: an idle machine with nothing in its input is STARVED.
- **Breakdowns** are operation dependent: time to failure counts busy time only (exponential, mean
  `mtbf`), repair is exponential (mean `mttr`), the interrupted cycle resumes where it stopped.
- **Scrap**: each unit finished at a station is scrapped with probability `1 - yield`.
- **Joins**: a station with several predecessors needs `batch` units from every input; the first
  input's unit carries on, the others are consumed into it.
- **Release**: `capacity` keeps raw material at every branch head (the line runs at its constraint);
  `takt` releases one token per takt.
- **Clock**: production seconds only (shifts x hours per day); the HUD maps it back to day, time and
  shift.
- **Measurement**: cumulative time per state per machine is snapshotted every 5 production minutes;
  the HUD window is the last 4 h (or since the last change). Utilization = busy share; the bottleneck
  is the station with the highest busy + down share in the window (the active period share). In
  capacity mode that is the constraint; machines before it are blocked, after it starved.
- **Forecast**: `FactorySkill.forecast(plan, overrides, { days })` runs a fresh simulation with the
  same seed, warm up long enough to fill the line (2.5 x the longest processing path), and measures
  units per day, state shares, bottleneck, WIP and lead time.
- **Determinism**: a seed (mulberry32) drives every random draw, so a spec and a seed always give the
  same numbers in Node and in the browser.

Limits: one sink (a tree, no rework loops), no setups or changeovers between variants, no labour
pool shared between stations, no material handling capacity (conveyors are buffers, AMRs and
forklifts are scenery), breakdowns of a continuous machine (`perMachine`) stop one slot, not the
whole machine.
