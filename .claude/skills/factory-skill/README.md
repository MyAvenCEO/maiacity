<h1 align="center">Factory</h1>

<p align="center"><b>Describe a factory in one line. Claude builds it as a live 3D simulation you can run.</b><br>An open source agent skill: a tilt-shift miniature of your factory, driven by a real discrete event simulation.</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/skills"><img src="https://img.shields.io/badge/Claude_Code-skill-24262a?style=flat-square" alt="Claude Code skill"></a>
  <a href="https://agentskills.io"><img src="https://img.shields.io/badge/Agent_Skills-compatible-24262a?style=flat-square" alt="Agent Skills compatible"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-24262a?style=flat-square" alt="MIT license"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/dependencies-0-24262a?style=flat-square" alt="No dependencies"></a>
  <a href="https://www.airsup.ai/lab/factory-skill"><img src="https://img.shields.io/badge/gallery-airsup.ai%2Flab%2Ffactory--skill-e2713a?style=flat-square" alt="Gallery"></a>
</p>

<p align="center">
  <img src=".github/assets/hero.gif" width="860" alt="A one line prompt is typed, a miniature e-bike motor factory assembles itself station by station, product flows on the conveyors and the HUD shows throughput against target and the bottleneck.">
</p>

## Quick start

```sh
npx skills add AirsupHQ/factory-skill -g -a claude-code
```

Then, in Claude Code:

```text
/factory a line that makes 2,000 e-bike motors a day
```

No API keys and nothing to `npm install`: the scripts use only Node built-ins and the page is one
self-contained HTML file.

## What it does

Claude reads the line, writes the real process route (stations, cycle times, batches, breakdown
rates, yields), sizes every station from demand, checks the line headless, and hands you **one HTML
file**: a model factory on a table, seen through a tilt-shift lens, with machines that move while
they work and product flowing between them. Under it runs a discrete event simulation. Every number
on screen is computed by it:

- **throughput** per day against the target, with a sparkline per production hour
- **takt**, **WIP** and **lead time**
- **utilization** of every station, split into busy, blocked, starved and down
- the **bottleneck**, outlined in pulsing red on the floor

Click a station: add a machine, slide its cycle time or its buffer, and watch the queue drain and
the bottleneck move. The inspector shows the sizing formula with its numbers and a 3 day forecast of
the changed line from the same engine.

## Gallery

<table>
  <tr>
    <td width="33%"><img src=".github/assets/ebike-motors.jpg" alt="E-bike hub motor line"></td>
    <td width="33%"><img src=".github/assets/croissant-bakery.jpg" alt="Croissant bakery"></td>
    <td width="33%"><img src=".github/assets/battery-gigafactory.jpg" alt="Battery cell gigafactory"></td>
  </tr>
  <tr>
    <td><sub><b>"a line that makes 2,000 e-bike motors a day"</b><br>stator, rotor and hub shell branches joined at assembly</sub></td>
    <td><sub><b>"a bakery that bakes 10,000 croissants an hour"</b><br>proofers, a 14 m tunnel oven and a spiral cooler as continuous dwell</sub></td>
    <td><sub><b>"a battery cell gigafactory"</b><br>a 4 GWh line, coating to formation, three shifts</sub></td>
  </tr>
  <tr>
    <td><img src=".github/assets/drone-line.jpg" alt="Drone assembly line"></td>
    <td><img src=".github/assets/brewery-canning.jpg" alt="Brewery canning hall"></td>
    <td><img src=".github/assets/satellite-factory.jpg" alt="Satellite factory"></td>
  </tr>
  <tr>
    <td><sub><b>"a drone assembly line"</b><br>flight controller SMT branch, calibration, flight test cage</sub></td>
    <td><sub><b>"a craft brewery canning 6,000 cans an hour"</b><br>filler, tunnel pasteurizer, case packer, robot palletizer</sub></td>
    <td><sub><b>"a factory that builds 4 satellites a day"</b><br>cleanroom bays, gantry cranes, thermal vacuum in batches of 4</sub></td>
  </tr>
</table>

