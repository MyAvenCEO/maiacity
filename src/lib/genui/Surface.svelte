<!--
	A declarative view (kind a2ui): the agent's JSON drawn by our own components (Node.svelte), its data model kept
	here, and its logic, if any, run in QuickJS in a sealed worker (logic.js). An event from a button or slider goes to the logic, which
	hands back the new data model; the page is told of each event and error.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import Node from './Node.svelte';
	import { loadLogic } from './logic.js';

	let { view, onevent = () => {}, onerror = () => {} } = $props();
	const byId = $derived(Object.fromEntries(view.spec.components.map((c) => [c.id, c])));
	let data = $state($state.snapshot(view.spec.data ?? {}));
	let logic = null;

	onMount(() => {
		let gone = false;
		loadLogic(view.spec.logic).then(async (l) => {
			if (gone) return l.dispose();
			logic = l;
			const r = await l.init($state.snapshot(data));
			if (gone) return;
			data = r.data;
			if (r.error) onerror(r.error);
		});
		return () => {
			gone = true;
			logic?.dispose();
			logic = null;
		};
	});

	// events go to the logic one after another, each given the data the one before handed back
	let turn = Promise.resolve();
	function send(event) {
		onevent(event);
		if (!logic) return;
		const l = logic;
		turn = turn.then(async () => {
			const r = await l.on(event, $state.snapshot(data));
			if (logic !== l) return;
			data = r.data;
			if (r.error) onerror(r.error);
		});
	}
</script>

<div class="surface"><Node id={view.spec.root} {byId} {data} onevent={send} /></div>

<style>
	.surface {
		padding: 0.2rem 0;
	}
</style>
