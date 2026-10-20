// What maiaCITY kept before avenDB, copied into a vault once as sparks and artifacts (content-v2 M1d,
// ./LegacyCopy.svelte): each inspire-me report (/inspire-me/<slug>/README.md) a spark that holds its source as an
// artifact (/inspire-me/<slug>/source.md, its words as rows); the journal's sources (/sources/*) artifacts on one spark;
// and each story's idea pad (/blog/<slug>/idea.md) a spark with its links as artifacts. (The admin's notebook, the
// server's ideas, held none when it was dropped, 2026-10-20.) It only copies: the files, the rows and the pages that
// show them stay as they are. Each copy carries a tag that names what it was copied from (`legacy:…`), so copying again
// copies only what is new, and the tag stays out of the tag chips, as every tag with a colon does.

import { parse as parseYaml } from 'yaml';
import { addingArtifact, ARTIFACT, fromLink, youtubeId } from './artifacts.js';
import { addingSpark, CARD, linkIn, sparkRecord, SPARK, textItem, titleOf } from './sparks.js';

/** The repository's files, each read only when it is copied. */
const REPORTS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/inspire-me/*/README.md', { query: '?raw', import: 'default' })
);
const SOURCES = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/inspire-me/*/source.md', { query: '?raw', import: 'default' })
);
const JOURNAL = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/sources/*', { query: '?raw', import: 'default' })
);
const PADS = /** @type {Record<string, () => Promise<string>>} */ (
	import.meta.glob('/blog/*/idea.md', { query: '?raw', import: 'default' })
);

/** The tag a copy of legacy piece `key` carries. @param {string} key */
export const legacyTag = (key) => `legacy:${key}`;

/** The folder or file a path names, without its extension. @param {string} path @param {number} [up] */
const nameAt = (path, up = 1) => (path.split('/').at(-up) ?? '').replace(/\.[a-z0-9]+$/i, '');

/**
 * What is there to copy: each piece its key, what it is, and its name.
 * @returns {{ key: string, kind: 'report' | 'journal' | 'pad', name: string }[]}
 */
export function pieces() {
	return [
		...Object.keys(REPORTS).map((p) => ({ key: `inspire-${nameAt(p, 2)}`, kind: /** @type {const} */ ('report'), name: nameAt(p, 2) })),
		...(Object.keys(JOURNAL).length ? [{ key: 'journal-sources', kind: /** @type {const} */ ('journal'), name: 'Journal sources' }] : []),
		...Object.keys(PADS).map((p) => ({ key: `pad-${nameAt(p, 2)}`, kind: /** @type {const} */ ('pad'), name: nameAt(p, 2) }))
	];
}

/**
 * The pieces vault `vault` holds no copy of yet, among `all`.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {ReturnType<typeof pieces>} all
 */
export function uncopied(world, vault, all) {
	// a piece counts as copied once its spark is: its spark is its copy's last write
	const have = new Set(world.entries.filter((e) => e.vault === vault && e.type === SPARK).flatMap((e) => e.tags ?? []));
	return all.filter((p) => !have.has(legacyTag(p.key)));
}

/** Seconds a time like `1:05` or `1:02:03` reads. @param {string} t */
const seconds = (t) => t.split(':').reduce((s, n) => s * 60 + Number(n), 0);

/**
 * Words as an artifact's rows: a paragraph each, from its time where it starts with one (`1:05 …`, `[1:05] …`).
 * @param {string} text
 */
export function rowsOf(text) {
	let t = 0;
	return text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p, i) => {
			const m = /^\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s+([\s\S]*)$/.exec(p);
			if (m) t = seconds(m[1]);
			return { id: i + 1, t, text: m ? m[2].trim() : p };
		});
}

/**
 * A source file as it is kept: its link and our note on it, where it opens with them (`Source: …`, `Note: …`, then a
 * line `---`), and its words.
 * @param {string} raw
 */
export function sourceOf(raw) {
	const text = raw.replace(/\r\n/g, '\n');
	const cut = /^Source:[\s\S]*?\n---\n/.exec(text);
	if (!cut) return { url: '', note: '', words: text.trim() };
	const head = cut[0].replace(/\n---\n$/, '');
	const url = /^Source:\s*(\S+)/.exec(head)?.[1] ?? '';
	const note = /\nNote:\s*([\s\S]*)$/.exec(head)?.[1].replace(/\s*\n\s*/g, ' ').trim() ?? '';
	return { url, note, words: text.slice(cut[0].length).trim() };
}

/** A report's frontmatter. @param {string} raw */
function frontOf(raw) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	try {
		return (m ? parseYaml(m[1]) : null) ?? {};
	} catch {
		return {};
	}
}

