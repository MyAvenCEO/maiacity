// @ts-nocheck — plain JS data, kept loose on purpose
// The rulebook as code (Samuel, 2026-10-09): every mechanic of the valley is a hook in a config card's code, run in the
// page's QuickJS sandbox (src/lib/sandbox-8/sandbox.js), never in the page itself. Each section card's default code,
// the valley's own rules written out, is a code entry in the repo: code/logic/sandbox-7/<card>/logic.js, read by the
// one loader (game/code/index.js). A config card with code of its own runs that instead (a MIP changes it,
// like anything else), and any other card exporting the same hook is given what the rule made of it as `value`.
// The engine (src/lib/sandbox-8/economy.js) keeps the same rules natively, only as the fallback for a hook that fails
// or a page where QuickJS can't load; scripts/sandbox-8-rules.mjs checks the two agree.
//
// Every hook gets one argument with `valley` ({ day, values (every param by key), weather, prices, avens, ... }) and
// what the hook names; `dice` are numbers in [0, 1) drawn from the world's seeded dice, so a world plays the same way
// again from its seed. A hook returns plain JSON.

import { codeIn } from '../code/index.js';

/** each section card's default code, by its card's id, as the loader has it now (the vault's once loaded, else the seed's) */
export const defaultCode = () => Object.fromEntries(codeIn('logic/sandbox-7/').map((e) => [e.card, e.files['logic.js']]));
