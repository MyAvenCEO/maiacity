<!--
	The timeline: picture (V1), voice (A1), music (A2), sound (A3) and the captions (T1) that follow the voice. Every clip
	moves by hand in Edit — drag it to move it, drag its edges to trim it, click it to see and set it in the inspector —
	and nothing moves once the edit is locked. A world clip (a shot as data) sits on V1 like any other; selected, its
	keyframe lanes open under the tracks: the camera's keys, the hour, the exposure, the lights and the cues (a sound cue
	lands on A3, where it plays). A video's picture and its sound (its own clip, on a sound track) are linked: one moves and
	trims the other — Alt moves one alone. Zoomed in, a clip with words shows them where they are spoken; the captions
	(T1) are the voice's phrases as the render burns them in.
-->
<script>
	import { evaluate, shotAt, toKeys } from './shots.js';
	import { FPS, TRACKS, UNLINKED, clockText, isWorld, onSoundTrack, raw, thumb, tint } from './studio.svelte.js';
	import { wordsOf } from './transcript.js';
	import { BALANCE_NODES, NEUTRAL, NEUTRAL_BALANCE, cleanBalance, isNeutral, presetOf } from './color.js';
	import { wave } from './wave.js';
	import { fine } from './fine.js';
	import { gradedThumb } from './luts.js';

	/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
	/** @typedef {import('./studio.svelte.js').Clip} Clip */
	/** @typedef {import('./studio.svelte.js').Track} Track */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @param {number} t */
	const x = (t) => `${t * s.pxPerSec}px`;
	const ticks = $derived.by(() => {
		const every = s.pxPerSec >= 40 ? 1 : s.pxPerSec >= 15 ? 5 : 10;
		return Array.from({ length: Math.floor(s.span / every) + 1 }, (_, i) => i * every);
	});
	/** the world clip whose lanes are open */
	const wc = $derived((s.tab === 'edit' || s.tab === '3d') && isWorld(s.sel) ? s.sel : null);
	const spec = $derived(wc ? s.specOf(wc) : null);
	const LANES = ['Camera', 'Hour', 'Exposure', 'Lights', 'Cues'];
	// the Audio tab: the sound tracks only, taller, each clip with its level on it
	const audio = $derived(s.tab === 'audio');
	// the Script tab: the story's structure (its sections and their tension) over the captions
	const story = $derived(s.tab === 'script');
	const STORY = { id: 'S1', label: 'Story', accepts: [] };
	// the Grade tab: the grade's layers over the picture track, the last applied on top — each collapsed to its
	// values, open for its controls on every shot
	const grading = $derived(s.tab === 'grade');
	const GRADE_LAYERS = [
		{ id: 'L:look', label: 'Film look' },
		{ id: 'L:grade', label: 'Grade' },
		{ id: 'L:frame', label: 'Framing' },
		...[...BALANCE_NODES].reverse().map((n) => ({ id: `L:${n.id}`, label: n.label }))
	].map((l) => ({ ...l, accepts: [] }));
	// in Grade the shots stand side by side, one column each whatever their length, each with its picture: the grade is
	// judged shot against shot, not along the clock
	const COL = 168;
	const pics = $derived(grading ? s.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start) : []);
	const colOf = $derived(new Map(pics.map((c, i) => [c.id, i])));
	/** where a picture clip sits: its column in Grade, its time elsewhere @param {Clip} c */
	const left = (c) => (grading ? `${(colOf.get(c.id) ?? 0) * COL}px` : x(c.start));
	/** @param {Clip} c */
	const width = (c) => (grading ? `${COL}px` : x(c.dur));
	/** the shot under the playhead */
	const nowId = $derived(grading ? pics.find((c) => s.time >= c.start && s.time < c.start + c.dur)?.id ?? null : null);
	/**
	 * A shot's picture for the strip: its original's preview (the grading still's frame through the output transform),
	 * else its thumbnail.
	 * @param {Clip} c
	 */
	const previewOf = (c) => {
		if (!c.hash) return null;
		const orig = String(s.byHash.get(c.hash)?.meta?.proxy_of ?? c.hash);
		const meta = s.byHash.get(orig)?.meta;
		const h = [meta?.preview, meta?.thumbnail].find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
		return h ? raw(/** @type {string} */ (h)) : null;
	};
	// every picture clip's thumbnail as it will look: its grading still through its balance and grades, made by the Mac
	// (the grade's only maths) a moment after they change — the Grade strip and the Edit timeline show these
	let thumbs = $state(/** @type {Record<string, string>} */ ({}));
	/** @type {Record<string, string>} */
	const thumbOf = {};
	const thumbKeys = $derived(
		Object.fromEntries(
			s.clips
				.filter((c) => c.track === 'V1' && c.hash)
				.map((c) => {
					const st = s.stillOf(c);
					return [c.id, st ? JSON.stringify([st.hash, s.balanceOf(c), s.gradesOf(c)]) : ''];
				})
		)
	);
	$effect(() => {
		const keys = thumbKeys;
		let live = true;
		const t = setTimeout(() => {
			for (const [id, k] of Object.entries(keys)) {
				if (!k || thumbOf[id] === k) continue;
				const [still, b, g] = JSON.parse(k);
				gradedThumb(still, b, g)
					.then((u) => live && ((thumbs[id] = u), (thumbOf[id] = k)))
					.catch((e) => console.warn('thumbnail:', e));
			}
		}, 200);
		return () => ((live = false), clearTimeout(t));
	});
	/** a shot picked in the strip: selected, and the playhead on its grading still (else its first frame) @param {Clip} c */
	const pick = (c) => {
		s.selected = c.id;
		const st = s.stillOf(c);
		s.seek(st?.inside ? c.start + (st.t - c.in) : c.start + 1e-3);
	};
	let openLayers = $state(/** @type {string[]} */ ([]));
	/** @param {string} id */
	const toggleLayer = (id) => (openLayers = openLayers.includes(id) ? openLayers.filter((x) => x !== id) : [...openLayers, id]);
	const shown = $derived(
		audio ? TRACKS.filter((t) => t.id.startsWith('A')) : story ? [STORY, ...TRACKS.filter((t) => t.id === 'T1')] : grading ? [...GRADE_LAYERS, ...TRACKS.filter((t) => t.id === 'V1')] : TRACKS
	);
	const rows = $derived(
		grading ? `1.5rem ${GRADE_LAYERS.map((l) => (openLayers.includes(l.id) ? (l.id === 'L:grade' || l.id === 'L:look' ? '7.2rem' : l.id === 'L:wb' || l.id === 'L:frame' ? '4.4rem' : '2.8rem') : '1.5rem')).join(' ')} 7.2rem` :
		story ? '1.5rem minmax(5rem, 3fr) minmax(2.6rem, 1fr)' :
		audio ? `1.5rem repeat(${shown.length}, minmax(3.4rem, 1fr))` : `1.5rem minmax(2.6rem, 1fr) repeat(4, minmax(1.7rem, 1fr))${spec ? ` repeat(${LANES.length}, 1.45rem)` : ''}`
	);

	// ── the level on the clip (Audio): its gain as a line to drag, its fades as corners to drag, its loudness ──
	const TOP_DB = 12, BOTTOM_DB = -40;
	/** @param {number} vol */
	const dbOf = (vol) => (vol > 0 ? 20 * Math.log10(vol) : BOTTOM_DB);
	/** @param {number} db */
	const yOf = (db) => (TOP_DB - Math.max(BOTTOM_DB, Math.min(TOP_DB, db))) / (TOP_DB - BOTTOM_DB);
	/** @param {string} id */
	const loudOf = (id) => s.loud?.clips?.find((/** @type {any} */ m) => m.clip === id);
	/** @param {string} id */
	const overMusic = (id) => s.loud?.voice_over_music?.find((/** @type {any} */ u) => u.voice === id)?.voice_over_music_lu;
	/** the clip's loudness curve (LUFS at its gain), on its own clock, as an SVG path in (seconds, 0…1) @param {Clip} c */
	function curveOf(c) {
		const m = loudOf(c.id);
		if (!m?.curve) return '';
		let d = '', pen = false;
		m.curve.forEach((/** @type {number | null} */ l, /** @type {number} */ i) => {
			if (typeof l !== 'number') return void (pen = false);
			const y = Math.min(1, Math.max(0, -(l + dbOf(c.vol)) / 60));
			d += `${pen ? 'L' : 'M'}${((i + 0.5) * m.curve_step).toFixed(2)},${y.toFixed(3)}`;
			pen = true;
		});
		return d;
	}
	/**
	 * Drag the level (up and down: the gain, 0.5 dB steps) or a fade (left and right, its corner).
	 * @param {PointerEvent} e @param {Clip} c @param {'gain' | 'fin' | 'fout'} what
	 */
	function level(e, c, what) {
		e.stopPropagation();
		e.preventDefault();
		s.selected = c.id;
		const box = /** @type {HTMLElement} */ (e.currentTarget).closest('.clip')?.getBoundingClientRect();
		if (!box) return;
		const y0 = e.clientY, x0 = e.clientX, db0 = dbOf(c.vol), fin0 = c.fin ?? 0, fout0 = c.fout ?? 0;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			if (what === 'gain') {
				const db = Math.round((db0 - ((ev.clientY - y0) / box.height) * (TOP_DB - BOTTOM_DB)) * 2) / 2;
				s.setSound(c.id, { vol: Math.round(10 ** (Math.min(TOP_DB, Math.max(-60, db)) / 20) * 1000) / 1000 });
			} else {
				const dt = (ev.clientX - x0) / s.pxPerSec;
				const v = Math.round(Math.min(c.dur / 2, Math.max(0, what === 'fin' ? fin0 + dt : fout0 - dt)) * 20) / 20;
				s.setSound(c.id, { [what]: v });
			}
		};
		const up = () => (removeEventListener('pointermove', move), removeEventListener('pointerup', up));
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
	}

	// ── J and L cuts: clips of one track that overlap sit in two lanes, the overlap marked by what it does at the
	// picture cut in it — J: the next sound comes in before the cut; L: the last one runs on past it; × no cut ─
	const cuts = $derived(s.clips.filter((c) => c.track === 'V1' && c.start > 0.05).map((c) => c.start));
	/** per track: each clip's shape (where the one before still sounds over its head, where the next already sounds
	 * over its tail: fractions of its length), and the overlaps */
	const layout = $derived.by(() => {
		/** @type {Record<string, { shape: Record<string, { head: number, tail: number }>, overlaps: { from: number, to: number, kind: 'J' | 'L' | '×' }[] }>} */
		const out = {};
		for (const t of TRACKS) {
			const list = s.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start);
			/** @type {Record<string, { head: number, tail: number }>} */
			const shape = {};
			for (const c of list) shape[c.id] = { head: 0, tail: 1 };
			/** @type {{ from: number, to: number, kind: 'J' | 'L' | '×' }[]} */
			const overlaps = [];
			let prev = /** @type {Clip | null} */ (null);
			for (const c of list) {
				const end = prev ? prev.start + prev.dur : -1;
				if (prev && c.start < end - 0.02) {
					shape[prev.id].tail = Math.min(shape[prev.id].tail, (c.start - prev.start) / prev.dur);
					shape[c.id].head = Math.max(shape[c.id].head, (Math.min(end, c.start + c.dur) - c.start) / c.dur);
					const from = c.start, to = Math.min(end, c.start + c.dur);
					const cut = cuts.find((k) => k >= from - 0.05 && k <= to + 0.05);
					overlaps.push({ from, to, kind: t.id === 'V1' || cut === undefined ? '×' : Math.abs(cut - to) < Math.abs(cut - from) ? 'J' : 'L' });
				}
				if (!prev || c.start + c.dur > end) prev = c;
			}
			out[t.id] = { shape, overlaps };
		}
		return out;
	});
	/**
	 * A clip's outline with its overlaps: full height, but over the head the one before still sounds (it keeps the
	 * bottom half there) and over the tail the next already sounds (it keeps the top half) — so a J or an L reads as one.
	 * @param {string} track @param {Clip} c
	 */
	function outline(track, c) {
		const sh = layout[track]?.shape[c.id];
		if (!sh || (sh.head <= 0 && sh.tail >= 1)) return undefined;
		const g = `${(sh.head * 100).toFixed(2)}%`, f = `${(sh.tail * 100).toFixed(2)}%`;
		return `polygon(${g} 0, 100% 0, 100% ${sh.tail < 1 ? '50%' : '100%'}, ${f} ${sh.tail < 1 ? '50%' : '100%'}, ${f} 100%, 0 100%, 0 ${sh.head > 0 ? '50%' : '0'}, ${g} ${sh.head > 0 ? '50%' : '0'})`;
	}
	/** a linked sound against its own picture: J when it leads it, L when it trails it @param {Clip} c */
	function leadTrail(c) {
		if (!onSoundTrack(c) || !c.link) return '';
		const p = s.partnerOf(c);
		if (!p) return '';
		return [c.start < p.start - 0.05 ? 'J' : '', c.start + c.dur > p.start + p.dur + 0.05 ? 'L' : ''].join('');
	}

	const SECTION = /** @type {Record<string, string>} */ ({ thumbnail: 'Thumbnail', hook: 'Hook', act1: 'Act 1', act2: 'Act 2', act3: 'Act 3', cliffhanger: 'Cliffhanger' });
	/** the tension across the story: every section's points on the film's clock, one line (0 at the bottom, 1 at the top) @param {Clip[]} secs */
	function tensionPath(secs) {
		const pts = secs
			.filter((c) => c.section !== 'thumbnail')
			.flatMap((c) => (c.tension ?? []).map((p) => [c.start + p.t * c.dur, 1 - p.v]))
			.sort((a, b) => a[0] - b[0]);
		return pts.map(([t, y], i) => `${i ? 'L' : 'M'}${t.toFixed(2)},${(0.1 + y * 0.8).toFixed(3)}`).join('');
	}

	// during playback the view follows the playhead: a page on when it nears the right edge, back when it is off
	// to the left (a seek), never while paused — then the view is the editor's
	/** @type {HTMLDivElement | null} */
	let scroller = $state(null);
	$effect(() => {
		const t = s.time;
		if (!s.playing || !scroller) return;
		const px = grading ? (colOf.get(nowId ?? '') ?? 0) * COL : t * s.pxPerSec, w = scroller.clientWidth, at = scroller.scrollLeft;
		if (px > at + w * 0.85 || px < at) scroller.scrollLeft = Math.max(0, px - w * 0.15);
	});

	// measured by itself in Audio: when the tab opens, and a moment after the sound clips change
	const soundKey = $derived(audio ? JSON.stringify(s.clips.filter((c) => c.track !== 'V1').map((c) => [c.id, c.hash, c.start, c.in, c.dur])) : '');
	$effect(() => {
		if (!soundKey) return;
		const t = setTimeout(() => void s.measureSound(), s.loud ? 1500 : 0);
		return () => clearTimeout(t);
	});
	/** timeline time of a shot-local time in the open world clip */
	/** @param {number} t */
	const tl = (t) => (wc ? wc.start + (t - wc.in) : 0);
	/** @param {number} t */
	const inClip = (t) => !!wc && t >= wc.in - 1e-6 && t <= wc.in + wc.dur + 1e-6;

	// ── by hand: move, trim, seek, drop ──────────────────────────────────────
	/** @param {PointerEvent} e @param {Clip} c @param {'move' | 'left' | 'right'} mode */
	function grab(e, c, mode) {
		e.stopPropagation();
		e.preventDefault();
		s.selected = c.id;
		s.selectedKey = null;
		if (!s.canEdit) return;
		const x0 = e.clientX, s0 = c.start, i0 = c.in, d0 = c.dur;
		// a still, a slate or a line has no length of its own: any
		const isImage = c.kind === 'slate' || c.kind === 'line' || (!isWorld(c) && s.byHash.get(c.hash ?? '')?.kind === 'image');
		const max = isImage ? Infinity : isWorld(c) ? (s.specOf(c)?.seconds ?? d0 + i0) : (s.sources[c.hash ?? '']?.duration ?? d0 + i0);
		// its linked partner (a video's picture, its sound) moves and trims with it — unless Alt is held: this one alone
		const p0 = e.altKey ? null : s.partnerOf(c);
		const pmax = p0 ? (s.sources[p0.hash ?? '']?.duration ?? p0.dur + p0.in) : Infinity;
		let moved = false;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const dt = (ev.clientX - x0) / s.pxPerSec;
			if (Math.abs(ev.clientX - x0) > 1) moved = true;
			const i = s.clips.findIndex((k) => k.id === c.id);
			if (i < 0) return;
			const k = { ...s.clips[i] };
			if (mode === 'move') k.start = Math.max(0, s.snap(s0 + dt));
			if (mode === 'left') {
				// trimming the head: the clip starts later and plays from further in (a world clip: later in its move — never faster)
				const d = Math.min(Math.max(s.snap(dt), -Math.min(s0, isImage ? s0 : i0, p0 ? Math.min(p0.start, p0.in) : Infinity)), d0 - 0.2, p0 ? p0.dur - 0.2 : Infinity);
				k.start = s0 + d;
				k.in = isImage ? 0 : i0 + d;
				k.dur = d0 - d;
			}
			if (mode === 'right') k.dur = Math.min(Math.max(0.2, s.snap(d0 + dt)), max - i0, p0 ? pmax - p0.in - (p0.dur - d0) : Infinity);
			s.clips[i] = k;
			if (p0) {
				const j = s.clips.findIndex((x) => x.id === p0.id);
				if (j >= 0) s.clips[j] = { ...s.clips[j], start: Math.max(0, p0.start + (k.start - s0)), in: Math.max(0, p0.in + (k.in - i0)), dur: Math.max(0.2, p0.dur + (k.dur - d0)) };
			}
			// the playhead follows the edge in hand: the monitor shows the very frame the cut lands on — the first frame
			// of a trimmed head, the last of a trimmed tail
			// (seek, not a bare time: the monitor's player is moved to that frame too)
			if (!s.playing && mode !== 'move') s.seek(mode === 'left' ? k.start : Math.max(k.start, k.start + k.dur - 1 / FPS));
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (moved) {
				s.changed();
				if (s.playing) s.schedule();
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ── words inside the clips, where they are spoken (zoomed in far enough to read) ──
	const WORD_ZOOM = 25;
	/**
	 * The words of a clip's file within the part it plays, placed in the clip (px), those that would overlap the one
	 * before left out.
	 * @param {Clip} c @param {import('$lib/auth/client').MediaItem | undefined} m
	 */
	function clipWords(c, m) {
		if (s.pxPerSec < WORD_ZOOM || !m || isWorld(c)) return [];
		// a picture shows its words only while its sound is its own (not pulled out onto a sound track)
		if (c.track === 'V1' && (m.kind !== 'video' || s.partnerOf(c) || !c.vol)) return [];
		/** @type {{ x: number, w: string }[]} */
		const out = [];
		let right = -Infinity;
		for (const w of wordsOf(m)) {
			if (w.e <= c.in) continue;
			if (w.s >= c.in + c.dur) break;
			const x = Math.max(0, (w.s - c.in) * s.pxPerSec);
			if (x < right) continue;
			out.push({ x, w: w.w });
			right = x + w.w.length * 5.4 + 5;
		}
		return out;
	}
	/** @type {Record<string, string>} */
	const soundNote = { loading: 'reading its sound…', waiting: 'no audio proxy yet', silent: 'no sound in this file' };

	/** @param {PointerEvent} e */
	function scrub(e) {
		const lanes = s.lanes;
		// in Grade the shots are columns, not time: a shot is picked by its own column
		if (!lanes || grading) return;
		// a click in the world clip's lanes moves the playhead and keeps the clip (and its lanes) in hand
		if (!(/** @type {Element} */ (e.target)).closest?.('.lane')) s.selected = null;
		s.selectedKey = null;
		/** @param {PointerEvent} ev */
		const put = (ev) => s.seek((ev.clientX - lanes.getBoundingClientRect().left) / s.pxPerSec);
		put(e);
		const up = () => (window.removeEventListener('pointermove', put), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', put);
		window.addEventListener('pointerup', up);
	}

	/** @param {DragEvent} e @param {Track} track */
	async function drop(e, track) {
		e.preventDefault();
		if (!s.lanes) return;
		const at = (e.clientX - s.lanes.getBoundingClientRect().left) / s.pxPerSec;
		const shot = e.dataTransfer?.getData('text/x-shot');
		if (shot) {
			if (track !== 'V1') return void (s.error = 'A world shot goes on V1.');
			const got = await shotAt(shot, Number(e.dataTransfer?.getData('text/x-shot-version')) || undefined);
			if (got) s.placeShot(got, at);
			return;
		}
		const hash = e.dataTransfer?.getData('text/x-hash');
		if (!hash) return;
		// from the source monitor a drag carries the marked range too
		/** @type {{ in: number, dur: number } | undefined} */
		let range;
		try {
			const r = JSON.parse(e.dataTransfer?.getData('text/x-range') || 'null');
			if (r && typeof r.in === 'number' && typeof r.dur === 'number') range = r;
		} catch {
			/* no range: the whole file */
		}
		void s.place(hash, track, at, range);
	}

	// ── the world clip's lanes ────────────────────────────────────────────────
	const keys = $derived(spec?.camera.kind === 'keys' ? (spec.camera.keys ?? []) : null);
	/** @param {PointerEvent} e @param {number} i */
	function dragKey(e, i) {
		e.stopPropagation();
		e.preventDefault();
		s.selectedKey = i;
		if (!wc || !keys || !s.canEdit) return;
		const clip = wc, x0 = e.clientX, t0 = keys[i].t;
		s.seek(tl(t0));
		let moved = false;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const dt = (ev.clientX - x0) / s.pxPerSec;
			if (Math.abs(ev.clientX - x0) < 2 && !moved) return;
			moved = true;
			const t = Math.min(clip.in + clip.dur, Math.max(clip.in, Math.round((t0 + dt) * 30) / 30));
			s.editSpec(clip, (sp) => {
				const k = sp.camera.keys?.[i];
				if (k) k.t = t;
			});
			s.seek(tl(t));
		};
		const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	/** A key where the camera is at that moment (so adding one changes nothing until it is moved). */
	/** @param {MouseEvent} e */
	function addKey(e) {
		e.stopPropagation();
		if (!wc || !spec || !s.canEdit || !s.lanes) return;
		const at = (e.clientX - s.lanes.getBoundingClientRect().left) / s.pxPerSec;
		const t = Math.min(wc.in + wc.dur, Math.max(wc.in, wc.in + (at - wc.start)));
		const ev = evaluate(spec, t);
		/** @type {import('$lib/auth/client').CameraKey} */
		const k = { t: Math.round(t * 30) / 30, position: [ev.pose[0], ev.pose[1], ev.pose[2]], yaw: ev.pose[3], pitch: ev.pose[4], fov: ev.fov };
		s.editSpec(wc, (sp) => {
			const list = sp.camera.kind === 'keys' ? (sp.camera.keys ?? []) : (toKeys(sp) ?? []);
			sp.camera = { kind: 'keys', curve: sp.camera.curve ?? 'glide', keys: [...list, k].sort((a, b) => a.t - b.t) };
		});
		s.seek(tl(k.t));
	}
	/** @param {PointerEvent} e @param {number} i */
	function dragCue(e, i) {
		e.stopPropagation();
		e.preventDefault();
		if (!wc || !spec || !s.canEdit) return;
		const clip = wc, x0 = e.clientX, t0 = spec.cues[i].at;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const t = Math.min(clip.in + clip.dur, Math.max(clip.in, Math.round((t0 + (ev.clientX - x0) / s.pxPerSec) * 30) / 30));
			s.editSpec(clip, (sp) => void (sp.cues[i].at = t));
		};
		const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	/** @param {number} v */
	const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
	/** @param {ShotSpec} sp */
	const hourText = (sp) => `${fmt(sp.time.hour)} h${sp.time.hourTo !== undefined && sp.time.hourTo !== sp.time.hour ? ` → ${fmt(sp.time.hourTo)} h` : ''}`;
	/** @param {ShotSpec} sp */
	const expText = (sp) => {
		const st = sp.exposure.stops;
		const stops = Array.isArray(st) ? `${st.length} keys of stops` : `${st >= 0 ? '+' : ''}${fmt(st)} stops`;
		return `${sp.exposure.meter} · ${stops}${sp.exposure.ev !== undefined ? ` · EV ${fmt(sp.exposure.ev)}` : ''}`;
	};
	/** @param {ShotSpec} sp */
	const lightText = (sp) =>
		sp.lights.length ? sp.lights.map((l) => `${l.id} ${Array.isArray(l.intensity) ? '∿' : fmt(l.intensity ?? 1, 2)}`).join(' · ') : 'no light changes';
</script>

{#snippet cdlCell(/** @type {import('$lib/auth/client').Cdl | null} */ g, /** @type {string | null} */ preset, /** @type {boolean} */ open, /** @type {(g: import('$lib/auth/client').Cdl | null, preset?: string | null) => void} */ set)}
	{@const cur = g ?? NEUTRAL}
	{#if open}
		<div class="chips">
			{#each s.presets as p (p.name)}<button class:on={(preset ?? presetOf(g, s.presets)) === p.name} title={p.label} onclick={() => set(isNeutral(p.cdl) ? null : structuredClone(p.cdl), p.name === 'neutral' ? null : p.name)}>{p.name}</button>{/each}
		</div>
		{#each [['slope', 'gain', 0, 2], ['offset', 'lift', -0.2, 0.2], ['power', 'gamma', 0.4, 2.5]] as [k, label, lo, hi] (k)}
			{@const key = /** @type {'slope' | 'offset' | 'power'} */ (k)}
			{@const mean = (cur[key][0] + cur[key][1] + cur[key][2]) / 3}
			<label class="sl"><span>{label}</span><input {@attach fine()} type="range" min={lo} max={hi} step="0.005" value={mean} oninput={(e) => { const v = Number(e.currentTarget.value); const next = structuredClone($state.snapshot(cur)); for (let i = 0; i < 3; i++) next[key][i] = +(next[key][i] + v - mean).toFixed(4); set(isNeutral(next) ? null : next); }} /><output>{mean.toFixed(3)}</output></label>
		{/each}
		<label class="sl"><span>sat</span><input {@attach fine()} type="range" min="0" max="2" step="0.01" value={cur.sat} oninput={(e) => { const next = { ...structuredClone($state.snapshot(cur)), sat: Number(e.currentTarget.value) }; set(isNeutral(next) ? null : next); }} /><output>{cur.sat.toFixed(2)}</output></label>
	{:else}
		<span class="val" class:on={!!g || !!preset}>{preset ?? (g ? presetOf(g, s.presets) ?? 'own' : '—')}</span>
	{/if}
{/snippet}

<div class="timeline" style:--rows={rows}>
	<div class="heads">
		<div class="head"></div>
		{#each shown as t (t.id)}
			{#if t.id.startsWith('L:')}
				<button class="head layer" class:open={openLayers.includes(t.id)} onclick={() => toggleLayer(t.id)} title="Open or close this layer's controls"><span class="caret">{openLayers.includes(t.id) ? '▾' : '▸'}</span> {t.label}</button>
			{:else}<div class="head"><b>{t.id}</b> {t.label}</div>{/if}
		{/each}
		{#if spec}
			{#each LANES as l (l)}<div class="head lane-head">{l}</div>{/each}
		{/if}
	</div>
	<div class="scroll" bind:this={scroller}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="lanes" class:locked={!s.canEdit} class:grading bind:this={s.lanes} style:width={grading ? `${pics.length * COL}px` : x(s.span)} onpointerdown={scrub}>
			<div class="ruler">
				{#if grading}
					{#each pics as c, i (c.id)}<span class="tick shot" class:now={nowId === c.id} style:left={left(c)} style:width={width(c)}><b>{i + 1}</b> {clockText(c.start)}</span>{/each}
				{:else}
					{#each ticks as t (t)}<span class="tick" style:left={x(t)}>{t}s</span>{/each}
				{/if}
			</div>
			{#each shown as t (t.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="track" ondragover={(e) => t.id !== 'T1' && s.canEdit && e.preventDefault()} ondrop={(e) => t.id !== 'T1' && drop(e, /** @type {Track} */ (t.id))}>
					{#if t.id.startsWith('L:')}
						{@const open = openLayers.includes(t.id)}
						{#if t.id === 'L:look'}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="cell film" style:left="0" style:width={grading ? `${pics.length * COL}px` : x(s.end)} onpointerdown={(e) => e.stopPropagation()}>
								{@render cdlCell(s.current?.grade?.look ?? null, s.current?.grade?.preset ?? null, open, (g, preset) => s.setMeta({ grade: g || preset ? { look: g, ...(preset ? { preset } : {}) } : null }))}
							</div>
						{:else}
							{#each s.clips.filter((c) => c.track === 'V1') as c (c.id)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="cell" class:sel={s.selected === c.id} style:left={left(c)} style:width={width(c)} onpointerdown={(e) => (e.stopPropagation(), (s.selected = c.id))}>
									{#if t.id === 'L:grade'}
										{@render cdlCell(c.grade ?? null, null, open, (g) => s.patchClip(c.id, { grade: g ?? undefined }))}
									{:else if t.id === 'L:frame'}
										{@const f = c.frame?.[s.shape] ?? { x: 0, y: 0, zoom: 1 }}
										{#if open && !isWorld(c)}
											{#each [['x', -1, 1], ['y', -1, 1], ['zoom', 1, 3]] as [k, lo, hi] (k)}
												<label class="sl"><span>{k}</span><input {@attach fine()} type="range" min={lo} max={hi} step="0.01" value={f[/** @type {'x' | 'y' | 'zoom'} */ (k)]} oninput={(e) => s.setFrame(c.id, s.shape, { ...f, [k]: Number(e.currentTarget.value) })} /></label>
											{/each}
										{:else}<span class="val" class:on={!!c.frame?.[s.shape]}>{c.frame?.[s.shape] ? `${s.shape} · ${f.zoom.toFixed(2)}×` : '—'}</span>{/if}
									{:else}
										{@const n = BALANCE_NODES.find((b) => `L:${b.id}` === t.id)}
										{@const bal = c.balance ?? NEUTRAL_BALANCE}
										{#if n}
											{#if open}
												{#each n.fields as f (f.key)}
													<label class="sl" title="{f.label} {bal[f.key].toFixed(2)} (double-click: 0)"><span>{n.fields.length > 1 ? f.label.slice(0, 4) : ''}</span><input {@attach fine()} type="range" min={f.min} max={f.max} step={f.step} value={bal[f.key]} oninput={(e) => s.patchClip(c.id, { balance: cleanBalance({ ...bal, [f.key]: Number(e.currentTarget.value) }) ?? undefined })} ondblclick={() => s.patchClip(c.id, { balance: cleanBalance({ ...bal, [f.key]: 0 }) ?? undefined })} /><output>{bal[f.key].toFixed(2)}</output></label>
												{/each}
											{:else}
												{@const vals = n.fields.map((f) => bal[f.key])}
												<span class="val" class:on={vals.some((v) => v !== 0)}>{vals.every((v) => v === 0) ? '—' : n.fields.map((f) => `${bal[f.key] > 0 ? '+' : ''}${bal[f.key].toFixed(2)}`).join(' / ')}</span>
											{/if}
										{/if}
									{/if}
								</div>
							{/each}
						{/if}
					{:else if t.id === 'S1'}
						{@const secs = s.clips.filter((c) => c.kind === 'section').sort((a, b) => a.start - b.start)}
						{#each secs as c (c.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="sec {c.section}" class:mark={c.section === 'thumbnail'} style:left={x(c.start)} style:width={x(Math.max(c.section === 'thumbnail' ? 0 : 0.2, c.dur))} onpointerdown={(e) => (e.stopPropagation(), s.seek(c.start))} title={c.text}>
								<span>{SECTION[c.section ?? ''] ?? c.section}</span>
								{#if c.section !== 'thumbnail' && c.text}<small>{c.text}</small>{/if}
							</div>
						{/each}
						<svg class="tension" viewBox="0 0 {Math.max(1, s.span)} 1" preserveAspectRatio="none" style:width={x(s.span)} aria-hidden="true">
							<path d={tensionPath(secs)} />
						</svg>
					{:else if t.id === 'T1'}
						{#each s.phrases as p (`${p.clip}:${p.words[0].i}`)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="clip caps"
								class:now={s.caption === p.words}
								style:left={x(p.start)}
								style:width={x(Math.max(0.2, p.end - p.start))}
								onpointerdown={(e) => (e.stopPropagation(), (s.selected = p.clip), s.seek(p.start))}
								title="{p.words.map((w) => w.word).join(' ')} — edit it in the inspector (its voice clip)"
							>
								<span>{p.words.map((w) => w.word).join(' ')}</span>
							</div>
						{/each}
					{:else if grading && t.id === 'V1'}
						{#each pics as c, i (c.id)}
							{@const pic = thumbs[c.id] ?? previewOf(c)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="shot" class:sel={s.selected === c.id} class:now={nowId === c.id} class:balanced={!!c.balance} style:left={left(c)} style:width={width(c)} onpointerdown={(e) => (e.stopPropagation(), pick(c))} title="{s.clipName(c)}{c.script?.description ? ` — ${c.script.description}` : ''}">
								{#if pic}<img src={pic} alt="" draggable="false" />{:else}<span class="none">{isWorld(c) ? 'world shot' : c.kind === 'slate' ? 'not filmed yet' : 'no picture yet'}</span>{/if}
								<span class="cap"><b>{i + 1}</b> {c.script?.size ?? ''} {c.script?.description ?? s.clipName(c)}</span>
							</div>
						{/each}
					{:else}
						{#each s.clips.filter((c) => c.track === t.id) as c (c.id)}
							{@const m = c.hash ? s.byHash.get(c.hash) : undefined}
							{@const src = c.hash ? s.sources[c.hash] : undefined}
							{@const world = isWorld(c)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							{@const drift = c.link ? s.drift(c) : 0}
							{@const snd = onSoundTrack(c) && m?.kind === 'video' && c.hash ? (s.soundState[c.hash] ?? 'loading') : 'ready'}
							<div
								class="clip {world ? 'world' : c.kind === 'slate' ? 'slate' : c.kind === 'line' ? 'audio line' : onSoundTrack(c) ? 'audio' : m?.kind} {t.id}"
								class:linked={!!c.link && c.link !== UNLINKED}
								class:missing={!!c.hash && !m}
								class:sel={s.selected === c.id}
								class:graded={!!c.grade}
								style:left={x(c.start)}
								style:width={x(c.dur)}
								style:clip-path={outline(t.id, c)}
								onpointerdown={(e) => grab(e, c, 'move')}
								title={world ? `${s.clipName(c)} · world shot v${c.shotVersion}` : `${s.clipName(c)}${c.link ? ' · picture and sound linked (Alt-drag: one alone)' : ''}`}
							>
								{#if m?.kind === 'image'}
									<img src={thumb(m)} alt="" draggable="false" />
								{:else if t.id === 'V1' && thumbs[c.id]}
									<img class="gthumb" src={thumbs[c.id]} alt="" draggable="false" />
								{:else if onSoundTrack(c) && src?.peaks.length}
									<canvas use:wave={{ peaks: src.peaks, from: c.in, to: c.in + c.dur, total: src.buffer?.duration ?? src.duration, color: tint(/** @type {Track} */ (t.id)) }}></canvas>
								{/if}
								{#each clipWords(c, m) as w, i (i)}<span class="wd" style:left="{w.x}px">{w.w}</span>{/each}
								{#if leadTrail(c)}<b class="jl" title="{leadTrail(c) === 'J' ? 'J-cut: its sound comes in before its picture' : leadTrail(c) === 'L' ? 'L-cut: its sound runs on past its picture' : 'Its sound leads and trails its picture'}">{leadTrail(c)}</b>{/if}
								{#if c.hash && !m}<b class="gone" title="This clip's file is not on this Mac yet — it comes with the next sync">not on this Mac yet</b>{/if}
								<span class="label">{#if onSoundTrack(c) && m?.kind === 'video'}<i class="snd">♪&nbsp;</i>{/if}{s.clipName(c)}{#if world}<i>&nbsp;v{c.shotVersion}</i>{/if}</span>
								{#if snd !== 'ready' || drift}
									<span class="chips snd-chips">
										{#if snd !== 'ready'}<b class="nosnd" title={snd}>{soundNote[snd] ?? 'sound failed'}</b>{/if}
										{#if drift}<b class="drift" title="Out of sync with its linked partner by {drift.toFixed(2)} s (the inspector puts it back)">{drift > 0 ? '+' : ''}{drift.toFixed(2)}s</b>{/if}
									</span>
								{/if}
								{#if t.id === 'V1'}
									<span class="chips">
										{#if world}<b class="wtag">world</b>{:else if m}{#if m.kind === 'video' && !s.proxy(m).hash}{@const st = s.proxy(m).state}<b class="nopx" title="No proxy yet: the original plays">{st === 'none' ? 'no proxy' : `proxy ${st}`}</b>{/if}{/if}
										{#if c.grade}<b class="gr" title="Graded">◐</b>{/if}
									</span>
								{/if}
								{#if audio && onSoundTrack(c)}
									{@const g = dbOf(c.vol)}
									{@const y = yOf(g)}
									{@const fi = Math.min(c.fin ?? 0, c.dur / 2)}
									{@const fo = Math.min(c.fout ?? 0, c.dur / 2)}
									{@const lm = loudOf(c.id)}
									{@const om = overMusic(c.id)}
									<svg class="mix" viewBox="0 0 {c.dur} 1" preserveAspectRatio="none" aria-hidden="true">
										<path class="loud" d={curveOf(c)} />
										<polyline class="env" points="0,1 {fi},{y} {c.dur - fo},{y} {c.dur},1" />
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<line class="grab" x1={fi} x2={c.dur - fo} y1={y} y2={y} onpointerdown={(e) => level(e, c, 'gain')} />
									</svg>
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<i class="fade in" style:left={x(fi)} style:top="{y * 100}%" title="Fade in {fi.toFixed(2)} s — drag" onpointerdown={(e) => level(e, c, 'fin')}></i>
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<i class="fade out" style:left={x(c.dur - fo)} style:top="{y * 100}%" title="Fade out {fo.toFixed(2)} s — drag" onpointerdown={(e) => level(e, c, 'fout')}></i>
									<span class="lvl">{g > 0 ? '+' : ''}{g.toFixed(1)} dB{#if typeof lm?.lufs_at_vol === 'number'} · {lm.lufs_at_vol.toFixed(1)} LUFS{/if}{#if typeof om === 'number'} · <b class:low={om < 12}>{om.toFixed(0)} LU over music</b>{/if}</span>
								{/if}
								{#if s.canEdit}
									<i class="edge l" onpointerdown={(e) => grab(e, c, 'left')}></i>
									<i class="edge r" onpointerdown={(e) => grab(e, c, 'right')}></i>
								{/if}
							</div>
						{/each}
						{#each layout[t.id]?.overlaps ?? [] as o, i (i)}
							<span class="overlap {o.kind === '×' ? 'x' : o.kind}" style:left={x(o.from)} style:width={x(Math.max(0.05, o.to - o.from))} title={o.kind === 'J' ? 'J-cut: the next sound comes in before the picture cuts' : o.kind === 'L' ? 'L-cut: the last sound runs on past the picture cut' : 'Two clips overlap'}><b>{o.kind}</b></span>
						{/each}
						{#if t.id === 'A3'}
							{#each s.cueClips as q (q.id)}
								{@const src = s.sources[q.hash ?? '']}
								<div class="clip audio A3 cue" style:left={x(q.start)} style:width={x(q.dur)} title="A sound cue of a world shot (edit it in its Cues lane)">
									{#if src}<canvas use:wave={{ peaks: src.peaks, from: 0, to: q.dur, total: src.duration, color: tint('A3') }}></canvas>{/if}
									<span class="label">cue · {s.byHash.get(q.hash ?? '')?.title || 'sound'}</span>
								</div>
							{/each}
						{/if}
					{/if}
				</div>
			{/each}
			{#if spec && wc}
				<!-- the world clip's keyframe lanes -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="lane" ondblclick={addKey} title={s.canEdit ? 'Double-click to add a camera key here' : ''}>
					<i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i>
					{#if keys}
						{#each keys as k, i (i)}
							<button
								class="key"
								class:on={s.selectedKey === i}
								class:out={!inClip(k.t)}
								style:left={x(tl(k.t))}
								onpointerdown={(e) => dragKey(e, i)}
								ondblclick={(e) => e.stopPropagation()}
								aria-label="Camera key at {fmt(k.t, 2)} s"
							></button>
						{/each}
					{:else}
						<span class="val" style:left={x(wc.start)}>{spec.camera.kind} ({spec.camera.curve ?? 'glide'}) — preset move</span>
					{/if}
				</div>
				<div class="lane"><i class="span hour" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{hourText(spec)}</span></div>
				<div class="lane"><i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{expText(spec)}</span></div>
				<div class="lane"><i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{lightText(spec)}</span></div>
				<div class="lane">
					<i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i>
					{#each spec.cues as q, i (i)}
						<button
							class="key cue {q.kind}"
							class:out={!inClip(q.at)}
							style:left={x(tl(q.at))}
							onpointerdown={(e) => dragCue(e, i)}
							title={q.kind === 'sound' ? `sound cue (lands on A3) at ${fmt(q.at, 2)} s` : `${q.name} at ${fmt(q.at, 2)} s`}
							aria-label="Cue at {fmt(q.at, 2)} s"
						></button>
					{/each}
				</div>
			{/if}
			{#if !grading}<div class="playhead" style:left={x(s.time)}><i></i></div>{/if}
		</div>
	</div>
</div>

<style>
	.timeline {
		grid-area: timeline;
		display: grid;
		grid-template-columns: 7rem 1fr;
		min-height: 0;
		/* at most half the window: more rows (the grade's open layers) scroll inside */
		max-height: 50vh;
		overflow-y: auto;
		background: var(--bg);
	}

	.heads {
		display: grid;
		grid-template-rows: var(--rows);
		border-right: 1px solid var(--edge);
		background: var(--panel);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.7rem;
		border-bottom: 1px solid var(--edge);
		font-size: 0.75rem;
		color: var(--dim);
	}

	.head b {
		color: var(--ink);
	}

	.lane-head {
		padding-left: 1.2rem;
		font-size: 0.66rem;
		background: var(--chrome);
		color: var(--cyan);
	}

	.scroll {
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.lanes {
		position: relative;
		display: grid;
		grid-template-rows: var(--rows);
		min-width: 100%;
		height: 100%;
		cursor: text;
		touch-action: none;
		user-select: none;
	}

	.ruler,
	.track,
	.lane {
		position: relative;
		border-bottom: 1px solid var(--edge);
	}

	.ruler {
		background: var(--chrome);
	}

	.lane {
		background: var(--lane);
	}

	.tick {
		position: absolute;
		top: 0;
		height: 100%;
		padding-left: 3px;
		border-left: 1px solid var(--edge);
		font-size: 0.62rem;
		line-height: 1.5rem;
		color: var(--dim);
	}

	.clip {
		position: absolute;
		top: 0.3rem;
		bottom: 0.3rem;
		overflow: hidden;
		border: 1px solid;
		border-radius: 6px;
		cursor: grab;
	}

	.locked .clip {
		cursor: pointer;
	}

	/* the level on a sound clip (Audio) */
	.mix {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.mix .loud {
		fill: none;
		stroke: rgb(230 238 247 / 0.4);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.mix .env {
		fill: rgb(230 238 247 / 0.1);
		stroke: var(--ink);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.mix .grab {
		stroke: transparent;
		stroke-width: 12;
		vector-effect: non-scaling-stroke;
		cursor: ns-resize;
		pointer-events: stroke;
	}

	.fade {
		position: absolute;
		z-index: 2;
		width: 0.55rem;
		height: 0.55rem;
		margin: -0.275rem 0 0 -0.275rem;
		border: 1.5px solid var(--ink);
		border-radius: 50%;
		background: var(--bg);
		cursor: ew-resize;
	}

	.lvl {
		position: absolute;
		right: 0.35rem;
		bottom: 0.15rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.6rem;
		color: var(--ink);
		pointer-events: none;
	}

	.lvl b {
		font-weight: 600;
	}

	.lvl b.low {
		color: var(--bad);
	}

	.clip:active {
		cursor: grabbing;
	}

	.clip.sel {
		box-shadow: 0 0 0 2px var(--accent);
	}

	.clip.image,
	.clip.video {
		display: flex;
		border-color: #4fae84;
		background: #103527;
	}

	/* the grade's layers (Grade), one row each over V1: a cell per shot, its values, or its controls when open */
	.head.layer {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		width: 100%;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.7rem;
		text-align: left;
		color: var(--dim);
		cursor: pointer;
	}

	.head.layer.open {
		color: var(--ink);
	}

	.head.layer .caret {
		font-size: 0.6rem;
	}

	.cell {
		position: absolute;
		top: 1px;
		bottom: 1px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.1rem;
		overflow: hidden;
		padding: 0 0.35rem;
		border-left: 1px solid var(--edge);
		background: rgb(230 238 247 / 0.035);
	}

	.cell.sel {
		background: var(--warn-bg);
	}

	.cell.film {
		background: rgb(0 0 0 / 0.2);
	}

	.cell .val {
		overflow: hidden;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.62rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #6c84a0;
	}

	.cell .val.on {
		color: var(--warn);
	}

	.cell .sl {
		display: grid;
		grid-template-columns: 2.2rem minmax(2rem, 1fr) 2.2rem;
		gap: 0.25rem;
		align-items: center;
		font-size: 0.6rem;
		color: var(--dim);
	}

	.cell .sl input {
		width: 100%;
		accent-color: var(--ink);
	}

	.cell .sl output {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.58rem;
		text-align: right;
	}

	.cell .chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem;
	}

	.cell .chips button {
		padding: 0 0.35rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.58rem;
		color: var(--ink);
		cursor: pointer;
	}

	.cell .chips button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}

	/* the story (Script): its sections as bands, the tension as one line over them */
	.sec {
		position: absolute;
		top: 0.3rem;
		bottom: 0.3rem;
		overflow: hidden;
		padding: 0.2rem 0.4rem;
		border-left: 2px solid rgb(230 238 247 / 0.45);
		background: rgb(230 238 247 / 0.04);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.sec span {
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.sec small {
		display: block;
		overflow: hidden;
		font-size: 0.64rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.sec.hook {
		background: #3a2c13;
	}

	.sec.act1 {
		background: #162b4a;
	}

	.sec.act2 {
		background: #15322a;
	}

	.sec.act3 {
		background: #281f48;
	}

	.sec.cliffhanger {
		background: #3d1f1c;
	}

	.sec.mark {
		z-index: 2;
		overflow: visible;
		padding: 0;
		border-left: 2px solid var(--accent);
		background: none;
	}

	.sec.mark span {
		position: absolute;
		bottom: 0.1rem;
		left: 0.2rem;
		padding: 0 0.25rem;
		border-radius: 3px;
		background: var(--accent);
		font-size: 0.58rem;
		color: var(--on-accent);
		white-space: nowrap;
	}

	.tension {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		pointer-events: none;
	}

	.tension path {
		fill: none;
		stroke: var(--terracotta);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

	/* J and L cuts: the clips keep their full height; across the overlap each keeps its half (outline()); the letter */
	.overlap {
		position: absolute;
		top: 0.3rem;
		bottom: 0.3rem;
		z-index: 3;
		display: grid;
		place-items: center;
		border-left: 1px dashed rgb(230 238 247 / 0.45);
		border-right: 1px dashed rgb(230 238 247 / 0.45);
		pointer-events: none;
	}

	.overlap b {
		padding: 0 0.3rem;
		border-radius: 3px;
		background: var(--ink);
		font-size: 0.62rem;
		color: var(--on-ink);
	}

	.overlap.J b {
		background: var(--cyan);
	}

	.overlap.L b {
		background: var(--accent);
	}

	.jl {
		position: absolute;
		right: 0.3rem;
		top: 0.15rem;
		padding: 0 0.3rem;
		border-radius: 3px;
		background: var(--cyan);
		font-size: 0.6rem;
		color: var(--on-ink);
	}

	/* a clip whose file this Mac does not have yet: kept, marked */
	.clip.missing {
		border-style: dashed;
		opacity: 0.7;
	}

	.gone {
		position: absolute;
		left: 0.3rem;
		bottom: 0.2rem;
		padding: 0 0.3rem;
		border-radius: 3px;
		background: var(--bad-bg);
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--bad);
	}

	/* the script's stand-ins: a shot not filmed yet, a line not recorded yet */
	.clip.slate {
		display: flex;
		border-style: dashed;
		border-color: #a88f55;
		background: repeating-linear-gradient(135deg, #2a2415 0 6px, #211c11 6px 12px);
	}

	.clip.audio.line {
		border-style: dashed;
		font-style: italic;
	}

	.clip.world {
		border-color: #6f8fd6;
		background: linear-gradient(180deg, #172e57, #16342c);
	}

	.clip.image img {
		height: 100%;
		pointer-events: none;
	}

	.clip.audio.A1 {
		border-color: #d4a64a;
		background: #33280f;
	}

	.clip.audio.A2 {
		border-color: #45b6a4;
		background: #0d3434;
	}

	.clip.audio.A3 {
		border-color: #6f8fd6;
		background: #16284d;
	}

	.clip.cue {
		border-style: dashed;
		opacity: 0.8;
		cursor: default;
	}

	.clip canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.clip .label {
		position: absolute;
		top: 0.15rem;
		left: 0.5rem;
		overflow: hidden;
		max-width: calc(100% - 1rem);
		font-size: 0.66rem;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink);
		pointer-events: none;
	}

	.clip .label i {
		font-style: normal;
		color: var(--info);
	}

	.clip.image .label,
	.clip.video .label,
	.clip.world .label {
		left: auto;
		right: 0.5rem;
		max-width: calc(100% - 4.5rem);
	}

	/* on the left of the clip's top line (its name is on the right), so a short row still shows both */
	.chips {
		position: absolute;
		top: 0.15rem;
		left: 0.3rem;
		display: flex;
		gap: 0.2rem;
		align-items: center;
	}

	.chips b {
		padding: 0 0.25rem;
		border-radius: 4px;
		font-size: 0.56rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.wtag {
		background: var(--info-bg);
		color: var(--info);
	}

	.nopx {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.gr {
		background: rgb(232 168 58 / 0.26);
		color: #f6cf85;
	}

	.clip.caps {
		display: flex;
		align-items: center;
		border-color: #8d78cc;
		background: #221b42;
		cursor: default;
	}

	.clip.caps.now {
		border-color: var(--violet);
		background: #372a6a;
	}

	.clip.caps span {
		overflow: hidden;
		padding: 0 0.5rem;
		font-size: 0.7rem;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* the words, faint, where they are spoken */
	.wd {
		position: absolute;
		bottom: 0.05rem;
		font-size: 0.58rem;
		line-height: 1;
		white-space: nowrap;
		color: rgb(230 238 247 / 0.55);
		pointer-events: none;
	}

	.label .snd {
		font-style: normal;
		color: var(--info);
	}

	.clip.linked {
		border-bottom-width: 2px;
	}

	.snd-chips {
		top: auto;
		bottom: 0.15rem;
		left: auto;
		right: 0.4rem;
	}

	.nosnd {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.drift {
		background: var(--bad-bg);
		color: var(--bad);
	}

	.edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 7px;
		cursor: ew-resize;
	}

	.edge.l {
		left: 0;
	}

	.edge.r {
		right: 0;
	}

	.clip:hover .edge,
	.clip.sel .edge {
		background: rgb(230 238 247 / 0.22);
	}

	.span {
		position: absolute;
		top: 0.2rem;
		bottom: 0.2rem;
		border-radius: 4px;
		background: var(--hover);
		pointer-events: none;
	}

	.span.hour {
		background: linear-gradient(90deg, #183257, #3a2c13);
	}

	.val {
		position: absolute;
		top: 0;
		padding-left: 0.45rem;
		font-size: 0.64rem;
		line-height: 1.45rem;
		white-space: nowrap;
		color: var(--cyan);
		pointer-events: none;
	}

	.key {
		position: absolute;
		top: 50%;
		width: 0.62rem;
		height: 0.62rem;
		margin: -0.31rem 0 0 -0.31rem;
		padding: 0;
		border: 1px solid var(--cyan);
		background: var(--bg);
		transform: rotate(45deg);
		cursor: ew-resize;
	}

	.key.on {
		background: var(--accent);
		border-color: #f6cf85;
	}

	.key.out {
		opacity: 0.35;
	}

	.key.cue.sound {
		border-color: var(--info);
		background: #3c5fa8;
		border-radius: 50%;
		transform: none;
	}

	.key.cue.event {
		border-color: var(--violet);
		background: #4a3a80;
	}

	/* Edit: a picture clip opens with its thumbnail as it will look (balance and grades) */
	.clip .gthumb {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: auto;
		max-width: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	/* Grade: the shots side by side, one column each, with their pictures */
	.lanes.grading {
		cursor: default;
	}

	.tick.shot {
		overflow: hidden;
		padding-left: 0.4rem;
		white-space: nowrap;
	}

	.tick.shot b {
		color: var(--ink);
	}

	.tick.shot.now,
	.tick.shot.now b {
		color: var(--accent);
	}

	.shot {
		position: absolute;
		top: 0.25rem;
		bottom: 0.25rem;
		overflow: hidden;
		margin: 0 3px;
		border: 2px solid transparent;
		border-radius: 4px;
		background: var(--chrome);
		cursor: pointer;
	}

	.shot img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.shot.now {
		border-color: var(--rec);
	}

	.shot.sel {
		border-color: var(--accent);
	}

	.shot .none {
		display: grid;
		place-items: center;
		height: 100%;
		font-size: 0.66rem;
		color: var(--dim);
	}

	.shot .cap {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		overflow: hidden;
		padding: 0.15rem 0.35rem;
		background: linear-gradient(transparent, rgb(0 0 0 / 0.75));
		font-size: 0.62rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #f0f3f7;
	}

	.shot .cap b {
		color: var(--accent);
	}

	.shot.balanced .cap::after {
		content: ' ◐';
		color: var(--accent);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px solid var(--rec);
		pointer-events: none;
	}

	.playhead i {
		position: absolute;
		top: 0;
		left: -7px;
		width: 12px;
		height: 12px;
		border-radius: 0 0 50% 50%;
		background: var(--rec);
	}
</style>
