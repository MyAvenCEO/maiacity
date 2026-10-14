# Where this skill comes from

Every text file here except `SOURCE.md` and `ours.md` is AirSup's own, copied word for word from
[AirsupHQ/machine-skill](https://github.com/AirsupHQ/machine-skill) at commit `e0bd066`
(`e0bd066ac5beaf48512935de2fc0f0e55636853a`, its newest on 2026-10-14), under its MIT licence (`LICENSE`, kept
beside them):

- `SKILL.md`, what Claude reads. The only change is its `name` in the front matter (`machine-skill`, so it matches
  this folder; theirs is `machine`).
- `references/solvers.md`, the solver recipes `SKILL.md` names.
- `README.md` (what the skill makes, how to record a film, how it works, requirements, limits), `CONTRIBUTING.md`
  (their house rules), `CHANGELOG.md`, `LAUNCH.md`, `V2-IDEAS.md` (the machines they plan next), `film/README.md`
  (their launch film), `evals/evals.json` (prompts and what a good answer contains) and `.github/REPO.md`.

Keep them that way: our own know-how never goes into any of them. How a machine joins our library and the Machines
app is in `ours.md` beside them; the laws over both are in the master skill, `asset-producer`.

The skill is not installed. Its tools and pictures (`kit/`, `scripts/`, `film/launch.html`, `examples/`,
`.github/assets/`, `package.json`) stay in that repository, so the links to them in `README.md` lead nowhere here.
When a step of `SKILL.md` names one, clone the repository at that commit into the scratchpad and run it from there,
never inside this repo:

```sh
git clone https://github.com/AirsupHQ/machine-skill <scratchpad>/machine-skill && git -C <scratchpad>/machine-skill checkout e0bd066ac5beaf48512935de2fc0f0e55636853a
```

To take a newer AirSup version: copy every text file again (changing only `SKILL.md`'s `name`), check each against
the source byte for byte, and put the new commit here.
