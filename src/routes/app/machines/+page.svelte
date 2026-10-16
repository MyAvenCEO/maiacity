<!--
	Machines: everything we build that works by moving parts (src/lib/machines), on the shared turntable
	($lib/assets/AssetViewer.svelte), every part to pick with its card. The people and animals are /app/actors/. An admin's.
-->
<script>
	import { MACHINES } from '$lib/machines';
	import AssetViewer from '$lib/assets/AssetViewer.svelte';
</script>

<AssetViewer name="machines" group="machines" title="Machines" lede="What works by moving parts: diggers, the pod and its forklift, the LifeTrac, the cubes and the BatteryPack, every part its own." items={MACHINES} />
