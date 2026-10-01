<!--
	A video as QuickTime shows it. The webview's own <video> shows a BT.709 file (a render's 10-bit HEVC master above
	all) darker than QuickTime and the studio's frames do; here the <video> only decodes and keeps the sound: each
	frame's code values go to the GPU untouched (UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE, as the studio's viewer reads
	them) and come out the way macOS shows Rec.709 video — decoded with gamma 1.961 (Core Media's video convention, the
	one QuickTime and the Mac's own frames use), written to the sRGB canvas. Its controls are its own.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';

	let { src, onmeta }: { src: string; onmeta?: (w: number, h: number, d: number) => void } = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let stage = $state<HTMLDivElement | null>(null);
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let muted = $state(false);
	let failed = $state('');

	const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
	// Rec.709 code values → light as Core Media shows video (gamma 1.961) → sRGB-encoded for the canvas (same primaries)
	const FS = `#version 300 es
precision highp float;
uniform sampler2D img; in vec2 uv; out vec4 o;
vec3 srgb(vec3 l) { return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
void main() { vec3 v = texture(img, uv).rgb; o = vec4(srgb(pow(max(v, 0.0), vec3(1.961))), 1.0); }`;

	let gl: WebGL2RenderingContext | null = null;
	let tex: WebGLTexture | null = null;
	function setup(c: HTMLCanvasElement) {
		const g = c.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
		if (!g) return void (failed = 'No WebGL2: the picture cannot be drawn colour-true here');
		const shader = (type: number, text: string) => {
			const s = g.createShader(type)!;
			g.shaderSource(s, text);
			g.compileShader(s);
			return s;
		};
		const prog = g.createProgram()!;
		g.attachShader(prog, shader(g.VERTEX_SHADER, VS));
		g.attachShader(prog, shader(g.FRAGMENT_SHADER, FS));
		g.linkProgram(prog);
		if (!g.getProgramParameter(prog, g.LINK_STATUS)) return void (failed = 'The picture shader did not build');
		g.useProgram(prog);
		const buf = g.createBuffer();
		g.bindBuffer(g.ARRAY_BUFFER, buf);
		g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
		const at = g.getAttribLocation(prog, 'p');
		g.enableVertexAttribArray(at);
		g.vertexAttribPointer(at, 2, g.FLOAT, false, 0, 0);
		tex = g.createTexture();
		g.bindTexture(g.TEXTURE_2D, tex);
		for (const [k, v] of [
			[g.TEXTURE_MIN_FILTER, g.LINEAR],
			[g.TEXTURE_MAG_FILTER, g.LINEAR],
			[g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE],
			[g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]
		])
			g.texParameteri(g.TEXTURE_2D, k, v);
		gl = g;
	}

	/** the frame on screen, drawn at the canvas's own pixel size */
	function draw() {
		if (!gl || !video || !canvas || video.readyState < 2) return;
		const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
		const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
		if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
		gl.viewport(0, 0, w, h);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	// every frame the video shows, drawn (requestVideoFrameCallback where there is one, else each animation frame)
	let raf = 0;
	let vfc = 0;
	function loop() {
		draw();
		if (!video) return;
		if ('requestVideoFrameCallback' in video) vfc = (video as any).requestVideoFrameCallback(loop);
		else raf = requestAnimationFrame(loop);
	}
	$effect(() => {
		if (canvas && !gl) setup(canvas);
	});
	$effect(() => {
		if (!video) return;
		loop();
		return () => {
			cancelAnimationFrame(raf);
			if (video && 'cancelVideoFrameCallback' in video) (video as any).cancelVideoFrameCallback(vfc);
		};
	});
	// the canvas keeps the video's shape inside the room it is given
	let aspect = $state(16 / 9);
	onDestroy(() => {
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	});

	const toggle = () => (video && (video.paused ? void video.play() : video.pause()));
	const clock = (s: number) => {
		s = Math.max(0, Math.floor(s));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	function onkey(e: KeyboardEvent) {
		if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
			e.preventDefault();
			toggle();
		}
	}
</script>

<svelte:window onkeydown={onkey} />

<div class="v709" bind:this={stage}>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		{src}
		autoplay
		playsinline
		bind:paused
		bind:currentTime={time}
		bind:duration
		bind:muted
		onloadedmetadata={(e) => {
			const v = e.currentTarget;
			aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : aspect;
			onmeta?.(v.videoWidth, v.videoHeight, v.duration);
		}}
		onseeked={draw}
		onloadeddata={draw}
	></video>
	<div class="room">
		<canvas bind:this={canvas} style:aspect-ratio={aspect} style:width="min(100cqw, {aspect} * 100cqh)" onclick={toggle}></canvas>
	</div>
	{#if failed}<p class="failed">{failed}</p>{/if}
	<div class="bar">
		<button onclick={toggle} aria-label={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
		<span class="t">{clock(time)}</span>
		<input type="range" min="0" max={duration || 0} step="0.01" value={time} oninput={(e) => video && (video.currentTime = Number(e.currentTarget.value))} aria-label="Position" />
		<span class="t">{clock(duration)}</span>
		<button onclick={() => (muted = !muted)} aria-label={muted ? 'Sound on' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
		<button onclick={() => (document.fullscreenElement ? document.exitFullscreen() : stage?.requestFullscreen())} aria-label="Full screen">⤢</button>
	</div>
</div>

<style>
	.v709 {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #000;
	}

	video {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	/* the canvas as large as the room allows at the video's own shape */
	.room {
		display: grid;
		flex: 1;
		place-items: center;
		min-height: 0;
		container-type: size;
	}

	canvas {
		display: block;
		height: auto;
		cursor: pointer;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.8rem;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 0.8rem;
	}

	.bar button {
		padding: 0.15rem 0.5rem;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.bar input {
		flex: 1;
		accent-color: var(--accent);
	}

	.t {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-variant-numeric: tabular-nums;
	}

	.failed {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		margin: 0;
		color: #fff;
		font-size: 0.75rem;
	}
</style>
