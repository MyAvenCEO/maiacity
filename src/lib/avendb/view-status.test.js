// @ts-nocheck — Bun test fixture
import { test, expect } from 'bun:test';
import { viewStatus } from './view-status.js';
const files = { reading: 0, waiting: 0 };
test('unknown and unavailable observations never imply local completion', () => {
 expect(viewStatus({total:0,local:0,pending:0}, files).state).toBe('unknown');
 expect(viewStatus({total:2,local:1,pending:0}, files).state).toBe('unavailable');
 expect(viewStatus({total:2,local:1,pending:1}, files).state).toBe('loading');
 expect(viewStatus({total:2,local:2,pending:0}, files)).toEqual({label:'Local view loaded',state:'local'});
});
test('pending files prevent a local-read completion indication', () => {
 const reads={total:2,local:2,pending:0};
 expect(viewStatus(reads,{reading:1,waiting:0}).state).toBe('loading');
 expect(viewStatus(reads,{reading:1,waiting:1}).state).toBe('waiting');
});
