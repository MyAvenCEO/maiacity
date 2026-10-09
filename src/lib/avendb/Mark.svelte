<!--
	A vault's mark: its initials on its colour, shaped by its kind, a circle for a person's vault, a hexagon for an aven,
	a rounded square for a coop. The same vault looks the same on every device, its colour drawn from its id.
-->
<script>
	import { hue, initials, nameOf } from './vaults.js';

	/** @type {{ vault: import('./vaults.js').VaultView | undefined, size?: number, dim?: boolean }} */
	let { vault, size = 44, dim = false } = $props();
</script>

<span
	class="mark {vault?.kind ?? 'human'}"
	class:dim
	style="--size: {size}px; --hue: {vault ? hue(vault.id) : 0}"
	role="img"
	aria-label={nameOf(vault)}
>
	{initials(vault)}
</span>

<style>
	.mark {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: hsl(var(--hue) 38% 42%);
		color: #fff;
		font-size: calc(var(--size) * 0.36);
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1;
		user-select: none;
	}

	.mark.coop {
		border-radius: 28%;
	}

	.mark.aven {
		border-radius: 0;
		clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%);
	}

	.mark.dim {
		filter: grayscale(0.85);
		opacity: 0.5;
	}
</style>
