# Where this skill comes from

`SKILL.md` and `references/` here are AirSup's own text, copied word for word from
[AirsupHQ/factory-skill](https://github.com/AirsupHQ/factory-skill) at commit `9fde755` (`9fde7554e6a30e77ea1008dec08f2ba8d8d37f27`), under its MIT licence
(`LICENSE`, kept beside them). The only change is the skill's `name` in the front matter (`factory-skill`, so it
matches this folder). Keep it that way: our own know-how never goes into `SKILL.md` or `references/`. It is in the
master skill, `asset-producer`; when we build our first factory into our own app, what it teaches us goes in an
`ours.md` beside them, as `machine-skill`'s does.

The skill is not installed. Its tools (runtime/, vendor/, scripts/ and examples/) stay in that repository. When a step of `SKILL.md` names one, clone
the repository at that commit into the scratchpad and run it from there, never inside this repo:

```sh
git clone https://github.com/AirsupHQ/factory-skill <scratchpad>/factory-skill && git -C <scratchpad>/factory-skill checkout 9fde7554e6a30e77ea1008dec08f2ba8d8d37f27
```

To take a newer AirSup version: copy its `SKILL.md` (changing only `name`) and `references/` again and put the new
commit here.
