// What the Stories pages know about a story beyond the board's helpers ($lib/admin/board): what each step is for, the
// kinds of beat its journey is made of (each its own colour), where a story's page is, and the links in its pad.
import { base } from '$app/paths';

/** @typedef {import('$lib/auth/client').Status} Status */
/** @typedef {import('$lib/auth/client').BeatType} BeatType */

/** @type {Record<Status, string>} what a story gets at each step */
export const STAGE_NOTE = {
	idea: 'The brainstorm pad: links, concepts, fragments',
	journey: 'The arc: from where to where, beat by beat, and what the viewer feels',
	hook: 'The title, the hook, the description and the 16:9 title card',
	writing: 'The long-form article: the master every output derives from',
	movie: 'The film, in the studio: script to render',
	derivatives: 'The posts derived from the article and the film',
	scheduled: 'When each post goes out',
	published: 'Out: where each one is'
};

/** @type {Record<BeatType, string>} */
export const BEAT_LABEL = {
	hook: 'Hook',
	context: 'Context',
	problem: 'Problem',
	intention: 'Intention',
	obstacle: 'Obstacle',
	low: 'Low',
	turn: 'Turn',
	solution: 'Solution',
	vision: 'Vision'
};

/** @type {Record<BeatType, string>} what a beat of that kind does (storyteller: arc.md, structure.md) */
export const BEAT_NOTE = {
	hook: 'The anchor and the promise: why stay',
	context: 'Who, where, what is at stake: plead the case',
	problem: 'The pain, in the viewer’s own life',
	intention: 'What we set out to do',
	obstacle: 'What gets in the way',
	low: 'The lowest point: it might not work',
	turn: 'The insight that changes the way',
	solution: 'How it was solved, shown working',
	vision: 'What it means, and the door to tomorrow'
};

/** @type {Record<BeatType, string>} each kind its colour, the same on every card and on the curve */
export const BEAT_COLOR = {
	hook: '#e39a2d',
	context: '#7fa37a',
	problem: '#d4683f',
	intention: '#4f86c6',
	obstacle: '#c44d3a',
	low: '#6d5a9e',
	turn: '#2a958d',
	solution: '#4a9a58',
	vision: '#3f9fd6'
};

/** How tense a beat of that kind usually is, for a new beat (0 calm … 1 most). */
/** @type {Record<BeatType, number>} */
export const BEAT_TENSION = { hook: 0.6, context: 0.25, problem: 0.5, intention: 0.4, obstacle: 0.7, low: 0.85, turn: 0.75, solution: 0.5, vision: 0.3 };

/** A story's own page, at a tab. */
export const storyHref = (/** @type {string} */ id, /** @type {string} */ tab = '') =>
	`${base}/app/stories/story/?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`;

/** Every link in a pad, once, in order: its address, its host, and the words written before it on its line. */
export function linksIn(/** @type {string} */ md) {
	/** @type {{ url: string; host: string; label: string }[]} */
	const out = [];
	for (const line of (md ?? '').split('\n')) {
		for (const m of line.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
			const url = m[0].replace(/[.,;:!?]+$/, '');
			if (out.some((l) => l.url === url)) continue;
			let host = url;
			try {
				host = new URL(url).hostname.replace(/^www\./, '');
			} catch {
				/* shown as written */
			}
			const label = line
				.slice(0, m.index)
				.replace(/^[\s>*-]*(\d+\.)?\s*/, '')
				.replace(/[*_`[\]]/g, '')
				.replace(/[\s:—–-]+$/, '')
				.trim();
			out.push({ url, host, label });
		}
	}
	return out;
}

/** About how many words, and minutes to read at 200 a minute. */
export function wordsOf(/** @type {string} */ md) {
	const words = (md ?? '').trim() ? md.trim().split(/\s+/).length : 0;
	return { words, minutes: Math.max(1, Math.round(words / 200)) };
}
