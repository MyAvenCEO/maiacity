<!--
	The scopes, from the frame the viewer shows (after the output transform, as a delivery will be): the waveform (luma
	by column), the RGB parade, the vectorscope (Rec.709 chroma), and a false-colour exposure overlay on the picture.
	They read the viewer back a few times a second.
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @type {'wave' | 'parade'} */
	let mode = $state('wave');
	/** @type {HTMLCanvasElement | null} */
	let left = $state(null);
	/** @type {HTMLCanvasElement | null} */
	let right = $state(null);
	/** a signature of the last frame read, so a still frame is not measured again and again */
	let lastSig = '';
	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null;
	const probe = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	/** exposed for tests and the curious: the mean luma of the last frame read (0…1) */
	let mean = $state(0);

	const W = 192, H = 108;

	/** @returns {Uint8ClampedArray | null} */
	function read() {
		const src = s.scopeCanvas ?? s.viewerCanvas;
		if (!src || !probe || !src.width || !src.height) return null;
		probe.width = W;
		probe.height = H;
		const g = probe.getContext('2d', { willReadFrequently: true });
		if (!g) return null;
		try {
			g.drawImage(src, 0, 0, W, H);
			return g.getImageData(0, 0, W, H).data;
		} catch {
			return null;
		}
	}

	/** @param {HTMLCanvasElement} canvas @param {number} w @param {number} h @param {(img: ImageData) => void} draw */
	function plot(canvas, w, h, draw) {
		canvas.width = w;
		canvas.height = h;
		const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
		const img = g.createImageData(w, h);
		for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
		draw(img);
		g.putImageData(img, 0, 0);
		// graticule: 0, 25, 50, 75, 100 %
		g.strokeStyle = 'rgb(255 255 255 / 0.18)';
		g.lineWidth = 1;
		for (const p of [0, 0.25, 0.5, 0.75, 1]) {
			const y = Math.round((1 - p) * (h - 1)) + 0.5;
			g.beginPath();
			g.moveTo(0, y);
			g.lineTo(w, y);
			g.stroke();
		}
	}
	/** @param {ImageData} img @param {number} x @param {number} y @param {[number, number, number]} c */
	const add = (img, x, y, c, k = 38) => {
		const i = (y * img.width + x) * 4;
		img.data[i] = Math.min(255, img.data[i] + c[0] * k);
		img.data[i + 1] = Math.min(255, img.data[i + 1] + c[1] * k);
		img.data[i + 2] = Math.min(255, img.data[i + 2] + c[2] * k);
	};

	function update() {
		if (s.falseColor) return; // the scopes measure the picture, not its false colours: they hold the last frame
		const px = read();
		if (!px || !left || !right) return;
		let sig = 0;
		for (let i = 0; i < px.length; i += 97) sig = (sig * 31 + px[i]) | 0;
		const key = `${sig}:${mode}`;
		if (key === lastSig) return;
		lastSig = key;
		const h = 128;
		let sum = 0;
		if (mode === 'wave') {
			plot(left, W, h, (img) => {
				for (let y = 0; y < H; y++)
					for (let x = 0; x < W; x++) {
						const i = (y * W + x) * 4;
						const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
						sum += l;
						add(img, x, Math.round((1 - l) * (h - 1)), [0.55, 1, 0.6]);
					}
			});
		} else {
			const cw = Math.floor(W / 3);
			plot(left, cw * 3, h, (img) => {
				for (let y = 0; y < H; y++)
					for (let x = 0; x < W; x += 1) {
						const i = (y * W + x) * 4;
						const xx = Math.floor(x / 3);
						sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
						for (let c = 0; c < 3; c++) {
							/** @type {[number, number, number]} */
							const col = c === 0 ? [1, 0.25, 0.2] : c === 1 ? [0.3, 1, 0.35] : [0.3, 0.45, 1];
							add(img, c * cw + xx, Math.round((1 - px[i + c] / 255) * (h - 1)), col, 60);
						}
					}
			});
		}
		mean = sum / (W * H);
		// the vectorscope: Rec.709 chroma (Cb, Cr) of every sample, round the centre
		const n = 128;
		plot(right, n, n, (img) => {
			for (let i = 0; i < px.length; i += 4) {
				const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
				const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
				const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
				const x = Math.round(n / 2 + cb * n * 0.9), yy = Math.round(n / 2 - cr * n * 0.9);
				if (x >= 0 && x < n && yy >= 0 && yy < n) add(img, x, yy, [0.7, 1, 0.75], 30);
			}
		});
		const g = /** @type {CanvasRenderingContext2D} */ (right.getContext('2d'));
		g.strokeStyle = 'rgb(255 255 255 / 0.2)';
		g.beginPath();
		g.arc(n / 2, n / 2, n * 0.45, 0, Math.PI * 2);
		g.moveTo(n / 2, 0);
		g.lineTo(n / 2, n);
		g.moveTo(0, n / 2);
		g.lineTo(n, n / 2);
		g.stroke();
		// skin-tone line (about 123° on a Rec.709 vectorscope)
		g.strokeStyle = 'rgb(243 199 104 / 0.45)';
		g.beginPath();
		g.moveTo(n / 2, n / 2);
		g.lineTo(n / 2 + Math.cos((-123 * Math.PI) / 180) * n * 0.45, n / 2 + Math.sin((-123 * Math.PI) / 180) * n * 0.45);
		g.stroke();
	}

	onMount(() => {
		timer = setInterval(update, 180);
	});
	onDestroy(() => timer && clearInterval(timer));
</script>

<div class="scopes" data-mean={mean.toFixed(4)}>
	<div class="bar">
		<div class="modes" role="tablist">
			<button role="tab" aria-selected={mode === 'wave'} class:on={mode === 'wave'} onclick={() => (mode = 'wave')}>Waveform</button>
			<button role="tab" aria-selected={mode === 'parade'} class:on={mode === 'parade'} onclick={() => (mode = 'parade')}>RGB parade</button>
		</div>
		<label class="fc"><input type="checkbox" bind:checked={s.falseColor} /> False colour</label>
		<span class="mean">mean {Math.round(mean * 100)}%</span>
	</div>
	<div class="plots">
		<canvas class="wave" bind:this={left} aria-label={mode === 'wave' ? 'Waveform' : 'RGB parade'}></canvas>
		<canvas class="vec" bind:this={right} aria-label="Vectorscope"></canvas>
	</div>
	{#if s.falseColor}
		<p class="legend">
			<i style:background="#7319a0"></i>crushed <i style:background="#1a59f2"></i>deep <i style:background="#33bf4d"></i>18% grey <i style:background="#f28cb3"></i>skin <i style:background="#fad926"></i>bright <i style:background="#f21f1a"></i>clipping
		</p>
	{/if}
</div>

<style>
	.scopes {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-height: 0;
		padding: 0.45rem 0.8rem 0.6rem;
		background: var(--panel);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.modes {
		display: flex;
		gap: 0.2rem;
	}

	.modes button {
		padding: 0.12rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.7rem;
		color: var(--dim);
		cursor: pointer;
	}

	.modes button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: #fff;
	}

	.fc {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.mean {
		margin-left: auto;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.66rem;
	}

	.plots {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		min-height: 0;
	}

	canvas {
		width: 100%;
		height: 100%;
		min-height: 0;
		border-radius: 6px;
		background: #111;
		image-rendering: auto;
	}

	.vec {
		width: auto;
		aspect-ratio: 1;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		margin: 0;
		font-size: 0.64rem;
		color: var(--dim);
	}

	.legend i {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-left: 0.3rem;
		border-radius: 2px;
	}
</style>
