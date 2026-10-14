<!--
	Machines: everything we build that works by moving parts (src/lib/machines), on the shared turntable
	($lib/app/ActorsView.svelte), every part to pick with its card. The people and animals are /app/actors/. An admin's.
-->
<script>
	import { MACHINES } from '$lib/machines';
	import ActorsView from '$lib/app/ActorsView.svelte';
</script>

<ActorsView name="machines" title="Machines" lede="What works by moving parts: diggers, the pod and its forklift, the LifeTrac, the cubes and the BatteryPack, every part its own." families={MACHINES} />
