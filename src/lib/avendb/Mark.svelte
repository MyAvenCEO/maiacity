<!--
	A vault's mark: its initials on its colour, shaped by its kind as every profile is ($lib/app/shapes.js), a circle for
	a person's vault, a sun of 12 rays for an aven, a hexagon for a coop, a square for a device vault. The same vault
	looks the same on every device, its colour drawn from its id. With `src`, its profile picture (./picture.js) in that
	shape instead.
-->
<script>
	import { shaped } from '$lib/app/shapes.js';
	import { hue, initials, nameOf } from './vaults.js';

	/** @type {{ vault: import('./vaults.js').VaultView | undefined, size?: number, dim?: boolean, src?: string }} */
	let { vault, size = 44, dim = false, src = '' } = $props();
</script>

<span
	class="mark {vault?.kind ?? 'human'}"
	class:dim
	style="--size: {size}px; --hue: {vault ? hue(vault.id) : 0}; {shaped(vault?.kind)}"
	role="img"
	aria-label={nameOf(vault)}
>
	{#if src}<img {src} alt="" />{:else}{initials(vault)}{/if}
</span>

<style>
	.mark {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: var(--size);
		height: var(--size);
		background: hsl(var(--hue) 38% 42%);
		color: #fff;
		font-size: calc(var(--size) * 0.36);
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1;
		user-select: none;
	}

	.mark img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.mark.aven {
		font-size: calc(var(--size) * 0.3);
	}

	.mark.dim {
		filter: grayscale(0.85);
		opacity: 0.5;
	}
</style>
