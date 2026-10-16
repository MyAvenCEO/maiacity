<!--
	Plants: every plant grown from code (src/lib/plants), from its seed to the plant in fruit, in the one asset viewer
	($lib/assets/AssetViewer.svelte), each grown in the asset box: its ten stages to tab through across the top (the last
	four the fruit's own, set to ripe), the whole plant or one of its fruit on its own (the seed picks which, and gives it
	its own small differences), in its earth with the near side cut away so the roots show as plainly as the shoot. Each
	plant grows from a seed id: the same id the same plant every time, New seed a sister plant. An admin's.
-->
<script>
	import { LAYERS, PLANTS } from '$lib/plants';
	import AssetViewer from '$lib/assets/AssetViewer.svelte';
</script>

<AssetViewer
	name="plants"
	group="plants"
	title="Plants"
	lede="Grown from code, seed to fruit, roots and all, in the seven layers of a food forest: tab through the ten stages, change the seed id for a sister plant."
	items={PLANTS}
	heading={(p) => LAYERS.find((l) => l.id === p.layer)?.label ?? ''}
	soil
/>
