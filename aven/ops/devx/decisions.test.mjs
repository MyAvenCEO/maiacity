import { expect, test } from 'bun:test';
import { firstEdit } from './decisions.mjs';

const head = '# Decisions\n\nThe newest first.\n\n| Id | Decision |\n|---|---|\n';
const log = head + '| A2 | Two. |\n| A1 | One. |\n';

test('a new row on top keeps the log', () => {
 expect(firstEdit(log, log)).toBeNull();
 expect(firstEdit(log, head + '| A3 | Three, superseding A2. |\n| A2 | Two. |\n| A1 | One. |\n')).toBeNull();
 expect(firstEdit('', log)).toBeNull();
});

test('editing a row is refused, at its line', () => {
 expect(firstEdit(log, log.replace('Two.', 'Two, changed.'))).toEqual({ line: 7, was: '| A2 | Two. |', now: '| A2 | Two, changed. |' });
});

test('deleting a row, or adding one below the old ones, is refused', () => {
 expect(firstEdit(log, head + '| A2 | Two. |\n')).toEqual({ line: 7, was: '| A2 | Two. |', now: '(deleted)' });
 expect(firstEdit(log, log + '| A3 | Three. |\n')).not.toBeNull();
});

test('editing the head, or adding prose between the rows, is refused', () => {
 expect(firstEdit(log, log.replace('The newest first.', 'Oldest first.'))).toEqual({ line: 3, was: 'The newest first.', now: 'Oldest first.' });
 expect(firstEdit(log, head + 'A note.\n| A2 | Two. |\n| A1 | One. |\n')).toEqual({ line: 7, was: '(a new row)', now: 'A note.' });
});
