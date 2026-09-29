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
export type VaultStatus = { endpoint: string; catalog: string; dir: string; files: number; bytes: number; disk_free: number; disk_total: number };
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

/** A file's bytes from this Mac's store — with Range, for <img>, <video> and <audio>. */
export const vaultUrl = (hash: string) => `vault://localhost/${hash}`;

export const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);
export const name = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
