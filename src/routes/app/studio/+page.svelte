<!--
	The studio: a small editing room for the journal films, over the media library.

	The library sits on the left, filtered by type and tag; drag a file onto a track (or double-click it to drop it
	at the playhead). On the timeline every clip moves by hand: drag it to move it, drag its edges to trim it, click
	it to see and set it in the inspector, Delete to remove it. Space plays. The captions follow the voice clips,
	word by word, from each take's own timings. The edit is kept in this browser.

	A single click on a library file opens it in the source monitor, beside the program: it plays there on its own
	(the timeline stops while it does), I and O mark the part to use, and "Add to timeline" — or a drag onto a
	track — lays just that part down.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		API,
		createTimeline,
		deleteTimeline,
		listMedia,
		listRenders,
		listTimelines,
		may,
		queueRender,
		type RenderJob,
		me,
		saveTimeline,
		type MediaItem,
		type Timeline
	} from '$lib/auth/client';

	type Track = 'V1' | 'A1' | 'A2' | 'A3';
	type Clip = { id: string; cid: string; track: Track; start: number; in: number; dur: number; vol: number; fin?: number; fout?: number };
	type Source = { url: string; duration: number; peaks: number[]; buffer?: AudioBuffer };
	type Timed = { word: string; start: number; end: number };

	const TRACKS: { id: Track | 'T1'; label: string; accepts: string[] }[] = [
		{ id: 'V1', label: 'Picture', accepts: ['image', 'video'] },
		{ id: 'A1', label: 'Voice', accepts: ['audio'] },
		{ id: 'A2', label: 'Music', accepts: ['audio'] },
		{ id: 'A3', label: 'Sound', accepts: ['audio'] },
		{ id: 'T1', label: 'Captions', accepts: [] }
	];
	const ASPECTS = ['1:1', '16:9', '9:16', '4:5'];
	const LAST = 'maia-studio-last-timeline';
	const IMAGE_LEN = 4;

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let error = $state('');
	let library = $state<MediaItem[]>([]);
	let timelines = $state<Timeline[]>([]);
	let current = $state<Timeline | null>(null);
	let saving = $state<'saved' | 'saving' | 'unsaved'>('saved');
	let kind = $state<'all' | 'image' | 'video' | 'audio'>('all');
	let tag = $state<string | null>(null);
	let q = $state('');
	let clips = $state<Clip[]>([]);
	let selected = $state<string | null>(null);
	let sources = $state<Record<string, Source>>({});
	let pxPerSec = $state(60);
	let time = $state(0);
	let playing = $state(false);
	let lanes = $state<HTMLDivElement | null>(null);
	/** The monitor's videos, by clip: the shot on screen and the next ones, loaded and waiting on their first frame. */
	const reelVideos: Record<string, HTMLVideoElement | null> = $state({});
	let studio = $state<HTMLElement | null>(null);
	let renders = $state<RenderJob[]>([]);
	let showRenders = $state(false);
	let renderPoll: ReturnType<typeof setInterval> | null = null;
	let screen = $state<HTMLElement | null>(null);

	const byCid = $derived(new Map(library.map((m) => [m.cid, m])));
	const aspect = $derived(current?.aspect ?? '1:1');
	let frame = 0;

	// ── the library on the left ─────────────────────────────────────────────
	const ROLES = ['cover', 'in the post', 'poster', 'film', 'author', 'site'];
	const rank = (t: string) => (t.startsWith('Day ') ? 0 : ROLES.includes(t) ? 1 : t === 'unused' ? 3 : 2);
	const allTags = $derived(
		[...new Set(library.flatMap((m) => m.tags))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
	);
	const shown = $derived(
		library.filter((m) => {
			if (!['image', 'video', 'audio'].includes(m.kind) || m.tags.includes('superseded')) return false;
			if (kind !== 'all' && m.kind !== kind) return false;
			if (tag && !m.tags.includes(tag)) return false;
			const f = q.trim().toLowerCase();
			return !f || m.cid.includes(f) || m.title.toLowerCase().includes(f) || m.description.toLowerCase().includes(f) || m.tags.some((t) => t.toLowerCase().includes(f)) || String(m.meta?.text ?? '').toLowerCase().includes(f);
		})
	);
	const shownTimelines = $derived(timelines.filter((t) => !tag || t.tags.includes(tag)));
	// one heading per project, its variants under it (A, B, …); timelines without a project last
	const groups = $derived.by(() => {
		const map = new Map<string, Timeline[]>();
		for (const t of shownTimelines) map.set(t.project ?? '', [...(map.get(t.project ?? '') ?? []), t]);
		for (const l of map.values()) l.sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? '', undefined, { numeric: true }));
		return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
	});
	// the nav: a project opens to its variants; the open timeline's project opens with it
	const OPEN = 'studio:open-projects';
	let expanded = $state<string[]>([]);
	const shows = (p: string) => expanded.includes(p);
	function expand(p: string, on = !shows(p)) {
		expanded = on ? [...new Set([...expanded, p])] : expanded.filter((x) => x !== p);
		try {
			localStorage.setItem(OPEN, JSON.stringify(expanded));
		} catch {
			/* fine */
		}
	}

	const name = (m: MediaItem | undefined) => m?.title || m?.cid.slice(0, 10) || '';
	const raw = (cid: string) => `${API}/api/media/${cid}`;
	// thumbnails from the CDN copy when there is one (cached, public), else from the library itself
	const thumb = (m: MediaItem) => (m.cdn_path ? `https://maia.city/${m.cdn_path}` : raw(m.cid));

	// ── the timeline ────────────────────────────────────────────────────────
	const end = $derived(clips.reduce((n, c) => Math.max(n, c.start + c.dur), 0));
	const span = $derived(Math.max(end + 4, 20));
	const ticks = $derived.by(() => {
		const every = pxPerSec >= 40 ? 1 : pxPerSec >= 15 ? 5 : 10;
		return Array.from({ length: Math.floor(span / every) + 1 }, (_, i) => i * every);
	});
	const x = (t: number) => `${t * pxPerSec}px`;
	const sel = $derived(clips.find((c) => c.id === selected) ?? null);
	const at = (track: Track, t: number) => clips.filter((c) => c.track === track && t >= c.start && t < c.start + c.dur).at(-1) ?? null;
	const picture = $derived(at('V1', time));
	const pictureItem = $derived(picture ? byCid.get(picture.cid) : undefined);
	// a title card's marker shows as the day's card made for this frame — the one its meta names by CID, as the render uses it
	const stillItem = $derived.by(() => {
		const cards = pictureItem?.meta?.cards as Record<string, string> | undefined;
		const cid = cards?.[aspect.replace(':', 'x')];
		return (cid && byCid.get(cid)) || pictureItem;
	});
	// the reel: the video on screen and the next two, so a cut never waits for a file to load (no black frame)
	const reel = $derived.by(() => {
		const v1 = clips.filter((c) => c.track === 'V1' && byCid.get(c.cid)?.kind === 'video' && sources[c.cid]).sort((a, b) => a.start - b.start);
		const i = v1.findIndex((c) => c.start + c.dur > time);
		return i < 0 ? [] : v1.slice(i, i + 3);
	});

	// captions: every voice clip's words, placed where the clip puts them
	const captionWords = $derived.by(() => {
		const out: { word: string; t: number; clip: string }[] = [];
		for (const c of clips.filter((c) => c.track === 'A1')) {
			const m = byCid.get(c.cid);
			const words = (Array.isArray(m?.meta?.words) ? m!.meta.words : []) as Timed[];
			for (const w of words) if (w.start >= c.in && w.start < c.in + c.dur) out.push({ word: w.word, t: c.start + (w.start - c.in), clip: c.id });
		}
		return out;
	});
	// words become phrases — a few at a time, broken at the punctuation — the way a film's subtitles run
	const phrases = $derived.by(() => {
		const out: { words: { word: string; t: number }[]; start: number; end: number; clip: string }[] = [];
		for (const c of clips.filter((c) => c.track === 'A1')) {
			let cur: { word: string; t: number }[] = [];
			const flush = () => cur.length && out.push({ words: cur, start: cur[0]!.t, end: cur.at(-1)!.t + 0.5, clip: c.id });
			for (const w of captionWords.filter((w) => w.clip === c.id)) {
				cur.push(w);
				const text = cur.map((x) => x.word).join(' ');
				if ((/[.,;:!?]$/.test(w.word) && (cur.length >= 3 || /[.;:!?]$/.test(w.word))) || text.length > 38) flush(), (cur = []);
			}
			flush();
		}
		// each phrase stays until the next one begins (or a moment after its last word)
		return out.map((p, i) => ({ ...p, end: out[i + 1] && out[i + 1]!.clip === p.clip ? Math.min(out[i + 1]!.start, p.end + 1.2) : p.end + 0.6 }));
	});
	const caption = $derived(phrases.find((p) => time >= p.start - 0.08 && time < p.end)?.words ?? []);

	const clockText = (t: number) => {
		const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t % 1) * 100);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
	};

	// ── loading ─────────────────────────────────────────────────────────────
	// if anything goes wrong on the way in, say what — a gate that only ever says "One moment…" hides it
	let failed = $state<string | null>(null);
	onMount(() => {
		const report = (e: ErrorEvent | PromiseRejectionEvent) => {
			failed = String('reason' in e ? (e.reason?.stack ?? e.reason) : `${e.message} (${e.filename}:${e.lineno})`);
		};
		addEventListener('error', report);
		addEventListener('unhandledrejection', report);
		const slow = setTimeout(() => phase === 'loading' && !failed && (failed = 'Still waiting for the API (/api/me, /api/media, /api/timelines) after 10 s.'), 10000);
		load().catch((e) => (failed = (e as Error).stack ?? String(e)));
		return () => (removeEventListener('error', report), removeEventListener('unhandledrejection', report), clearTimeout(slow));
	});
	async function load() {
		try {
			const founder = await me();
			if (!may(founder, 'media:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			[library, timelines] = await Promise.all([listMedia().then((r) => r.media), listTimelines()]);
		} catch (e) {
			error = (e as Error).message;
		}
		phase = 'ready';
		let last: string | null = null;
		try {
			last = localStorage.getItem(LAST);
			const kept = JSON.parse(localStorage.getItem(OPEN) ?? '[]');
			expanded = Array.isArray(kept) ? kept.filter((p) => typeof p === 'string') : [];
		} catch {
			/* no storage: open the newest */
		}
		const open = timelines.find((t) => t.id === last) ?? timelines[0];
		if (open) await openTimeline(open);
		else await newTimeline();
	}

	async function openTimeline(t: Timeline) {
		stop();
		await flush();
		current = t;
		expand(t.project ?? '', true);
		clips = t.clips.filter((c) => byCid.has(c.cid)) as Clip[];
		selected = null;
		time = 0;
		saving = 'saved';
		try {
			localStorage.setItem(LAST, t.id);
		} catch {
			/* fine */
		}
		for (const c of clips) void source(c.cid).catch((e) => (error = (e as Error).message));
	}

	async function newTimeline() {
		const made = await starter();
		const t = await createTimeline({ name: `Timeline ${timelines.length + 1}`, aspect: '16:9', tags: [], clips: made });
		timelines = [t, ...timelines];
		await openTimeline(t);
	}

	// ── exporting: a job for the render worker (bun film worker); the studio shows how it goes ──
	const running = (r: RenderJob) => r.status === 'queued' || r.status === 'rendering';
	const newest = $derived([...renders].sort((a, b) => Date.parse(b.created) - Date.parse(a.created)));
	const active = $derived(newest.find(running) ?? null);
	// the job the panel is about: the one under way, else the last one; the rest are the short history under it
	const focus = $derived(active ?? newest[0] ?? null);
	const earlier = $derived(newest.filter((r) => r.id !== focus?.id).slice(0, 5));
	let queuing = $state(false); // Render pressed: saving, then asking for the job
	let now = $state(Date.now());
	let skew = 0; // the server's clock minus ours, measured when a job is queued, so "elapsed" starts at 0:00
	// how fast the film itself renders, seen from here: the first rendering progress and the latest, with when each came
	let pace = $state<Record<string, { t0: number; p0: number; t: number; p: number }>>({});

	async function refreshRenders() {
		if (!current) return;
		const id = current.id;
		const before = renders;
		const next = await listRenders(id).catch(() => null);
		if (!next || current?.id !== id) return; // another timeline opened while this was on its way
		renders = next;
		const t = Date.now();
		for (const r of next) {
			if (r.status !== 'rendering' || r.note !== 'rendering') continue;
			const seen = pace[r.id];
			if (!seen) pace[r.id] = { t0: t, p0: r.progress, t, p: r.progress };
			else if (r.progress !== seen.p) pace[r.id] = { ...seen, t, p: r.progress };
		}
		// a job just finished: the film is in the library now (show it there), and the panel says how it went
		const ended = next.filter((r) => !running(r) && before.some((b) => b.id === r.id && running(b)));
		if (ended.length) {
			showRenders = true;
			if (ended.some((r) => r.status === 'done')) library = await listMedia().then((r) => r.media).catch(() => library);
		}
		poll(next.some(running));
	}
	function poll(on: boolean) {
		if (on && !renderPoll) renderPoll = setInterval(refreshRenders, 3000);
		else if (!on && renderPoll) clearInterval(renderPoll), (renderPoll = null);
	}
	async function exportTimeline() {
		if (!current || queuing) return;
		queuing = true;
		showRenders = true;
		try {
			await flush(); // render what is on screen, saved
			const job = await queueRender(current.id);
			skew = Date.parse(job.created) - Date.now();
			renders = [job, ...renders.filter((r) => r.id !== job.id)];
			poll(true);
		} catch (e) {
			error = `Render: ${(e as Error).message}`;
		} finally {
			queuing = false;
		}
	}
	// a timeline opens: its renders, fetched fresh. Only the timeline's id is watched — refreshRenders reads and
	// writes the list, and tracking that here looped the page to a standstill
	$effect(() => {
		void current?.id;
		untrack(() => {
			renders = [];
			void refreshRenders();
		});
	});
	// the clock in the panel ticks while something is under way
	$effect(() => {
		if (!active && !queuing) return;
		now = Date.now();
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	const mmss = (s: number) => {
		s = Math.max(0, Math.round(s));
		const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
		return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(r).padStart(2, '0')}`;
	};
	/** What the worker is doing, in plain words. */
	function stage(r: RenderJob) {
		if (r.status === 'queued') return 'Waiting for the render worker';
		if (r.status === 'done') return 'Rendered';
		if (r.status === 'failed') return 'The render failed';
		const said: Record<string, string> = {
			'fetching files': 'Fetching the files',
			'setting the captions': 'Setting the captions',
			rendering: 'Rendering the film',
			'into the library': 'Into the library'
		};
		return said[r.note ?? ''] ?? r.note ?? 'Starting';
	}
	const elapsed = (r: RenderJob) => (now + skew - Date.parse(r.created)) / 1000;
	const took = (r: RenderJob) => (Date.parse(r.updated) - Date.parse(r.created)) / 1000;
	/** Seconds left, from how fast the progress has moved since the film began rendering; null until it has moved. */
	function left(r: RenderJob) {
		const s = pace[r.id];
		if (!s || s.t <= s.t0 || s.p <= s.p0) return null;
		const rate = (s.p - s.p0) / (s.t - s.t0);
		return Math.max(0, (0.95 - s.p) / rate - (now - s.t) / 1000 + 2); // + the moment it takes to go into the library
	}
	const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	/** The rendered film, in the source monitor (the library is fetched again if it is not in it yet). */
	async function openRender(r: RenderJob) {
		if (!r.output_cid) return;
		let m = byCid.get(r.output_cid);
		if (!m) {
			library = await listMedia().then((x) => x.media).catch(() => library);
			m = library.find((x) => x.cid === r.output_cid);
		}
		if (m) pick(m);
		else window.open(raw(r.output_cid), '_blank', 'noopener');
	}

	async function removeTimeline(t: Timeline) {
		if (!confirm(`Delete the timeline “${t.name}”? The files stay in the library.`)) return;
		await deleteTimeline(t.id);
		timelines = timelines.filter((x) => x.id !== t.id);
		if (current?.id === t.id) {
			current = null;
			if (timelines[0]) await openTimeline(timelines[0]);
			else await newTimeline();
		}
	}

	// every change is saved, a moment after the last one
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function changed() {
		saving = 'unsaved';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void flush(), 700);
	}
	async function flush() {
		if (saveTimer) clearTimeout(saveTimer), (saveTimer = null);
		if (!current || saving !== 'unsaved') return;
		saving = 'saving';
		try {
			const t = await saveTimeline(current.id, { name: current.name, project: current.project, variant: current.variant, description: current.description, aspect: current.aspect, tags: current.tags, clips });
			timelines = [t, ...timelines.filter((x) => x.id !== t.id)];
			current = { ...current, updated: t.updated };
			saving = 'saved';
		} catch (e) {
			error = (e as Error).message;
			saving = 'unsaved';
		}
	}
	const setMeta = (patch: Partial<Timeline>) => {
		if (!current) return;
		current = { ...current, ...patch };
		changed();
	};

	/** A first edit to start from: a still, the newest voice take on it, a music bed under it. */
	async function starter(): Promise<Clip[]> {
		const voices = library.filter((m) => m.kind === 'audio' && m.tags.includes('role:voice'));
		const voice = voices.find((m) => Array.isArray(m.meta?.words) && (m.meta.words as unknown[]).length) ?? voices[0];
		const bed = library.find((m) => m.kind === 'audio' && (m.tags.includes('role:music') || m.tags.includes('role:score')));
		const still = library.find((m) => m.kind === 'image' && m.tags.includes('role:cover')) ?? library.find((m) => m.kind === 'image');
		const vlen = voice ? (await source(voice.cid)).duration : 6;
		const next: Clip[] = [];
		if (still) next.push(clip(still.cid, 'V1', 0, 0, vlen + 2));
		if (voice) next.push(clip(voice.cid, 'A1', 0.5, 0, vlen));
		if (bed) next.push({ ...clip(bed.cid, 'A2', 0, 0, vlen + 2.5), vol: 0.3 });
		return next;
	}

	const clip = (cid: string, track: Track, start: number, from: number, dur: number): Clip => ({
		id: Math.random().toString(36).slice(2, 10),
		cid,
		track,
		start,
		in: from,
		dur,
		vol: 1
	});

	// ── sound: one Web Audio clock; every clip is scheduled on it, sample-exact ──
	// (Safari lets a page make sound only from a click: the context is woken by the Play button)
	/** How far the music steps back under the voice: about −6 dB. */
	const DUCK = 0.5;
	let ctx: AudioContext | null = null;
	const audioCtx = () => (ctx ??= new AudioContext());
	let playing_nodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
	let ctxStart = 0, timeStart = 0;

	const pending = new Map<string, Promise<Source>>();
	/** Fetch a file once: sound is decoded (for playing and for its waveform); a still is only shown. */
	// the true length of each video, found one at a time (and the player let go of after, so it frees its slot)
	const probing: string[] = [];
	let prober: Promise<void> | null = null;
	function probeLength(cid: string) {
		probing.push(cid);
		prober ??= (async () => {
			for (let next; (next = probing.shift()); ) {
				const duration = await new Promise<number>((ok) => {
					const v = document.createElement('video');
					v.preload = 'metadata';
					v.crossOrigin = 'use-credentials';
					const done = (d: number) => (clearTimeout(late), v.removeAttribute('src'), v.load(), ok(d));
					const late = setTimeout(() => done(0), 8000);
					v.onloadedmetadata = () => done(v.duration || 0);
					v.onerror = () => done(0);
					v.src = raw(next!);
				});
				if (duration && sources[next]) sources[next] = { ...sources[next]!, duration };
			}
			prober = null;
		})();
	}

	function source(cid: string): Promise<Source> {
		if (sources[cid]) return Promise.resolve(sources[cid]!);
		if (pending.has(cid)) return pending.get(cid)!;
		const m0 = byCid.get(cid);
		if (m0?.kind === 'video') {
			// a video streams straight from the library (it answers byte ranges): no need to download it first. It is
			// ready at once — the monitor's own players load it when it comes up — and its length is looked up
			// behind, one video at a time: Safari loads only a few videos at once, and a timeline of 42 shots asking
			// for all of them together left some never answering (black shots, a playhead that would not start)
			const s = (sources[cid] = { url: raw(cid), duration: Number(m0.meta?.duration_s) || 3600, peaks: [] });
			probeLength(cid);
			return Promise.resolve(s);
		}
		if (m0?.kind === 'image') {
			const s = { url: thumb(m0), duration: IMAGE_LEN, peaks: [] };
			sources[cid] = s;
			return Promise.resolve(s);
		}
		const p = (async () => {
			const m = byCid.get(cid);
			const res = await fetch(raw(cid), { credentials: 'include' });
			if (!res.ok) throw new Error(`Could not load ${name(m)} (${res.status}).`);
			const bytes = await res.arrayBuffer();
			const url = URL.createObjectURL(new Blob([bytes], { type: m?.mime }));
			let duration = IMAGE_LEN, peaks: number[] = [], buffer: AudioBuffer | undefined;
			if (m?.kind === 'audio') {
				buffer = await audioCtx().decodeAudioData(bytes.slice(0));
				duration = buffer.duration;
				const data = buffer.getChannelData(0), n = Math.min(8000, Math.ceil(buffer.duration * 100)), step = Math.floor(data.length / n);
				peaks = Array.from({ length: n }, (_, i) => {
					let max = 0;
					for (let j = i * step; j < (i + 1) * step; j++) max = Math.max(max, Math.abs(data[j] ?? 0));
					return max;
				});
			} else if (m?.kind === 'video') {
				duration = await new Promise<number>((ok) => {
					const v = document.createElement('video');
					v.preload = 'metadata';
					v.onloadedmetadata = () => ok(v.duration || IMAGE_LEN);
					v.onerror = () => ok(IMAGE_LEN);
					v.src = url;
				});
			}
			const s = { url, duration, peaks, buffer };
			sources[cid] = s;
			return s;
		})();
		pending.set(cid, p);
		return p;
	}

	function silence() {
		for (const { src } of playing_nodes) {
			try {
				src.stop();
			} catch {
				/* already ended */
			}
		}
		playing_nodes = [];
	}

	/** Lay every sound clip on the clock from the playhead on: each starts, trims and fades exactly where it should. */
	function schedule() {
		silence();
		const ac = audioCtx();
		ctxStart = ac.currentTime + 0.05;
		timeStart = time;
		for (const c of clips) {
			const buf = sources[c.cid]?.buffer;
			if (!buf || c.start + c.dur <= time) continue;
			const from = Math.max(time, c.start); // timeline time the sound begins
			const offset = c.in + (from - c.start); // how far into the file
			const length = c.start + c.dur - from;
			if (length <= 0.01 || offset >= buf.duration) continue;
			const when = ctxStart + (from - time);
			const src = ac.createBufferSource();
			src.buffer = buf;
			const gain = ac.createGain();
			// the clip's own fades (a bed crossfades over a second or so), else a short one, so a cut never clicks
			const fadeIn = from === c.start ? Math.max(0.01, c.fin ?? 0.06) : 0.02, fadeOut = Math.min(c.fout ?? 0.3, length / 2);
			gain.gain.setValueAtTime(0, when);
			gain.gain.linearRampToValueAtTime(c.vol, when + fadeIn);
			// the music steps back while the voice speaks, and comes up again in the pauses (the render does the same)
			if (c.track === 'A2')
				for (const v of clips.filter((v) => v.track === 'A1' && v.start + v.dur > from && v.start < c.start + c.dur)) {
					const a = ctxStart + (Math.max(from, v.start) - time), b = ctxStart + (v.start + v.dur - time);
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
			playing_nodes.push({ src, gain });
		}
	}

	onDestroy(() => {
		if (typeof window === 'undefined') return; // also runs while the page is prerendered
		cancelAnimationFrame(frame);
		poll(false);
		silence();
		void flush();
		void ctx?.close();
		for (const s of Object.values(sources)) if (s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
	});

	// ── playback ────────────────────────────────────────────────────────────
	function syncVideo(force = false) {
		for (const c of reel) {
			const v = reelVideos[c.id];
			if (!v) continue;
			if (c.id !== picture?.id) {
				// waiting in the wings: paused on its first frame
				if (!v.paused) v.pause();
				if (Math.abs(v.currentTime - c.in) > 0.04) v.currentTime = c.in;
				continue;
			}
			const local = c.in + (time - c.start);
			v.volume = c.vol;
			if (force || Math.abs(v.currentTime - local) > 0.25) v.currentTime = local;
			if (playing && v.paused) void v.play();
			if (!playing && !v.paused) v.pause();
		}
	}

	function tick() {
		if (!ctx) return;
		time = timeStart + Math.max(0, ctx.currentTime - ctxStart);
		if (time >= end) {
			time = end;
			return stop();
		}
		syncVideo();
		frame = requestAnimationFrame(tick);
	}

	async function play() {
		srcEl?.pause(); // the timeline plays alone: the source monitor waits
		if (!clips.length) return;
		if (time >= end - 0.02) time = 0;
		await audioCtx().resume();
		await Promise.all(clips.map((c) => source(c.cid).catch(() => null)));
		playing = true;
		schedule();
		syncVideo(true);
		frame = requestAnimationFrame(tick);
	}

	function stop() {
		playing = false;
		cancelAnimationFrame(frame);
		silence();
		syncVideo();
	}

	const toggle = () => (playing ? stop() : void play());

	function seek(t: number) {
		time = Math.min(Math.max(0, t), span);
		if (playing) schedule();
		syncVideo(true);
	}

	// ── by hand: move, trim, seek, drop ────────────────────────────────────
	const snap = (t: number) => Math.round(t * 20) / 20;

	function grab(e: PointerEvent, c: Clip, mode: 'move' | 'left' | 'right') {
		e.stopPropagation();
		e.preventDefault();
		selected = c.id;
		const x0 = e.clientX, s0 = c.start, i0 = c.in, d0 = c.dur;
		const isImage = byCid.get(c.cid)?.kind === 'image';
		const max = isImage ? Infinity : (sources[c.cid]?.duration ?? d0 + i0);
		let moved = false;
		const move = (ev: PointerEvent) => {
			const dt = (ev.clientX - x0) / pxPerSec;
			if (Math.abs(ev.clientX - x0) > 1) moved = true;
			const i = clips.findIndex((k) => k.id === c.id);
			if (i < 0) return;
			const k = { ...clips[i]! };
			if (mode === 'move') k.start = Math.max(0, snap(s0 + dt));
			if (mode === 'left') {
				// trimming the head: the clip starts later and plays from further in
				const d = Math.min(Math.max(snap(dt), -Math.min(s0, isImage ? s0 : i0)), d0 - 0.2);
				k.start = s0 + d;
				k.in = isImage ? 0 : i0 + d;
				k.dur = d0 - d;
			}
			if (mode === 'right') k.dur = Math.min(Math.max(0.2, snap(d0 + dt)), max - i0);
			clips[i] = k;
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (moved) {
				changed();
				if (playing) schedule();
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function scrub(e: PointerEvent) {
		if (!lanes) return;
		selected = null;
		const put = (ev: PointerEvent) => seek((ev.clientX - lanes!.getBoundingClientRect().left) / pxPerSec);
		put(e);
		const up = () => (window.removeEventListener('pointermove', put), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', put);
		window.addEventListener('pointerup', up);
	}

	/** Lays a file on a track at `start`: the whole of it, or only `range` of it (a sound or a film marked in the source monitor). */
	async function place(cid: string, track: Track, start: number, range?: { in: number; dur: number }) {
		const m = byCid.get(cid);
		const accepts = TRACKS.find((t) => t.id === track)?.accepts ?? [];
		if (!m || !accepts.includes(m.kind)) return void (error = `${name(m)} does not go on the ${track} track.`);
		error = '';
		try {
			const s = await source(cid);
			const whole = m.kind === 'image' ? IMAGE_LEN : s.duration;
			const from = m.kind === 'image' || !range ? 0 : Math.min(Math.max(0, range.in), Math.max(0, whole - 0.2));
			const dur = m.kind === 'image' || !range ? whole : Math.min(Math.max(0.2, range.dur), whole - from);
			const c = clip(cid, track, Math.max(0, snap(start)), from, dur);
			if (track === 'A2') c.vol = 0.3;
			if (track === 'A3') c.vol = 0.2;
			clips = [...clips, c];
			selected = c.id;
			changed();
			if (playing) schedule();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function drop(e: DragEvent, track: Track) {
		e.preventDefault();
		const cid = e.dataTransfer?.getData('text/x-cid');
		if (!cid || !lanes) return;
		// from the source monitor a drag carries the marked range too
		let range: { in: number; dur: number } | undefined;
		try {
			const r = JSON.parse(e.dataTransfer?.getData('text/x-range') || 'null');
			if (r && typeof r.in === 'number' && typeof r.dur === 'number') range = r;
		} catch {
			/* no range: the whole file */
		}
		void place(cid, track, (e.clientX - lanes.getBoundingClientRect().left) / pxPerSec, range);
	}

	const defaultTrack = (m: MediaItem): Track =>
		m.kind === 'audio'
			? ['role:music', 'role:score', 'role:cue'].some((t) => m.tags.includes(t))
				? 'A2'
				: ['role:sfx', 'role:ambience'].some((t) => m.tags.includes(t))
					? 'A3'
					: 'A1'
			: 'V1';
	const tint = (t: Track) => (t === 'A1' ? '#a8741a' : t === 'A3' ? '#4a5f93' : '#2f7d6a');

	// ── the source monitor: one file from the library, on its own, beside the program ──
	// A click in the library shows it here; it plays apart from the timeline (never both at once),
	// I and O mark the part to use, and "Add to timeline" (or a drag onto a track) lays that part down.
	let preview = $state<string | null>(null);
	let srcEl = $state<HTMLMediaElement | null>(null);
	let srcUrl = $state('');
	let srcTime = $state(0);
	let srcDuration = $state(0);
	let srcAspect = $state(16 / 9);
	let markIn = $state<number | null>(null);
	let markOut = $state<number | null>(null);
	let srcFocus = $state(false); // the source is the thing in hand: I and O mark it
	const previewItem = $derived(preview ? byCid.get(preview) : undefined);
	const srcAv = $derived(previewItem?.kind === 'audio' || previewItem?.kind === 'video');
	const srcLen = $derived(
		Number.isFinite(srcDuration) && srcDuration > 0
			? srcDuration
			: preview && srcAv
				? (sources[preview]?.duration ?? (Number(previewItem?.meta?.duration_s) || 0))
				: 0
	);
	const marked = $derived(srcAv && (markIn !== null || markOut !== null));
	const srcRange = $derived.by(() => {
		if (!marked || !srcLen) return undefined;
		const from = Math.min(markIn ?? 0, srcLen), to = Math.min(markOut ?? srcLen, srcLen);
		return to - from >= 0.05 ? { in: from, dur: to - from } : undefined;
	});
	const pct = (t: number) => `${srcLen ? (Math.min(Math.max(t, 0), srcLen) / srcLen) * 100 : 0}%`;

	function pick(m: MediaItem) {
		srcFocus = true;
		if (preview === m.cid) return;
		srcEl?.pause();
		preview = m.cid;
		srcUrl = m.kind === 'image' ? thumb(m) : (sources[m.cid]?.url ?? raw(m.cid));
		srcTime = 0;
		srcDuration = 0;
		srcAspect = 16 / 9;
		markIn = markOut = null;
		if (m.kind === 'audio') void source(m.cid).catch((e) => (error = (e as Error).message)); // for its waveform
	}

	function closeSource() {
		srcEl?.pause();
		preview = null;
		srcFocus = false;
	}

	/** The source starts to sound: the timeline stops. */
	function srcPlays() {
		if (playing) stop();
	}

	function mark(which: 'in' | 'out') {
		if (!srcAv) return;
		const t = srcEl?.currentTime ?? srcTime;
		if (which === 'in') {
			markIn = t;
			if (markOut !== null && markOut <= t) markOut = null;
		} else {
			markOut = t;
			if (markIn !== null && markIn >= t) markIn = null;
		}
	}

	function addSource() {
		if (previewItem) void place(previewItem.cid, defaultTrack(previewItem), time, srcRange);
	}

	function dragSource(e: DragEvent) {
		if (!previewItem || !e.dataTransfer) return;
		e.dataTransfer.setData('text/x-cid', previewItem.cid);
		if (srcRange) e.dataTransfer.setData('text/x-range', JSON.stringify(srcRange));
	}

	/** Click or drag along the source's waveform (or scrub bar) to move through it. */
	function scrubSource(e: PointerEvent) {
		const bar = e.currentTarget as HTMLElement;
		if (!srcEl || !srcLen) return;
		e.preventDefault();
		const put = (ev: PointerEvent) => {
			const r = bar.getBoundingClientRect();
			const t = (Math.min(Math.max(ev.clientX - r.left, 0), r.width) / (r.width || 1)) * srcLen;
			if (srcEl) srcEl.currentTime = t;
			srcTime = t;
		};
		put(e);
		const up = () => (window.removeEventListener('pointermove', put), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', put);
		window.addEventListener('pointerup', up);
	}

	// whatever was last touched decides where I and O go: the source monitor (or the library that fills it), or not
	$effect(() => {
		const inHand = (e: Event) => (srcFocus = !!(e.target as Element | null)?.closest?.('.source, .items'));
		window.addEventListener('pointerdown', inHand, true);
		window.addEventListener('focusin', inHand, true);
		return () => {
			window.removeEventListener('pointerdown', inHand, true);
			window.removeEventListener('focusin', inHand, true);
		};
	});

	function remove(id: string | null) {
		if (!id) return;
		clips = clips.filter((c) => c.id !== id);
		selected = null;
		changed();
		if (playing) schedule();
	}

	function setClip(patch: Partial<Clip>) {
		const i = clips.findIndex((c) => c.id === selected);
		if (i >= 0) clips[i] = { ...clips[i]!, ...patch };
		changed();
		if (playing) schedule();
	}

	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, select')) return;
		// the source monitor in hand: I marks in, O marks out
		if (srcFocus && srcAv && !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyI' || e.code === 'KeyO')) {
			e.preventDefault();
			return mark(e.code === 'KeyI' ? 'in' : 'out');
		}
		// inside the source player's own controls its keys are its own (Space plays it, arrows step through it)
		if (target?.closest?.('.source audio, .source video')) return;
		if (e.code === 'Space') (e.preventDefault(), toggle());
		else if (e.code === 'Home') seek(0);
		else if (e.code === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : 0.1));
		else if (e.code === 'ArrowRight') seek(time + (e.shiftKey ? 1 : 0.1));
		else if ((e.code === 'Delete' || e.code === 'Backspace') && selected) (e.preventDefault(), remove(selected));
	}

	/** The picture alone, full screen, playing on from the playhead (Esc leaves it; the bar at the foot moves it). */
	async function playFullscreen() {
		await screen?.requestFullscreen().catch(() => {});
		if (!playing) await play();
	}

	async function fullscreen() {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await studio?.requestFullscreen().catch(() => {});
	}

	/** Draws the part of a sound's waveform that the clip plays. */
	function wave(canvas: HTMLCanvasElement, args: { peaks: number[]; from: number; to: number; total: number; color: string }) {
		const draw = ({ peaks, from, to, total, color }: typeof args) => {
			const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
			canvas.width = Math.max(1, w * dpr);
			canvas.height = Math.max(1, h * dpr);
			const g = canvas.getContext('2d')!;
			g.scale(dpr, dpr);
			if (!peaks.length || !total) return;
			let top = 0;
			for (const p of peaks) top = Math.max(top, p);
			g.fillStyle = color;
			for (let px = 0; px < w; px++) {
				const t = from + ((to - from) * px) / w;
				const p = (peaks[Math.floor((t / total) * peaks.length)] ?? 0) / (top || 1);
				const bar = Math.max(0.5, p * (h / 2 - 2));
				g.fillRect(px, h / 2 - bar, 1, bar * 2);
			}
		};
		draw(args);
		return { update: draw };
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>Studio · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if phase !== 'ready'}
	<main class="wrap gate">
		<h1>Studio</h1>
		{#if phase === 'loading'}
			<p>One moment…</p>
			{#if failed}<pre class="failed">{failed}</pre>{/if}
		{:else if phase === 'signed-out'}
			<p>The studio belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
		{:else}
			<p>The studio belongs to the admin, and your account is not one.</p>
		{/if}
	</main>
{:else}
	<section class="studio" bind:this={studio} aria-label="Studio">
		<header class="bar">
			<a class="back" href="{base}/app/">← Dashboard</a>
			<strong>Studio</strong>
			{#if current}
				<input class="tproj" value={current.project ?? ''} placeholder="project" onchange={(e) => setMeta({ project: e.currentTarget.value.trim() || null })} aria-label="Project" />
				<input class="tvar" value={current.variant ?? ''} placeholder="–" onchange={(e) => setMeta({ variant: e.currentTarget.value.trim() || null })} aria-label="Variant" />
				<input class="tname" value={current.name} onchange={(e) => setMeta({ name: e.currentTarget.value.trim() || current!.name })} aria-label="Timeline name" />
				<input class="tdesc" value={current.description ?? ''} placeholder="what this variant is" onchange={(e) => setMeta({ description: e.currentTarget.value.trim() || null })} aria-label="Variant description" />
				<input class="ttags" value={current.tags.join(', ')} placeholder="tags" onchange={(e) => setMeta({ tags: e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean) })} aria-label="Timeline tags" />
				<select value={current.aspect} onchange={(e) => setMeta({ aspect: e.currentTarget.value })} aria-label="Frame">
					{#each ASPECTS as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			{/if}
			<span class="sub">{clips.length} clips · {clockText(end)} · {saving === 'saved' ? 'saved' : saving === 'saving' ? 'saving…' : 'unsaved'}</span>
			{#if error}<span class="err">{error}</span>{/if}
			<span class="grow"></span>
			<span class="renders">
				<!-- while a job is under way the button shows how far it is, and opens the panel instead of queueing another -->
				<button
					class="render"
					class:busy={!!active || queuing}
					style:--p="{Math.round((active?.progress ?? 0) * 100)}%"
					onclick={() => (active || queuing ? (showRenders = !showRenders) : exportTimeline())}
					disabled={!current}
				>
					{queuing ? 'Queueing…' : active ? (active.status === 'queued' ? 'Waiting…' : `Rendering ${Math.round(active.progress * 100)}%`) : '⤓ Render'}
				</button>
				{#if renders.length && !active && !queuing}
					<button class="ghost count" onclick={() => (showRenders = !showRenders)} aria-label="Renders" aria-expanded={showRenders}>{renders.length}</button>
				{/if}
				{#if showRenders && (focus || queuing)}
					<div class="render-panel" role="status" aria-live="polite">
						{#if queuing && !active}
							<div class="rp-head"><b>Saving the edit, queueing the render…</b></div>
							<div class="rp-bar waiting"><i></i></div>
						{:else if focus}
							{@const r = focus}
							{@const eta = r.status === 'rendering' ? left(r) : null}
							<div class="rp-head">
								<b class="st {r.status}">{stage(r)}</b>
								{#if running(r)}<span class="rp-pct">{Math.round(r.progress * 100)}%</span>{/if}
								<button class="rp-x" onclick={() => (showRenders = false)} aria-label="Close">×</button>
							</div>
							{#if running(r)}
								<div class="rp-bar" class:waiting={r.status === 'queued'}><i style:width="{r.progress * 100}%"></i></div>
								<p class="rp-meta">
									{mmss(elapsed(r))} elapsed
									{#if r.note === 'rendering'}· {eta === null ? 'estimating the time left…' : `about ${mmss(eta)} left`}{/if}
								</p>
								{#if r.status === 'queued' && elapsed(r) > 10}
									<p class="rp-hint">No render worker running — start it with <code>bun film worker --local</code></p>
								{/if}
							{:else if r.status === 'done'}
								<p class="rp-meta">{when(r.created)} · took {mmss(took(r))}</p>
								{#if r.output_cid}
									<div class="rp-acts">
										<button class="ghost" onclick={() => openRender(r)}>▶ Play in the source monitor</button>
										<a class="ghost" href={raw(r.output_cid)} target="_blank" rel="noopener">File ↗</a>
									</div>
								{/if}
							{:else}
								<p class="rp-meta">{when(r.created)} · after {mmss(took(r))}</p>
								<pre class="rp-why">{r.note || 'No reason given.'}</pre>
								<div class="rp-acts"><button class="ghost" onclick={exportTimeline}>↻ Render again</button></div>
							{/if}
						{/if}
						{#if earlier.length}
							<h4>Earlier</h4>
							<ul class="rp-list">
								{#each earlier as r (r.id)}
									<li>
										<span class="st {r.status}">{r.status}</span>
										<span class="d">{when(r.created)}</span>
										{#if r.status === 'done' && r.output_cid}
											<button class="link" onclick={() => openRender(r)}>play</button>
											<a href={raw(r.output_cid)} target="_blank" rel="noopener">file</a>
										{:else if r.status === 'failed'}
											<span class="why" title={r.note ?? ''}>{r.note}</span>
										{:else}
											<span class="d">{Math.round(r.progress * 100)}%</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</span>
			<button class="ghost" onclick={fullscreen}>⛶ Full screen</button>
		</header>

		<!-- the library -->
		<aside class="bin">
			<div class="tl-head"><h3>Timelines</h3></div>
			<div class="tls">
				{#each groups as [project, list] (project)}
					<button class="proj" class:here={(current?.project ?? '') === project} aria-expanded={shows(project)} onclick={() => expand(project)}>
						<span class="caret">{shows(project) ? '▾' : '▸'}</span>{project || 'Other'} <span>{list.length}</span>
					</button>
					{#if shows(project)}
						<ul>
							{#each list as t (t.id)}
								<li class:on={current?.id === t.id}>
									<button class="tl" onclick={() => openTimeline(t)}>
										<span class="nm">{#if t.variant}<b class="var">{t.variant}</b>{/if}{t.name}</span>
										<span class="tg">{t.description ?? `${t.aspect} · ${t.clips.length} clips`}</span>
									</button>
									<button class="x" onclick={() => removeTimeline(t)} aria-label="Delete timeline">×</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/each}
			</div>
			<h3>Library</h3>
			<div class="kinds">
				{#each [['all', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Sound']] as [k, label] (k)}
					<button class:on={kind === k} onclick={() => (kind = k as typeof kind)}>{label}</button>
				{/each}
			</div>
			<input type="search" bind:value={q} placeholder="Find by name, words or CID" aria-label="Find" />
			<div class="tagrow">
				{#each allTags as t (t)}
					<button class="tag" class:on={tag === t} onclick={() => (tag = tag === t ? null : t)}>{t}</button>
				{/each}
			</div>
			<ul class="items">
				{#each shown as m (m.cid)}
					<li>
						<button
							class="item"
							class:on={preview === m.cid}
							draggable="true"
							ondragstart={(e) => e.dataTransfer?.setData('text/x-cid', m.cid)}
							onclick={() => pick(m)}
							ondblclick={() => place(m.cid, defaultTrack(m), time)}
							title="Click to see it in the source monitor, drag onto a track, or double-click to drop it at the playhead"
						>
							<span class="thumb">
								{#if m.kind === 'image'}<img src={thumb(m)} alt="" loading="lazy" draggable="false" />{:else}<i>{m.kind === 'audio' ? '♪' : '▶'}</i>{/if}
							</span>
							<span class="meta">
								<span class="nm">{String(m.meta?.title ?? name(m))}</span>
								<span class="tg">{m.tags.filter((t) => rank(t) < 3).slice(0, 2).join(' · ') || m.kind}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<div class="monitors" class:split={!!previewItem}>
			<!-- the source monitor: the file clicked in the library, on its own -->
			{#if previewItem}
				{@const m = previewItem}
				<section class="source" aria-label="Source">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="shead" draggable="true" ondragstart={dragSource} title="Drag onto a track">
						<h2 class="mlabel">Source</h2>
						<span class="sname">{String(m.meta?.title ?? name(m))}</span>
						<button class="x" onclick={closeSource} aria-label="Close the source monitor">×</button>
					</div>
					<div class="sstage" style:--ar={srcAspect}>
						{#key preview}
							{#if m.kind === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									class="sframe"
									bind:this={srcEl}
									bind:currentTime={srcTime}
									bind:duration={srcDuration}
									src={srcUrl}
									crossorigin="use-credentials"
									preload="metadata"
									controls
									playsinline
									onloadedmetadata={(e) => {
										const v = e.currentTarget;
										if (v.videoWidth && v.videoHeight) srcAspect = v.videoWidth / v.videoHeight;
									}}
									onplay={srcPlays}
								></video>
							{:else if m.kind === 'audio'}
								{@const s = sources[m.cid]}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="swave" onpointerdown={scrubSource}>
									{#if s?.peaks.length}
										<canvas use:wave={{ peaks: s.peaks, from: 0, to: s.duration, total: s.duration, color: tint(defaultTrack(m)) }}></canvas>
									{:else}
										<span class="hint">Reading the sound…</span>
									{/if}
									{#if marked}<i class="band" style:left={pct(markIn ?? 0)} style:right="calc(100% - {pct(markOut ?? srcLen)})"></i>{/if}
									<i class="sph" style:left={pct(srcTime)}></i>
								</div>
							{:else}
								<img
									class="sframe"
									src={srcUrl}
									alt=""
									draggable="false"
									onload={(e) => {
										const i = e.currentTarget as HTMLImageElement;
										if (i.naturalWidth && i.naturalHeight) srcAspect = i.naturalWidth / i.naturalHeight;
									}}
								/>
							{/if}
						{/key}
					</div>
					{#if m.kind === 'audio'}
						{#key preview}
							<audio
								bind:this={srcEl}
								bind:currentTime={srcTime}
								bind:duration={srcDuration}
								src={srcUrl}
								crossorigin="use-credentials"
								preload="metadata"
								controls
								onplay={srcPlays}
							></audio>
						{/key}
					{:else if m.kind === 'video'}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="sbar" onpointerdown={scrubSource}>
							{#if marked}<i class="band" style:left={pct(markIn ?? 0)} style:right="calc(100% - {pct(markOut ?? srcLen)})"></i>{/if}
							<i class="sph" style:left={pct(srcTime)}></i>
						</div>
					{/if}
					<div class="sacts">
						{#if srcAv}
							<button class="ghost small" onclick={() => mark('in')} title="Mark in (I)">Mark in</button>
							<button class="ghost small" onclick={() => mark('out')} title="Mark out (O)">Mark out</button>
							<span class="range">
								{#if srcRange}{clockText(srcRange.in)} → {clockText(srcRange.in + srcRange.dur)} · {clockText(srcRange.dur)}{:else}whole file{/if}
							</span>
							{#if marked}<button class="ghost small" onclick={() => (markIn = markOut = null)}>Clear</button>{/if}
						{/if}
						<span class="grow"></span>
						<button class="add" draggable="true" ondragstart={dragSource} onclick={addSource} title="Add at the playhead ({defaultTrack(m)}), or drag onto a track">
							+ Add to timeline
						</button>
					</div>
					<div class="sinfo">
						<p class="skind">{m.kind}{#if srcAv && srcLen} · {clockText(srcLen)}{/if}{#if m.tags.length} · <span>{m.tags.join(', ')}</span>{/if}</p>
						{#if m.meta?.text}<p class="line">{String(m.meta.text)}</p>{/if}
					</div>
				</section>
			{/if}

			<!-- the program monitor: the timeline, as it plays -->
			<div class="monitor" bind:this={screen}>
				<h2 class="mlabel">Program</h2>
				<div class="frame" class:tall={aspect === '9:16'} style:--ar={aspect.replace(':', ' / ')}>
					{#each reel as c (c.id)}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video class="reel" class:on={pictureItem?.kind === 'video' && picture?.id === c.id} bind:this={reelVideos[c.id]} src={sources[c.cid]!.url} crossorigin="use-credentials" preload="auto" playsinline muted onloadeddata={() => syncVideo()}></video>
					{/each}
					{#if pictureItem?.kind === 'image'}
						<img class="still" src={thumb(stillItem ?? pictureItem)} alt="" />
					{/if}
					<div class="grade"></div>
					{#if caption.length}
						<p class="caption">
							{#each caption as w, i (i)}<span class:lit={w.t <= time}>{w.word}</span>{' '}{/each}
						</p>
					{/if}
					<span class="tc">{clockText(time)}</span>
				</div>
				<!-- full screen: play and pause, and the playhead to move by hand -->
				<div class="fsbar">
					<button class="fsplay" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
					<input class="scrub" type="range" min="0" max={end} step="0.01" value={time} oninput={(e) => seek(Number(e.currentTarget.value))} aria-label="Playhead" />
					<span class="fstc">{clockText(time)} / {clockText(end)}</span>
				</div>
			</div>
		</div>

		<!-- the inspector -->
		<aside class="inspector">
			<h2>Inspector</h2>
			{#if sel}
				{@const m = byCid.get(sel.cid)}
				<p class="iname">{String(m?.meta?.title ?? name(m))}</p>
				{#if m?.meta?.text}<p class="line">{String(m.meta.text)}</p>{/if}
				<label>Start <input type="number" step="0.05" min="0" value={sel.start.toFixed(2)} onchange={(e) => setClip({ start: Math.max(0, Number(e.currentTarget.value)) })} /> s</label>
				<label>Length <input type="number" step="0.05" min="0.2" value={sel.dur.toFixed(2)} onchange={(e) => setClip({ dur: Math.max(0.2, Number(e.currentTarget.value)) })} /> s</label>
				{#if m?.kind !== 'image'}
					<label>From <input type="number" step="0.05" min="0" value={sel.in.toFixed(2)} onchange={(e) => setClip({ in: Math.max(0, Number(e.currentTarget.value)) })} /> s in</label>
					<label class="vol">Volume <input type="range" min="0" max="1" step="0.01" value={sel.vol} oninput={(e) => setClip({ vol: Number(e.currentTarget.value) })} /> {Math.round(sel.vol * 100)}%</label>
				{/if}
				<dl>
					{#if m?.meta?.voice}<dt>Voice</dt><dd>{String(m.meta.voice)} · {String(m.meta.model ?? '').split('/').pop()}</dd>{/if}
					{#if m?.meta?.artist}<dt>Artist</dt><dd>{String(m.meta.artist)}</dd>{/if}
					<dt>Tags</dt><dd>{m?.tags.join(', ') || '—'}</dd>
					<dt>CID</dt><dd><code>{sel.cid}</code></dd>
				</dl>
				<button class="ghost danger" onclick={() => remove(sel.id)}>Remove clip</button>
			{:else}
				<p class="hint">Click a clip to see and set it. Drag it to move it, drag its edges to trim it.</p>
			{/if}
		</aside>

		<!-- transport -->
		<div class="transport">
			<button class="tbtn" onclick={() => seek(0)} aria-label="To the start">⏮</button>
			<button class="tbtn play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
			<span class="time">{clockText(time)} <span>/ {clockText(end)}</span></span>
			<button class="ghost" onclick={playFullscreen}>⛶ Play full screen</button>
			<label class="zoom">Zoom <input type="range" min="8" max="200" step="1" bind:value={pxPerSec} /></label>
			<span class="hint">Space play · I / O mark the source · Delete removes · ← → nudge</span>
		</div>

		<!-- the timeline -->
		<div class="timeline">
			<div class="heads">
				<div class="head"></div>
				{#each TRACKS as t (t.id)}<div class="head"><b>{t.id}</b> {t.label}</div>{/each}
			</div>
			<div class="scroll">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="lanes" bind:this={lanes} style:width={x(span)} onpointerdown={scrub}>
					<div class="ruler">
						{#each ticks as s (s)}<span class="tick" style:left={x(s)}>{s}s</span>{/each}
					</div>
					{#each TRACKS as t (t.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="track"
							ondragover={(e) => t.id !== 'T1' && e.preventDefault()}
							ondrop={(e) => t.id !== 'T1' && drop(e, t.id as Track)}
						>
							{#if t.id === 'T1'}
								{#each clips.filter((c) => c.track === 'A1') as c (c.id)}
									{@const words = captionWords.filter((w) => w.clip === c.id)}
									{#if words.length}
										<div class="clip caps" style:left={x(words[0]!.t)} style:width={x(Math.max(0.3, c.start + c.dur - words[0]!.t))}>
											<span>{words.map((w) => w.word).join(' ')}</span>
										</div>
									{/if}
								{/each}
							{:else}
								{#each clips.filter((c) => c.track === t.id) as c (c.id)}
									{@const m = byCid.get(c.cid)}
									{@const s = sources[c.cid]}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="clip {m?.kind} {t.id}"
										class:sel={selected === c.id}
										style:left={x(c.start)}
										style:width={x(c.dur)}
										onpointerdown={(e) => grab(e, c, 'move')}
									>
										{#if m?.kind === 'image'}
											<img src={thumb(m)} alt="" draggable="false" />
										{:else if m?.kind === 'audio' && s}
											<canvas use:wave={{ peaks: s.peaks, from: c.in, to: c.in + c.dur, total: s.duration, color: tint(t.id as Track) }}></canvas>
										{/if}
										<span class="label">{String(m?.meta?.title ?? name(m))}</span>
										<i class="edge l" onpointerdown={(e) => grab(e, c, 'left')}></i>
										<i class="edge r" onpointerdown={(e) => grab(e, c, 'right')}></i>
									</div>
								{/each}
							{/if}
						</div>
					{/each}
					<div class="playhead" style:left={x(time)}><i></i></div>
				</div>
			</div>
		</div>
	</section>
{/if}

<style>
	.gate {
		padding-block: 3rem 6rem;
	}

	.gate a {
		color: var(--terracotta);
	}

	/* the editing room: light, and the whole window */
	.studio {
		--bg: #f6f3ec;
		--panel: #fbfaf6;
		--edge: #e2dccd;
		--ink: #26382c;
		--dim: #7b857a;
		--accent: #d99a2b;
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		grid-template-columns: 19rem 1fr 17rem;
		grid-template-rows: auto minmax(0, 1fr) auto minmax(11rem, 34vh);
		grid-template-areas:
			'bar bar bar'
			'bin monitor inspector'
			'bin transport transport'
			'bin timeline timeline';
		gap: 1px;
		background: var(--edge);
		color: var(--ink);
		font-size: 0.85rem;
	}

	.bar {
		grid-area: bar;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.55rem 1rem;
		background: var(--panel);
	}

	.back {
		color: var(--dim);
		text-decoration: none;
	}

	.bar strong {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 500;
	}

	.sub,
	.hint {
		font-size: 0.75rem;
		color: var(--dim);
	}

	.err {
		font-size: 0.78rem;
		color: #9c3b26;
	}

	.grow {
		flex: 1;
	}

	.ghost {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.ghost.danger {
		margin-top: 0.8rem;
		color: #9c3b26;
	}

	/* the library */
	.bin {
		grid-area: bin;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-height: 0;
		padding: 0.8rem;
		background: var(--panel);
	}

	.kinds {
		display: flex;
		gap: 0.3rem;
	}

	.kinds button,
	.tag {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		color: var(--dim);
		cursor: pointer;
	}

	.kinds button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: #fff;
	}

	.tag.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.bin input[type='search'] {
		padding: 0.45rem 0.75rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.8rem;
		color: var(--ink);
	}

	.tagrow {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		max-height: 5.2rem;
		overflow: auto;
	}

	.tag {
		padding: 0.12rem 0.5rem;
		font-size: 0.7rem;
	}

	.items {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.35rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: grab;
	}

	.item:hover {
		background: var(--bg);
	}

	.item.on {
		background: #f3e3c1;
	}

	.thumb {
		display: grid;
		flex: none;
		place-items: center;
		width: 3.4rem;
		height: 2.2rem;
		overflow: hidden;
		border-radius: 5px;
		background: var(--bg);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb i {
		font-style: normal;
		color: var(--dim);
	}

	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.nm,
	.tg {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.nm {
		font-size: 0.8rem;
	}

	.tg {
		font-size: 0.68rem;
		color: var(--dim);
	}

	/* the monitors: the program alone, or the source beside it */
	.monitors {
		grid-area: monitor;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		min-width: 0;
		min-height: 0;
		background: var(--edge);
	}

	.monitors.split {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}

	.mlabel {
		margin: 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.monitor {
		position: relative;
		display: grid;
		place-items: center;
		min-width: 0;
		min-height: 0;
		padding: 1.4rem 1rem 1rem;
		background: var(--bg);
		/* the frame measures itself against the room it has, so it keeps its aspect however narrow */
		container-type: size;
	}

	.monitor > .mlabel {
		position: absolute;
		top: 0.4rem;
		left: 1rem;
	}

	.monitor:fullscreen .mlabel {
		display: none;
	}

	.monitor:fullscreen {
		padding: 0;
		background: #000;
	}

	.monitor:fullscreen .frame {
		border-radius: 0;
		box-shadow: none;
	}

	.fsbar {
		display: none;
	}

	.monitor:fullscreen .fsbar {
		position: absolute;
		right: 3%;
		bottom: 2.5%;
		left: 3%;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.45);
		color: #fff;
		opacity: 0.25;
		transition: opacity 200ms ease;
	}

	.monitor:fullscreen .fsbar:hover,
	.monitor:fullscreen .fsbar:focus-within {
		opacity: 1;
	}

	.fsplay {
		border: 0;
		background: none;
		font-size: 1.1rem;
		color: #fff;
		cursor: pointer;
	}

	.scrub {
		flex: 1;
		accent-color: #f3c768;
		cursor: pointer;
	}

	.fstc {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.monitor:fullscreen .caption {
		font-size: clamp(1.2rem, 3.2vh, 2.6rem);
	}

	.frame {
		position: relative;
		width: min(100cqw, calc(100cqh * var(--ar)));
		aspect-ratio: var(--ar);
		/* the captions are sized by the frame, as the render sizes them, whatever its shape */
		container-type: size;
		overflow: hidden;
		border-radius: 6px;
		background: #111;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.15);
	}

	.frame img,
	.frame video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.frame .reel,
	.frame .still {
		position: absolute;
		inset: 0;
	}

	/* the shots waiting in the wings stay loaded but unseen (opacity, not visibility: Safari kept painting a hidden
	   video's layer, half the frame black) */
	.frame .reel {
		object-position: center;
		opacity: 0;
	}

	.frame .reel.on {
		z-index: 1;
		opacity: 1;
	}

	.grade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(0 0 0 / 0.6), transparent 50%);
	}

	.caption {
		position: absolute;
		right: 8%;
		bottom: 8%;
		left: 8%;
		margin: 0;
		font-family: var(--font-display);
		z-index: 2;
		/* as the render sets them: a 24th of the frame's short side; smaller, and higher (clear of the app's own
		   buttons and text), on a phone-shaped 9:16 */
		font-size: calc(min(100cqw, 100cqh) / 24);
		line-height: 1.35;
		text-align: center;
		color: rgb(255 255 255 / 0.35);
		text-shadow: 0 1px 12px rgb(0 0 0 / 0.5);
		/* a subtitle is never more than two lines */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.frame.tall .caption {
		bottom: 22%;
		font-size: calc(100cqw / 30);
	}

	.caption .lit {
		color: #fff;
	}

	.tc {
		position: absolute;
		top: 0.6rem;
		right: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: rgb(0 0 0 / 0.5);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		color: #fff;
	}

	/* the source monitor */
	.source {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
		min-height: 0;
		padding: 0.4rem 1rem 0.7rem;
		background: var(--bg);
	}

	.shead {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		cursor: grab;
	}

	.sname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.shead .x {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--dim);
		cursor: pointer;
	}

	.shead .x:hover {
		color: var(--ink);
	}

	.sstage {
		position: relative;
		display: grid;
		flex: 1;
		place-items: center;
		min-height: 4rem;
		container-type: size;
	}

	.sframe {
		display: block;
		width: min(100cqw, calc(100cqh * var(--ar)));
		aspect-ratio: var(--ar);
		border-radius: 6px;
		background: #111;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.15);
		object-fit: contain;
	}

	.swave,
	.sbar {
		position: relative;
		overflow: hidden;
		cursor: text;
		touch-action: none;
		user-select: none;
	}

	.swave {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: #fff;
	}

	.swave canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.sbar {
		flex: none;
		height: 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: #fff;
	}

	.band {
		position: absolute;
		top: 0;
		bottom: 0;
		border-inline: 2px solid var(--accent);
		background: rgb(217 154 43 / 0.22);
		pointer-events: none;
	}

	.sph {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px solid #e5483d;
		pointer-events: none;
	}

	.source audio {
		flex: none;
		width: 100%;
		height: 2.2rem;
	}

	.sacts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.range {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.add {
		padding: 0.3rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
	}

	.sinfo {
		flex: none;
		max-height: 5.5rem;
		overflow: auto;
	}

	.skind {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.skind span {
		overflow-wrap: anywhere;
	}

	.sinfo .line {
		margin: 0;
		font-size: 0.82rem;
	}

	/* the inspector */
	.inspector {
		grid-area: inspector;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	.inspector h2 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.iname {
		margin: 0 0 0.3rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.line {
		margin: 0 0 0.7rem;
		font-family: var(--font-display);
		line-height: 1.4;
	}

	.inspector label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.35rem 0;
		font-size: 0.78rem;
		color: var(--dim);
	}

	.inspector input[type='number'] {
		width: 4.6rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid var(--edge);
		border-radius: 5px;
		font: inherit;
		color: var(--ink);
	}

	.inspector .vol input {
		flex: 1;
	}

	dl {
		display: grid;
		gap: 0.15rem;
		margin: 0.6rem 0 0;
	}

	dt {
		margin-top: 0.35rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	dd code {
		font-size: 0.68rem;
		color: var(--dim);
	}

	/* transport */
	.transport {
		grid-area: transport;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.9rem;
		background: var(--panel);
	}

	.tbtn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--edge);
		border-radius: 50%;
		background: #fff;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.tbtn.play {
		width: 2.4rem;
		height: 2.4rem;
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.time {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.95rem;
	}

	.time span {
		color: var(--dim);
	}

	.zoom {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: 1rem;
		font-size: 0.75rem;
		color: var(--dim);
	}

	.transport .hint {
		margin-left: auto;
	}

	/* the timeline */
	.timeline {
		grid-area: timeline;
		display: grid;
		grid-template-columns: 7rem 1fr;
		min-height: 0;
		background: var(--bg);
	}

	.heads {
		display: grid;
		grid-template-rows: 1.5rem repeat(5, 1fr);
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

	.scroll {
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.lanes {
		position: relative;
		display: grid;
		grid-template-rows: 1.5rem repeat(5, 1fr);
		min-width: 100%;
		height: 100%;
		cursor: text;
		touch-action: none;
		user-select: none;
	}

	.ruler,
	.track {
		position: relative;
		border-bottom: 1px solid var(--edge);
	}

	.ruler {
		background: var(--panel);
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

	.clip:active {
		cursor: grabbing;
	}

	.clip.sel {
		box-shadow: 0 0 0 2px var(--accent);
	}

	.clip.image,
	.clip.video {
		display: flex;
		border-color: #7fa98f;
		background: #dcebe1;
	}

	.clip.image img {
		height: 100%;
		pointer-events: none;
	}

	.clip.audio.A1 {
		border-color: #d4a64a;
		background: #f7e8c5;
	}

	.clip.audio.A2 {
		border-color: #6fb3a1;
		background: #d6eee8;
	}

	.clip.audio.A3 {
		border-color: #8fa0c9;
		background: #e1e7f5;
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

	.clip.image .label,
	.clip.video .label {
		left: auto;
		right: 0.5rem;
	}

	.clip.caps {
		display: flex;
		align-items: center;
		border-color: #a594c6;
		background: #ebe5f5;
		cursor: default;
	}

	.clip.caps span {
		overflow: hidden;
		padding: 0 0.5rem;
		font-size: 0.7rem;
		white-space: nowrap;
		text-overflow: ellipsis;
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
		background: rgb(38 56 44 / 0.18);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px solid #e5483d;
		pointer-events: none;
	}

	.playhead i {
		position: absolute;
		top: 0;
		left: -7px;
		width: 12px;
		height: 12px;
		border-radius: 0 0 50% 50%;
		background: #e5483d;
	}

	.renders {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.render {
		padding: 0.4rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
	}

	.render:disabled {
		background: var(--accent);
		cursor: default;
	}

	.render.busy {
		/* the button fills as the film renders */
		background: linear-gradient(90deg, var(--accent) var(--p), #c4a672 var(--p));
		cursor: pointer;
	}

	.count {
		padding: 0.3rem 0.6rem;
	}

	/* the render panel: under the button, over the inspector, small enough to keep editing beside it */
	.render-panel {
		position: absolute;
		top: 2.4rem;
		right: 0;
		z-index: 5;
		width: 21rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.15);
		font-size: 0.75rem;
	}

	.rp-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.rp-head b {
		flex: 1;
		font-weight: 600;
	}

	.rp-pct {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.rp-x {
		padding: 0 0.2rem;
		border: 0;
		background: none;
		font-size: 1rem;
		line-height: 1;
		color: var(--dim);
		cursor: pointer;
	}

	.rp-bar {
		overflow: hidden;
		height: 6px;
		margin: 0.5rem 0 0.4rem;
		border-radius: 999px;
		background: var(--edge);
	}

	.rp-bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.6s ease;
	}

	/* queued: no progress to show, only that it is alive */
	.rp-bar.waiting i {
		width: 30% !important;
		background: var(--dim);
		opacity: 0.5;
		animation: rp-wait 1.6s ease-in-out infinite alternate;
	}

	@keyframes rp-wait {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(333%);
		}
	}

	.rp-meta {
		margin: 0.3rem 0 0;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}

	.rp-hint {
		margin: 0.5rem 0 0;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		background: #fbf1dc;
		line-height: 1.4;
	}

	.rp-hint code {
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.rp-why {
		overflow: auto;
		max-height: 8rem;
		margin: 0.45rem 0 0;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		background: #f8ebe6;
		font-size: 0.72rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: #9c3b26;
	}

	.rp-acts {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.55rem;
	}

	.rp-acts a {
		text-decoration: none;
	}

	.render-panel h4 {
		margin: 0.8rem 0 0.3rem;
		padding-top: 0.55rem;
		border-top: 1px solid var(--edge);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.rp-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rp-list li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}

	.rp-list .d {
		color: var(--dim);
		white-space: nowrap;
	}

	.rp-list .why {
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.rp-list a,
	.rp-list .link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}

	.render-panel .st {
		font-weight: 600;
	}

	.rp-list .st {
		min-width: 4rem;
	}

	.render-panel .st.done {
		color: #2f7d4f;
	}

	.render-panel .st.failed,
	.rp-list .why {
		color: #9c3b26;
	}

	.tname {
		width: 16rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-weight: 600;
		color: var(--ink);
	}

	.ttags {
		width: 9rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		color: var(--ink);
	}

	.tname:hover,
	.tname:focus {
		border-color: var(--edge);
		background: #fff;
	}

	.bar select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
	}

	.bin h3 {
		margin: 0.2rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.tl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.ghost.small {
		padding: 0.2rem 0.6rem;
		font-size: 0.72rem;
	}

	.tls {
		flex: none;
		max-height: 14rem;
		overflow: auto;
	}

	.tls ul {
		margin: 0 0 0.4rem;
		padding: 0;
		list-style: none;
	}

	.proj {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		width: 100%;
		margin: 0.15rem 0;
		padding: 0.3rem 0.2rem;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.proj:hover {
		background: #0000000a;
	}

	.caret {
		width: 0.8rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.tls ul {
		padding-left: 0.9rem;
	}

	.failed {
		max-width: 60rem;
		padding: 0.8rem 1rem;
		border-radius: 8px;
		background: #fff3f0;
		font-size: 0.75rem;
		white-space: pre-wrap;
		color: #8a2a12;
	}

	.tdesc {
		width: 14rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		color: var(--dim);
	}

	.tdesc:hover,
	.tdesc:focus {
		border-color: var(--edge);
		background: #fff;
	}

	.proj span {
		font-weight: 400;
		color: var(--dim);
	}

	.var {
		display: inline-grid;
		place-items: center;
		min-width: 1.15rem;
		height: 1.15rem;
		margin-right: 0.4rem;
		padding: 0 0.2rem;
		border-radius: 4px;
		background: var(--ink);
		font-size: 0.68rem;
		color: #fff;
	}

	.tproj {
		width: 6rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink);
	}

	.tvar {
		width: 2.2rem;
		padding: 0.3rem 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		text-align: center;
		color: #fff;
	}

	.tls li {
		display: flex;
		align-items: center;
		border-radius: 8px;
	}

	.tls li.on {
		background: #f3e3c1;
	}

	.tl {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		padding: 0.4rem 0.55rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.tls .x {
		padding: 0 0.5rem;
		border: 0;
		background: none;
		font-size: 1rem;
		color: var(--dim);
		cursor: pointer;
		opacity: 0.4;
	}

	.tls li:hover .x {
		opacity: 1;
	}

	@media (max-width: 900px) {
		.studio {
			grid-template-columns: 1fr;
			grid-template-rows: auto 30vh auto minmax(10rem, 1fr) 30vh;
			grid-template-areas: 'bar' 'monitor' 'transport' 'timeline' 'bin';
		}

		/* source above program */
		.studio:has(.monitors.split) {
			grid-template-rows: auto 64vh auto minmax(10rem, 1fr) 30vh;
		}

		.monitors.split {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		}

		.inspector,
		.transport .hint,
		.zoom {
			display: none;
		}
	}
</style>
