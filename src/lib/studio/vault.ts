// This Mac's vault, as the studio's Ingest and Library tabs see it (the app's own commands; see vault/app).

export type VaultFile = {
	hash: string;
	size: number;
	mime: string;
	kind: string;
	title?: string;
	description?: string;
	tags?: string[];
	/** anything else known: colour, role, shot, its proxy (as the library kept it) */
	meta?: Record<string, unknown>;
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

/** The classes a story keeps its files in, each with its own destinations. */
export const CLASSES = ['default', 'original', 'proxy', 'delivery'] as const;
export type FileClass = (typeof CLASSES)[number];
/**
 * Each class's one name, wherever a class is shown — badge, filter, rules, modal. A file flagged neither original,
 * proxy nor delivery is a working file (its class key stays `default`).
 */
export const CLASS_NAMES: Record<FileClass, { one: string; many: string }> = {
	default: { one: 'working', many: 'working files' },
	original: { one: 'original', many: 'originals' },
	proxy: { one: 'proxy', many: 'proxies' },
	delivery: { one: 'delivery', many: 'deliveries' },
};
/** A class's name (`n` ≠ 1: its plural). */
export const className = (c: FileClass | string, n = 1) => {
	const k = (CLASS_NAMES as Record<string, { one: string; many: string }>)[c] ?? CLASS_NAMES.default;
	return n === 1 ? k.one : k.many;
};
/**
 * The master copies, each device in its one tier: A the master cloud backup, B the local master working copy, C the
 * cold archive (HDD, LTO — not set up yet). The ingest flow shows these three and nothing else; any other device that
 * syncs is just a device.
 */
export const TIERS = [
	{ tier: 'A', store: 'hetzner', name: 'Cloud Master', where: 'avenCEO (Hetzner)' },
	{ tier: 'B', store: 'avenSSD', name: 'Local Master', where: 'avenSSD (internal SSD)' },
	{ tier: 'C', store: null, name: 'Archive', where: 'not set up yet' }
] as const;
export type Tier = (typeof TIERS)[number];
/** The tier letters of the stores a rule names ("hetzner" → A). */
export const tiersOf = (stores: string[]) => TIERS.filter((t) => t.store && stores.includes(t.store)).map((t) => t.tier);

/** A proxy being made or waiting its turn (the app makes one at a time). */
/** a proxy being made (`of`: the original's hash, or `shot:<id>:v<n>`), or a render (`render:<job id>`: stage starting or making) */
export type Making = { of: string; name: string; stage: 'queued' | 'waiting for memory' | 'probing' | 'opening the world' | 'starting' | 'making' | 'adding'; done: number };

/**
 * Where an original's proxy stands, from what the vault says about it (meta.proxy): made (its hash), waiting (no colour
 * journey into ACEScct for its source yet, or a colour nobody can tell), failed, or not tried yet.
 */
export function proxyState(meta: Record<string, unknown> | undefined): { state: 'made' | 'waiting' | 'unknown-colour' | 'failed' | 'pending'; note: string } {
	const p = typeof meta?.proxy === 'string' ? meta.proxy : '';
	if (/^[0-9a-f]{64}$/.test(p)) return { state: 'made', note: 'proxy in ACEScct' };
	if (p.startsWith('waiting: its colour cannot be told')) return { state: 'unknown-colour', note: p.slice(9) };
	if (p.startsWith('waiting')) return { state: 'waiting', note: p.slice(9) };
	if (p.startsWith('failed')) return { state: 'failed', note: p };
	return { state: 'pending', note: 'its proxy comes next' };
}

/** What a person (or an agent) may set; proxy and delivery are written only by their pipelines. */
export const BY_HAND = ['default', 'original'] as const;
/** One file on its way, live from iroh: to this Mac's avenSSD, to the server (hetzner), or to another device. */
export type Moving = { hash: string; dest: string; size: number; sent: number; rate: number; done: boolean; aborted: boolean };
/** Where each class of a story's files is kept: store names ("avenSSD", "hetzner"). */
export type Rules = Record<FileClass, string[]>;
/** A story: the bucket everything of one story lives in. Its id is an iroh namespace key; the inbox's is the catalog's. */
export type Story = { id: string; title: string; description: string; series: string; episode: string; rules: Rules; created: string };
export type StoryView = Story & { inbox: boolean; files: number; bytes: number; classes: Record<FileClass, [number, number]> };

/** Verified copies of a file: this Mac and the server count; two make a card safe to format. */
export const verifiedCopies = (c: Copies) => (c.here === 'verified' ? 1 : 0) + (c.server === 'stored' ? 1 : 0);

/** A file's bytes from this Mac's store — with Range, for <img>, <video> and <audio>. */
export const vaultUrl = (hash: string) => `vault://localhost/${hash}`;

export const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);
export const name = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
