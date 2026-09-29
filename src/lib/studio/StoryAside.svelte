<!--
	The chosen story (or the inbox), essentials only: its series and episode, its title and hook, what it holds, and
	the devices that keep it — each with the classes of this story it keeps (the story's rules) and where it stands.
	Only paired devices sync; a device is revoked here. How an agent connects stays one line at the foot.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listVaultDevices, revokeVaultDevice, type VaultDevice } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { CLASSES, gb, type Network, type StoryView, type VaultStatus } from './vault';

	let { story }: { story: StoryView | null } = $props();

	let net = $state<Network | null>(null);
	let status = $state<VaultStatus | null>(null);
	let devices = $state<VaultDevice[]>([]);
	let mcp = $state<{ url: string; claude: string } | null>(null);
	let autoProxy = $state(false);
	let copied = $state(false);
	let revoking = $state<VaultDevice | null>(null);

	/** the classes of this story a store keeps, by its name in the rules */
	const keeps = (store: string) => (story ? CLASSES.filter((c) => story.rules[c].includes(store)) : []);
	const held = $derived(story ? CLASSES.filter((c) => (story.classes[c]?.[0] ?? 0) > 0) : []);
	const others = $derived(devices.filter((d) => d.endpoint_id !== net?.node && !d.revoked_at));

	async function load() {
		[net, status, devices] = await Promise.all([
			command<Network>('vault_connect').catch(() => null),
			command<VaultStatus>('vault_status').catch(() => null),
			listVaultDevices().catch(() => [])
		]);
		mcp = await command<{ url: string; claude: string }>('mcp_info').catch(() => null);
		autoProxy = (await command<{ auto_proxy: boolean }>('settings_get').catch(() => ({ auto_proxy: false }))).auto_proxy;
	}
	async function revoke() {
		if (!revoking) return;
		await revokeVaultDevice(revoking.endpoint_id);
		revoking = null;
		await load();
	}
	async function setAutoProxy(on: boolean) {
		autoProxy = (await command<{ auto_proxy: boolean }>('settings_set', { key: 'auto_proxy', value: on })).auto_proxy;
	}
	async function copy() {
		if (!mcp) return;
		await navigator.clipboard.writeText(mcp.claude);
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
	onMount(load);
</script>

{#if story}
	<p class="ep">{story.inbox ? 'Inbox' : [story.series, story.episode].filter(Boolean).join(' · ')}</p>
	<h3>{story.title}</h3>
	{#if story.description && !story.inbox}<p class="hook">{story.description}</p>{/if}
	<p class="count">
		{story.files} files · {gb(story.bytes)}{#each held as c (c)}<span> · {story.classes[c][0]} {c}</span>{/each}
	</p>
{/if}

<h4>Devices</h4>
<ul class="devices">
	<li>
		<span class="dot" class:on={!!status}></span>
		<div>
			<strong>avenSSD</strong> <small>this Mac</small>
			<p>{keeps('avenSSD').join(' · ') || 'nothing of this story'}</p>
			{#if status}<p class="dim">{status.files} files · {gb(status.disk_free)} free</p>{/if}
		</div>
	</li>
	<li>
		<span class="dot" class:on={!!net?.joined}></span>
		<div>
			<strong>hetzner</strong> <small>Object Storage</small>
			<p>{keeps('hetzner').join(' · ') || 'nothing of this story'}</p>
			<p class="dim">{net?.joined ? 'joined' : (net?.note ?? 'not joined yet')}</p>
		</div>
	</li>
	{#each others as d (d.endpoint_id)}
		<li>
			<span class="dot"></span>
			<div>
				<strong>{d.label || d.endpoint_id.slice(0, 10)}</strong>
				<p>{keeps(d.label).join(' · ') || 'nothing of this story'}</p>
				<button class="link" onclick={() => (revoking = d)}>revoke</button>
			</div>
		</li>
	{/each}
</ul>
{#if revoking}
	<p class="confirm">Revoke {revoking.label || revoking.endpoint_id.slice(0, 10)}? It stops syncing at once. <button onclick={revoke}>Revoke</button> <button class="link" onclick={() => (revoking = null)}>Cancel</button></p>
{/if}

<div class="foot">
	<label><input type="checkbox" checked={autoProxy} onchange={(e) => setAutoProxy(e.currentTarget.checked)} /> Proxies by themselves after ingest</label>
	{#if mcp}<button class="link" onclick={copy} title={mcp.claude}>{copied ? 'copied' : 'Copy the agents’ MCP command'}</button>{/if}
</div>

<style>
	.ep { margin: 0; font-family: ui-monospace, monospace; font-size: 0.7rem; letter-spacing: 0.02em; color: var(--dim); }
	h3 { margin: 0.2rem 0 0.4rem; font-size: 1.2rem; }
	.hook { margin: 0 0 0.5rem; font-size: 0.86rem; line-height: 1.4; }
	.count { margin: 0; font-size: 0.76rem; color: var(--dim); }
	h4 { margin: 1.6rem 0 0.6rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	.devices { display: flex; flex-direction: column; gap: 0.8rem; margin: 0; padding: 0; list-style: none; }
	.devices li { display: grid; grid-template-columns: 0.6rem 1fr; gap: 0.6rem; align-items: start; }
	.dot { width: 0.5rem; height: 0.5rem; margin-top: 0.35rem; border-radius: 50%; background: var(--edge); }
	.dot.on { background: #6f9a57; }
	strong { font-size: 0.86rem; }
	small { font-size: 0.72rem; color: var(--dim); }
	.devices p { margin: 0.1rem 0 0; font-size: 0.76rem; }
	.dim { color: var(--dim); }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.74rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.confirm { font-size: 0.78rem; color: #7a5a14; }
	.confirm button:not(.link) { padding: 0.1rem 0.6rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.74rem; color: #fff; cursor: pointer; }
	.foot { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 1.8rem; padding-top: 0.8rem; border-top: 1px solid var(--edge); font-size: 0.76rem; color: var(--dim); }
	.foot label { display: flex; align-items: center; gap: 0.4rem; }
	.foot .link { align-self: flex-start; }
</style>
