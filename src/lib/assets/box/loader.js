// @ts-nocheck — plain JS, runs inside the box before anything else, the second lock included
/*
 * HOW THE ENGINE LOADS A RECIPE — a recipe file is a classic script (../engines.js), loaded with importScripts from a
 * blob: URL, the one kind of script the box's policy lets in (a module from a blob: URL is refused in a frame with no
 * origin). The engine keeps importScripts for itself here, before the second lock (./lockdown.js) takes it off the
 * worker's global scope, so no recipe can reach it: it lives only in this module.
 */
export const load = self.importScripts.bind(self);
