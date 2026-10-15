<!-- Game Assets: the machines, actors, worlds, buildings, things, biomes and plants the games are made of, as one list. An admin's. -->
<script>
	import GroupList from '$lib/app/GroupList.svelte';
	import { ASSETS_GROUP } from '$lib/app/places';
</script>

<GroupList group={ASSETS_GROUP} lede="What the games are made of: factories, machines, people and animals, worlds, buildings, still things, biomes and plants." />
