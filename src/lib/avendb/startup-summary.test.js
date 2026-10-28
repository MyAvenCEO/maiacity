// @ts-nocheck — Bun runtime fixtures, matching adjacent tests.
import { expect, test } from 'bun:test';
import { summaryView, completeEntries, needsWorldEntries, localNavigation } from './startup-summary.js';
test('only audited dashboard and scoped chat use summary startup', () => {
 for (const path of ['/app','/app/','/prefix/app/','/app/chat/']) expect(summaryView(path)).toBe(true);
 expect(summaryView('/app/','#home')).toBe(true);
 for (const hash of ['#settings','#stories/note','#unknown']) expect(summaryView('/app/',hash)).toBe(false);
 for (const path of ['/app/studio','/app/games/sandbox-4','/app/unknown']) expect(summaryView(path)).toBe(false);
});
test('absent collection is never complete; legacy complete worlds remain compatible', () => {
 expect(completeEntries(null)).toBe(false);
 expect(completeEntries({entries:[],entriesComplete:false})).toBe(false);
 expect(completeEntries({entries:[]})).toBe(true);
 expect(completeEntries({entries:[],entriesComplete:true})).toBe(true);
});

test('native hash navigation publishes route and starts local readiness without awaiting it', async () => {
 let route = 'home', reads = 0, resolve;
 const pending = new Promise(r => { resolve = r; });
 localNavigation(() => { route = 'assets'; }, () => { reads++; return pending; });
 expect(route).toBe('assets'); expect(reads).toBe(1);
 expect(summaryView('/app/','#assets')).toBe(true);
 expect(summaryView('/app/','#assets/entry/version')).toBe(true);
 expect(needsWorldEntries({entriesComplete:false},'assets')).toBe(false);
 expect(needsWorldEntries({entriesComplete:false},'settings')).toBe(true);
 resolve(); await pending;
});

test('a view paints at once while the device catches up: the summary world is marked reading, never a loading screen', async () => {
 const { shellView } = await import('./startup-summary.js');
 const { freshLine } = await import('./fresh.js');
 const { freshnessOf } = await import('../../../game/code/sources/coverage.js');
 const summary = { entries: [], entriesComplete: false }, whole = { entries: [{ entry: 'a' }] };
 // the phone of 28 Oct: 2,778 logs left, the full world not read yet
 const behind = freshnessOf({ ok: {}, fresh: { state: 'behind', logs: 2778, waits: 0, unheard: 0 } });
 const stories = shellView(summary, 'stories', behind);
 expect(stories.reading).toBe(true);
 expect(stories.fresh.state).toBe('behind');
 expect(freshLine(stories.fresh)).toBe('Catching up · reading this view’s entries on this device');
 // a summary view, and every view once the whole world is in, shows the world's own stamp
 expect(shellView(summary, 'assets', behind)).toEqual({ reading: false, fresh: behind });
 expect(freshLine(shellView(whole, 'stories', behind).fresh)).toBe('Catching up · 2,778 logs left for this view');
 const current = freshnessOf({ ok: {} });
 expect(shellView(whole, 'stories', current).fresh.state).toBe('current');
 expect(freshLine(shellView(whole, 'stories', current).fresh)).toBe('');
 // even current, a summary world reads on: never shown as final before its entries are read
 expect(shellView(summary, 'settings', current).fresh.state).toBe('behind');
 // offline stays offline (local-first), said so
 const offline = freshnessOf({ ok: {}, fresh: { state: 'offline', asOf: 0 } });
 expect(shellView(summary, 'todos', offline).fresh.state).toBe('offline');
 expect(freshLine(shellView(summary, 'todos', offline).fresh)).toBe('Offline · reading this view’s entries on this device');
});

test('the Shell has no loading screen of its own: it paints the view under one freshness badge', async () => {
 const shell = await Bun.file(new URL('./Shell.svelte', import.meta.url)).text();
 expect(shell).not.toContain('Loading this view’s local entries');
 expect(shell).toContain('shellView(world, tab, session.worldFresh)');
 expect(shell).toContain('<Fresh fresh={view.fresh} />');
});
