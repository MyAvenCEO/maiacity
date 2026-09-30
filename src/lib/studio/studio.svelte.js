// The studio's one state: the library, the open timeline and its clips, the playhead and the sound, the colour
// pipeline's LUTs, the world viewer, the renders — shared by the three working steps (Edit · Grade · Render) and every
// panel in them. The panels only show it and call its methods; nothing here draws.
import {
	API,
	fileUrl,
	createTimeline,
	deleteTimeline,
	describeMedia,
	listContent,
	listJobs,
	listMedia,
	listRenders,
	listTimelines,
	may,
	me,
	missing,
	queueRender,
	saveTimeline
} from '$lib/auth/client';
import { ODT, PROFILES, WORKING, asStudio, clean, gradesFor, isCache, isSequence, presetOf, profileFor, proxyFor } from './color.js';
import { filmLut, nativeLut } from './luts.js';
import { cached, evaluate, saveSpec, shotAt } from './shots.js';
import { WorldViewer } from './world.svelte.js';
import { native } from '$lib/native';

/** @typedef {import('$lib/auth/client').Cdl} Cdl */
/** @typedef {import('$lib/auth/client').ClipFrame} ClipFrame */
/** @typedef {import('$lib/auth/client').Delivery} Delivery */
/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */
/** @typedef {import('$lib/auth/client').RenderJob} RenderJob */
/** @typedef {import('$lib/auth/client').Shape} Shape */
/** @typedef {import('$lib/auth/client').Shot} Shot */
/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
/** @typedef {import('$lib/auth/client').Timeline} Timeline */
/** @typedef {import('$lib/auth/client').TimelineStage} TimelineStage */
/** @typedef {import('./color.js').ProxyState} ProxyState */
/** @typedef {import('./luts.js').Lut} Lut */
/** @typedef {import('./luts.js').LutSource} LutSource */
/** @typedef {'V1' | 'A1' | 'A2' | 'A3'} Track */
/** @typedef {import('$lib/auth/client').TimelineClip} Clip */
/** @typedef {{ url: string, duration: number, peaks: number[], buffer?: AudioBuffer }} Source */
/** @typedef {{ word: string, start: number, end: number }} Timed */
/** @typedef {'ingest' | 'library' | '3d' | 'edit' | 'grade' | 'render'} Tab */
/**
 * A sound cue of a world shot, where it lands on A3 (derived from the shot record, never saved as a clip).
 * @typedef {Clip & { cue: true, from: string }} CueClip
 */
/** @typedef {Delivery & Record<string, unknown>} DeliveryRecord */

/** @type {{ id: Track | 'T1', label: string, accepts: string[] }[]} */
export const TRACKS = [
	{ id: 'V1', label: 'Picture', accepts: ['image', 'video', 'world'] },
	{ id: 'A1', label: 'Voice', accepts: ['audio'] },
	{ id: 'A2', label: 'Music', accepts: ['audio'] },
	{ id: 'A3', label: 'Sound', accepts: ['audio'] },
	{ id: 'T1', label: 'Captions', accepts: [] }
];
/** @type {Shape[]} */
export const SHAPES = ['16:9', '9:16', '1:1', '4:5'];
/** @type {TimelineStage[]} */
export const STAGES = ['edit', 'locked', 'graded', 'rendered'];
const LAST = 'maia-studio-last-timeline';
const OPEN = 'studio:open-projects';
export const IMAGE_LEN = 4;
/** How far the music steps back under the voice: about −6 dB. */
const DUCK = 0.5;

/** @param {Clip | null | undefined} c */
export const isWorld = (c) => c?.kind === 'world';
/** @param {string} shape */
export const ratio = (shape) => {
	const [w, h] = shape.split(':').map(Number);
	return (w || 16) / (h || 9);
};
/**
 * The world's proxy-level frame for a shape: HD, the long edge 1920.
 * @param {string} shape
 */
export const hd = (shape) => {
	const r = ratio(shape);
	return r >= 1 ? { width: 1920, height: Math.round(1920 / r) } : { width: Math.round(1920 * r), height: 1920 };
};
/** @param {number} t */
export const clockText = (t) => {
	const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t % 1) * 100);
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
/** A file's bytes, from this Mac's vault (with Range). @param {string} hash */
export const raw = (hash) => fileUrl(hash);
/** @param {MediaItem} m */
export const thumb = (m) => raw(m.hash);
/** @param {MediaItem | undefined} m */
export const itemName = (m) => m?.title || m?.original_name || m?.hash.slice(0, 10) || '';
/** @param {RenderJob} r */
export const running = (r) => r.status === 'queued' || r.status === 'rendering';

export class Studio {
	/** @type {'loading' | 'signed-out' | 'forbidden' | 'ready'} */
	phase = $state('loading');
	error = $state('');
	/** @type {string | null} */
	failed = $state(null);
	/** @type {Tab} */
	tab = $state('edit');

	/** @type {MediaItem[]} */
	library = $state([]);
	/** @type {Timeline[]} */
	timelines = $state([]);
	/** @type {Timeline | null} */
	current = $state(null);
	/** @type {'saved' | 'saving' | 'unsaved'} */
	saving = $state('saved');

	/** @type {Clip[]} */
	clips = $state([]);
	/** @type {string | null} */
	selected = $state(null);
	/** @type {Record<string, Source>} */
	sources = $state({});
	pxPerSec = $state(60);
	time = $state(0);
	playing = $state(false);
	/** @type {HTMLDivElement | null} */
	lanes = $state(null);
	/**
	 * The monitor's videos, by clip: the shot on screen and the next ones, loaded and waiting on their first frame.
	 * @type {Record<string, HTMLVideoElement | null>}
	 */
	reelVideos = $state({});
	/**
	 * the program monitor (what goes full screen)
	 * @type {HTMLElement | null}
	 */
	screen = $state(null);
	/**
	 * the program monitor's still, when the picture is an image
	 * @type {HTMLImageElement | null}
	 */
	stillEl = $state(null);

	/**
	 * the source monitor's file and its player (the timeline pauses it when it plays)
	 * @type {string | null}
	 */
	preview = $state(null);
	/** @type {HTMLMediaElement | null} */
	srcEl = $state(null);
	srcFocus = $state(false);

