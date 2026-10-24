// @ts-nocheck
import { playbackMetrics } from './playback-metrics.js';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import { currentWorldPage, waitForWorld } from './world-loading.js';
import { FramePacer } from './frame-pacer.js';
import { filmPath } from '../../../game/film/worlds.js';

// Exercise the real lifecycle without a browser GPU. Server compilation only erases runes.
const source = readFileSync(new URL('./world.svelte.js', import.meta.url), 'utf8');
const compiled = compileModule(source, { generate: 'server' }).js.code
 .replace(/^import .*?;$/gm, '')
 .replace(/export /g, '')
 .replaceAll("import('./jobs/mac.js')", 'Promise.resolve({ studioWorld() {} })');
const WorldViewer = new Function('playbackMetrics', 'SvelteSet', 'waitForWorld', 'currentWorldPage', 'FramePacer', 'forwardConsole', 'filmPath', compiled + ';return WorldViewer;')(playbackMetrics, Set, waitForWorld, currentWorldPage, FramePacer, () => {}, filmPath);
const spec = { world: { sandbox: 'maiacity-v2', area: 'C' } };
const frame = { spec, meter: false, width: 640, height: 360 };
const tick = () => new Promise(r => setTimeout(r, 0));

test('a draw completing after detach cannot resurrect the old world or drain its queue', async () => {
 const v = new WorldViewer(); let finish;
 v.url = filmPath(spec.world); v.state = 'ready';
 v.film = { show: () => new Promise(r => finish = r) };
 v.show(frame); await tick(); v.show(frame);
 v.detach(); finish(true); await tick();
 expect(v.state).toBe('off'); expect(v.drawn).toBe(''); expect(v.queued).toBeNull(); expect(v.busy).toBe(false);
});

test('an outgoing page error is ignored until the requested world document arrives', async () => {
 const previous = globalThis.location;
 globalThis.location = { href: 'tauri://localhost/app/studio/' };
 try {
  const v = new WorldViewer(), url = filmPath(spec.world);
  let win = { location: { href: 'tauri://localhost/games/maiacity-v1/?film&area=A' }, __filmMountError: 'old failure' };
  const iframe = { get contentWindow() { return win; }, getAttribute: () => url };
  v.forwardKeys = () => {}; v.watchLoss = () => {};
  const pending = v.attach(iframe, url, 200, 500);
  win = { location: { href: 'tauri://localhost' + url }, __film: { show() {}, ready: async () => {} } };
  await pending;
  expect(v.state).toBe('ready'); expect(v.error).toBe(''); expect(v.film).toBe(win.__film);
 } finally { globalThis.location = previous; }
});

test('retry invalidates a same-URL outgoing world before attaching again', () => {
 const v = new WorldViewer(), url = filmPath(spec.world);
 const win = { __film: { show() {} } }, iframe = { contentWindow: win, src: url };
 v.iframe = iframe; v.url = url; v.film = win.__film; v.error = 'old failure';
 let attached;
 v.attach = (frame, path) => { attached = [frame, path]; };
 v.retry();
 expect(win.__lost).toBe(true); expect(v.film).toBeNull(); expect(v.error).toBe('');
 expect(iframe.src).toBe('about:blank'); expect(attached).toEqual([iframe, url]);
});

test('a synchronous prepare failure settles and reports the actual error', async () => {
 const v = new WorldViewer();
 const film = { prepare() { throw new Error('missing local recipe'); } };
 v.film = film;
 await v.prepareOne(film, spec, false);
 expect(v.error).toBe('prepare: missing local recipe'); expect(v.ends.size).toBe(0);
});

test('footage playback does not enter world preparation, even with future world clips', async () => {
 const studio = readFileSync(new URL('./studio.svelte.js', import.meta.url), 'utf8');
 const method = studio.slice(studio.indexOf('\tasync preparePlayback('), studio.indexOf('\n\t/** resolves once `done()`'));
 const Subject = new Function('isWorld', `return class { ${method} }`)(picture => picture?.kind === 'world');
 for (const worldClips of [[], [{ kind: 'world' }]]) {
  const subject = new Subject(); subject.worldClips = worldClips; subject.picture = { kind: 'video' };
  subject.beginLoading = () => { throw new Error('Footage entered world preparation'); };
  await subject.preparePlayback();
 }
});
