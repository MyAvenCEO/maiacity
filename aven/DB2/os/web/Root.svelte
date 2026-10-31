<script>
	// avenOS's root: #/docs is the docs (docs/Docs.svelte) on every host, signed in or not, before any vault's route;
	// every other address is the host's own view, App or Network, as main.js chose it
	import Docs from './docs/Docs.svelte';

	let { view, props } = $props();

	const read = () => /^#\/?docs(\/|$)/.test(location.hash);
	let docs = $state(read());
	$effect(() => {
		const follow = () => (docs = read());
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});
	const View = $derived(view);
</script>

{#if docs}
	<Docs />
{:else}
	<View {...props} />
{/if}
