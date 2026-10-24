// @ts-nocheck
import { expect, test } from 'bun:test';
import { createPlaybackMetrics } from './playback-metrics.js';
test('measures actual frame cadence and cut gaps, excluding stopped time', () => {
 const m = createPlaybackMetrics();
 m.frame(0, 10, 'one'); m.frame(1000/30, 11, 'one'); m.frame(2000/30, 12, 'two');
 expect(m.snapshot().fps).toBeCloseTo(30);
 expect(m.snapshot().cuts).toBe(1); expect(m.snapshot().cutP95).toBeCloseTo(1000/30);
 m.resetClock(); m.frame(10000, 12, 'three');
 expect(m.snapshot().fps).toBeCloseTo(30); expect(m.snapshot().cuts).toBe(1);
 m.frame(10200, 190, 'four'); expect(m.snapshot().longGaps).toBe(1);
});
