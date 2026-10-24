// @ts-nocheck — test-only immutable fixture.
// Test-only, process-scoped immutable fixture. Production builds never import this module.
// No disk cache: a new test invocation always bundles the current source tree.
import { bundleRecipes as build } from '../box/plugin.js';
let pending;
function freeze(value) {
 if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
 }
 return value;
}
export const bundleRecipes = () => pending ??= build().then(freeze).catch(error => { pending = undefined; throw error; });
