// @ts-nocheck
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createTimeline } from './timeline.js';
const source = readFileSync(new URL('./intro-film.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace('export function', 'function');

test('both version adapters drive their gameplay world through the same clock/camera contract', async () => {
 const previous = { location: globalThis.location, document: globalThis.document, window: globalThis.window };
 globalThis.location = { search: '' }; globalThis.window = {};
 try {
  for (const [sandbox, seat] of [['maiacity-v1', 'B'], ['maiacity-v2', 'C']]) {
   let connected, options, disposed = 0, removed = 0, tickAt = 0;
   const canvas = { style: {}, remove() { removed++; } };
   globalThis.document = { createElement: () => canvas };
   const createIntroFilm = new Function('connectFilm', 'createCameraHold', 'createTimeline', source + ';return createIntroFilm;')(
    config => { connected = config; return { disconnect() { disposed++; } }; },
    () => ({ flying: () => false }), createTimeline);
   const noop = () => {};
   const world = { ready: Promise.resolve(), choose: noop, update: noop, trees: noop, reveal: noop, set: noop, touring: noop,
    dispose() { disposed++; }, film: { reset: noop, tick(t) { tickAt = t; }, camera: {}, renderer: {}, scene: {}, frames: {}, lights: {}, parts: () => noop } };
   const step = { segs: ['hold'], stage: {}, step: { kind: 'hold', lines: [] } };
   const mount = createIntroFilm({ sandbox, createWorld(_canvas, o) { options = o; return world; }, momentOf: noop,
    intro: { HOLD: 1, RATE: 30, TREES: { [seat]: {} }, introPlan: () => ({ steps: [step] }), loadBaked: async () => ({}),
     freshStep: () => ({ segs: [{ n: 30 }], shots: [] }), shotSpec: noop } });
   const mounted = await mount({ appendChild: noop }, seat);
   expect(connected.sandbox).toBe(sandbox); expect(connected.area).toBe(seat);
   expect(options.own).toBe(false); expect(options.film).toBe(true);
   connected.animate(.5); expect(tickAt).toBe(.5); expect(options.clock()).toBe(.5);
   await connected.stage({ clock: .2 }); expect(tickAt).toBe(.2);
   mounted.dispose(); expect(disposed).toBe(2); expect(removed).toBe(1);
  }
 } finally { Object.assign(globalThis, previous); }
});
