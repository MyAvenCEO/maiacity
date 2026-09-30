// A file's words: its transcript (meta.transcript, written server-side for every original with speech — `s`/`e` in
// seconds of the original file), or a voice take's own word timing (meta.words, the captions' format: the render and
// the program monitor read it). Its sound, for a video: the audio proxy (meta.audio — an audio-only .m4a on the
// original's clock). And its timecode (meta.probe.timecode + timecode_fps, on camera files).

/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */
/** @typedef {{ w: string, s: number, e: number, c?: number, sp?: string | number }} Word */
/** @typedef {{ s: number, e: number, text: string, sp?: string | number }} Utterance */
/**
 * @typedef {{ model?: string, language?: string, text?: string, words: Word[], utterances?: Utterance[], of?: string, at?: string }} Transcript
 */
/** A caption word as the render reads it (vault-render timeline.rs `Word`). @typedef {{ word: string, start: number, end: number }} CaptionWord */
/** @typedef {{ s: number, e: number, from: number, to: number, sp?: string | number }} Line */

export const HASH = /^[0-9a-f]{64}$/;

/** @param {unknown} v @returns {v is Word} */
const isWord = (v) => !!v && typeof v === 'object' && typeof (/** @type {Word} */ (v).w) === 'string' && Number.isFinite((/** @type {Word} */ (v).s)) && Number.isFinite((/** @type {Word} */ (v).e));
/** @param {unknown} v @returns {v is CaptionWord} */
const isCaption = (v) =>
	!!v && typeof v === 'object' && typeof (/** @type {CaptionWord} */ (v).word) === 'string' && Number.isFinite((/** @type {CaptionWord} */ (v).start)) && Number.isFinite((/** @type {CaptionWord} */ (v).end));

/** The file's transcript, when it has one with words. @param {MediaItem | undefined} m @returns {Transcript | null} */
export function transcriptOf(m) {
	const t = /** @type {Transcript | undefined} */ (m?.meta?.transcript);
	if (!t || typeof t !== 'object' || !Array.isArray(t.words)) return null;
	const words = t.words.filter(isWord);
	return words.length ? { ...t, words } : null;
}

/** A file's own caption words (meta.words: a voice take's timing, or captions edited by hand). @param {MediaItem | undefined} m @returns {CaptionWord[]} */
const ownCaptions = (m) => (Array.isArray(m?.meta?.words) ? /** @type {unknown[]} */ (m.meta.words).filter(isCaption) : []);

/**
 * A voice file's caption words, as the render reads them (vault-render `caption_words`): its own, else its transcript's
 * — every voice has its captions without anyone asking.
 * @param {MediaItem | undefined} m @returns {CaptionWord[]}
 */
export function captionWordsOf(m) {
	const own = ownCaptions(m);
	if (own.length) return own;
	const t = transcriptOf(m);
	return t ? asCaptions(t.words) : [];
}

/**
 * A file's words on its own clock: the transcript's, else the voice take's own timing.
 * @param {MediaItem | undefined} m @returns {Word[]}
 */
export function wordsOf(m) {
	const t = transcriptOf(m);
	if (t) return t.words;
	return ownCaptions(m).map((x) => ({ w: x.word, s: x.start, e: x.end }));
}

/**
 * @typedef {{ state: 'ready' | 'queued' | 'running' | 'failed' | 'stuck' | 'none' | 'unknown', note: string, progress: number, stage: string }} Step
 */
/**
 * Where one automatic step of a file stands, from its record's view in meta (`<step>_state`, `_stage`, `_progress`,
 * `_tries`): queued (with why it waits, when it says), running (how far), failed and trying again by itself, stuck
 * (failed three times: a person starts it again), none (nothing to find — no speech), or not started.
 * @param {MediaItem | undefined} m @param {'transcript' | 'analysis'} step @returns {Step}
 */
