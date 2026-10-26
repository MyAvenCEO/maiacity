// @ts-nocheck — shared browser/native JS
/** Whether a change (the device's `touched` answer: `{ entries, vaults, all }`) may change what a mounted read shows
 * (avendb/spec/AvenDB/LiveQuery.lean, `untouched_query_unchanged`). A read selects by the entries it names and by its
 * vault; one naming no vault is judged by the vaults its last answer showed. Where it can't tell, it is touched: a
 * read is never left stale, only spared a re-run that can't change it.
 * @param {any} op the read @param {any} t the change @param {any} [last] the read's last answer */
export function touches(op, t, last) {
	if (!t || t.all !== false || !Array.isArray(t.entries) || !Array.isArray(t.vaults)) return true;
	if (!t.entries.length) return false;
	const entries = new Set(t.entries);
	const ok = last?.ok;
	const rows = Array.isArray(ok) ? ok : Array.isArray(ok?.rows) ? ok.rows : Array.isArray(ok?.entries) ? ok.entries : [];
	const named = [op?.entry, ...(Array.isArray(op?.entries) ? op.entries : []), ok?.entry, ...rows.map((r) => r?.entry)];
	if (named.some((e) => typeof e === 'string' && entries.has(e))) return true;
	const vaults = typeof op?.vault === 'string' ? [op.vault]
		: [ok?.vault, ...rows.map((r) => r?.vault)].filter((v) => typeof v === 'string');
	if (!vaults.length) return true;
	return vaults.some((v) => t.vaults.includes(v));
}
