<!--
	The agents on this Mac waiting to be adopted, in the Mac app: each an agent's own avenDB device (avendb-device's
	`agent`), which an agent harness such as Claude Code started as its MCP (`avendb-device agent avenCLAUDE`). One
	touch of the person's passkey adopts it: their vault founds the aven vault of its name, or takes the one of that name
	it owns already, and adds the agent's device to it; the vaults ticked give that aven a Suggester share, so that it
	reads them and writes on proposals the person merges. No token: the agent's own key is who it is.
-->
<script>
	import Icon from './Icon.svelte';
	import { nameOf, seeded } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, agents: { name: string, device: string, offer: string }[],
	 *   busy: boolean, onadopt: (name: string, offer: string, vaults: string[]) => void }}
	 */
	let { world, agents, busy, onadopt } = $props();

	/** the vaults an aven of the person's may work on: their own, and the coops their vault owns */
	const ownable = $derived(
		world.vaults.filter((v) => v.kind !== 'aven' && (v.id === world.mine || v.via?.length))
	);
	/** Maia City, where the content lives, ticked first: the seed's coop beside avenCEO GmbH */
	const city = $derived(seeded(world)[3]?.[0]?.id);

	/** @type {Record<string, string[]>} the vaults ticked for each agent, by its name */
	let ticked = $state({});
	const tickedFor = (/** @type {string} */ name) => ticked[name] ?? (city ? [city] : []);
	/** @param {string} name @param {string} vault @param {boolean} on */
	function tick(name, vault, on) {
		const now = tickedFor(name).filter((v) => v !== vault);
		ticked[name] = on ? [...now, vault] : now;
	}
</script>

{#each agents as agent (agent.device)}
	<section class="agent" aria-label="{agent.name} wants to join">
		<header>
			<Icon name="key" size={18} />
			<b>{agent.name} wants to join as your aven on this Mac</b>
		</header>
		<p class="soft">
			An agent on this Mac (Claude Code) started its own avenDB device. Adopting it makes the aven vault
			{agent.name}, which your vault owns, with this device its key: it acts only as {agent.name}, and you can take it
			back any time in Owners &amp; devices. It may read and suggest changes in:
		</p>
		<ul>
			{#each ownable as v (v.id)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={tickedFor(agent.name).includes(v.id)}
							onchange={(e) => tick(agent.name, v.id, e.currentTarget.checked)}
						/>
						{nameOf(v)}
					</label>
				</li>
			{/each}
		</ul>
		<button
			class="btn primary"
			disabled={busy}
			onclick={() => onadopt(agent.name, agent.offer, tickedFor(agent.name))}
		>
			Adopt {agent.name}
		</button>
	</section>
{/each}

<style>
	.agent {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--accent);
		border-radius: 12px;
		background: #fff;
	}

	.agent header {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.agent p {
		margin: 0;
		font-size: 0.86rem;
	}

	.agent ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.86rem;
	}

	.agent button {
		align-self: flex-start;
	}
</style>