function stepState(m, step) {
	const meta = m?.meta ?? {};
	const st = typeof meta[`${step}_state`] === 'string' ? /** @type {string} */ (meta[`${step}_state`]) : '';
	const progress = Math.max(0, Math.min(1, Number(meta[`${step}_progress`]) || 0));
	const stage = typeof meta[`${step}_stage`] === 'string' ? /** @type {string} */ (meta[`${step}_stage`]) : '';
	const tries = Number(meta[`${step}_tries`]) || 0;
	if (st === 'transcribing' || st === 'analysing') return { state: 'running', note: stage || st, progress, stage };
	if (st.startsWith('queued')) return { state: 'queued', note: st.replace(/^queued:?\s*/, '') || 'queued', progress: 0, stage };
	if (st.startsWith('failed')) return { state: /waits for a person/.test(st) || tries >= 3 ? 'stuck' : 'failed', note: st.replace(/^failed:\s*/, ''), progress: 0, stage };
	if (st.startsWith('none')) return { state: 'none', note: st.replace(/^none:\s*/, ''), progress: 1, stage };
	if (st === 'done') return { state: 'ready', note: 'done', progress: 1, stage };
	return { state: 'unknown', note: 'not started yet', progress: 0, stage };
}

/** Where a file's transcript stands (its words, once there are any, win). @param {MediaItem | undefined} m @returns {Step} */
export function transcriptState(m) {
	const t = transcriptOf(m);
	if (t) return { state: 'ready', note: `${t.words.length} words${t.language ? ` · ${t.language}` : ''}${t.model ? ` · ${t.model}` : ''}`, progress: 1, stage: '' };
	return stepState(m, 'transcript');
}

/** Where a file's shot analysis (tags, cues, thumbnail) stands. @param {MediaItem | undefined} m @returns {Step} */
export function analysisState(m) {
	const a = /** @type {{ tags?: unknown[], summary?: { line?: string } } | undefined} */ (m?.meta?.analysis);
	if (a && typeof a === 'object') return { state: 'ready', note: a.summary?.line || `${Array.isArray(a.tags) ? a.tags.length : 0} tags`, progress: 1, stage: '' };
	return stepState(m, 'analysis');
}

/** Is a step still to come or on its way (not ready, nothing to find, or given up)? @param {Step} s */
export const stepOpen = (s) => s.state === 'queued' || s.state === 'running' || s.state === 'failed' || s.state === 'unknown';

/**
 * Does a video carry sound? Its audio proxy says so, or its probe; an original not probed yet is taken to have it.
 * @param {MediaItem | undefined} m
 */
export function hasSound(m) {
	if (!m || m.kind !== 'video') return m?.kind === 'audio';
	if (m.meta?.sequence === 'exr' || m.class === 'proxy' || typeof m.meta?.shot === 'string') return false;
	if (typeof m.meta?.audio === 'string' && HASH.test(m.meta.audio)) return true;
	const probe = /** @type {{ audio?: boolean } | undefined} */ (m.meta?.probe);
	if (probe && typeof probe.audio === 'boolean') return probe.audio;
	return m.class === 'original';
}
/** A video's audio proxy (its hash), when made. @param {MediaItem | undefined} m @returns {string | null} */
export const audioProxyOf = (m) => (typeof m?.meta?.audio === 'string' && HASH.test(m.meta.audio) ? m.meta.audio : null);

/**
 * The transcript in lines to read: its utterances when it has them, else sentences (a full stop, a pause longer than
 * 0.8 s, a change of speaker, or 16 words).
 * @param {Word[]} words @param {Utterance[] | undefined} [utterances] @returns {Line[]}
 */
