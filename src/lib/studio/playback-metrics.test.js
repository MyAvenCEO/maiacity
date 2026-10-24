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

test('retains early hitches and cut maxima after bounded samples roll over', () => {
 const m = createPlaybackMetrics();
 m.frame(0, 10, 'first'); m.frame(200, 190, 'second');
 for (let i = 1; i <= 600; i++) m.frame(200 + i * 1000 / 30, 10, 'second');
 const report = m.snapshot();
 expect(report.frames).toBe(602); expect(report.samples).toBe(300);
 expect(report.longGaps).toBe(1); expect(report.maxGap).toBe(200);
 expect(report.maxCutGap).toBe(200); expect(report.cuts).toBe(1);
 expect(report.gapP95).toBeCloseTo(1000 / 30);
 expect(report.fps).toBeCloseTo(601 * 1000 / 20200);
 m.failed(); m.reset();
 expect(m.snapshot()).toEqual({ frames: 0, samples: 0, elapsedMs: 0, fps: null,
  renderP95: null, gapP95: null, cutP95: null, cuts: 0, maxGap: null, maxCutGap: null,
  longGaps: 0, failures: 0 });
 m.frame(30000, 10, 'new run');
 expect(m.snapshot().maxGap).toBeNull();
});
