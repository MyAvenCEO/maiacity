<!-- Game Assets: the models, buildings, actors, plants, biomes and worlds the games are made of, as one list. An admin's. -->
<script>
	import GroupList from '$lib/app/GroupList.svelte';
	import { ASSETS_GROUP } from '$lib/app/places';
</script>

<GroupList group={ASSETS_GROUP} lede="What the games are made of: still models, buildings, actors that move, plants, biomes and worlds." />
