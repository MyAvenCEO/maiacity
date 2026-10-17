// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The three first generated views (Samuel, 2026-10-13): a three.js scene and a d3 chart (both `html`, with a draw
 * script) and a dome planner (`a2ui`, declarative JSON with its logic in QuickJS). Their code is in the repo's code
 * entries (code/views/, read by the one loader, game/code/index.js), the first of the repo's Generated UI views; an
 * agent changes one with a draft the admin keeps, which lands in the repo by PR (api/src/genui.js).
 */
import { codeAt, viewOfEntry } from '../code/index.js';

export const EXAMPLES = ['village-scene', 'coop-chart', 'dome-planner'].map((id) => viewOfEntry(codeAt(`views/${id}`)));
