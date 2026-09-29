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
	const source = $derived.by(() => {
		if (!pic) return null;
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
	// the world: started in its iframe as soon as the timeline has a world clip
	$effect(() => {
		if (s.wantWorld && iframe) void s.world.attach(iframe, worldUrl(base));
	});
	// paused: the world (or its stand-in) shows the frame under the playhead whenever anything about it changes
	$effect(() => {
		void s.time;
		void spec;
		void s.tab;
		void s.previewGrade;
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
		const px = s.proxy(s.pictureItem);
		if (s.onProxies) return px.cid ? 'proxy' : 'no proxy yet · original';
		return 'original';
	});
</script>

<div class="monitor" bind:this={s.screen}>
	<h2 class="mlabel">{label}</h2>
	<div class="badges">
		{#if fileNote}<span class="b" class:warn={fileNote.startsWith('no proxy')}>{fileNote}</span>{/if}
		{#if worldNote}<span class="b world">{worldNote}</span>{/if}
		{#if s.preparing}<span class="b warn">preparing the world…</span>{/if}
		{#if gl && plan?.note && pic}<span class="b warn" title={plan.note}>{plan.note}</span>{/if}
		{#if !gl}<span class="b warn">No WebGL2: colour not managed</span>{/if}
		{#if s.tab === 'edit' && s.previewGrade}<span class="b">grade preview</span>{/if}
	</div>
	<div class="frame" class:tall={s.viewShape === '9:16'} class:gl style:--ar={s.viewShape.replace(':', ' / ')}>
		{#each s.reel as c (c.id)}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="reel"
				class:on={!gl && pic?.id === c.id && (!isWorld(c) || !live)}
				bind:this={s.reelVideos[c.id]}
				src={s.playUrl(c)}
				crossorigin="use-credentials"
				preload="auto"
				playsinline
				muted
				onloadeddata={() => s.syncVideo()}
			></video>
		{/each}
		{#if s.pictureItem?.kind === 'image'}
			<img class="still" class:on={!gl} bind:this={s.stillEl} src={raw((s.stillItem ?? s.pictureItem).cid)} alt="" crossorigin="use-credentials" />
		{/if}
		<canvas class="stand" class:on={!gl && isWorld(pic) && !live && !worldVideo} bind:this={stand}></canvas>
		<Viewer
			{source}
			profile={s.profileOfClip(pic)}
			grades={s.gradesOf(pic)}
			luts={s.luts}
			aspect={ratio(s.viewShape)}
			frame={frameOf}
			falseColor={s.falseColor}
			bind:canvas={s.viewerCanvas}
			bind:plan
			bind:supported={gl}
		/>
		{#if s.wantWorld}
			<iframe class="world" class:on={live} bind:this={iframe} title="The world (film mode)" tabindex="-1"></iframe>
		{/if}
		<div class="shade"></div>
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
		background: var(--bg);
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
		pointer-events: none;
	}

	.b {
		overflow: hidden;
		max-width: 22rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #e8efe9;
		font-size: 0.64rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #2f5a3f;
		pointer-events: auto;
	}

	.b.warn {
		background: #fbf1dc;
		color: #7a5a17;
	}

	.b.world {
		background: #e6ecf5;
		color: #4a5f93;
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
		background: #111;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.15);
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