export function linesOf(words, utterances) {
	/** @type {Line[]} */
	const out = [];
	if (Array.isArray(utterances) && utterances.length) {
		let i = 0;
		for (const u of utterances) {
			if (!Number.isFinite(u?.s) || !Number.isFinite(u?.e)) continue;
			while (i < words.length && words[i].s < u.s - 0.05) i++;
			const from = i;
			while (i < words.length && words[i].s < u.e - 0.01) i++;
			if (i > from) out.push({ s: words[from].s, e: words[i - 1].e, from, to: i - 1, sp: u.sp });
		}
		// words no utterance covered: lines of their own (never lost)
		if (out.reduce((n, l) => n + l.to - l.from + 1, 0) === words.length) return out;
		out.length = 0;
	}
	let from = 0;
	for (let i = 0; i < words.length; i++) {
		const w = words[i], next = words[i + 1];
		const end = !next || /[.!?…]["»”']?$/.test(w.w) || next.s - w.e > 0.8 || (next.sp !== undefined && next.sp !== w.sp) || i - from >= 15;
		if (end) {
			out.push({ s: words[from].s, e: w.e, from, to: i, sp: words[from].sp });
			from = i + 1;
		}
	}
	return out;
}

/**
 * A time of the file as its timecode ("HH:MM:SS:FF", counted from its start timecode, frames counted without drop), or as file time when
 * it has none.
 * @param {MediaItem | undefined} m @param {number} s
 */
export function timecodeAt(m, s) {
	// the probe's (the camera's start timecode), else the one the transcript kept
	/** @typedef {{ timecode?: string, timecode_fps?: number, fps?: number }} Tc */
	const probe = /** @type {Tc | undefined} */ (m?.meta?.probe);
	const kept = /** @type {Tc | undefined} */ (m?.meta?.transcript);
	const from = typeof probe?.timecode === 'string' ? probe : typeof kept?.timecode === 'string' ? kept : undefined;
	const tc = from?.timecode?.match(/^(\d+):(\d+):(\d+)[:;.](\d+)$/) ?? null;
	if (!tc) return fileTime(s);
	const fps = Math.max(1, Math.round(Number(from?.timecode_fps) || Number(probe?.fps) || 25));
	const [h, mi, se, fr] = tc.slice(1).map(Number);
	const frames = ((h * 60 + mi) * 60 + se) * fps + fr + Math.round(Math.max(0, s) * fps);
	const f = frames % fps, secs = Math.floor(frames / fps);
	const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return `${p(Math.floor(secs / 3600) % 24)}:${p(Math.floor(secs / 60) % 60)}:${p(secs % 60)}:${p(f)}`;
}
/** @param {number} s */
export const fileTime = (s) => {
	const m = Math.floor(s / 60), x = Math.floor(s % 60), cs = Math.floor((s % 1) * 10 + 1e-6);
	return `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}.${cs}`;
};

/**
 * Words into caption phrases, the render's rule (vault-render timeline.rs `phrases`): a phrase ends at a word ending
 * in punctuation once it has three words (at once on a full stop, colon, …), or when it passes 34 characters.
 * @template {{ word: string }} T
 * @param {T[]} words @returns {T[][]}
 */
export function phraseBreak(words) {
	/** @type {T[][]} */
	const out = [];
	/** @type {T[]} */
	let cur = [];
	for (const w of words) {
		cur.push(w);
		const len = cur.map((x) => x.word).join(' ').length;
		if ((/[.,;:!?…]$/.test(w.word) && (cur.length >= 3 || /[.;:!?…]$/.test(w.word))) || len > 34) out.push(cur), (cur = []);
	}
	if (cur.length) out.push(cur);
	return out;
}

/** A transcript's words as caption words (meta.words). @param {Word[]} words @returns {CaptionWord[]} */
export const asCaptions = (words) => words.map((w) => ({ word: w.w, start: Math.round(w.s * 1000) / 1000, end: Math.round(w.e * 1000) / 1000 }));

/**
 * A phrase's words written anew: the same number of words keep their timing; any other number share the phrase's
 * time evenly.
 * @param {CaptionWord[]} old @param {string} text @returns {CaptionWord[]}
 */
export function rewordPhrase(old, text) {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (!old.length || !tokens.length) return [];
	if (tokens.length === old.length) return old.map((w, i) => ({ ...w, word: tokens[i] }));
	const a = old[0].start, b = /** @type {CaptionWord} */ (old.at(-1)).end, step = (b - a) / tokens.length;
	return tokens.map((word, i) => ({ word, start: Math.round((a + i * step) * 1000) / 1000, end: Math.round((a + (i + 1) * step) * 1000) / 1000 }));
}
