<!--
	Share one entry, a note or a todo, on: with another vault this browser knows, which then reads, writes or owns it,
	or with everyone, who may only read. Making a vault an owner needs the acting vault's owners' passkey; the rest none.
-->
<script>
	import { nameOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, space: string,
	 *   entry: string, ondone: () => void }}
	 */
	let { world, actor, api, busy, space, entry, ondone } = $props();

	/** the vaults the acting vault may share with: every other vault this browser knows */
	const others = $derived(world.vaults.filter((v) => v.id !== actor));
	let grantee = $state('');
	let role = $state('read');
	const to = $derived(grantee || others[0]?.id || 'public');

	async function give() {
		if (await api.grant(actor, space, entry, to === 'public' ? 'read' : role, to)) ondone();
	}
</script>

<div class="share">
	<select class="field" value={to} onchange={(e) => (grantee = e.currentTarget.value)} aria-label="Share with">
		{#each others as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
		<option value="public">Everyone (public)</option>
	</select>
	{#if to !== 'public'}
		<select class="field" bind:value={role} aria-label="Role">
			<option value="read">reads</option>
			<option value="write">writes</option>
			<option value="owner">owns (your passkey approves)</option>
		</select>
	{/if}
	<button class="btn primary" disabled={busy} onclick={give}>Share it</button>
</div>

<style>
	.share {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
</style>
