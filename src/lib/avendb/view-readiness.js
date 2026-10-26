// Passive observations of real local query answers, for the diagnostics report; no queries or record identifiers retained.
/** @type {any[]} */ const samples=[];
export const viewReadiness={
 /** @param {ReturnType<typeof import('../../../game/code/sources/coverage.js').coverageOf>} coverage @param {any} answer */
 record(coverage, answer) {
  const ok=answer?.ok;
  samples.push({at:Date.now(), coverage:coverage.state, have:coverage.have, known:coverage.known,
   waiting:coverage.waiting.length, logs:coverage.logs, rows:Array.isArray(ok?.rows) ? ok.rows.length : null});
  if(samples.length>16) samples.shift();
 },
 snapshot(){return {samples:samples.map(s=>({...s})),semantics:'Coverage of observed local query answers (Coverage.lean); not a rendered first view.'};}
};
