/*
 * A story going out as a film (Samuel 2026-10-17: only stories and their posts; script, cut and artwork stay the film
 * workshop behind a video post). A cut's render (the `render` rule, J12) makes its films, `media:delivery` Library
 * files; each one can become a post of type `film` ($lib/avendb/posttypes.js): its `media` the film, beside the cut it
 * was rendered from, that cut's script and the story they all tell.
 */

import { postTag } from '../avendb/posttypes.js';
import { tasksOf } from './jobs/tasks.js';

/** @param {string} s */
const parse = (s) => {
	try {
		return s ? JSON.parse(s) : null;
	} catch {
		return null;
	}
};

/**
 * The films the renders of cut entry `cut` made, the newest render first: each film's file entry, its name, and what
 * the render says of it (its shape and length) where its report is at hand (`value`: a report read from its file, by
 * task entry, for a report too long to keep in the task).
 * @param {import('../avendb/vaults.js').WorldView} world @param {string} cut
 * @param {Record<string, any>} [value]
 */
export function filmsOf(world, cut, value = {}) {
	const byId = new Map(world.entries.map((e) => [e.entry, e]));
	return tasksOf(world)
		.filter((t) => t.rule === 'render' && t.status === 'done' && t.inputs[0]?.entry === cut)
		.sort((a, b) => b.at - a.at)
		.flatMap((t) => {
			const v = value[t.entry] ?? parse(t.result) ?? {};
			// the report lists the films in the order the render put them in, the thumbnails after them
			const said = /** @type {any[]} */ (v.deliveries ?? []).filter((d) => d.kind !== 'thumbnail');
			return t.outputs.flatMap((id, i) => {
				const e = byId.get(id);
				if (!e || e.deleted) return [];
				const d = said[i] ?? {};
				return [{ task: t.entry, file: e, name: /** @type {any} */ (e.record)?.name ?? e.title ?? 'A film', aspect: d.aspect ?? '', seconds: d.seconds ?? null, format: d.format ?? '' }];
			});
		});
}

/**
 * The film post of film `film` (one of `filmsOf`), of story entry `story`, rendered from cut entry `cut` of the script
 * the cut names: titled as the story is, its words to be written from the post type's template.
 * @param {import('../avendb/vaults.js').EntryView} story @param {import('../avendb/vaults.js').EntryView} cut
 * @param {{ file: import('../avendb/vaults.js').EntryView, aspect: string, seconds: number | null }} film
 */
export function filmPost(story, cut, film) {
	const t = parse(/** @type {any} */ (cut.record)?.timeline ?? '') ?? {};
	const r = /** @type {any} */ (story.record) ?? {};
	return {
		kind: postTag('film'),
		title: story.title || r.title || 'A film',
		text: '',
		story: { vault: story.vault, entry: story.entry },
		channel: 'Film',
		media: { vault: film.file.vault, entry: film.file.entry },
		cut: { vault: cut.vault, entry: cut.entry },
		...(t.script?.entry ? { script: t.script } : {}),
		shape: film.aspect || '16:9',
		...(film.seconds != null ? { seconds: film.seconds } : {}),
		...(r.language ? { language: r.language } : {}),
		tags: []
	};
}

/** The film posts of film file entry `file`. @param {import('../avendb/vaults.js').WorldView} world @param {string} file */
export const postsOfFilm = (world, file) =>
	world.entries.filter((e) => e.type === 'post' && !e.deleted && /** @type {any} */ (e.record)?.kind === postTag('film') && /** @type {any} */ (e.record)?.media?.entry === file);
