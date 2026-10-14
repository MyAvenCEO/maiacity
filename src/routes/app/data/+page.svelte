<!-- My Data: the studio's films, the avenDB vaults, the crew's skills and the generated mini apps, the stories, the journal and Inspire me, as one list. -->
<script>
	import GroupList from '$lib/app/GroupList.svelte';
	import { DATA_GROUP } from '$lib/app/places';
</script>

<GroupList group={DATA_GROUP} lede="Your films, vaults, skills and mini apps, your stories, the journal and what inspires us." />
