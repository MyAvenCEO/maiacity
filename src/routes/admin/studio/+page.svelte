<!--
	The studio: a small editing room for the journal films, over the media library.

	The library sits on the left, filtered by type and tag; drag a file onto a track (or double-click it to drop it
	at the playhead). On the timeline every clip moves by hand: drag it to move it, drag its edges to trim it, click
	it to see and set it in the inspector, Delete to remove it. Space plays. The captions follow the voice clips,
	word by word, from each take's own timings. The edit is kept in this browser.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import {
		API,
		createTimeline,
		deleteTimeline,
		listMedia,
		listTimelines,
		may,
		me,
		saveTimeline,
		type MediaItem,
		type Timeline
	} from '$lib/auth/client';

	type Track = 'V1' | 'A1' | 'A2' | 'A3';
	type Clip = { id: string; cid: string; track: Track; start: number; in: number; dur: number; vol: number };
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
	let monitorVideo = $state<HTMLVideoElement | null>(null);
	let studio = $state<HTMLElement | null>(null);
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
			if (!['image', 'video', 'audio'].includes(m.kind) || !m.paths.length) return false;
			if (kind !== 'all' && m.kind !== kind) return false;
			if (tag && !m.tags.includes(tag)) return false;
			const f = q.trim().toLowerCase();
			return !f || m.cid.includes(f) || m.paths.some((p) => p.toLowerCase().includes(f)) || String(m.meta?.text ?? '').toLowerCase().includes(f);
		})
	);
	const shownTimelines = $derived(timelines.filter((t) => !tag || t.tags.includes(tag)));
	const name = (m: MediaItem | undefined) => m?.paths[0]?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? m?.cid.slice(0, 10) ?? '';
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
	const voiceNow = $derived(at('A1', time));
	const caption = $derived(voiceNow ? captionWords.filter((w) => w.clip === voiceNow.id) : []);

	const clockText = (t: number) => {
		const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t % 1) * 100);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
	};

	// ── loading ─────────────────────────────────────────────────────────────
	onMount(async () => {
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
		} catch {
			/* no storage: open the newest */
		}
		const open = timelines.find((t) => t.id === last) ?? timelines[0];
		if (open) await openTimeline(open);
		else await newTimeline();
	});

	async function openTimeline(t: Timeline) {
		stop();
		await flush();
		current = t;
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
		const t = await createTimeline({ name: `Timeline ${timelines.length + 1}`, aspect: '1:1', tags: [], clips: made });
		timelines = [t, ...timelines];
		await openTimeline(t);
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
			const t = await saveTimeline(current.id, { name: current.name, aspect: current.aspect, tags: current.tags, clips });
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
		const voices = library.filter((m) => m.kind === 'audio' && m.paths.some((p) => p.startsWith('/studio/voice/')));
		const voice = voices.find((m) => Array.isArray(m.meta?.words) && (m.meta.words as unknown[]).length) ?? voices[0];
		const bed = library.find((m) => m.kind === 'audio' && m.paths.some((p) => p.startsWith('/music/')));
		const still = library.find((m) => m.paths.includes('/day-18-homes-and-the-sound-of-the-forest/terrace-upper.jpg')) ?? library.find((m) => m.kind === 'image');
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
	let ctx: AudioContext | null = null;
	const audioCtx = () => (ctx ??= new AudioContext());
	let playing_nodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
	let ctxStart = 0, timeStart = 0;

	const pending = new Map<string, Promise<Source>>();
	/** Fetch a file once: sound is decoded (for playing and for its waveform); a still is only shown. */
	function source(cid: string): Promise<Source> {
		if (sources[cid]) return Promise.resolve(sources[cid]!);
		if (pending.has(cid)) return pending.get(cid)!;
		const m0 = byCid.get(cid);
		if (m0?.kind === 'video') {
			// a video streams straight from the library (it answers byte ranges): no need to download it first
			const url = raw(cid);
			const p = new Promise<Source>((ok) => {
				const v = document.createElement('video');
				v.preload = 'metadata';
				v.crossOrigin = 'use-credentials';
				const done = (duration: number) => ok((sources[cid] = { url, duration, peaks: [] }));
				v.onloadedmetadata = () => done(v.duration || IMAGE_LEN);
				v.onerror = () => done(Number(m0.meta?.duration_s) || IMAGE_LEN);
				v.src = url;
			});
			pending.set(cid, p);
			return p;
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
			// a short fade in at the clip's head and out at its tail, so a cut never clicks
			const fadeIn = from === c.start ? 0.06 : 0.02, fadeOut = Math.min(0.3, length / 3);
			gain.gain.setValueAtTime(0, when);
			gain.gain.linearRampToValueAtTime(c.vol, when + fadeIn);
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
		silence();
		void flush();
		void ctx?.close();
		for (const s of Object.values(sources)) if (s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
	});

	// ── playback ────────────────────────────────────────────────────────────
	function syncVideo(force = false) {
		if (!monitorVideo || !picture || pictureItem?.kind !== 'video') return;
		const local = picture.in + (time - picture.start);
		monitorVideo.volume = picture.vol;
		if (force || Math.abs(monitorVideo.currentTime - local) > 0.25) monitorVideo.currentTime = local;
		if (playing && monitorVideo.paused) void monitorVideo.play();
		if (!playing && !monitorVideo.paused) monitorVideo.pause();
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

	async function place(cid: string, track: Track, start: number) {
		const m = byCid.get(cid);
		const accepts = TRACKS.find((t) => t.id === track)?.accepts ?? [];
		if (!m || !accepts.includes(m.kind)) return void (error = `${name(m)} does not go on the ${track} track.`);
		error = '';
		try {
			const s = await source(cid);
			const c = clip(cid, track, Math.max(0, snap(start)), 0, m.kind === 'image' ? IMAGE_LEN : s.duration);
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
		void place(cid, track, (e.clientX - lanes.getBoundingClientRect().left) / pxPerSec);
	}

	const defaultTrack = (m: MediaItem): Track =>
		m.kind === 'audio'
			? m.paths.some((p) => p.startsWith('/music/'))
				? 'A2'
				: m.paths.some((p) => p.startsWith('/sounds/')) || m.tags.includes('sfx')
					? 'A3'
					: 'A1'
			: 'V1';

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
		if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
		if (e.code === 'Space') (e.preventDefault(), toggle());
		else if (e.code === 'Home') seek(0);
		else if (e.code === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : 0.1));
		else if (e.code === 'ArrowRight') seek(time + (e.shiftKey ? 1 : 0.1));
		else if ((e.code === 'Delete' || e.code === 'Backspace') && selected) (e.preventDefault(), remove(selected));
	}

	/** The picture alone, full screen, playing from the start (Esc leaves it). */
	async function playFullscreen() {
		await screen?.requestFullscreen().catch(() => {});
		seek(0);
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
		{:else if phase === 'signed-out'}
			<p>The studio belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
		{:else}
			<p>The studio belongs to the admin, and your account is not one.</p>
		{/if}
	</main>
{:else}
	<section class="studio" bind:this={studio} aria-label="Studio">
		<header class="bar">
			<a class="back" href="{base}/admin/media/">← Admin</a>
			<strong>Studio</strong>
			{#if current}
				<input class="tname" value={current.name} onchange={(e) => setMeta({ name: e.currentTarget.value.trim() || current!.name })} aria-label="Timeline name" />
				<input class="ttags" value={current.tags.join(', ')} placeholder="tags" onchange={(e) => setMeta({ tags: e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean) })} aria-label="Timeline tags" />
				<select value={current.aspect} onchange={(e) => setMeta({ aspect: e.currentTarget.value })} aria-label="Frame">
					{#each ASPECTS as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			{/if}
			<span class="sub">{clips.length} clips · {clockText(end)} · {saving === 'saved' ? 'saved' : saving === 'saving' ? 'saving…' : 'unsaved'}</span>
			{#if error}<span class="err">{error}</span>{/if}
			<span class="grow"></span>
			<button class="ghost" onclick={fullscreen}>⛶ Full screen</button>
		</header>

		<!-- the library -->
		<aside class="bin">
			<div class="tl-head">
				<h3>Timelines</h3>
				<button class="ghost small" onclick={newTimeline}>+ New</button>
			</div>
			<ul class="tls">
				{#each shownTimelines as t (t.id)}
					<li class:on={current?.id === t.id}>
						<button class="tl" onclick={() => openTimeline(t)}>
							<span class="nm">{t.name}</span>
							<span class="tg">{t.aspect} · {t.clips.length} clips{t.tags.length ? ` · ${t.tags.join(', ')}` : ''}</span>
						</button>
						<button class="x" onclick={() => removeTimeline(t)} aria-label="Delete timeline">×</button>
					</li>
				{/each}
			</ul>
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
							draggable="true"
							ondragstart={(e) => e.dataTransfer?.setData('text/x-cid', m.cid)}
							ondblclick={() => place(m.cid, defaultTrack(m), time)}
							title="Drag onto a track, or double-click to drop it at the playhead"
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

		<!-- the program monitor -->
		<div class="monitor" bind:this={screen}>
			<div class="frame" style:aspect-ratio={aspect.replace(':', ' / ')}>
				{#if pictureItem?.kind === 'image'}
					<img src={thumb(pictureItem)} alt="" />
				{:else if pictureItem?.kind === 'video' && picture && sources[picture.cid]}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video bind:this={monitorVideo} src={sources[picture.cid]!.url} crossorigin="use-credentials" playsinline muted></video>
				{/if}
				<div class="grade"></div>
				{#if caption.length}
					<p class="caption">
						{#each caption as w, i (i)}<span class:lit={w.t <= time}>{w.word}</span>{' '}{/each}
					</p>
				{/if}
				<span class="tc">{clockText(time)}</span>
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
			<span class="hint">Space play · Delete removes · ← → nudge</span>
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
											<canvas use:wave={{ peaks: s.peaks, from: c.in, to: c.in + c.dur, total: s.duration, color: t.id === 'A1' ? '#a8741a' : t.id === 'A3' ? '#4a5f93' : '#2f7d6a' }}></canvas>
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

	/* the monitor */
	.monitor {
		grid-area: monitor;
		display: grid;
		place-items: center;
		min-height: 0;
		padding: 1rem;
		background: var(--bg);
	}

	.monitor:fullscreen {
		padding: 0;
		background: #000;
	}

	.monitor:fullscreen .frame {
		border-radius: 0;
		box-shadow: none;
	}

	.monitor:fullscreen .caption {
		font-size: clamp(1.2rem, 3.2vh, 2.6rem);
	}

	.frame {
		position: relative;
		height: 100%;
		max-width: 100%;
		max-height: 100%;
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
		font-size: clamp(0.95rem, 2vw, 1.5rem);
		line-height: 1.35;
		text-align: center;
		color: rgb(255 255 255 / 0.35);
		text-shadow: 0 1px 12px rgb(0 0 0 / 0.5);
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
		max-height: 11rem;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
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

		.inspector,
		.transport .hint,
		.zoom {
			display: none;
		}
	}
</style>
