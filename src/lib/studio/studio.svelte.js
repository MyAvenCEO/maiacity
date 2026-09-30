// The studio's one state: the library, the open timeline and its clips, the playhead and the sound, the colour
// pipeline's LUTs, the world viewer, the renders — shared by the three working steps (Edit · Grade · Render) and every
// panel in them. The panels only show it and call its methods; nothing here draws.
import {
	API,
	fileUrl,
	createTimeline,
	deleteTimeline,
	describeMedia,
	getTimeline,
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
import { ODT, PROFILES, WORKING, asStudio, clean, cleanBalance, gradesFor, isCache, isSequence, presetOf, profileFor, proxyFor } from './color.js';
import { filmLut, gradeLut, nativeLut, nativePresets } from './luts.js';
import { cached, evaluate, saveSpec, shotAt } from './shots.js';
import { WorldViewer } from './world.svelte.js';
import { captionWordsOf, hasSound, lineWords, phraseBreak, rewordPhrase, stepOpen, transcriptOf, transcriptState } from './transcript.js';
import { command, native } from '$lib/native';

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
/**
 * A caption word on the film's clock: `t`…`e`, from its voice clip's file (`hash`), `i` its place in that file's meta.words.
 * @typedef {{ word: string, t: number, e: number, clip: string, hash: string, i: number }} CaptionWord
 */
/** @typedef {{ words: CaptionWord[], start: number, end: number, clip: string }} Phrase */
/**
 * Where a video's sound stands in the studio: decoded (ready), on its way (loading),
 * none in the file (silent), or failed (and why).
 * @typedef {'ready' | 'loading' | 'waiting' | 'silent' | `failed: ${string}`} SoundState
 */
/** A shot of the script: its clip, how far it is (words, a storyboard still, the footage, a world shot), what is said under it. @typedef {{ clip: Clip, stage: 'text' | 'storyboard' | 'footage' | 'world', lines: Clip[] }} ScriptShot */
/** @typedef {{ scene: string, shots: ScriptShot[] }} ScriptScene */
/** @typedef {'ingest' | 'library' | 'script' | '3d' | 'edit' | 'audio' | 'grade' | 'render' | 'deliverables'} Tab */
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
/** The film's frame rate (the render's): edits snap to its frames. */
export const FPS = 30;
/** A clip's link when its picture and sound were set apart on purpose (never linked again by itself). */
export const UNLINKED = '-';
/** A file's bytes, from this Mac's vault (with Range). @param {string} hash */
export const raw = (hash) => fileUrl(hash);
/** @param {MediaItem} m */
export const thumb = (m) => raw(m.hash);
/** @param {MediaItem | undefined} m */
export const itemName = (m) => m?.title || m?.original_name || m?.hash.slice(0, 10) || '';
/** @param {RenderJob} r */
export const running = (r) => r.status === 'queued' || r.status === 'rendering';
/** A sound's waveform: the loudest sample of each hundredth of a second (at most 8000 bars). @param {AudioBuffer} buffer */
const peaksOf = (buffer) => {
	const data = buffer.getChannelData(0), n = Math.min(8000, Math.ceil(buffer.duration * 100)), step = Math.floor(data.length / n);
	return Array.from({ length: n }, (_, i) => {
		let max = 0;
		for (let j = i * step; j < (i + 1) * step; j++) max = Math.max(max, Math.abs(data[j] ?? 0));
		return max;
	});
};
/** @param {Clip | null | undefined} c */
export const onSoundTrack = (c) => !!c && c.track !== 'V1';

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
	/** the grade presets, as Rust holds them (`color_presets`) @type {import('./luts.js').Preset[]} */
	presets = $state([]);
	/** the Audio tab: how the timeline sounds, clip by clip (render.rs `measure_sound`), and whether it is being measured */
	/** @type {any} */
	loud = $state(null);
	loudMeasuring = $state(false);
	/**
	 * Grade: what the viewer shows of each shot — its grading still (a frame of the original, 4K, through its CST into
	 * ACEScct: the base corrections are judged on it), its proxy, or the original itself
	 * @type {'stills' | 'proxies' | 'originals'}
	 */
	gradeOn = $state('stills');
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

	/**
	 * a video's sound, by its hash: the movie's own sound decoded for the sound tracks (see `sound()`)
	 * @type {Record<string, SoundState>}
	 */
	soundState = $state({});
	/** a passing word from the studio (what an action did) — shown beside the error, dismissed by a click */
	notice = $state('');

	// ── derived ──────────────────────────────────────────────────────────────
	byHash = $derived(new Map(this.library.map((m) => [m.hash, m])));
	aspect = $derived(this.current?.aspect ?? '1:1');
	/** @type {TimelineStage} */
	stage = $derived(this.current?.stage ?? 'edit');
	version = $derived(this.current?.version ?? 1);
	/** no lock for now: the cut stays open in every tab (a timeline locked before is opened again when it opens) */
	locked = false;
	/** picture and sound can be changed: the Edit and 3D tabs */
	canEdit = $derived(this.tab === 'edit' || this.tab === '3d' || this.tab === 'script');
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
	// captions: every voice clip's words (its file's meta.words — the render reads the same), placed where the clip puts them
	captionWords = $derived.by(() => {
		/** @type {CaptionWord[]} */
		const out = [];
		for (const c of this.clips.filter((c) => c.track === 'A1' && (c.hash || c.kind === 'line'))) {
			const hash = c.hash ?? '';
			// a line of the script not recorded yet: its words spread over it, as the render spreads them
			const words = c.kind === 'line' ? lineWords(c) : captionWordsOf(this.byHash.get(hash));
			for (const [i, w] of words.entries())
				if (w.start >= c.in && w.start < c.in + c.dur) out.push({ word: w.word, t: c.start + (w.start - c.in), e: c.start + (w.end - c.in), clip: c.id, hash, i });
		}
		return out;
	});
	// words become phrases — a few at a time, broken at the punctuation — by the render's own rule (timeline.rs `phrases`)
	phrases = $derived.by(() => {
		/** @type {Phrase[]} */
		const out = [];
		for (const c of this.clips.filter((c) => c.track === 'A1'))
			for (const words of phraseBreak(this.captionWords.filter((w) => w.clip === c.id)))
				out.push({ words, start: words[0].t, end: /** @type {CaptionWord} */ (words.at(-1)).e, clip: c.id });
		return out;
	});
	// on screen as the render burns it in: from a moment before the phrase's first word to a moment after its last
	caption = $derived(this.phrases.findLast((p) => this.time >= p.start - 0.08 && this.time < p.end + 0.3)?.words ?? []);

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
		if (c.kind === 'slate') return [c.script?.label, c.script?.description].filter(Boolean).join(' · ') || 'A shot to film';
		if (c.kind === 'line') return c.text ? `“${c.text}”` : 'A line to record';
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
	onProxies = $derived(this.tab !== 'grade' || this.gradeOn !== 'originals');
	/**
	 * A shot's grading still (its original's meta.grade_still), when the vault has it: the file and the moment of the
	 * original it shows.
	 * @param {Clip | null | undefined} c @returns {{ hash: string, t: number, inside: boolean } | null}
	 */
	stillOf(c) {
		if (!c?.hash) return null;
		const orig = String(this.byHash.get(c.hash)?.meta?.proxy_of ?? c.hash);
		// the file's one grading still (its best frame, as the analysis marks it)
		const h = this.byHash.get(orig)?.meta?.grade_still;
		const st = typeof h === 'string' ? this.byHash.get(h) : undefined;
		if (!st) return null;
		const t = Number(st.meta?.t ?? 0);
		return { hash: st.hash, t, inside: t >= c.in && t <= c.in + c.dur };
	}
	/** Grade, paused, on stills: the shot under the playhead shows its grading still */
	showStill = $derived(this.tab === 'grade' && this.gradeOn === 'stills' && !this.playing && !!this.stillOf(this.picture));
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
	 * The grades a clip is seen through, on every tab: its own, then the film's look.
	 * @param {Clip | null | undefined} c @returns {Cdl[]}
	 */
	gradesOf(c) {
		return gradesFor(c, this.current);
	}
	/**
	 * A grade's cube as the Mac baked it (`gradeLut`), at once when it is here; else null, and the world is drawn again
	 * when it comes.
	 * @param {import('$lib/auth/client').Balance | null} balance @param {Cdl[]} grades @returns {import('./luts.js').Lut | null}
	 */
	cubeFor(balance, grades) {
		const key = JSON.stringify([balance, grades]);
		if (this.#cubes.has(key)) return this.#cubes.get(key) ?? null;
		this.#cubes.set(key, null);
		if (this.#cubes.size > 24) this.#cubes.delete(/** @type {string} */ (this.#cubes.keys().next().value));
		gradeLut(balance, grades)
			.then((l) => (this.#cubes.set(key, l), this.driveWorld()))
			.catch(() => this.#cubes.delete(key));
		return null;
	}
	/** @type {Map<string, import('./luts.js').Lut | null>} */
	#cubes = new Map();
	/** A clip's balance as the viewer shows it, on every tab. @param {Clip | null | undefined} c */
	balanceOf(c) {
		return c?.balance ?? null;
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
		this.watchVault();
		void this.loadLuts();
		void this.refreshJobs();
		// a proxy the Mac just made — a world shot's too — is in the library at once, so its clips play it
		if (native() && !this.unlisten)
			this.unlisten = import('@tauri-apps/api/event').then(({ listen }) =>
				listen('vault-proxy', () => void this.reloadLibrary())
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
		if (!this.presets.length) this.presets = await nativePresets().catch(() => []);
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
		// every clip stays, a file this Mac does not have yet included: the timeline marks it on the clip itself;
		// a picture and its own sound in sync, linked
		const [clips, linked] = this.autoLink(t.clips);
		this.clips = clips;
		this.dropped = 0;
		this.past = [];
		this.future = [];
		this.baseline = this.snapshotNow();
		if (linked) queueMicrotask(() => this.changed());
		this.selected = null;
		this.selectedKey = null;
		this.time = 0;
		this.saving = 'saved';
		this.shape = /** @type {Shape} */ (['16:9', '9:16', '1:1', '4:5'].includes(t.aspect) ? t.aspect : '16:9');
		// a timeline locked before the lock went: open again (the API fixes the cut of a locked one)
		if (t.stage && t.stage !== 'edit') this.setMeta({ stage: 'edit' });
		try {
			localStorage.setItem(LAST, t.id);
		} catch {
			/* fine */
		}
		for (const c of this.clips) if (c.hash) void this.source(c.hash).catch((e) => (this.error = /** @type {Error} */ (e).message));
		for (const c of this.clips) if (onSoundTrack(c) && c.hash && this.byHash.get(c.hash)?.kind === 'video') void this.sound(c.hash);
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
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	settle = undefined;
	// ── revert and reapply: the timeline as it was a step ago (a burst of changes — a slider's drag — is one step) ──
	/** @typedef {{ clips: Clip[], grade: Timeline['grade'] }} Step */
	/** @type {Step[]} */
	past = $state([]);
	/** @type {Step[]} */
	future = $state([]);
	/** @type {Step | null} the timeline as it stood when the last burst of changes began */
	baseline = null;
	lastChange = 0;
	restoring = false;
	/** @returns {Step} */
	snapshotNow() {
		return { clips: $state.snapshot(this.clips), grade: $state.snapshot(this.current?.grade ?? null) };
	}
	/** @param {Step} st */
	apply(st) {
		this.restoring = true;
		this.clips = structuredClone(st.clips);
		if (this.current) this.current = { ...this.current, grade: structuredClone(st.grade) };
		this.baseline = st;
		this.changed();
		this.restoring = false;
		if (this.playing) this.schedule();
	}
	undo() {
		const st = this.past.at(-1);
		if (!st) return;
		this.past = this.past.slice(0, -1);
		this.future = [...this.future, this.snapshotNow()];
		this.apply(st);
	}
	redo() {
		const st = this.future.at(-1);
		if (!st) return;
		this.future = this.future.slice(0, -1);
		this.past = [...this.past, this.snapshotNow()];
		this.apply(st);
	}
	changed() {
		if (!this.restoring) {
			const now = Date.now();
			// the first change of a burst: the state before it becomes one step back
			if (this.baseline && now - this.lastChange > 800) {
				this.past = [...this.past.slice(-49), this.baseline];
				this.future = [];
			}
			this.lastChange = now;
			clearTimeout(this.settle);
			this.settle = setTimeout(() => (this.baseline = this.snapshotNow()), 800);
		}
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
			// only over the version this copy was read from: an agent's edit in between is never overwritten
			const t = await saveTimeline(cur.id, { ...body, ...(cur.updated ? { if_updated: cur.updated } : {}) });
			this.timelines = [t, ...this.timelines.filter((x) => x.id !== t.id)];
			// an API that keeps the stages says which version the timeline is (it counts the unlocks itself)
			if (this.current?.id === cur.id) this.current = { ...this.current, updated: t.updated, version: t.version };
			this.saving = 'saved';
		} catch (e) {
			const msg = /** @type {Error} */ (e).message;
			if (/changed elsewhere/.test(msg)) {
				// someone else's edit is newer: theirs wins, this one is read again
				await this.refresh(true);
				this.notice = 'The timeline was changed elsewhere (an agent?): read again — your last change was not saved.';
				return;
			}
			this.error = msg;
			this.saving = 'unsaved';
		}
	}
	/**
	 * The open timeline as the API has it now, when it changed elsewhere (an agent through MCP): its clips and meta
	 * read again, the playhead and tab kept. Never while a change of ours waits to be saved, unless `force`.
	 */
	async refresh(force = false) {
		const cur = this.current;
		if (!cur || (!force && this.saving !== 'saved')) return;
		let t;
		try {
			t = await getTimeline(cur.id);
		} catch {
			return;
		}
		if (this.current?.id !== cur.id || (!force && (this.saving !== 'saved' || t.updated === cur.updated))) return;
		// an edit from elsewhere (an agent): one step back reverts it
		if (this.baseline) this.past = [...this.past.slice(-49), this.baseline];
		this.future = [];
		this.current = t;
		this.timelines = [t, ...this.timelines.filter((x) => x.id !== t.id)];
		const [clips, linked] = this.autoLink(t.clips);
		this.clips = clips;
		this.dropped = 0;
		this.saving = 'saved';
		this.baseline = this.snapshotNow();
		if (linked) this.changed();
		if (this.playing) this.schedule();
	}
	/** @param {Partial<Timeline>} patch */
	setMeta(patch) {
		if (!this.current) return;
		this.current = { ...this.current, ...patch };
		this.changed();
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

	// ── the script: the timeline's own clips read as scenes of shots, each with the lines said under it ──────────
	script = $derived.by(() => {
		/** @type {ScriptScene[]} */
		const out = [];
		const lines = this.clips.filter((c) => c.track === 'A1').sort((a, b) => a.start - b.start);
		for (const c of this.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start)) {
			const scene = c.script?.scene ?? out.at(-1)?.scene ?? 'Scene 1';
			if (out.at(-1)?.scene !== scene) out.push({ scene, shots: [] });
			const kind = c.kind === 'slate' ? 'text' : isWorld(c) ? 'world' : this.byHash.get(c.hash ?? '')?.kind === 'image' ? 'storyboard' : 'footage';
			const mine = lines.filter((l) => l.start >= c.start - 0.05 && l.start < c.start + c.dur);
			/** @type {ScriptScene} */ (out.at(-1)).shots.push({ clip: c, stage: kind, lines: mine });
		}
		return out;
	});
	/**
	 * A shot's place in the script: its scene, label, description, notes, size (any tab; the cut stays).
	 * @param {string} id @param {import('$lib/auth/client').ClipScript} patch
	 */
	setScript(id, patch) {
		const c = this.clips.find((k) => k.id === id);
		if (c) this.patchClip(id, { script: { ...(c.script ?? {}), ...patch } });
	}
	/** A line's words (a line not recorded yet). @param {string} id @param {string} text */
	setLine(id, text) {
		this.patchClip(id, { text });
	}
	/**
	 * Everything from `at` on, on every track, later by `by` seconds: room for a new shot.
	 * @param {number} at @param {number} by
	 */
	ripple(at, by) {
		this.clips = this.clips.map((c) => (c.start >= at - 1e-6 ? { ...c, start: this.snap(c.start + by) } : c));
	}
	/**
	 * A new shot of the script, as a slate: at the end of its scene (or of the film), everything after it later.
	 * @param {string} scene @param {number} [seconds]
	 */
	addShot(scene, seconds = 4) {
		const inScene = this.script.find((x) => x.scene === scene)?.shots ?? [];
		const at = inScene.length ? Math.max(...inScene.map((x) => x.clip.start + x.clip.dur)) : this.end;
		this.ripple(at, seconds);
		const n = this.clips.filter((c) => c.track === 'V1').length + 1;
		/** @type {Clip} */
		const c = { id: Math.random().toString(36).slice(2, 10), kind: 'slate', track: 'V1', start: this.snap(at), in: 0, dur: seconds, vol: 0, script: { scene, label: String(n) } };
		this.clips = [...this.clips, c];
		this.selected = c.id;
		this.changed();
	}
	/** A new line under a shot: after its last line, else at its start. @param {string} shotId */
	addLine(shotId) {
		const s = this.script.flatMap((x) => x.shots).find((x) => x.clip.id === shotId);
		if (!s) return;
		const after = s.lines.at(-1);
		const start = after ? after.start + after.dur + 0.3 : s.clip.start + 0.3;
		/** @type {Clip} */
		const c = { id: Math.random().toString(36).slice(2, 10), kind: 'line', track: 'A1', start: this.snap(start), in: 0, dur: 3, vol: 1, text: '' };
		this.clips = [...this.clips, c];
		this.selected = c.id;
		this.changed();
	}
	/**
	 * A slate or a line swapped for a file (a storyboard still, the footage, the recorded voice): the same place and
	 * length, its script kept.
	 * @param {string} id @param {string} hash
	 */
	async swap(id, hash) {
		const c = this.clips.find((k) => k.id === id);
		const m = this.byHash.get(hash);
		if (!c || !m) return;
		const dur = m.kind === 'image' ? c.dur : Math.min(c.dur, (await this.source(hash).catch(() => null))?.duration ?? c.dur);
		const { kind: _k, text: _t, ...rest } = c;
		this.clips = this.clips.map((k) => (k.id === id ? { ...rest, hash, in: 0, dur, vol: c.track === 'V1' ? (m.kind === 'video' ? 0.2 : 0) : 1 } : k));
		this.selected = id;
		this.changed();
		if (c.track !== 'V1') void this.sound(hash);
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
				peaks = peaksOf(buffer);
			}
			const s = { url, duration, peaks, buffer };
			this.sources[hash] = s;
			return s;
		})();
		this.pending.set(hash, p);
		return p;
	}

	/** @type {Map<string, Promise<void>>} */
	pendingSound = new Map();
	/**
	 * A clip's sound, ready to play: a sound file decoded (source()); a video's sound — a clip of it on a sound track —
	 * decoded from the movie itself: its proxy (which carries the sound) or, without one, its original, read by hash
	 * from the vault. There are no audio proxies. soundState says where each one is.
	 * @param {string} hash
	 */
	async sound(hash) {
		const m = this.byHash.get(hash);
		if (m?.kind !== 'video') return void (await this.source(hash));
		await this.source(hash);
		if (this.sources[hash]?.buffer) return void (this.soundState[hash] = 'ready');
		if (!hasSound(m)) return void (this.soundState[hash] = 'silent');
		const waiting = this.pendingSound.get(hash);
		if (waiting) return waiting;
		const p = (async () => {
			this.soundState[hash] = 'loading';
			try {
				// the sound the movie carries: its proxy's (the proxy keeps it, on the original's clock), else the original's —
				// read by hash straight from the vault, never copied out of it
				const from = this.proxy(m).hash ?? hash;
				const res = await fetch(raw(from));
				if (!res.ok) throw new Error(`the vault did not give ${from.slice(0, 12)} (${res.status})`);
				const buffer = await this.audioCtx().decodeAudioData(await res.arrayBuffer());
				this.sources[hash] = { ...this.sources[hash], buffer, peaks: peaksOf(buffer) };
				this.soundState[hash] = 'ready';
			} catch (e) {
				this.soundState[hash] = `failed: ${/** @type {Error} */ (e).message}`;
				console.warn(`sound of ${itemName(m)}:`, /** @type {Error} */ (e).message);
			} finally {
				this.pendingSound.delete(hash);
			}
		})();
		this.pendingSound.set(hash, p);
		return p;
	}
	/** Every video sound on the sound tracks not decoded yet, tried again (its proxy may have come in). */
	retrySounds() {
		for (const c of this.clips) if (onSoundTrack(c) && c.hash && this.soundState[c.hash] && this.soundState[c.hash] !== 'ready') void this.sound(c.hash);
	}
	/** The library read again (a proxy or a transcript came in), and the sounds waiting on it tried. */
	async reloadLibrary() {
		this.library = await listMedia().then(asStudio).catch(() => this.library);
		this.retrySounds();
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
		// the sound tracks only: a video's picture on V1 plays its own sound through its player (at its volume — 0 once
		// its sound is a clip of its own), never twice
		const all = [...this.clips.filter((c) => onSoundTrack(c)), ...this.cueClips];
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
				for (const v of this.clips.filter((v) => v.track === 'A1' && v.start + v.dur > from && v.start < c.start + c.dur).sort((x, y) => x.start - y.start)) {
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
		if (this.vaultWatch) clearInterval(this.vaultWatch), (this.vaultWatch = null);
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
			// a picture whose sound is its own clip is silent — but while that sound is not decoded yet, the
			// picture's player lends it its sound (in sync only), so nothing plays mute
			const p = this.partnerOf(c);
			v.volume = Math.min(1, p && onSoundTrack(p) && c.hash && this.soundState[c.hash] !== 'ready' && !this.drift(c) ? p.vol : c.vol);
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
		// the view film mode draws through: the clip's grade (balance, its CDL, the film's look: the Mac's cube) and the output
		const grades = this.gradesOf(c), balance = this.balanceOf(c);
		const grade = grades.length || balance ? this.cubeFor(balance, grades) : null;
		this.world.show({ spec, t: this.shotTime(c), shape: /** @type {Shape} */ (this.viewShape), ...hd(this.viewShape), view: { lut: filmLut(this.luts['odt-rec709'] ?? null), grade: filmLut(grade) } });
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
		await Promise.all(
			[...this.clips, ...this.cueClips].map((c) =>
				c.hash
					? (onSoundTrack(c) ? this.sound(c.hash) : this.source(c.hash)).catch((e) => {
							// a sound that cannot load plays as silence — say so, never in silence
							console.warn(`sound ${c.hash?.slice(0, 12)} (${c.track}):`, /** @type {Error} */ (e).message);
							return null;
						})
					: null
			)
		);
		const mute = this.clips.filter((c) => onSoundTrack(c) && c.hash && this.byHash.get(c.hash)?.kind === 'video' && this.soundState[c.hash] !== 'ready');
		if (mute.length) console.warn(`${mute.length} video sound clip(s) play silent until their sound is decoded:`, mute.map((c) => `${this.clipName(c)} (${this.soundState[c.hash ?? '']})`).join(', '));
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
	/** A time on the film's frame grid (the render's 30 fps): every cut lands on a frame. @param {number} t */
	snap = (t) => Math.round(t * FPS) / FPS;

	/**
	 * Lays a file on a track at `start`: the whole of it, or only `range` of it (a sound or a film marked in the source monitor).
	 * @param {string} hash @param {Track} track @param {number} start @param {{ in: number, dur: number }} [range]
	 */
	async place(hash, track, start, range) {
		if (!this.canEdit && this.tab !== 'script') return void (this.error = '');
		const m = this.byHash.get(hash);
		// dropped onto a slate (a shot of the script not filmed yet) or a line not recorded yet: it takes its place,
		// keeping its time and its script
		const stand = this.clips.find((c) => c.track === track && (c.kind === 'slate' || c.kind === 'line') && start >= c.start - 0.05 && start < c.start + c.dur);
		if (stand && m) return this.swap(stand.id, hash);
		const accepts = TRACKS.find((t) => t.id === track)?.accepts ?? [];
		// a video on a sound track: its sound alone (a camera's voice on A1, its room on A3)
		const soundOnly = track !== 'V1' && m?.kind === 'video' && hasSound(m);
		if (!m || !(accepts.includes(m.kind) || soundOnly)) return void (this.error = `${itemName(m)} does not go on the ${track} track.`);
		this.error = '';
		try {
			const s = await this.source(hash);
			const whole = m.kind === 'image' ? IMAGE_LEN : s.duration;
			const from = m.kind === 'image' || !range ? 0 : Math.min(Math.max(0, range.in), Math.max(0, whole - 0.2));
			const dur = m.kind === 'image' || !range ? whole : Math.min(Math.max(0.2, range.dur), whole - from);
			const c = this.clip(hash, track, Math.max(0, this.snap(start)), from, dur);
			if (track === 'A2') c.vol = 0.3;
			if (track === 'A3') c.vol = soundOnly ? 1 : 0.2;
			/** @type {Clip[]} */
			const added = [c];
			// a video with sound on V1: its sound comes along as a clip of its own on A3, linked to the picture (moved and
			// trimmed with it); the picture's own player is silent then — the sound plays once, from the sound track
			if (track === 'V1' && m.kind === 'video' && hasSound(m)) {
				const link = Math.random().toString(36).slice(2, 10);
				c.link = link;
				c.vol = 0;
				// someone speaking in it: its sound is a voice (A1, in the captions); else the room (A3)
				const speech = !!transcriptOf(m);
				added.push({ ...this.clip(hash, speech ? 'A1' : 'A3', c.start, c.in, c.dur), link });
			}
			this.clips = [...this.clips, ...added];
			this.selected = c.id;
			this.changed();
			for (const k of added) if (onSoundTrack(k) && m.kind === 'video') void this.sound(hash);
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

	/**
	 * A cut by hand: the clip at `t` in two — the part before stays, the part after is a new clip that goes on from
	 * there in its file (its fade in and out kept at the outer ends). Its linked partner is cut with it, the two new
	 * halves linked again. Nothing happens within a frame of either end.
	 * @param {string} id @param {number} t @param {boolean} [alone]
	 */
	split(id, t, alone = false) {
		const c = this.clips.find((k) => k.id === id);
		if (!c) return;
		const at = this.snap(t);
		if (at <= c.start + 1 / FPS || at >= c.start + c.dur - 1 / FPS) return;
		const partner = alone ? null : this.partnerOf(c);
		const link = Math.random().toString(36).slice(2, 10);
		/** @param {Clip} k @returns {[Clip, Clip]} */
		const cut = (k) => {
			const d = at - k.start;
			const { fout: _o, ...left } = k;
			const { fin: _i, ...right } = k;
			return [
				{ ...left, dur: d },
				{ ...right, id: Math.random().toString(36).slice(2, 10), start: at, in: k.in + d, dur: k.dur - d, ...(k.link && partner ? { link } : {}) }
			];
		};
		const halves = [c, ...(partner && at > partner.start && at < partner.start + partner.dur ? [partner] : [])].map(cut);
		const ids = new Set(halves.map(([l]) => l.id));
		this.clips = [...this.clips.filter((k) => !ids.has(k.id)), ...halves.flat()];
		this.selected = halves[0][1].id;
		this.changed();
		if (this.playing) this.schedule();
	}
	/** The blade at the playhead: the selected clip, else every clip under the playhead on V1. @param {boolean} [alone] */
	splitAtPlayhead(alone = false) {
		if (!this.canEdit) return;
		const sel = this.sel;
		const under = (/** @type {Clip} */ k) => this.time > k.start && this.time < k.start + k.dur;
		const targets = sel && under(sel) ? [sel] : this.clips.filter((k) => k.track === 'V1' && under(k));
		for (const k of targets) this.split(k.id, this.time, alone);
	}
	/**
	 * Takes a clip off the timeline — and its linked partner (a video's picture and its sound go together), unless `alone`.
	 * @param {string | null} id
	 */
	remove(id, alone = false) {
		if (!id || !this.canEdit) return;
		const c = this.clips.find((k) => k.id === id);
		const partner = alone ? null : this.partnerOf(c);
		this.clips = this.clips.filter((k) => k.id !== id && k.id !== partner?.id).map((k) => (alone && c?.link && k.link === c.link ? { ...k, link: undefined } : k));
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
		const c = this.clips.find((k) => k.id === id);
		const partner = this.partnerOf(c);
		if (c && partner && (patch.start !== undefined || patch.in !== undefined || patch.dur !== undefined)) {
			// the linked partner moves and trims by as much
			const ds = (patch.start ?? c.start) - c.start, di = (patch.in ?? c.in) - c.in, dd = (patch.dur ?? c.dur) - c.dur;
			const pin = Math.max(0, partner.in + di);
			this.patchClip(partner.id, { start: Math.max(0, partner.start + ds), in: pin, dur: Math.max(0.2, partner.dur + dd) });
		}
		this.patchClip(id, patch);
	}

	// ── a video's picture and its sound, linked ─────────────────────────────────
	/**
	 * The clip linked to this one: a video's sound for its picture, its picture for its sound.
	 * @param {Clip | null | undefined} c @returns {Clip | null}
	 */
	partnerOf(c) {
		if (!c?.link || c.link === UNLINKED) return null;
		return this.clips.find((k) => k.id !== c.id && k.link === c.link) ?? null;
	}
	/**
	 * How far a linked sound has slid off its picture (seconds; 0 in sync): where the file's first frame lands on each.
	 * @param {Clip} c
	 */
	drift(c) {
		const p = this.partnerOf(c);
		return p ? this.snap(p.start - p.in - (c.start - c.in)) : 0;
	}
	/**
	 * A video clip's sound, pulled out onto A3 as a clip of its own (the same file, the same place and length), linked to
	 * it; the picture's player goes silent. The sound plays from the movie itself, the render from the original.
	 * @param {Clip} c
	 */
	detachSound(c) {
		if (!this.canEdit || !c.hash || c.track !== 'V1' || this.partnerOf(c)) return;
		const link = Math.random().toString(36).slice(2, 10);
		const sound = { ...this.clip(c.hash, 'A3', c.start, c.in, c.dur), vol: c.vol || 1, link };
		this.clips = [...this.clips.map((k) => (k.id === c.id ? { ...k, link, vol: 0 } : k)), sound];
		this.selected = sound.id;
		this.changed();
		void this.sound(c.hash);
		if (this.playing) this.schedule();
	}
	/** A linked clip slid off its partner, put back: this clip moves so the file's frames meet again. @param {Clip} c */
	resync(c) {
		const p = this.partnerOf(c);
		if (!p || !this.canEdit) return;
		this.patchClip(c.id, { start: Math.max(0, this.snap(c.start + this.drift(c))) });
	}
	/** Picture and sound apart: each moves on its own from now on. @param {Clip} c */
	unlink(c) {
		if (!this.canEdit || !c.link) return;
		const link = c.link;
		// apart on purpose: never linked again by itself
		this.clips = this.clips.map((k) => (k.link === link ? { ...k, link: UNLINKED } : k));
		this.changed();
	}
	/**
	 * A video's picture (V1) and its own sound (an A track, the same file) that play in sync are linked by default:
	 * moved, trimmed and cut together. Those unlinked on purpose stay apart. Returns the clips, and whether any changed.
	 * @param {Clip[]} clips @returns {[Clip[], boolean]}
	 */
	autoLink(clips) {
		const free = (/** @type {Clip} */ k) => !k.link;
		const out = clips.map((k) => ({ ...k }));
		let changed = false;
		for (const p of out.filter((k) => k.track === 'V1' && k.hash && free(k))) {
			const a = out.find(
				(k) =>
					k.track !== 'V1' && k.hash === p.hash && free(k) &&
					Math.abs(k.start - k.in - (p.start - p.in)) <= 1.5 / FPS &&
					Math.min(k.start + k.dur, p.start + p.dur) - Math.max(k.start, p.start) >= 0.5 * Math.min(k.dur, p.dur)
			);
			if (!a) continue;
			const link = Math.random().toString(36).slice(2, 10);
			p.link = link;
			a.link = link;
			changed = true;
		}
		return [out, changed];
	}
	/**
	 * A clip cut down to a run of its file's words (from, to: seconds of the file) — where they sit on the timeline stays.
	 * @param {Clip} c @param {number} from @param {number} to
	 */
	trimTo(c, from, to) {
		const a = this.snap(Math.max(0, from)), b = this.snap(to);
		if (b - a < 0.1) return;
		this.setClip({ start: Math.max(0, this.snap(c.start + (a - c.in))), in: a, dur: b - a }, c.id);
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
	/**
	 * A sound clip's gain and fades (the Audio tab): its level, never its place.
	 * @param {string} id @param {{ vol?: number, fin?: number, fout?: number }} patch
	 */
	setSound(id, patch) {
		this.patchClip(id, patch);
	}
	/** How the timeline sounds now, measured on this Mac (the Audio tab draws it). */
	async measureSound() {
		if (!this.current || this.loudMeasuring) return;
		this.loudMeasuring = true;
		try {
			this.loud = await command('sound_measure', { timeline: { ...$state.snapshot(this.current), clips: $state.snapshot(this.clips) } });
		} catch (e) {
			this.error = `Sound: ${e}`;
		} finally {
			this.loudMeasuring = false;
		}
	}
	/**
	 * The selected picture clip's balance layers (null: as shot).
	 * @param {import('$lib/auth/client').Balance | null} b
	 */
	setBalance(b) {
		if (!this.sel) return;
		this.patchClip(this.sel.id, { balance: cleanBalance(b) ?? undefined });
	}
	/** @param {Cdl | null} g */
	setGrade(g) {
		if (this.gradeTarget === 'film' || !this.sel || this.sel.track !== 'V1') {
			const preset = presetOf(g, this.presets);
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

	// ── captions: the voice's words on screen ─────────────────────────────────────
	// Every voice (A1) clip's captions come by themselves: its file's own words, else its transcript's (captionWordsOf,
	// the render's `caption_words`). Editing a phrase writes the file's own words; from then on those win.
	/**
	 * A file's caption words set (meta.words, merged into its meta; it syncs).
	 * @param {string} hash @param {import('./transcript.js').CaptionWord[]} words
	 */
	async setCaptionWords(hash, words) {
		try {
			await describeMedia(hash, { meta: { words } });
			this.library = this.library.map((x) => (x.hash === hash ? { ...x, meta: { ...x.meta, words } } : x));
			return true;
		} catch (e) {
			this.error = `Captions: ${/** @type {Error} */ (e).message}`;
			return false;
		}
	}
	/**
	 * A caption phrase written by hand: its words in the file's meta.words replaced (the same count keep their timing).
	 * @param {Phrase} p @param {string} text
	 */
	async rewordPhrase(p, text) {
		const hash = p.words[0]?.hash;
		const m = hash ? this.byHash.get(hash) : undefined;
		if (!m || !hash) return;
		const all = captionWordsOf(m);
		const from = p.words[0].i, to = /** @type {CaptionWord} */ (p.words.at(-1)).i;
		const next = [...all.slice(0, from), ...rewordPhrase(all.slice(from, to + 1), text), ...all.slice(to + 1)];
		await this.setCaptionWords(hash, next);
	}

	// ── what the vault brings later: audio proxies and transcripts (made on the server, synced into the catalog) ──
	/** @type {ReturnType<typeof setInterval> | null} */
	vaultWatch = null;
	/** Is anything on screen waiting for the vault — a sound still loading, a transcript on its way? */
	waitingOnVault() {
		if (Object.values(this.soundState).some((v) => v !== 'ready' && v !== 'silent' && v !== 'loading')) return true;
		const hashes = new Set([...this.clips.map((c) => c.hash), this.preview]);
		return this.library.some((m) => hashes.has(m.hash) && hasSound(m) && stepOpen(transcriptState(m)));
	}
	/** @type {ReturnType<typeof setInterval> | null} */
	timelineWatch = null;
	watchVault() {
		// the open timeline as others change it (an agent through MCP): seen here within seconds
		this.timelineWatch ??= setInterval(() => void this.refresh(), 4000);
		this.vaultWatch ??= setInterval(() => void (this.waitingOnVault() && this.reloadLibrary()), 20000);
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
export const tint = (t) => (t === 'A1' ? '#c8923a' : t === 'A3' ? '#6f8fd6' : '#3fae96');
export { evaluate };