	// colour
	/** @type {LutSource} */
	lutFrom = $state('none');
	/** @type {Record<string, Lut | null>} */
	luts = $state({});
	/** Edit: preview the grade on the proxies (read-only there) */
	previewGrade = $state(false);
	/**
	 * Grade: the viewer shows the originals (conformed) or, faster, the proxies
	 * @type {'originals' | 'proxies'}
	 */
	gradeOn = $state('originals');
	/**
	 * Grade: the shape being checked
	 * @type {Shape}
	 */
	shape = $state('16:9');
	/**
	 * Grade: what the controls change — the selected clip's grade or the whole film's look
	 * @type {'clip' | 'film'}
	 */
	gradeTarget = $state('clip');
	falseColor = $state(false);
	/**
	 * the viewer's canvas, for the scopes
	 * @type {HTMLCanvasElement | null}
	 */
	viewerCanvas = $state(null);
	/**
	 * what the scopes read when it is not the viewer (the live world's own canvas)
	 * @type {HTMLCanvasElement | null}
	 */
	scopeCanvas = $state(null);
	/** clips of the open timeline left out because this Mac lacks their files: while any are, nothing is saved */
	dropped = $state(0);

	jobsKnown = $state(false);

	// the world
	world = new WorldViewer();
	/** bumped when a shot record arrives, so everything that reads `cached()` looks again */
	shotRev = $state(0);
	/** @type {number | null} */
	selectedKey = $state(null);

	// renders
	/** @type {RenderJob[]} */
	renders = $state([]);
	/** @type {RenderJob[]} */
	queue = $state([]);
	/** @type {(Delivery & Record<string, unknown>)[]} */
	deliveries = $state([]);
	queuing = $state(false);
	now = $state(Date.now());
	skew = 0;
	/** @type {Record<string, { t0: number; p0: number; t: number; p: number }>} */
	pace = $state({});
	/** @type {ReturnType<typeof setInterval> | null} */
	renderPoll = null;

	/** @type {string[]} */
	expanded = $state([]);

	// ── derived ──────────────────────────────────────────────────────────────
	byHash = $derived(new Map(this.library.map((m) => [m.hash, m])));
	aspect = $derived(this.current?.aspect ?? '1:1');
	/** @type {TimelineStage} */
	stage = $derived(this.current?.stage ?? 'edit');
	version = $derived(this.current?.version ?? 1);
	locked = $derived(this.stage !== 'edit');
	/** picture and sound can be changed: the Edit tab, the edit not locked */
	canEdit = $derived((this.tab === 'edit' || this.tab === '3d') && !this.locked);
	/**
	 * the frame the program shows: the timeline's own shape, or in Grade the one being checked
	 * @type {string}
	 */
	viewShape = $derived(this.tab === 'grade' ? this.shape : this.aspect);
	end = $derived(this.clips.reduce((n, c) => Math.max(n, c.start + c.dur), 0));
	span = $derived(Math.max(this.end + 4, 20));
	sel = $derived(this.clips.find((c) => c.id === this.selected) ?? null);
	picture = $derived(this.at('V1', this.time));
	pictureItem = $derived(this.picture?.hash ? this.byHash.get(this.picture.hash) : undefined);
	/** a title card's marker shows as the day's card made for this frame — the one its meta names by hash, as the render uses it */
	stillItem = $derived.by(() => {
		const cards = /** @type {Record<string, string> | undefined} */ (this.pictureItem?.meta?.cards);
		const hash = cards?.[this.viewShape.replace(':', 'x')];
		return (hash && this.byHash.get(hash)) || this.pictureItem;
	});
	worldClips = $derived(this.clips.filter((c) => isWorld(c)));
	/** every sound cue of the world clips, on A3 where it lands */
	cueClips = $derived.by(() => {
		void this.shotRev;
		/** @type {CueClip[]} */
		const out = [];
		for (const c of this.worldClips) {
			const spec = cached(c.shot, c.shotVersion)?.spec;
			for (const [i, q] of (spec?.cues ?? []).entries()) {
				if (q.kind !== 'sound' || q.at < c.in || q.at >= c.in + c.dur) continue;
				const len = this.sources[q.hash]?.duration ?? 2;
				const start = c.start + (q.at - c.in);
				out.push({ id: `${c.id}:cue${i}`, hash: q.hash, track: 'A3', start, in: 0, dur: Math.min(len, c.start + c.dur - start + 2), vol: q.level ?? 1, cue: true, from: c.id });
			}
		}
		return out;
	});
	/**
	 * The reel: the video on screen and the next two, so a cut never waits for a file to load (no black frame). A world
	 * clip joins it with its HD proxy, which plays whenever the live world is not ready.
	 */
	reel = $derived.by(() => {
		const v1 = this.clips
			.filter((c) => c.track === 'V1' && !!this.playUrl(c))
			.sort((a, b) => a.start - b.start);
		const i = v1.findIndex((c) => c.start + c.dur > this.time);
		return i < 0 ? [] : v1.slice(i, i + 3);
	});
	// captions: every voice clip's words, placed where the clip puts them
	captionWords = $derived.by(() => {
		/** @type {{ word: string, t: number, clip: string }[]} */
		const out = [];
		for (const c of this.clips.filter((c) => c.track === 'A1')) {
			const m = c.hash ? this.byHash.get(c.hash) : undefined;
			const words = /** @type {Timed[]} */ (Array.isArray(m?.meta?.words) ? m.meta.words : []);
			for (const w of words) if (w.start >= c.in && w.start < c.in + c.dur) out.push({ word: w.word, t: c.start + (w.start - c.in), clip: c.id });
		}
		return out;
	});
	// words become phrases — a few at a time, broken at the punctuation — the way a film's subtitles run
	phrases = $derived.by(() => {
		/** @type {{ words: { word: string, t: number }[], start: number, end: number, clip: string }[]} */
		const out = [];
		for (const c of this.clips.filter((c) => c.track === 'A1')) {
			/** @type {{ word: string, t: number }[]} */
			let cur = [];
			const flush = () => cur.length && out.push({ words: cur, start: cur[0].t, end: /** @type {{ t: number }} */ (cur.at(-1)).t + 0.5, clip: c.id });
			for (const w of this.captionWords.filter((w) => w.clip === c.id)) {
				cur.push(w);
				const text = cur.map((x) => x.word).join(' ');
				if ((/[.,;:!?]$/.test(w.word) && (cur.length >= 3 || /[.;:!?]$/.test(w.word))) || text.length > 38) flush(), (cur = []);
			}
			flush();
		}
		// each phrase stays until the next one begins (or a moment after its last word)
		return out.map((p, i) => ({ ...p, end: out[i + 1] && out[i + 1].clip === p.clip ? Math.min(out[i + 1].start, p.end + 1.2) : p.end + 0.6 }));
	});
	caption = $derived(this.phrases.find((p) => this.time >= p.start - 0.08 && this.time < p.end)?.words ?? []);

