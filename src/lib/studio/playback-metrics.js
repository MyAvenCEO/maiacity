// @ts-nocheck
/** Completed preview frames only. Bounded samples; full-run counters retain every hitch. */
export function createPlaybackMetrics() {
 const gaps = [], renders = [], cuts = [];
 let previous = null, key = '', failures = 0;
 let frames = 0, intervals = 0, elapsedMs = 0, cutCount = 0, longGaps = 0;
 let maxGap = null, maxCutGap = null;
 const push = (list, value) => { list.push(value); if (list.length > 300) list.shift(); };
 const p95 = list => list.length ? [...list].sort((a,b) => a-b)[Math.ceil(list.length*.95)-1] : null;
 return {
  resetClock() { previous = null; key = ''; },
  reset() {
   gaps.length = renders.length = cuts.length = 0;
   previous = null; key = ''; failures = frames = intervals = elapsedMs = cutCount = longGaps = 0;
   maxGap = maxCutGap = null;
  },
  frame(at, duration, shot) {
   frames++; push(renders, duration);
   if (previous !== null) {
    const gap = at - previous;
    intervals++; elapsedMs += gap; push(gaps, gap);
    maxGap = Math.max(maxGap ?? 0, gap);
    if (gap > 50) longGaps++;
    if (shot !== key) { cutCount++; push(cuts, gap); maxCutGap = Math.max(maxCutGap ?? 0, gap); }
   }
   previous = at; key = shot;
  },
  failed() { failures++; },
  snapshot() {
   return { frames, samples: renders.length, elapsedMs,
    fps: elapsedMs > 0 ? intervals * 1000 / elapsedMs : null,
    renderP95: p95(renders), gapP95: p95(gaps), cutP95: p95(cuts), cuts: cutCount,
    maxGap, maxCutGap, longGaps, failures };
  }
 };
}
export const playbackMetrics = createPlaybackMetrics();
