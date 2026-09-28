<!-- Inspire me moved into the blog: an old address goes on to /blog/inspire-me/…, its query kept. -->
<script lang="ts">
	import { page } from '$app/state';
	import Moved from '$lib/app/Moved.svelte';
</script>

<Moved to="/blog/inspire-me/{page.params.rest?.replace(/\/+$/, '') ? `${page.params.rest.replace(/\/+$/, '')}/` : ''}" />
