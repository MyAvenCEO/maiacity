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
