# Where this skill comes from

Every text file here except `SOURCE.md` is AirSup's own, copied word for word from
[AirsupHQ/factory-skill](https://github.com/AirsupHQ/factory-skill) at commit `9fde755`
(`9fde7554e6a30e77ea1008dec08f2ba8d8d37f27`, its newest on 2026-10-14), under its MIT licence (`LICENSE`, kept
beside them):

- `SKILL.md`, what Claude reads. The only change is its `name` in the front matter (`factory-skill`, so it matches
  this folder; theirs is `factory`).
- `references/` (`process.md`, `des.md`, `kit.md`, `look.md`), the references `SKILL.md` names.
- `README.md` (what the skill makes, how to use it, requirements, limits), `CONTRIBUTING.md`, `CHANGELOG.md`,
  `LAUNCH.md`, `evals/evals.json` (prompts and what a good answer contains) and `.github/REPO.md`.

Keep them that way: our own know-how never goes into any of them. It is in the master skill, `asset-producer`; when
we build our first factory into our own app, what it teaches us goes in an `ours.md` beside them, as
`machine-skill`'s does.

The skill is not installed. Its tools and pictures (`runtime/`, `vendor/` with three.js and its licence, `scripts/`,
`examples/`, `.github/assets/`) stay in that repository, so the links to them in `README.md` lead nowhere here. When
a step of `SKILL.md` names one, clone the repository at that commit into the scratchpad and run it from there, never
inside this repo:

```sh
git clone https://github.com/AirsupHQ/factory-skill <scratchpad>/factory-skill && git -C <scratchpad>/factory-skill checkout 9fde7554e6a30e77ea1008dec08f2ba8d8d37f27
```

To take a newer AirSup version: copy every text file again (changing only `SKILL.md`'s `name`), check each against
the source byte for byte, and put the new commit here.
