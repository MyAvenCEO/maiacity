<!--
	The program monitor: the timeline as it plays, in the frame of the shape being viewed. Media clips play from their
	proxies (Edit) or originals (Grade), through the viewer's colour path; the videos themselves stay loaded, three at a
	time (the one on screen and the next two), so a cut never waits. A world clip is the live world (film mode, in an
	iframe driven by the timeline's clock); while its world is not ready its HD proxy plays, else a drawn stand-in.
	Captions are HTML over the picture — graphics, never graded.
-->
<script>
	import { base } from '$app/paths';
	import { evaluate } from './shots.js';
	import { clockText, isWorld, ratio, raw } from './studio.svelte.js';
	import Viewer from './Viewer.svelte';
	import { untrack } from 'svelte';
	import { nativeFrame } from './luts.js';
	import { placeholder, worldUrl } from './world.svelte.js';

	/** @typedef {import('$lib/auth/client').Shape} Shape */
	/** @type {{ s: import('./studio.svelte.js').Studio, label?: string }} */
	let { s, label = 'Program' } = $props();

	/** @type {HTMLIFrameElement | null} */
	let iframe = $state(null);
	/** @type {HTMLCanvasElement | null} */
	let stand = $state(null);
	/** @type {import('./view.js').ViewPlan | null} */
	let plan = $state(null);
	let gl = $state(true);

	const pic = $derived(s.picture);
	const spec = $derived(isWorld(pic) ? s.specOf(pic) : null);
	/** the live world is showing this frame */
	const live = $derived(!!spec && s.world.state === 'ready' && s.world.isReady(spec));
	const worldVideo = $derived(isWorld(pic) && !live ? (s.reelVideos[pic?.id ?? ''] ?? null) : null);
	/** the grading still on screen (Grade, paused, on stills) */
	const still = $derived(s.showStill ? s.stillOf(pic) : null);
	/** @type {HTMLImageElement | null} */
	let stillImg = $state(null);
	// Grade, playing: the Mac plays the picture through the whole grade (the render's chain on Metal, secondaries and
	// finishing too), laid over the viewer's picture; the sound stays the studio's, the player follows its clock
	/** @type {HTMLDivElement | null} */
	let frameEl = $state(null);
	const nativePlay = $derived(s.tab === 'grade' && s.playing && !s.falseColor);
	/** @param {string} name @param {Record<string, unknown>} args */
	const mac = async (name, args) => {
		try {
			const { command } = await import('$lib/native');
			await command(name, args);
		} catch (e) {
			console.warn(`playback: ${name}:`, e);
		}
	};
	const playKey = $derived(s.tab === 'grade' ? JSON.stringify([s.current?.id, s.viewShape, s.current?.grade ?? null, s.clips.filter((c) => c.track === 'V1')]) : '');
	let loaded = '';
	const place = () => {
		const r = frameEl?.getBoundingClientRect();
		if (r) void mac('player_view', { rect: [r.left, r.top, r.width, r.height] });
	};
	// the handovers, so the picture never drops to the webview's own preview in between: playing, the Mac's layer
	// shows once it plays (until then the last still stays); stopped, the layer stays (the player paused on the same
	// frame, through the same chain) until the Mac's still of that frame is on screen
	let layerUp = $state(false);
	let handover = false;
	const layerDown = () => {
		handover = false;
		layerUp = false;
		void mac('player_view', { rect: null });
	};
	const shown = () => {
		if (handover) layerDown();
	};
	$effect(() => {
		if (!nativePlay) {
			const at = untrack(() => s.time);
			void mac('player_pause', { time: at });
			if (!untrack(() => layerUp) || !untrack(() => nativeKey)) return void layerDown();
			handover = true;
			// never longer than this, whatever becomes of the still
			const t = setTimeout(shown, 1500);
			return () => clearTimeout(t);
		}
		const key = untrack(() => playKey);
		// read without tracking: an edit while it plays doesn't restart the player (the next play picks it up)
		void untrack(() => (async () => {
			if (loaded !== key) {
				const clips = s.clips.filter((c) => c.track === 'V1' && c.hash);
				const files = Object.fromEntries(clips.map((c) => [c.id, s.playItem(c)?.hash ?? c.hash]));
				const profiles = Object.fromEntries(clips.map((c) => [c.id, s.profileOfClip(c)]));
				await mac('player_load', { timeline: $state.snapshot(s.current), shape: s.viewShape, files, profiles, width: 1280 });
				loaded = key;
			}
			await mac('player_play', { time: untrack(() => s.time) });
			// its first frames made before its layer shows (no black between the still and the playing picture)
			await new Promise((r) => setTimeout(r, 120));
			if (!untrack(() => nativePlay)) return;
			handover = false;
			place();
			layerUp = true;
			// the still it covers is let go: stopping shows the new frame's, never this one again
			nativeUrl = null;
		})());
		// kept on the studio's clock, and on the picture when the window moves or resizes
		const id = setInterval(() => void mac('player_sync', { time: untrack(() => s.time) }), 1000);
		const ro = new ResizeObserver(place);
		if (frameEl) ro.observe(frameEl);
		window.addEventListener('resize', place);
		return () => (clearInterval(id), ro.disconnect(), window.removeEventListener('resize', place));
	});
	// Grade, paused: the picture the Mac makes through the whole grade — secondaries, looks, finishing, what the render
	// makes — over the live preview, a moment after anything about it changes. Still, proxy or original: the same chain,
	// only the frame it starts from differs (the still; the proxy's or the original's frame under the playhead)
	let nativeUrl = $state(/** @type {string | null} */ (null));
	const nativeSrc = $derived.by(() => {
		if (!pic || s.falseColor || s.tab !== 'grade' || s.playing || isWorld(pic)) return null;
		if (still) return still.hash;
		if (s.pictureItem?.kind !== 'video') return null;
		const it = s.playItem(pic);
		if (!it?.hash) return null;
		// on the frame (30 fps): scrubbing asks for each frame once
		const at = Math.round((pic.in + (s.time - pic.start)) * 30) / 30;
		return { file: it.hash, profile: s.profileOfClip(pic), at };
	});
	const nativeKey = $derived(nativeSrc && pic ? JSON.stringify([nativeSrc, s.frameTimeline(pic), s.viewShape]) : '');
	$effect(() => {
		const k = nativeKey;
		// while it plays the last still stays (under the Mac's layer, and over the preview until the layer is up)
		if (!k) return void (untrack(() => s.playing) || (nativeUrl = null));
		let live = true;
		const t = setTimeout(() => {
			const [src, tl, shape] = JSON.parse(k);
			nativeFrame(tl, tl.clips[0].id, src, 1600, shape)
				.then((u) => {
					if (!live) return;
					// the same picture as on screen already: it is shown
					if (u === nativeUrl) shown();
					nativeUrl = u;
				})
				.catch((e) => console.warn('viewer: the native frame', e));
		}, 120);
		return () => ((live = false), clearTimeout(t));
	});
	const source = $derived.by(() => {
		if (!pic) return null;
		if (still) return stillImg;
		if (isWorld(pic)) return live ? null : (worldVideo ?? stand);
		if (s.pictureItem?.kind === 'image') return s.stillEl;
		return s.reelVideos[pic.id] ?? null;
	});
	const frameOf = $derived(pic && !isWorld(pic) ? pic.frame?.[/** @type {Shape} */ (s.viewShape)] : undefined);

	// the scopes read the live world's own canvas while it shows the frame (same origin), else the viewer
	$effect(() => {
		/** @type {HTMLCanvasElement | null} */
		let c = null;
		try {
			c = live ? (iframe?.contentDocument?.querySelector('canvas') ?? null) : null;
		} catch {
			c = null;
		}
		s.scopeCanvas = c;
	});
	// the live world: started in its iframe in the 3D tab only, and let go (its WebGL, its domes) when the tab is left —
	// everywhere else a world shot plays from its HD proxy
	const inWorld = $derived(s.wantWorld && s.tab === '3d');
	$effect(() => {
		if (inWorld && iframe) void s.world.attach(iframe, worldUrl(base));
	});
	$effect(() => {
		if (!inWorld && s.world.state !== 'off') s.world.detach();
	});
	// paused: the world (or its stand-in) shows the frame under the playhead whenever anything about it changes
	$effect(() => {
		void s.time;
		void spec;
		void s.tab;
		void s.current?.grade;
		void pic?.grade;
		if (!s.playing) s.driveWorld();
	});
	// the stand-in, drawn at the shot's time (when neither the live world nor a proxy can show it)
	$effect(() => {
		if (!stand || !spec || !pic || live || worldVideo) return;
		const t = s.shotTime(pic);
		const e = evaluate(spec, t, /** @type {Shape} */ (s.viewShape));
		const r = ratio(s.viewShape);
		stand.width = r >= 1 ? 960 : Math.round(960 * r);
		stand.height = r >= 1 ? Math.round(960 / r) : 960;
		placeholder(stand, {
			name: s.clipName(pic),
			t,
			seconds: spec.seconds,
			hour: e.hour,
			pose: e.pose,
			fov: e.fov,
			note: s.world.state === 'loading' ? 'Starting the world…' : s.world.state === 'ready' ? 'Preparing this shot…' : 'World viewer unavailable — placeholder (no HD proxy yet)'
		});
	});

	const worldNote = $derived(
		!isWorld(pic)
			? null
			: live
				? `live world${s.world.scale < 1 ? ` · ${Math.round(s.world.scale * 100)}% res` : ''}`
				: worldVideo
					? 'world: HD proxy (live world not ready)'
					: 'world: stand-in'
	);
	const fileNote = $derived.by(() => {
		if (!pic || isWorld(pic) || s.pictureItem?.kind !== 'video') return null;
		if (still) return `grading still · original at ${still.t.toFixed(1)} s${still.inside ? '' : ' (outside this cut)'}`;
		const px = s.proxy(s.pictureItem);
		if (s.onProxies) return px.hash ? 'proxy' : 'no proxy yet · original';
		return 'original';
	});
</script>

<div class="monitor" bind:this={s.screen}>
	<h2 class="mlabel">{label}</h2>
	<div class="badges">
		{#if s.tab === 'grade'}
			<!-- what the picture is judged on: its 4K still (a frame of the original), its proxy, its original — one control,
			     each choice saying what it shows -->
			{@const st = s.stillOf(pic)}
			<span class="src" role="tablist" aria-label="What the grade is judged on">
				<i>Picture</i>
				<button role="tab" aria-selected={s.gradeOn === 'stills'} class:on={s.gradeOn === 'stills'} class:warn={!!st && !st.inside} onclick={() => (s.gradeOn = 'stills')} title={st ? `The grading still: a 4K frame of the original at ${st.t.toFixed(1)} s${st.inside ? '' : ' — outside this cut'}` : 'No grading still for this shot yet'}>Still{#if st}<small>{st.t.toFixed(1)} s{st.inside ? '' : ' ⚠'}</small>{/if}</button>
				<button role="tab" aria-selected={s.gradeOn === 'proxies'} class:on={s.gradeOn === 'proxies'} onclick={() => (s.gradeOn = 'proxies')} title="The HD proxy: plays light">Proxy</button>
				<button role="tab" aria-selected={s.gradeOn === 'originals'} class:on={s.gradeOn === 'originals'} onclick={() => (s.gradeOn = 'originals')} title="The original file: full quality, heavy">Original</button>
			</span>
		{/if}
		{#if fileNote && (s.tab !== 'grade' || fileNote.startsWith('no proxy'))}<span class="b" class:warn={fileNote.startsWith('no proxy') || fileNote.includes('outside')}>{fileNote}</span>{/if}
		{#if worldNote}<span class="b world">{worldNote}</span>{/if}
		{#if s.preparing}<span class="b warn">preparing the world…</span>{/if}
		{#if isWorld(pic) && s.world.error}<span class="b warn" title={s.world.error}>world: {s.world.error}</span>{/if}
		{#if gl && plan?.note && pic}<span class="b warn" title={plan.note}>{plan.note}</span>{/if}
		{#if !gl}<span class="b warn">No WebGL2: colour not managed</span>{/if}
	</div>
	<div class="frame" bind:this={frameEl} class:tall={s.viewShape === '9:16'} class:gl style:--ar={s.viewShape.replace(':', ' / ')}>
		{#each s.reel as c (c.id)}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="reel"
				class:on={!gl && pic?.id === c.id && (!isWorld(c) || !live)}
				bind:this={s.reelVideos[c.id]}
				src={s.playUrl(c)}
				crossorigin="anonymous"
				preload="auto"
				playsinline
				muted
				onloadeddata={() => s.syncVideo()}
			></video>
		{/each}
		{#if s.pictureItem?.kind === 'image'}
			<img class="still" class:on={!gl} bind:this={s.stillEl} src={raw((s.stillItem ?? s.pictureItem).hash)} alt="" crossorigin="anonymous" />
		{/if}
		{#if still}
			<img class="still" bind:this={stillImg} src={raw(still.hash)} alt="" crossorigin="anonymous" />
		{/if}
		<canvas class="stand" class:on={!gl && isWorld(pic) && !live && !worldVideo} bind:this={stand}></canvas>
		<Viewer
			{source}
			profile={source && source === stand ? 'srgb' : still ? 'acescct' : s.profileOfClip(pic)}
			grades={s.gradesOf(pic)}
			looks={s.looksOf(pic)}
			balance={s.balanceOf(pic)}
			luts={s.luts}
			aspect={ratio(s.viewShape)}
			frame={frameOf}
			falseColor={s.falseColor}
			bind:canvas={s.viewerCanvas}
			bind:plan
			bind:supported={gl}
		/>
		{#if nativeUrl && (nativeKey || (nativePlay && !layerUp))}
			<img class="native" src={nativeUrl} alt="" onload={shown} />
		{/if}
		{#if pic?.kind === 'slate'}
			<!-- a shot not filmed yet: its script, where the picture will be -->
			<div class="slate">
				<span>{[pic.script?.scene, pic.script?.label, pic.script?.size].filter(Boolean).join(' · ')}</span>
				<p>{pic.script?.description || 'A shot to film'}</p>
				{#if pic.script?.notes}<small>{pic.script.notes}</small>{/if}
			</div>
		{/if}
		{#if inWorld}
			<iframe class="world" class:on={live} bind:this={iframe} title="The world (film mode)" tabindex="-1"></iframe>
		{/if}
		<!-- the captions' backdrop (as the render sets it); not in Grade, where the picture itself is judged -->
		{#if s.tab !== 'grade'}<div class="shade"></div>{/if}
		{#if s.caption.length}
			<p class="caption">
				{#each s.caption as w, i (i)}<span class:lit={w.t <= s.time}>{w.word}</span>{' '}{/each}
			</p>
		{/if}
		<span class="tc">{clockText(s.time)}</span>
	</div>
	<!-- full screen: play and pause, and the playhead to move by hand -->
	<div class="fsbar">
		<button class="fsplay" onclick={s.toggle} aria-label={s.playing ? 'Pause' : 'Play'}>{s.playing ? '❚❚' : '▶'}</button>
		<input class="scrub" type="range" min="0" max={s.end} step="0.01" value={s.time} oninput={(e) => s.seek(Number(e.currentTarget.value))} aria-label="Playhead" />
		<span class="fstc">{clockText(s.time)} / {clockText(s.end)}</span>
	</div>
</div>

<style>
	.monitor {
		position: relative;
		display: grid;
		place-items: center;
		min-width: 0;
		min-height: 0;
		padding: 1.4rem 1rem 1rem;
		background: var(--abyss);
		/* the frame measures itself against the room it has, so it keeps its aspect however narrow */
		container-type: size;
	}

	.mlabel {
		position: absolute;
		top: 0.4rem;
		left: 1rem;
		margin: 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.badges {
		position: absolute;
		top: 0.3rem;
		right: 1rem;
		left: 6rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.3rem;
		z-index: 3;
		pointer-events: none;
	}

	.b {
		overflow: hidden;
		max-width: 22rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--ok-bg);
		font-size: 0.64rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ok);
		pointer-events: auto;
	}

	.b.warn {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.b.world {
		background: var(--info-bg);
		color: var(--info);
	}

	.monitor:fullscreen .mlabel,
	.monitor:fullscreen .badges {
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
		z-index: 5;
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
		background: #000;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.55);
	}

	.frame img,
	.frame video,
	.frame canvas.stand,
	.frame iframe {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		border: 0;
	}

	/* the pictures feed the viewer; unseen themselves (opacity, not visibility: Safari kept painting a hidden video's
	   layer, half the frame black) — shown only when there is no WebGL2 */
	.frame video,
	.frame img,
	.frame canvas.stand {
		opacity: 0;
	}

	/* the Mac's own picture of the still, through the whole grade */
	.frame img.native {
		z-index: 1;
		opacity: 1;
		object-fit: fill;
		pointer-events: none;
	}

	/* the badge row lets clicks through to the picture; the switch takes its own */
	.src {
		position: relative;
		z-index: 3;
		pointer-events: auto;
		display: inline-flex;
		padding: 1px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
	}

	.src button {
		padding: 0.05rem 0.55rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.68rem;
		color: var(--dim);
		cursor: pointer;
	}

	.src i {
		padding: 0 0.45rem 0 0.55rem;
		font-style: normal;
		font-size: 0.62rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--dim);
		align-self: center;
	}

	.src button small {
		margin-left: 0.3rem;
		font-size: 0.6rem;
		color: var(--dim);
	}

	.src button.on small {
		color: var(--ink-soft);
	}

	.src button.warn small {
		color: var(--warn);
	}

	.src button.on {
		background: var(--sel);
		color: var(--ink);
	}

	.slate {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.6rem;
		padding: 8% 12%;
		background: #1b1f22;
		color: #e9e6dd;
		text-align: center;
	}

	.slate span {
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #a8afa6;
	}

	.slate p {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1rem, 2.4vw, 1.8rem);
		line-height: 1.3;
	}

	.slate small {
		font-size: 0.76rem;
		color: #a8afa6;
	}

	.frame .on {
		z-index: 1;
		opacity: 1;
	}

	/* the world draws its own frame (view transform and grade in film mode): on top of the viewer when live */
	.frame iframe {
		z-index: 0;
		opacity: 0;
		pointer-events: none;
	}

	.frame iframe.on {
		z-index: 2;
		opacity: 1;
		pointer-events: auto;
	}

	.shade {
		position: absolute;
		inset: 0;
		z-index: 3;
		background: linear-gradient(to top, rgb(0 0 0 / 0.6), transparent 50%);
		pointer-events: none;
	}

	.caption {
		position: absolute;
		right: 8%;
		bottom: 8%;
		left: 8%;
		z-index: 4;
		margin: 0;
		font-family: var(--font-display);
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
		pointer-events: none;
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
		z-index: 4;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: rgb(0 0 0 / 0.5);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		color: #fff;
	}
</style>
