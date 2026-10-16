<!--
	Things: every reusable still model the worlds are built from (src/lib/models), in the one asset viewer
	($lib/assets/AssetViewer.svelte), each built in the asset box; the address kept from when they were the Models. The
	buildings (the domes, the containers) are /app/buildings/, what moves by its parts /app/machines/, people and animals
	/app/actors/. An admin's.
-->
<script>
	import { MODELS } from '$lib/models';
	import AssetViewer from '$lib/assets/AssetViewer.svelte';
</script>

<AssetViewer name="models" group="things" title="Things" lede="The still things the worlds are built from, each to its real measure. What moves by its parts is a machine; people and animals are actors." items={MODELS} />