All six were made by Claude with this skill, from the prompts above. Open any
`examples/*/*.html` in a browser, or try them at
[airsup.ai/lab/factory-skill](https://www.airsup.ai/lab/factory-skill).

## Install

The repository is the skill: a folder with a `SKILL.md` at its root.

| | Command |
|---|---|
| skills CLI, for you | `npx skills add AirsupHQ/factory-skill -g -a claude-code` |
| skills CLI, one project | `npx skills add AirsupHQ/factory-skill` |
| git, for you | `git clone https://github.com/AirsupHQ/factory-skill.git ~/.claude/skills/factory` |
| git, one project | `git clone https://github.com/AirsupHQ/factory-skill.git .claude/skills/factory` |

Claude Code picks up new skills in a running session; if the `skills` folder did not exist when the
session started, run `/reload-skills`.

### Other agents

Factory follows the [Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` at its
root, plain scripts and references beside it. Any host that loads that format can use it. The skills
CLI installs it for other agents with `-a <agent>` (see `npx skills --help` for the list); in the
Claude apps you can upload the folder as a zip under Settings, Capabilities, Skills; the Claude Agent
SDK picks it up from `.claude/skills/`. The workflow needs a shell with Node 20 or later to run
`check.mjs` and `build.mjs`; a host without one can still follow `SKILL.md` and write the spec.

## Usage

```text
/factory a bakery that bakes 10,000 croissants an hour
/factory a battery cell gigafactory, three shifts, 4 GWh
/factory how many CNC machines do I need for 600 gearbox housings a week at 42 minutes each?
```

You do not have to name the skill: asking to see, size or simulate a production line loads it.
Give real numbers when you have them (volumes, cycle times, machines you already own, shifts);
Claude fills the rest with typical values and says which ones it assumed.

The headless tools work on their own too:

```sh
node scripts/check.mjs examples/ebike-motors/spec.js      # size the line and run 5 production days
node scripts/build.mjs examples/ebike-motors/spec.js      # write the self-contained page
node scripts/capture.mjs examples/ebike-motors/ebike-motors.html shot.png --query assemble=0
node scripts/record.mjs examples/ebike-motors/ebike-motors.html film.mp4 --secs 12 --query intro=1
```

`check.mjs` prints, per station, machines, capacity per day, busy, down, blocked, starved and
failures, then the forecast and the bottleneck:

```text
station                       ct s batch  mach   cap/day   busy   down  block starve  fails
> Lamination press              22     1     1     2,448    76%    12%    12%     0%     19
  Needle winding               150     1     7     2,481    74%     5%     9%    12%    140
  ...
forecast over 5 production days: 1,943 motors/day (97% of target), scrap 29.6/day
bottleneck: Lamination press (busy + down 88%)   WIP at end 193 tokens   lead time 72.6 min
```

## How it works

| Layer | What it does |
|---|---|
| `SKILL.md` | The method: read the line, state assumptions, write the process route with real numbers, size, check, build, look, answer with the finding |
| `runtime/des.js` | Event driven DES: parallel machines, lognormal cycles, batches, joins, finite buffers with blocking after service, operation dependent breakdowns, scrap, shift calendar, seeded and deterministic. Same file in Node and the browser |
| `runtime/kit.js` | 27 machines at real scale with moving parts and stack lights, 29 product shapes, people, forklifts, AMRs, trucks, racks, trees |
| `runtime/world.js` | Layout of the line (branches, joins, folding long lines), hall, yard, diorama base, and every token placed where the simulation says it is |
| `runtime/look.js` | The miniature: warm sun and soft shadows, GTAO, bloom on emissive parts only, a tilted band of focus, warm saturated grade |
| `runtime/app.js` | HUD, inspector, what-if API, film mode |
| `vendor/three.bundle.js` | three.js r185 and the addons used, MIT |

The model, its limits and the sizing rule are in [`references/des.md`](references/des.md); typical
process numbers in [`references/process.md`](references/process.md); the kit API in
[`references/kit.md`](references/kit.md); the look in [`references/look.md`](references/look.md).

## Requirements

Node 20 or later for the scripts (built-ins only). A WebGL2 browser for the page. Playwright is
optional, for `capture.mjs` and `record.mjs`.

## Limits

One sink (no rework loops), no changeovers between variants, no shared labour pool, conveyors are
buffers (material handling has no capacity of its own), and a breakdown of a continuous machine
(tunnel oven, spiral) stops one slot rather than the whole machine. Numbers are as good as the cycle
times Claude is given or estimates: the page shows its assumptions so you can change them.

## Credits

Made by [airsup](https://www.airsup.ai), manufacturing simulation for hardware teams. Inspired by
[Anatomy](https://github.com/wheresryan22/anatomy), the skill that brings machines to life as
isometric figures. MIT licence.
