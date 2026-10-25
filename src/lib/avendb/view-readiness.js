// Passive observations of real local query answers; no queries or record identifiers retained.
/** @type {any[]} */ const samples=[];
export const viewReadiness={
 /** @param {any} completeness @param {any} answer */
 record(completeness, answer) {
  const ok=answer?.ok;
  samples.push({at:Date.now(), response:completeness.response, discovery:completeness.discovery, history:completeness.history,
   pendingJudgments:completeness.pendingJudgments, unresolvedCandidates:completeness.unresolvedCandidates,
   rows:Array.isArray(ok?.rows) ? ok.rows.length : null,
   pendingEntries:Array.isArray(ok?.pendingEntries) ? ok.pendingEntries.length : null});
  if(samples.length>16) samples.shift();
 },
 snapshot(){return {samples:samples.map(s=>({...s})),semantics:'Observed local query responses, not proof of complete peer discovery or rendered first view.'};}
};
