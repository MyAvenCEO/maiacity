<!--
	Devices & storage — who may sync, and where the copies live. Only devices the admin approved with the passkey are
	in the vault's network (the server peer, its relay and every Mac enforce the same list); revoking one cuts it off.
	The server keeps every file in Object Storage; this Mac keeps its copy where its vault lives.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listVaultDevices, revokeVaultDevice, type VaultDevice } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { gb, type Network, type VaultStatus } from './vault';

	let net = $state<Network | null>(null);
	let status = $state<VaultStatus | null>(null);
	let devices = $state<VaultDevice[]>([]);
	let error = $state('');
	let busy = $state(false);
	let mcp = $state<{ url: string; claude: string } | null>(null);
	let copied = $state(false);

	async function load() {
		busy = true;
		error = '';
		try {
			[net, status, devices] = await Promise.all([
				command<Network>('vault_connect'),
				command<VaultStatus>('vault_status'),
				listVaultDevices()
			]);
			mcp = await command<{ url: string; claude: string }>('mcp_info').catch(() => null);
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
		} finally {
			busy = false;
		}
	}

	async function revoke(d: VaultDevice) {
		if (!confirm(`Revoke "${d.label || d.endpoint_id.slice(0, 10)}"? It stops syncing at once.`)) return;
		await revokeVaultDevice(d.endpoint_id);
		await load();
	}

	// the vault on another drive (the external SSD): it fills itself there from the network, hash-checked
	async function move() {
		const { open } = await import('@tauri-apps/plugin-dialog');
		const where = await open({ directory: true, title: 'Where should this Mac keep its vault?' });
		if (!where || Array.isArray(where)) return;
		if (!confirm(`Keep the vault in "${where}/maiaCITY Vault" from now on? The app restarts; the new place fills itself from the network, and the old one stays until you remove it.`)) return;
		await command('vault_set_location', { path: where });
	}

	onMount(load);
	const since = (t: string | null) => (t ? new Date(t).toLocaleString() : '—');
</script>

<section class="devices" aria-label="Devices and storage">
	<h2>Devices & storage <button class="link" onclick={load} disabled={busy}>{busy ? '…' : 'refresh'}</button></h2>
	{#if error}<p class="err">{error}</p>{/if}
	<div class="copies">
		<div class="place">
			<strong>This Mac</strong>
			{#if status}
				<span>{status.dir}</span>
				<small>{status.files} files · {gb(status.bytes)} · {gb(status.disk_free)} free</small>
			{/if}
			<button class="link" onclick={move}>Keep the vault on another drive…</button>
		</div>
		<div class="place">
			<strong>Server · Object Storage</strong>
			<span>Hetzner, bucket maiacity (LIBRARY/)</span>
			<small>{net?.joined ? `joined · node ${net.server?.slice(0, 10)}…` : (net?.note ?? 'not joined yet')}</small>
		</div>
	</div>
	<h3>Paired devices — only these sync</h3>
	<ul>
		{#each devices as d (d.endpoint_id)}
			<li class:revoked={!!d.revoked_at} class:me={d.endpoint_id === net?.node}>
				<span class="label">{d.label || 'a device'}{d.endpoint_id === net?.node ? ' (this Mac)' : ''}</span>
				<code>{d.endpoint_id.slice(0, 16)}…</code>
				<small>paired {since(d.created)} · {d.revoked_at ? `revoked ${since(d.revoked_at)}` : `seen ${since(d.seen)}`}</small>
				{#if !d.revoked_at}<button class="link" onclick={() => revoke(d)}>Revoke</button>{/if}
			</li>
		{:else}
			<li class="quiet">No device paired yet.</li>
		{/each}
	</ul>
	<p class="quiet">A new device is paired by signing it in with the admin's passkey.</p>

	<h3>Agents (MCP) — the whole studio for Claude Code or any agent</h3>
	{#if mcp}
		<p class="quiet">On this Mac only, at {mcp.url}. Connect Claude Code with:</p>
		<pre class="cmd">{mcp.claude}</pre>
		<button class="link" onclick={() => navigator.clipboard.writeText(mcp!.claude).then(() => (copied = true))}>{copied ? 'Copied' : 'Copy the command'}</button>
	{:else}
		<p class="quiet">Starts with the app once it is signed in.</p>
	{/if}
</section>

<style>
	.devices { padding: 1rem 1.2rem; }
	h2 { display: flex; gap: 0.6rem; align-items: baseline; margin: 0 0 0.8rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	h3 { margin: 1rem 0 0.5rem; font-size: 0.78rem; font-weight: 600; }
	.copies { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
	.place { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.75rem; border: 1px solid var(--edge); border-radius: 10px; background: #fff; }
	.place span { overflow: hidden; font-size: 0.75rem; white-space: nowrap; text-overflow: ellipsis; }
	small, .quiet { font-size: 0.72rem; color: var(--dim); }
	ul { margin: 0; padding: 0; list-style: none; }
	li { display: grid; grid-template-columns: 1fr auto; gap: 0.1rem 0.6rem; padding: 0.45rem 0; border-bottom: 1px solid var(--edge); font-size: 0.8rem; }
	li code { font-size: 0.7rem; color: var(--dim); }
	li small { grid-column: 1; }
	li.revoked { opacity: 0.5; }
	li.me .label { font-weight: 600; }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.75rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.err { color: #9c3b26; }
	.cmd { overflow-x: auto; margin: 0.3rem 0; padding: 0.5rem 0.6rem; border-radius: 8px; background: #fff; font-size: 0.7rem; white-space: pre-wrap; word-break: break-all; }
</style>
