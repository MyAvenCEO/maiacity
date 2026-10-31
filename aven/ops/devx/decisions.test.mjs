import { expect, test } from 'bun:test';
import { firstEdit } from './decisions.mjs';

const log = '# Decisions\n\n### A1\nOne.\n\n### A2\nTwo.\n';

test('appending entries keeps the log', () => {
 expect(firstEdit(log, log)).toBeNull();
 expect(firstEdit(log, log + '\n### A3\nThree, superseding A2.\n')).toBeNull();
 expect(firstEdit('', log)).toBeNull();
});

test('editing an entry is refused, at its line', () => {
 expect(firstEdit(log, log.replace('Two.', 'Two, changed.'))).toEqual({ line: 7, was: 'Two.', now: 'Two, changed.' });
});

test('deleting an entry is refused', () => {
 expect(firstEdit(log, '# Decisions\n')).toEqual({ line: 3, was: '### A1', now: '(deleted)' });
});
