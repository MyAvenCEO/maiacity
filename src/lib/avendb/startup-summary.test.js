import { expect, test } from 'bun:test';
import { summaryView, completeEntries } from './startup-summary.js';
test('only audited dashboard and scoped chat use summary startup', () => {
 for (const path of ['/app','/app/','/prefix/app/','/app/chat/']) expect(summaryView(path)).toBe(true);
 expect(summaryView('/app/','#home')).toBe(true);
 for (const hash of ['#assets','#settings','#stories/note','#unknown']) expect(summaryView('/app/',hash)).toBe(false);
 for (const path of ['/app/studio','/app/games/sandbox-4','/app/unknown']) expect(summaryView(path)).toBe(false);
});
test('absent collection is never complete; legacy complete worlds remain compatible', () => {
 expect(completeEntries(null)).toBe(false);
 expect(completeEntries({entries:[],entriesComplete:false})).toBe(false);
 expect(completeEntries({entries:[]})).toBe(true);
 expect(completeEntries({entries:[],entriesComplete:true})).toBe(true);
});
