# Contributing

Issues and pull requests are welcome.

- **New machines** go in `runtime/kit.js` with `K.def(name, builder)`. Real scale (metres), a stack light, moving parts in `K.live` groups, and a `work(i, p)` that puts the unit where the machine really holds it. Add the name to the table in `SKILL.md`.
- **Engine changes** (`runtime/des.js`) must keep it pure and deterministic for a seed. Run every example through `node scripts/check.mjs` before and after and explain any change in the numbers.
- **Examples**: a `spec.js` with a `note` on every station that says where its numbers come from, plus the built page (`node scripts/build.mjs`).
- Keep the zero dependency rule: the build and check scripts use only Node built-ins. Playwright is optional, for screenshots and films.
