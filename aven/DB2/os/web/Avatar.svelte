<script>
	// A vault's mark: its initial on a colour of its own. A network's is square, a device's outlined.
	let { cast, id, size = 24 } = $props();

	const vault = $derived(cast.vaults[id]);
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
		background: oklch(56% 0.13 var(--hue));
		color: #fff;
		font-size: calc(var(--size) * 0.5);
		font-weight: 600;
		line-height: 1;
	}

	.network {
		border-radius: 28%;
	}

	.device {
		background: transparent;
		border: 1.5px solid oklch(56% 0.13 var(--hue));
		color: oklch(56% 0.13 var(--hue));
	}
</style>
