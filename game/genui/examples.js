// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The three first generated views (Samuel, 2026-10-13): a three.js scene and a d3 chart (both `html`, with a draw
 * script) and a dome planner (`a2ui`, declarative JSON with its logic in QuickJS). Their code is in the repo's code
 * entries (code/views/, read by the one loader, game/code/index.js). The API keeps them as the first views when it
 * has none; an agent may change or delete them like any other.
 */
import { codeAt, viewOfEntry } from '../code/index.js';

export const EXAMPLES = ['village-scene', 'coop-chart', 'dome-planner'].map((id) => viewOfEntry(codeAt(`views/${id}`)));
