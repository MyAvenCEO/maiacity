// This Mac's vault, as the studio's Ingest and Library tabs see it (the app's own commands; see vault/app).

export type VaultFile = {
	hash: string;
	size: number;
	mime: string;
	kind: string;
	title?: string;
	tags?: string[];
	public?: boolean;
	original_name?: string;
	source?: string;
	ingest?: string;
	added?: string;
};
export type VaultStatus = { endpoint: string; catalog: string; dir: string; files: number; bytes: number; disk_free: number; disk_total: number; watch_dir: string };
export type Source = { name: string; path: string; free: number; total: number };
export type Scan = { files: number; bytes: number; kinds: Record<string, number> };
export type Outcome = {
	source: string;
	size: number;
	hash: string;
	source_hash: string;
	disk_hash: string;
	iroh_hash: string;
	verdict: 'verified' | 'duplicate' | 'mismatch';
	seconds: number;
};
export type Progress = { index: number; total: number; path: string; size: number; outcome: Outcome | null };
export type Summary = { session: string; files: number; bytes: number; seconds: number; verified: number; duplicates: number; mismatches: number; report: string };

/** Where a file's copies are: this Mac's store and the server peer (Object Storage). */
export type Copies = {
	hash: string;
	name: string;
	size: number;
	kind: string;
	/** verified: complete, checked on the way in · partial: arriving · missing */
	here: 'verified' | 'partial' | 'missing';
	here_bytes: number;
	/** stored: in the bucket, pulled verified · syncing: known, still arriving · unknown: not seen yet */
	server: 'stored' | 'syncing' | 'unknown';
	location: string;
};
export type Network = { node: string; server: string | null; catalog: string; devices: number; joined: boolean; note: string | null };
export type Device = { endpoint_id: string; label: string; created: string; seen: string | null; revoked_at: string | null };

/** Verified copies of a file: this Mac and the server count; two make a card safe to format. */
export const verifiedCopies = (c: Copies) => (c.here === 'verified' ? 1 : 0) + (c.server === 'stored' ? 1 : 0);

/** A file's bytes from this Mac's store — with Range, for <img>, <video> and <audio>. */
export const vaultUrl = (hash: string) => `vault://localhost/${hash}`;

export const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);
export const name = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
