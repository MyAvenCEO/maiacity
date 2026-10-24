// @ts-nocheck
/** Completed preview frames only. Bounded, with no shot names or content retained. */
export function createPlaybackMetrics() {
 const gaps = [], renders = [], cuts = [];
 let previous = null, key = '', failures = 0;
 const push = (list, value) => { list.push(value); if (list.length > 300) list.shift(); };
 const p95 = list => list.length ? [...list].sort((a,b) => a-b)[Math.ceil(list.length*.95)-1] : null;
 return {
  resetClock() { previous = null; key = ''; },
  frame(at, duration, shot) {
   push(renders, duration);
   if (previous !== null) { const gap = at - previous; push(gaps, gap); if (shot !== key) push(cuts, gap); }
   previous = at; key = shot;
  },
  failed() { failures++; },
  snapshot() {
   const elapsed = gaps.reduce((a,b) => a+b, 0);
   return { frames: renders.length, fps: elapsed > 0 ? gaps.length * 1000 / elapsed : null,
    renderP95: p95(renders), gapP95: p95(gaps), cutP95: p95(cuts), cuts: cuts.length,
    longGaps: gaps.filter(x => x > 50).length, failures };
  }
 };
}
export const playbackMetrics = createPlaybackMetrics();
