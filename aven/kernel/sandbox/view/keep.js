// @ts-nocheck — plain JS, runs in the view worker before anything else, the second lock included
/*
 * WHAT THE VIEW WORKER KEEPS FOR ITSELF — importScripts and making a blob: URL, taken here before the second lock
 * (../lockdown.js) takes importScripts off the worker's global scope and the worker (./worker.js) takes blob: URLs
 * from the view, so a view's script can load nothing: only the engine loads its libraries and the view's own scripts.
 */
export const load = self.importScripts.bind(self);
const make = URL.createObjectURL.bind(URL);
export const objectUrl = (code) => make(new Blob([code], { type: 'text/javascript' }));
