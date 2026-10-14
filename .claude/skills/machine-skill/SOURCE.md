# Where this skill comes from

`SKILL.md` and `references/` here are AirSup's own text, copied word for word from
[AirsupHQ/machine-skill](https://github.com/AirsupHQ/machine-skill) at commit `e0bd066` (`e0bd066ac5beaf48512935de2fc0f0e55636853a`), under its MIT licence
(`LICENSE`, kept beside them). The only change is the skill's `name` in the front matter (`machine-skill`, so it
matches this folder). Keep it that way: our own know-how goes in the master skill, `asset-producer`, never in here.

The skill is not installed. Its tools (kit/, scripts/, film/ and examples/) stay in that repository. When a step of `SKILL.md` names one, clone
the repository at that commit into the scratchpad and run it from there, never inside this repo:

```sh
git clone https://github.com/AirsupHQ/machine-skill <scratchpad>/machine-skill && git -C <scratchpad>/machine-skill checkout e0bd066ac5beaf48512935de2fc0f0e55636853a
```

To take a newer AirSup version: copy its `SKILL.md` (changing only `name`) and `references/` again and put the new
commit here.