	// renders
	newest = $derived([...this.renders].sort((a, b) => Date.parse(b.created) - Date.parse(a.created)));
	active = $derived(this.newest.find(running) ?? null);
	/** the job the panel is about: the one under way, else the last one; the rest are the short history under it */
	focus = $derived(this.active ?? this.newest[0] ?? null);

	/** @param {Track} track @param {number} t */
	at(track, t) {
		return this.clips.filter((c) => c.track === track && t >= c.start && t < c.start + c.dur).at(-1) ?? null;
	}
	/** @param {Clip} c */
	clipName(c) {
		if (isWorld(c)) {
			void this.shotRev;
			return cached(c.shot, c.shotVersion)?.name ?? 'World shot';
		}
		const m = c.hash ? this.byHash.get(c.hash) : undefined;
		return String(m?.meta?.title ?? itemName(m));
	}
	/** @param {Clip | null | undefined} c @returns {Shot | null} */
	shotOf(c) {
		void this.shotRev;
		return c && isWorld(c) ? cached(c.shot, c.shotVersion) : null;
	}

	// ── what plays: proxies in Edit, originals in Grade ──────────────────────
	/**
	 * The proxy state of a library file (ready, queued, …, or none yet).
	 * @param {MediaItem | undefined} m @returns {{ hash: string | null, state: ProxyState }}
	 */
	proxy(m) {
		return proxyFor(m, (h) => this.byHash.get(h));
	}
	/** Does this clip play from its proxy right now? Edit always; Grade when asked (the originals are heavy). */
	onProxies = $derived(this.tab !== 'grade' || this.gradeOn === 'proxies');
	/**
	 * The file a clip's picture plays from, or null for a still (or a world clip with no HD proxy).
	 * @param {Clip} c @returns {string | null}
	 */
	playUrl(c) {
		if (isWorld(c)) {
			const p = this.worldProxy(c);
			return p ? raw(p.hash) : null;
		}
		const m = c.hash ? this.byHash.get(c.hash) : undefined;
		if (m?.kind !== 'video' || !this.sources[m.hash]) return null;
		const p = this.proxy(m);
		// an EXR sequence plays only through its proxy (the browser cannot play a tar of frames)
		return (this.onProxies || isSequence(m)) && p.hash ? raw(p.hash) : isSequence(m) ? null : this.sources[m.hash].url;
	}
	/**
	 * The library file a clip's picture is taken from now (the proxy or the original), for its colour profile.
	 * @param {Clip | null | undefined} c @returns {MediaItem | undefined}
	 */
	playItem(c) {
		if (!c) return undefined;
		if (isWorld(c)) return this.worldProxy(c) ?? undefined;
		const m = c.hash ? this.byHash.get(c.hash) : undefined;
		const p = this.proxy(m);
		// a still shows its proxy whenever it has one (it is what the picture is taken from — see source())
		return ((this.onProxies || isSequence(m) || m?.kind === 'image') && p.hash && this.byHash.get(p.hash)) || m;
	}
	/**
	 * A world clip's HD proxy (the Mac app renders one for every shot version a timeline plays — vault/app/src/world.rs):
	 * a proxy file naming the shot and version.
	 * @param {Clip} c @returns {MediaItem | null}
	 */
	worldProxy(c) {
		return this.library.find((m) => m.meta?.shot === c.shot && Number(m.meta?.shotVersion) === c.shotVersion && m.kind === 'video') ?? null;
	}
	/**
	 * The profile the viewer takes a clip's picture in by.
	 * @param {Clip | null | undefined} c @returns {string}
	 */
	profileOfClip(c) {
		if (isWorld(c)) return 'acescct'; // the world renders ACEScct (film mode, C3), and so do its proxies
		const it = this.playItem(c);
		// a proxy is ACEScct, always (proxyFor takes only the Mac's own)
		if (c?.hash && it?.hash !== c.hash) return WORKING;
		return profileFor(it).profile;
	}
	/**
	 * The grades a clip is seen through: in Grade always, in Edit only when previewing.
	 * @param {Clip | null | undefined} c @returns {Cdl[]}
	 */
	gradesOf(c) {
		if ((this.tab === 'edit' || this.tab === '3d') && !this.previewGrade) return [];
		return gradesFor(c, this.current);
	}

	// ── loading ──────────────────────────────────────────────────────────────
	async load() {
		try {
			const founder = await me();
			if (!may(founder, 'media:admin')) return void (this.phase = 'forbidden');
		} catch {
			return void (this.phase = 'signed-out');
		}
		try {
			const [media, tls] = await Promise.all([listMedia().then(asStudio), listTimelines()]);
			this.library = media;
			this.timelines = tls;
		} catch (e) {
			this.error = /** @type {Error} */ (e).message;
		}
		this.phase = 'ready';
		void this.loadLuts();
		void this.refreshJobs();
		// a proxy the Mac just made — a world shot's too — is in the library at once, so its clips play it
		if (native() && !this.unlisten)
			this.unlisten = import('@tauri-apps/api/event').then(({ listen }) =>
				listen('vault-proxy', () => void listMedia().then(asStudio).then((m) => (this.library = m)).catch(() => null))
			);
		/** @type {string | null} */
		let last = null;
		try {
			last = localStorage.getItem(LAST);
			const kept = JSON.parse(localStorage.getItem(OPEN) ?? '[]');
			this.expanded = Array.isArray(kept) ? kept.filter((p) => typeof p === 'string') : [];
		} catch {
			/* no storage: open the newest */
		}
		const open = this.timelines.find((t) => t.id === last) ?? this.timelines[0];
		// a timeline loads its sound (decoded) and its world: only when it is looked at — Ingest and the library
		// never need it, and on an 8 GB Mac it is a gigabyte and more
		this.later = open ?? 'new';
		if (this.tab !== 'ingest' && this.tab !== 'library') await this.openLater();
	}

	/** @type {Timeline | 'new' | null} the timeline to open once Edit, Grade or Render is shown */
	later = null;
	/** Open the timeline waiting to be opened (the first time Edit, Grade or Render is shown). */
	async openLater() {
		const l = this.later;
		if (!l) return;
		this.later = null;
		if (l === 'new') await this.newTimeline();
		else await this.openTimeline(l);
	}

	/** Every LUT the viewer uses, baked by the Mac: each profile's journey in (as its proxy took it), and the output. */
	async loadLuts() {
		const wanted = [
			/** @type {const} */ ([ODT, ODT]),
			...Object.entries(PROFILES)
				.filter(([, p]) => p.idt)
				.map(([profile, p]) => /** @type {const} */ ([/** @type {string} */ (p.idt), profile]))
		];
		const got = await Promise.all(wanted.map(async ([name, profile]) => /** @type {const} */ ([name, await nativeLut(profile).catch(() => null)])));
		this.luts = Object.fromEntries(got.filter(([, l]) => l));
		this.lutFrom = this.luts[ODT] ? 'mac' : 'none';
	}

