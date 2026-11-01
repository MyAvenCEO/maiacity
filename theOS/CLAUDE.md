Read what holds first with brain prime: `node brain/brain.mjs prime` (a session-start hook runs it for you). Act on what it lists, never on a superseded doc; `node brain/brain.mjs get <id>` shows one doc, `node brain/brain.mjs holds <type>` the rest (aip-836d · brain).

# theOS: working rules for agents

main is theOS's source of truth (d-6628): start from main, work on your own branch, and come back to main through a pull
request (a draft while you work; theOS's check runs once, when the goal's pull request is ready for review).

theOS is a standalone project: everything is built in theOS/, from scratch. Code outside theOS/ is legacy: read it if
useful, never change it or depend on it. One JSON doc per thing; no markdown files (this file is the one Claude Code
reads by name).

## The done rule (aip-31df · Checks for theOS's apps: the crawl and the docs check)

A change to theOS is done when theOS's check command is green (the crawl and the docs check), a decision that renames a
word has been swept for the old word, it is pushed to the work branch, and the theOS artifact (a private claude.ai page,
republished by avenMAIA with its files) is republished, its version noted in the commit message. In theOS, the
repository's root check (aven/ops/devx/check.mjs) does not apply. The pixel diff and the look checker join it with
aip-f4e2 · The pixel diff and the look checker.

The check command, from the repository's root:

    node theOS/avenCEO/checks/check.mjs

It serves theOS/, crawls from theOS/index.html (theOS/docs/index.html where there is no dashboard) at 390x844 and
1280x720, runs the docs check on every state it reaches, and exits non-zero on a failure. Buttons are pressed only in
the first state of each view type, one of each kind (for speed, d-5afb). `--fixtures` runs the check's own test
pages (theOS/avenCEO/checks/fixtures/, each says whether it must be red or green). `--help` lists its options.

Playwright is pinned in theOS/package.json to the version of avenSANDBOX's image (theOS/sandbox/box/Dockerfile), the
only source of the browser. Do not install packages into theOS/node_modules in a cloud session: the check uses the
session's own Playwright and Chromium when theOS/node_modules has none.