/** Only the fields that hold something. @param {Record<string, any>} o */
const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * The artifact a source is, from its link (./artifacts.js `fromLink`) or none, titled `title`, with `more` on it.
 * @param {string} url @param {string} title @param {Record<string, any>} more
 */
function artifactOf(url, title, more) {
	/** @type {URL | null} */
	let u = null;
	try {
		u = url ? new URL(url) : null;
	} catch {
		u = null;
	}
	const base = u ? fromLink(u) : { kind: ARTIFACT, look: 'link' };
	const by = filled({ ...(/** @type {any} */ (base).by ?? {}), ...(more.by ?? {}) });
	return filled({ ...base, ...more, title, by: Object.keys(by).length ? by : undefined });
}

/** Where the n-th item of a copy goes on its spark's canvas: in a row, four across. @param {number} n */
const spot = (n) => ({ x: CARD.pad + (n % 4) * (CARD.w + CARD.gap), y: CARD.pad + Math.floor(n / 4) * (CARD.h + CARD.gap) });

/**
 * The ops that copy piece `p` into vault `vault`, for `runAll`: its artifacts first, then its spark holding them (each
 * by `$n`, its place among the ops). `tags` are those the caps ask a new spark and artifact to carry.
 * @param {ReturnType<typeof pieces>[number]} p @param {string} vault @param {string} actor
 * @param {{ spark: string[], artifact: string[] }} tags
 * @returns {Promise<object[]>}
 */
export async function copying(p, vault, actor, tags) {
	const mark = legacyTag(p.key);
	/** @type {object[]} */
	const arts = [];
	const art = (/** @type {object} */ value) => arts.push({ ...addingArtifact(vault, value, [...tags.artifact, mark]), as: actor });
	/** @type {any[]} */
	const items = [];
	const holds = () => arts.forEach((_, i) => items.push({ id: items.length + 1, what: 'artifact', ref: { vault, entry: `$${i}` }, ...spot(i) }));
	const note = (/** @type {string} */ text) => items.push({ ...textItem(items, text), ...spot(items.length) });
	/** @type {object} */
	let spark;
	/** @type {string[]} */
	let more = [];

	if (p.kind === 'report') {
		const raw = await REPORTS[`/inspire-me/${p.name}/README.md`]();
		const fm = frontOf(raw);
		const src = sourceOf((await SOURCES[`/inspire-me/${p.name}/source.md`]?.()) ?? '');
		const url = String(fm.source ?? src.url ?? '');
		const kind = String(fm.type ?? '');
		const look = youtubeId(url) ? 'youtube' : kind === 'video' || kind === 'podcast' ? 'video' : 'link';
		art(
			artifactOf(url, String(fm.originalTitle ?? fm.title ?? p.name), {
				look,
				note: src.note,
				by: filled({ name: fm.author, url: fm.authorUrl, image: fm.authorImage }),
				taken: fm.published ? String(fm.published) : undefined,
				language: fm.language ? String(fm.language) : undefined,
				transcript: rowsOf(src.words)
			})
		);
		holds();
		const shift = fm.shift ? `From: ${fm.shift.from ?? ''}\nTo: ${fm.shift.to ?? ''}` : '';
		const quote = fm.quote ? `“${fm.quote}”${fm.quoteBy ? ` (${fm.quoteBy})` : ''}` : '';
		if (shift || quote) note([shift, quote].filter(Boolean).join('\n\n'));
		note(`The report card: https://maia.city/inspire-me/${p.name}`);
		spark = sparkRecord(String(fm.title ?? p.name), String(fm.hook ?? '').trim(), items);
		more = ['inspire-me', ...(Array.isArray(fm.categories) ? fm.categories.map(String) : [])];
	} else if (p.kind === 'journal') {
		for (const [path, read] of Object.entries(JOURNAL).sort()) {
			const raw = await read();
			const first = raw.split('\n').find((l) => l.trim()) ?? nameAt(path);
			art(artifactOf('', titleOf(first.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim()), { transcript: rowsOf(raw) }));
		}
		holds();
		spark = sparkRecord('Journal sources', 'The sources the journal was written from, kept in the repository before avenDB.', items);
		more = ['journal'];
	} else {
		const raw = await PADS[`/blog/${p.name}/idea.md`]();
		const title = (/^#\s+(.+)$/m.exec(raw)?.[1] ?? p.name).trim();
		const urls = [...new Set(raw.match(/https?:\/\/[^\s)>\]]+/g) ?? [])].map(linkIn).filter((u) => u !== null);
		for (const u of urls) art(fromLink(/** @type {URL} */ (u)));
		holds();
		note(raw.trim());
		spark = sparkRecord(title, `The idea pad of ${p.name}, from before avenDB.`, items);
		more = ['journal'];
	}
	return [...arts, { ...addingSpark(vault, spark, [...new Set([...tags.spark, ...more, mark])]), as: actor }];
}

