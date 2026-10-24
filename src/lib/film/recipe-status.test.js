// @ts-nocheck
import { expect, test } from 'bun:test';
import { recipeStatus } from './recipe-status.js';
test('film readiness follows the sandbox catalog gate, not unrelated missing assets', () => {
 expect(recipeStatus({ phase: 'ready', unread: ['unused asset'], missed: ['other asset'] }).error).toBe('');
 expect(recipeStatus({ phase: 'failed', error: 'local catalog unavailable' }).error).toBe('local catalog unavailable');
 expect(recipeStatus({ phase: 'loading', waiting: 2 }).label).toContain('local avenDB');
});