	/** The render queue (C6, `GET /api/film/jobs`), rendered by the Mac app — renders and hero frames. */
	async refreshJobs() {
		try {
			const all = await listJobs({ limit: 100 });
			this.jobsKnown = true;
			this.queue = all.filter(running).sort((a, b) => (a.status === b.status ? Date.parse(a.created) - Date.parse(b.created) : a.status === 'rendering' ? -1 : 1));
		} catch (e) {
			if (!missing(e)) console.warn('jobs:', /** @type {Error} */ (e).message);
			this.jobsKnown = false;
		}
	}

	/** @param {string} p */
	expand(p, on = !this.expanded.includes(p)) {
		this.expanded = on ? [...new Set([...this.expanded, p])] : this.expanded.filter((x) => x !== p);
		try {
			localStorage.setItem(OPEN, JSON.stringify(this.expanded));
		} catch {
			/* fine */
		}
	}

	/** @param {Timeline} t */
	async openTimeline(t) {
		this.stop();
		await this.flush();
		this.current = t;
		this.expand(t.project ?? '', true);
		this.clips = t.clips.filter((c) => isWorld(c) || (c.hash && this.byHash.has(c.hash)));
		// a clip whose file this Mac does not know is left out of the view — and then the timeline is never saved from
		// here, or those clips would be gone for good
		this.dropped = t.clips.length - this.clips.length;
		if (this.dropped) this.error = `${this.dropped} clip${this.dropped === 1 ? '' : 's'} of this timeline name files this Mac does not have yet — shown without them, and not saved.`;
		this.selected = null;
		this.selectedKey = null;
		this.time = 0;
		this.saving = 'saved';
		this.shape = /** @type {Shape} */ (['16:9', '9:16', '1:1', '4:5'].includes(t.aspect) ? t.aspect : '16:9');
		if (this.tab === 'grade' && !this.locked) this.tab = 'edit';
		try {
			localStorage.setItem(LAST, t.id);
		} catch {
			/* fine */
		}
		for (const c of this.clips) if (c.hash) void this.source(c.hash).catch((e) => (this.error = /** @type {Error} */ (e).message));
		void this.loadShots();
		this.renders = [];
		this.deliveries = [];
		void this.refreshRenders();
		void this.refreshJobs();
	}

	/** Every world clip's shot record, at the version it was cut with; and its sound cues' files. */
	async loadShots() {
		await Promise.all(this.worldClips.map((c) => (c.shot ? shotAt(c.shot, c.shotVersion) : null)));
		this.shotRev++;
		for (const q of this.cueClips) if (q.hash) void this.source(q.hash).catch(() => null);
		// the world: started as soon as the timeline has world clips
		if (this.worldClips.length) this.wantWorld = true;
	}
	/** the program monitor starts the world iframe when this is set */
	wantWorld = $state(false);

	async newTimeline() {
		const made = await this.starter();
		const t = (await createTimeline({ name: `Timeline ${this.timelines.length + 1}`, aspect: '16:9', tags: [], clips: made, stage: 'edit', version: 1, color: { working: 'acescct', output: 'odt-rec709' }, grade: null }));
		this.timelines = [t, ...this.timelines];
		await this.openTimeline(t);
	}

	/** @param {Timeline} t */
	async removeTimeline(t) {
		if (!confirm(`Delete the timeline “${t.name}”? The files stay in the library.`)) return;
		await deleteTimeline(t.id);
		this.timelines = this.timelines.filter((x) => x.id !== t.id);
		if (this.current?.id === t.id) {
			this.current = null;
			if (this.timelines[0]) await this.openTimeline(this.timelines[0]);
			else await this.newTimeline();
		}
	}

