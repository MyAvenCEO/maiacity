<!--
	Actors: the people and animals rigged to move (src/lib/actors), in the one asset viewer
	($lib/assets/AssetViewer.svelte), each built in the asset box and its moves played there. The machines are
	/app/machines/. An admin's.
-->
<script>
	import { FAMILIES } from '$lib/actors';
	import AssetViewer from '$lib/assets/AssetViewer.svelte';
</script>

<AssetViewer name="actors" group="actors" title="Actors" lede="People and animals rigged to move: the stand-in a shot is blocked with, and the animals of the worlds, kind by kind. The machines have their own shelf." items={FAMILIES} />
