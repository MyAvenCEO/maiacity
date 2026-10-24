/** Ephemeral correlation metadata for an opted-in, already-authorized query.
 * Never persist this list or treat a frontier as proof of edit inclusion, paint,
 * current access, durability or query completeness. Protocol acknowledgement must
 * recheck current access and bind a pending nonce to the exact consumed frontier.
 * @param {any} answer */
export function observedRevisions(answer) {
 const rows = answer?.ok?.rows;
 if (!Array.isArray(rows)) return [];
 const hex = /^[0-9a-f]{64}$/;
 const out = [];
 for (const row of rows.slice(0, 64)) {
  const revision = row?.observedRevision;
  if (!hex.test(row?.entry ?? '') || !revision || !['main-heads','checkpoint-basis'].includes(revision.kind)
   || typeof revision.frontierComplete !== 'boolean' || !Array.isArray(revision.heads)
   || revision.heads.length > 32 || revision.heads.some(h => typeof h !== 'string' || !hex.test(h))) continue;
  out.push({entry: row.entry, kind: revision.kind, heads: [...revision.heads], frontierComplete: revision.frontierComplete, readOnly: row.readOnly === true});
 }
 return out;
}
