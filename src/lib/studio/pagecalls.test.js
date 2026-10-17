// @ts-nocheck — plain JS
// The page's answers to the MCP (./pagecalls.js): only its own calls, only of cuts, an error as words.
// Run: bun test src/lib/studio/pagecalls.test.js
import { expect, test } from 'bun:test';
import { answerOf, answers } from './pagecalls.js';

test('the page answers only its own calls, of a cut named cut:<entry>', async () => {
	expect(['renderCut', 'frameCut', 'cutJobs', 'retryTask'].every(answers)).toBe(true);
	expect(answers('deleteCut')).toBe(false);
	expect(answers('toString')).toBe(false);
	expect(await answerOf('deleteCut', { id: 'cut:a' })).toEqual({ error: 'the page answers no call named deleteCut' });
	expect(await answerOf('renderCut', { id: 'tl1' })).toEqual({ error: 'name it as cut:<entry>' });
	expect(await answerOf('retryTask', { id: 'cut:a' })).toEqual({ error: 'name it as task:<entry>' });
	expect((await answerOf('frameCut', { id: 'cut:a' })).error).toBe('a frame needs its time, t, in seconds');
});