	// ── saving: every change, a moment after the last one ──────────────────────
	/** @type {ReturnType<typeof setTimeout> | null} */
	saveTimer = null;
	changed() {
		this.saving = 'unsaved';
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(), 700);
	}
	async flush() {
		if (this.saveTimer) clearTimeout(this.saveTimer), (this.saveTimer = null);
		const cur = this.current;
		if (!cur || this.saving !== 'unsaved') return;
		if (this.dropped) return;
		this.saving = 'saving';
		try {
			/** @type {Partial<Timeline>} */
			const body = {
				name: cur.name,
				project: cur.project,
				variant: cur.variant,
				description: cur.description,
				aspect: cur.aspect,
				tags: cur.tags,
				clips: /** @type {Clip[]} */ ($state.snapshot(this.clips)),
				stage: cur.stage ?? 'edit',
				version: cur.version ?? 1,
				color: cur.color ?? { working: 'acescct', output: 'odt-rec709' },
				grade: cur.grade ?? null
			};
			const t = await saveTimeline(cur.id, body);
			this.timelines = [t, ...this.timelines.filter((x) => x.id !== t.id)];
			// an API that keeps the stages says which version the timeline is (it counts the unlocks itself)
			if (this.current?.id === cur.id) this.current = { ...this.current, updated: t.updated, version: t.version };
			this.saving = 'saved';
		} catch (e) {
			this.error = /** @type {Error} */ (e).message;
			this.saving = 'unsaved';
		}
	}
	/** @param {Partial<Timeline>} patch */
	setMeta(patch) {
		if (!this.current) return;
		this.current = { ...this.current, ...patch };
		this.changed();
	}

	// ── the stages: edit → locked → graded → rendered ─────────────────────────
	/** Locks picture and sound: nothing moves on the timeline any more, and the Grade tab opens. */
	lock() {
		if (!this.current || this.locked) return;
		this.stop();
		this.setMeta({ stage: 'locked' });
		this.selected = null;
		this.tab = 'grade';
		void this.flush();
	}
	/** Opens the edit again, as a new version; every clip keeps its grade (it is on the clip, by its id). */
	unlock() {
		if (!this.current || !this.locked) return;
		if (!confirm(`Unlock the edit? It becomes version ${this.version + 1}; every clip keeps its grade.`)) return;
		this.setMeta({ stage: 'edit', version: this.version + 1 });
		this.tab = 'edit';
		void this.flush();
	}
	markGraded(on = true) {
		if (!this.current || !this.locked) return;
		this.setMeta({ stage: on ? 'graded' : 'locked' });
	}

	/**
	 * A first edit to start from: a still, the newest voice take on it, a music bed under it.
	 * @returns {Promise<Clip[]>}
	 */
	async starter() {
		const lib = this.library.filter((m) => !isCache(m));
		const voices = lib.filter((m) => m.kind === 'audio' && m.tags.includes('role:voice'));
		const voice = voices.find((m) => Array.isArray(m.meta?.words) && /** @type {unknown[]} */ (m.meta.words).length) ?? voices[0];
		const bed = lib.find((m) => m.kind === 'audio' && (m.tags.includes('role:music') || m.tags.includes('role:score')));
		const still = lib.find((m) => m.kind === 'image' && m.tags.includes('role:cover')) ?? lib.find((m) => m.kind === 'image');
		const vlen = voice ? (await this.source(voice.hash)).duration : 6;
		/** @type {Clip[]} */
		const next = [];
		if (still) next.push(this.clip(still.hash, 'V1', 0, 0, vlen + 2));
		if (voice) next.push(this.clip(voice.hash, 'A1', 0.5, 0, vlen));
		if (bed) next.push({ ...this.clip(bed.hash, 'A2', 0, 0, vlen + 2.5), vol: 0.3 });
		return next;
	}

	/** @param {string} hash @param {Track} track @param {number} start @param {number} from @param {number} dur @returns {Clip} */
	clip = (hash, track, start, from, dur) => ({
		id: Math.random().toString(36).slice(2, 10),
		hash,
		track,
		start,
		in: from,
		dur,
		vol: 1
	});

	// ── sound: one Web Audio clock; every clip is scheduled on it, sample-exact ──
	// (Safari lets a page make sound only from a click: the context is woken by the Play button)
	/** @type {AudioContext | null} */
	ctx = null;
	audioCtx = () => (this.ctx ??= new AudioContext());
	/** @type {{ src: AudioBufferSourceNode; gain: GainNode }[]} */
	nodes = [];
	ctxStart = 0;
	timeStart = 0;
	/** @type {Map<string, Promise<Source>>} */
	pending = new Map();
	// the true length of each video, found one at a time (and the player let go of after, so it frees its slot)
	/** @type {string[]} */
	probing = [];
	/** @type {Promise<void> | null} */
	prober = null;
	/** @param {string} hash */
	probeLength(hash) {
		this.probing.push(hash);
		this.prober ??= (async () => {
			for (let next; (next = /** @type {string | undefined} */ (this.probing.shift())); ) {
				/** @type {number} */
				const duration = await new Promise((ok) => {
					const v = document.createElement('video');
					v.preload = 'metadata';
					v.crossOrigin = 'anonymous';
					/** @param {number} d */
					const done = (d) => (clearTimeout(late), v.removeAttribute('src'), v.load(), ok(d));
					const late = setTimeout(() => done(0), 8000);
					v.onloadedmetadata = () => done(v.duration || 0);
					v.onerror = () => done(0);
					v.src = raw(/** @type {string} */ (next));
				});
				if (duration && this.sources[next]) this.sources[next] = { ...this.sources[next], duration };
			}
			this.prober = null;
		})();
	}

	/**
	 * Fetch a file once: sound is decoded (for playing and for its waveform); a still is only shown.
	 * @param {string} hash @returns {Promise<Source>}
	 */
	source(hash) {
		if (this.sources[hash]) return Promise.resolve(this.sources[hash]);
		const waiting = this.pending.get(hash);
		if (waiting) return waiting;
		const m0 = this.byHash.get(hash);
		if (m0?.kind === 'video') {
			// a video streams straight from the library (it answers byte ranges): no need to download it first. It is
			// ready at once — the monitor's own players load it when it comes up — and its length is looked up
			// behind, one video at a time: Safari loads only a few videos at once, and a timeline of 42 shots asking
			// for all of them together left some never answering (black shots, a playhead that would not start)
			const s = (this.sources[hash] = { url: raw(hash), duration: Number(m0.meta?.duration_s) || 3600, peaks: [] });
			this.probeLength(hash);
			return Promise.resolve(s);
		}
		if (m0?.kind === 'image') {
			// its ACEScct proxy when it has one (a float still, or one larger than HD), else the still itself
			const p = this.proxy(m0);
			const s = { url: p.hash ? raw(p.hash) : thumb(m0), duration: IMAGE_LEN, peaks: [] };
			this.sources[hash] = s;
			return Promise.resolve(s);
		}
		const p = (async () => {
			const m = this.byHash.get(hash);
			const res = await fetch(raw(hash));
			if (!res.ok) throw new Error(`Could not load ${itemName(m)} (${res.status}).`);
			const bytes = await res.arrayBuffer();
			const url = URL.createObjectURL(new Blob([bytes], { type: m?.mime }));
			let duration = IMAGE_LEN;
			/** @type {number[]} */
			let peaks = [];
			/** @type {AudioBuffer | undefined} */
			let buffer;
			if (m?.kind === 'audio' || !m) {
				buffer = await this.audioCtx().decodeAudioData(bytes.slice(0));
				duration = buffer.duration;
				const data = buffer.getChannelData(0), n = Math.min(8000, Math.ceil(buffer.duration * 100)), step = Math.floor(data.length / n);
				peaks = Array.from({ length: n }, (_, i) => {
					let max = 0;
					for (let j = i * step; j < (i + 1) * step; j++) max = Math.max(max, Math.abs(data[j] ?? 0));
					return max;
				});
			}
			const s = { url, duration, peaks, buffer };
			this.sources[hash] = s;
			return s;
		})();
		this.pending.set(hash, p);
		return p;
	}

	silence() {
		for (const { src } of this.nodes) {
			try {
				src.stop();
			} catch {
				/* already ended */
			}
		}
		this.nodes = [];
	}

	/** Lay every sound clip (and every world shot's sound cue, on A3) on the clock from the playhead on. */
	schedule() {
		this.silence();
		const ac = this.audioCtx();
		const time = this.time;
		this.ctxStart = ac.currentTime + 0.05;
		this.timeStart = time;
		/** @type {Clip[]} */
		const all = [...this.clips.filter((c) => !isWorld(c)), ...this.cueClips];
		for (const c of all) {
			const buf = c.hash ? this.sources[c.hash]?.buffer : undefined;
			if (!buf || c.start + c.dur <= time) continue;
			const from = Math.max(time, c.start); // timeline time the sound begins
			const offset = c.in + (from - c.start); // how far into the file
			const length = Math.min(c.start + c.dur - from, buf.duration - offset);
			if (length <= 0.01 || offset >= buf.duration) continue;
			const when = this.ctxStart + (from - time);
			const src = ac.createBufferSource();
			src.buffer = buf;
			const gain = ac.createGain();
			// the clip's own fades (a bed crossfades over a second or so), else a short one, so a cut never clicks
			const fadeIn = from === c.start ? Math.max(0.01, c.fin ?? 0.06) : 0.02, fadeOut = Math.min(c.fout ?? 0.3, length / 2);
			gain.gain.setValueAtTime(0, when);
			gain.gain.linearRampToValueAtTime(c.vol, when + fadeIn);
			// the music steps back while the voice speaks, and comes up again in the pauses (the render does the same)
			if (c.track === 'A2')
				for (const v of this.clips.filter((v) => v.track === 'A1' && v.start + v.dur > from && v.start < c.start + c.dur)) {
					const a = this.ctxStart + (Math.max(from, v.start) - time), b = this.ctxStart + (v.start + v.dur - time);
					if (a < when + fadeIn) continue;
					gain.gain.setValueAtTime(c.vol, a - 0.15);
					gain.gain.linearRampToValueAtTime(c.vol * DUCK, a);
					gain.gain.setValueAtTime(c.vol * DUCK, b);
					gain.gain.linearRampToValueAtTime(c.vol, b + 0.9);
				}
			gain.gain.setValueAtTime(c.vol, when + length - fadeOut);
			gain.gain.linearRampToValueAtTime(0, when + length);
			src.connect(gain).connect(ac.destination);
			src.start(when, offset, length);
			this.nodes.push({ src, gain });
		}
	}
	/** how many sounds are laid on the clock (for the transport's readout, and the tests) */
	scheduled = () => this.nodes.length;

	/** @type {Promise<() => void> | null} */
	unlisten = null;

	destroy() {
		void this.unlisten?.then((off) => off());
		this.unlisten = null;
		cancelAnimationFrame(this.frame);
		this.poll(false);
		this.silence();
		void this.flush();
		void this.ctx?.close();
		for (const s of Object.values(this.sources)) if (s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
	}

	// ── playback ──────────────────────────────────────────────────────────────
	frame = 0;
	/**
	 * the time a world clip plays at, shot-local: t = in + (timeline time − start)
	 * @param {Clip} c
	 */
	shotTime = (c, time = this.time) => c.in + (time - c.start);
	syncVideo(force = false) {
		for (const c of this.reel) {
			const v = this.reelVideos[c.id];
			if (!v) continue;
			if (c.id !== this.picture?.id) {
				// waiting in the wings: paused on its first frame
				if (!v.paused) v.pause();
				if (Math.abs(v.currentTime - c.in) > 0.04) v.currentTime = c.in;
				continue;
			}
			const local = this.shotTime(c);
			v.volume = c.vol;
			if (force || Math.abs(v.currentTime - local) > 0.25) v.currentTime = local;
			if (this.playing && v.paused) void v.play().catch(() => {});
			if (!this.playing && !v.paused) v.pause();
		}
		this.driveWorld();
	}

	/**
	 * The world follows the clock: the picture's world clip is drawn at its shot time (through the view transform and,
	 * when shown, the grade), and the next world clips ahead of the playhead are prepared, so a cut to them is ready.
	 */
	driveWorld() {
		const c = this.picture;
		if (this.world.state !== 'ready') return;
		const upcoming = this.worldClips.filter((w) => w.start + w.dur > this.time).sort((a, b) => a.start - b.start).slice(0, 3);
		const specs = upcoming.map((w) => cached(w.shot, w.shotVersion)?.spec).filter(/** @returns {s is ShotSpec} */ (s) => !!s);
		if (specs.length) void this.world.prepare(specs);
		// while a move is flown by hand the world has its canvas and clock back (film mode's record): no frames asked
		if (this.world.recording) return;
		if (!c || !isWorld(c)) return;
		const spec = cached(c.shot, c.shotVersion)?.spec;
		if (!spec) return;
		// the view film mode draws through: the output transform, and the grades in order (the clip's, then the film's look)
		const grade = this.gradesOf(c);
		this.world.show({ spec, t: this.shotTime(c), shape: /** @type {Shape} */ (this.viewShape), ...hd(this.viewShape), view: { lut: filmLut(this.luts['odt-rec709'] ?? null), grade: grade.length ? grade : null } });
	}

	tick = () => {
		if (!this.ctx) return;
		this.time = this.timeStart + Math.max(0, this.ctx.currentTime - this.ctxStart);
		if (this.time >= this.end) {
			this.time = this.end;
			return this.stop();
		}
		this.syncVideo();
		this.frame = requestAnimationFrame(this.tick);
	};

	/** prepare playback: what the world is loading before the timeline plays */
	preparing = $state(false);
	/** Loads every world shot the timeline touches and keeps it loaded (waits a little, then plays regardless: the proxies cover). */
	async preparePlayback(wait = 4000) {
		if (this.world.state !== 'ready' || !this.worldClips.length) return;
		const specs = this.worldClips.map((c) => cached(c.shot, c.shotVersion)?.spec).filter(/** @returns {s is ShotSpec} */ (s) => !!s);
		this.preparing = true;
		await Promise.race([this.world.prepare(specs), new Promise((r) => setTimeout(r, wait))]);
		this.preparing = false;
	}

	async play() {
		this.srcEl?.pause(); // the timeline plays alone: the source monitor waits
		if (!this.clips.length) return;
		if (this.time >= this.end - 0.02) this.time = 0;
		await this.audioCtx().resume();
		await Promise.all([...this.clips, ...this.cueClips].map((c) => (c.hash ? this.source(c.hash).catch(() => null) : null)));
		await this.preparePlayback();
		this.playing = true;
		this.schedule();
		this.syncVideo(true);
		this.frame = requestAnimationFrame(this.tick);
	}

	stop() {
		this.playing = false;
		cancelAnimationFrame(this.frame);
		this.silence();
		this.syncVideo();
	}

	toggle = () => (this.playing ? this.stop() : void this.play());

	/** @param {number} t */
	seek(t) {
		this.time = Math.min(Math.max(0, t), this.span);
		if (this.playing) this.schedule();
		this.syncVideo(true);
	}

	// ── by hand: move, trim, drop ──────────────────────────────────────────────
	/** @param {number} t */
	snap = (t) => Math.round(t * 20) / 20;

	/**
	 * Lays a file on a track at `start`: the whole of it, or only `range` of it (a sound or a film marked in the source monitor).
	 * @param {string} hash @param {Track} track @param {number} start @param {{ in: number, dur: number }} [range]
	 */
	async place(hash, track, start, range) {
		if (!this.canEdit) return void (this.error = this.locked ? 'The edit is locked: unlock it to change picture or sound.' : '');
		const m = this.byHash.get(hash);
		const accepts = TRACKS.find((t) => t.id === track)?.accepts ?? [];
		if (!m || !accepts.includes(m.kind)) return void (this.error = `${itemName(m)} does not go on the ${track} track.`);
		this.error = '';
		try {
			const s = await this.source(hash);
			const whole = m.kind === 'image' ? IMAGE_LEN : s.duration;
			const from = m.kind === 'image' || !range ? 0 : Math.min(Math.max(0, range.in), Math.max(0, whole - 0.2));
			const dur = m.kind === 'image' || !range ? whole : Math.min(Math.max(0.2, range.dur), whole - from);
			const c = this.clip(hash, track, Math.max(0, this.snap(start)), from, dur);
			if (track === 'A2') c.vol = 0.3;
			if (track === 'A3') c.vol = 0.2;
			this.clips = [...this.clips, c];
			this.selected = c.id;
			this.changed();
			if (this.playing) this.schedule();
		} catch (e) {
			this.error = /** @type {Error} */ (e).message;
		}
	}

	/**
	 * Lays a world shot on V1 at `start`: the whole shot, at its newest version.
	 * @param {Shot} shot @param {number} start
	 */
	placeShot(shot, start) {
		if (!this.canEdit) return void (this.error = 'The edit is locked: unlock it to change picture or sound.');
		/** @type {Clip} */
		const c = { id: Math.random().toString(36).slice(2, 10), kind: 'world', shot: shot.id, shotVersion: shot.version, track: 'V1', start: Math.max(0, this.snap(start)), in: 0, dur: shot.spec.seconds, vol: 1 };
		this.clips = [...this.clips, c];
		this.selected = c.id;
		this.wantWorld = true;
		this.shotRev++;
		this.changed();
	}

	/** @param {string | null} id */
	remove(id) {
		if (!id || !this.canEdit) return;
		this.clips = this.clips.filter((c) => c.id !== id);
		this.selected = null;
		this.changed();
		if (this.playing) this.schedule();
	}

	/**
	 * Changes a clip's place, length or sound (Edit only, unlocked).
	 * @param {Partial<Clip>} patch
	 */
	setClip(patch, id = this.selected) {
		if (!this.canEdit) return;
		this.patchClip(id, patch);
	}
	/**
	 * Changes what a clip is (its grade, its framing, its shot version) — not its place in the edit.
	 * @param {string | null} id @param {Partial<Clip>} patch
	 */
	patchClip(id, patch) {
		const i = this.clips.findIndex((c) => c.id === id);
		if (i < 0) return;
		this.clips[i] = { ...this.clips[i], ...patch };
		this.changed();
		if (this.playing) this.schedule();
	}
	/** @param {Cdl | null} g */
	setGrade(g) {
		if (this.gradeTarget === 'film' || !this.sel || this.sel.track !== 'V1') {
			const preset = presetOf(g);
			this.setMeta({ grade: { look: clean(g), ...(preset && preset !== 'neutral' ? { preset } : {}) } });
		} else this.patchClip(this.sel.id, { grade: clean(g) });
	}
	/** @param {string} id @param {Shape} shape @param {ClipFrame | null} f */
	setFrame(id, shape, f) {
		const c = this.clips.find((x) => x.id === id);
		if (!c) return;
		const frame = { ...(c.frame ?? {}) };
		if (f && (f.x || f.y || f.zoom !== 1)) frame[shape] = f;
		else delete frame[shape];
		this.patchClip(id, { frame: Object.keys(frame).length ? frame : undefined });
	}

	// ── world shots: a changed spec is a new version, and the clip follows it ──
	/** @type {Map<string, ReturnType<typeof setTimeout>>} */
	shotTimers = new Map();
	/**
	 * pending spec edits, by clip, shown at once and saved a moment after the last change (one version per pause)
	 * @type {Record<string, ShotSpec>}
	 */
	drafts = $state({});
	/** @param {Clip | null | undefined} c @returns {ShotSpec | null} */
	specOf(c) {
		if (!c) return null;
		return this.drafts[c.id] ?? this.shotOf(c)?.spec ?? null;
	}
	/** @param {Clip} c @param {(s: ShotSpec) => void} change */
	editSpec(c, change) {
		if (!this.canEdit) return;
		const base = this.specOf(c);
		const shot = this.shotOf(c);
		if (!base || !shot) return;
		const next = /** @type {ShotSpec} */ (structuredClone($state.snapshot(base)));
		change(next);
		this.drafts[c.id] = next;
		this.saving = 'unsaved';
		clearTimeout(this.shotTimers.get(c.id));
		this.shotTimers.set(
			c.id,
			setTimeout(async () => {
				try {
					const saved = await saveSpec(shot, /** @type {ShotSpec} */ ($state.snapshot(this.drafts[c.id])));
					delete this.drafts[c.id];
					this.shotRev++;
					// the clip follows the new version (and so does every other clip cut from the same shot and version)
					for (const k of this.clips.filter((k) => k.shot === shot.id && k.shotVersion === shot.version)) this.patchClip(k.id, { shotVersion: saved.version, ...(k.id === c.id && saved.spec.seconds < k.in + k.dur ? { dur: Math.max(0.2, saved.spec.seconds - k.in) } : {}) });
				} catch (e) {
					this.error = `Shot: ${/** @type {Error} */ (e).message}`;
				}
			}, 800)
		);
		if (!this.playing) this.driveWorld();
	}
	/**
	 * Shot versions: move a clip to another version of its shot (the newest, or back).
	 * @param {Clip} c @param {number} version
	 */
	async useVersion(c, version) {
		if (!c.shot || !this.canEdit) return;
		const s = await shotAt(c.shot, version);
		if (!s) return void (this.error = `No version ${version} of this shot.`);
		this.shotRev++;
		this.patchClip(c.id, { shotVersion: s.version });
	}

	/**
	 * Records a camera move over the playing timeline: from the clip's start, flown by hand, until stopped or the clip ends.
	 * @param {Clip} c
	 */
	async record(c) {
		if (!this.canEdit || !isWorld(c)) return;
		if (this.world.recording) return this.stopRecording(c);
		if (this.world.state !== 'ready') return void (this.error = 'Recording needs the live world — in the 3D tab.');
		this.seek(c.start);
		await this.play();
		if (!this.world.startRecording()) return;
		const until = () => {
			if (!this.world.recording) return;
			if (!this.playing || this.time >= c.start + c.dur) return void this.stopRecording(c);
			requestAnimationFrame(until);
		};
		requestAnimationFrame(until);
	}
	/** @param {Clip} c */
	async stopRecording(c) {
		const keys = await this.world.stopRecording();
		this.stop();
		if (!keys.length) return;
		// the keys' times are from when the recording began, which is the clip's first frame: shot time = in + t
		this.editSpec(c, (s) => {
			s.camera = { kind: 'keys', curve: s.camera.curve ?? 'glide', keys: keys.map((k) => ({ ...k, t: c.in + k.t })) };
		});
	}

	// ── colour: a file's profile, set by hand when detection got it wrong (re-queues its proxy, on the API side) ──
	/** @param {MediaItem} m @param {string | null} profile */
	async setOverride(m, profile) {
		/** @type {Record<string, unknown>} */
		const color = { .../** @type {object} */ (m.meta?.color ?? { profile: 'unknown', detectedFrom: 'set in the studio' }) };
		if (profile) color.override = profile;
		else delete color.override;
		const meta = { ...m.meta, color };
		try {
			await describeMedia(m.hash, { meta });
			this.library = this.library.map((x) => (x.hash === m.hash ? { ...x, meta } : x));
		} catch (e) {
			this.error = /** @type {Error} */ (e).message;
		}
	}

	// ── exporting: a job the Mac app renders natively (vault/app/src/render.rs); the studio shows how it goes ──
	async refreshRenders() {
		if (!this.current) return;
		const id = this.current.id;
		const before = this.renders;
		const next = await listRenders(id).catch(() => null);
		if (!next || this.current?.id !== id) return; // another timeline opened while this was on its way
		this.renders = next;
		const t = Date.now();
		for (const r of next) {
			if (r.status !== 'rendering' || r.note !== 'rendering') continue;
			const seen = this.pace[r.id];
			if (!seen) this.pace[r.id] = { t0: t, p0: r.progress, t, p: r.progress };
			else if (r.progress !== seen.p) this.pace[r.id] = { ...seen, t, p: r.progress };
		}
		// a job just finished: the film is in the library now (show it there), and the stage moves on
		const ended = next.filter((r) => !running(r) && before.some((b) => b.id === r.id && running(b)));
		if (ended.length) {
			this.showRenders = true;
			if (ended.some((r) => r.status === 'done')) {
				this.library = await listMedia().then(asStudio).catch(() => this.library);
				if (this.stage === 'locked' || this.stage === 'graded') this.setMeta({ stage: 'rendered' });
			}
		}
		void this.refreshDeliveries();
		this.poll(next.some(running));
	}
	showRenders = $state(false);

	/** The newest finished render of this timeline, and what its report says (the worker's, C6). */
	lastRender = $derived(this.newest.find((r) => r.status === 'done') ?? null);
	/** @type {import('$lib/auth/client').RenderReport | null} */
	lastReport = $derived(this.lastRender?.report ?? null);

	/**
	 * The files the last render delivered: the film's content item keeps every delivery of this timeline (format,
	 * channels, and from the colour-managed worker its QC and loudness); the render's own report fills in QC and
	 * loudness where the item has none.
	 */
	async refreshDeliveries() {
		const id = this.current?.id;
		if (!id || !this.lastRender) return void (this.deliveries = []);
		const items = await listContent().then((r) => r.items).catch(() => []);
		if (this.current?.id !== id) return;
		const fromReport = this.lastReport?.deliveries ?? [];
		this.deliveries = /** @type {DeliveryRecord[]} */ (items.flatMap((i) => i.deliveries ?? []).filter((d) => d.timeline === id)).map((d) => {
			const r = fromReport.find((x) => x.hash === d.hash && x.codec === d.codec);
			return r ? { ...d, qc: d.qc ?? r.qc, loudness: d.loudness ?? r.loudness } : d;
		});
	}

	/** @param {boolean} on */
	poll(on) {
		if (on && !this.renderPoll) this.renderPoll = setInterval(() => void this.refreshRenders(), 3000);
		else if (!on && this.renderPoll) clearInterval(this.renderPoll), (this.renderPoll = null);
	}
	async exportTimeline() {
		if (!this.current || this.queuing) return;
		this.queuing = true;
		this.showRenders = true;
		try {
			await this.flush(); // render what is on screen, saved
			const job = await queueRender(this.current.id);
			this.skew = Date.parse(job.created) - Date.now();
			this.renders = [job, ...this.renders.filter((r) => r.id !== job.id)];
			this.poll(true);
		} catch (e) {
			this.error = `Render: ${/** @type {Error} */ (e).message}`;
		} finally {
			this.queuing = false;
		}
	}
	/** @param {RenderJob} r */
	elapsed = (r) => (this.now + this.skew - Date.parse(r.created)) / 1000;
	/** @param {RenderJob} r */
	took = (r) => (Date.parse(r.updated) - Date.parse(r.created)) / 1000;
	/**
	 * Seconds left, from how fast the progress has moved since the film began rendering; null until it has moved.
	 * @param {RenderJob} r
	 */
	left(r) {
		const s = this.pace[r.id];
		if (!s || s.t <= s.t0 || s.p <= s.p0) return null;
		const rate = (s.p - s.p0) / (s.t - s.t0);
		return Math.max(0, (0.95 - s.p) / rate - (this.now - s.t) / 1000 + 2); // + the moment it takes to go into the library
	}

	/**
	 * A file (a render, a delivery) in the source monitor (the library is fetched again if it is not in it yet).
	 * @param {string | null} hash
	 */
	async openFile(hash) {
		if (!hash) return;
		let m = this.byHash.get(hash);
		if (!m) {
			this.library = await listMedia().then(asStudio).catch(() => this.library);
			m = this.library.find((x) => x.hash === hash);
		}
		if (m) this.pick(m);
		else window.open(raw(hash), '_blank', 'noopener');
	}

	/**
	 * A library file into the source monitor.
	 * @param {MediaItem} m
	 */
	pick(m) {
		this.srcFocus = true;
		if (this.preview === m.hash) return;
		this.srcEl?.pause();
		this.preview = m.hash;
		if (m.kind === 'audio') void this.source(m.hash).catch((e) => (this.error = /** @type {Error} */ (e).message)); // for its waveform
	}
	closeSource() {
		this.srcEl?.pause();
		this.preview = null;
		this.srcFocus = false;
	}

	/** @param {MediaItem} m @returns {Track} */
	defaultTrack = (m) =>
		m.kind === 'audio'
			? ['role:music', 'role:score', 'role:cue'].some((t) => m.tags.includes(t))
				? 'A2'
				: ['role:sfx', 'role:ambience'].some((t) => m.tags.includes(t))
					? 'A3'
					: 'A1'
			: 'V1';
}

/** @param {Track} t */
export const tint = (t) => (t === 'A1' ? '#a8741a' : t === 'A3' ? '#4a5f93' : '#2f7d6a');
export { evaluate };
