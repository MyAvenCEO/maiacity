<script>
	// A vault's mark: its initial on a colour of its own. An agent's is square, a coop's a hexagon, a device's outlined.
	import { tree, vaultName } from './id.svelte.js';
	let { id, size = 24 } = $props();

	const vault = $derived({ name: vaultName(id), kind: tree.kind(id) });
	const hue = $derived([...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 17));
</script>

<span
	class="avatar {vault.kind}"
	style:--hue={hue}
	style:--size={`${size}px`}
	aria-hidden="true">{vault.name.replace(/^the /i, '')[0]}</span
>

<style>
	.avatar {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: oklch(var(--mark-l) var(--mark-c) var(--hue));
		color: var(--on-accent);
		font-size: calc(var(--size) * 0.5);
		font-family: var(--font-display);
		font-weight: 500;
		line-height: 1;
	}

	.agent {
		border-radius: 28%;
	}

	.coop {
		border-radius: 0;
		clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%);
	}

	.device {
		background: transparent;
		border: 1.5px solid oklch(var(--mark-l) var(--mark-c) var(--hue));
		color: oklch(var(--mark-l) var(--mark-c) var(--hue));
	}
</style>
