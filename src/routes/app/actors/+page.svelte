<!--
	Actors: the people and animals rigged to move (src/lib/actors), on the shared turntable ($lib/app/ActorsView.svelte).
	The machines are /app/machines/. An admin's.
-->
<script>
	import { FAMILIES } from '$lib/actors';
	import ActorsView from '$lib/app/ActorsView.svelte';
</script>

<ActorsView name="actors" title="Actors" lede="People and animals rigged to move: the stand-in a shot is blocked with, and the animals of the worlds, kind by kind. The machines have their own shelf." families={FAMILIES} />
