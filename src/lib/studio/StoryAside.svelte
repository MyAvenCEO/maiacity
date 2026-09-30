<!--
	The chosen story (or the inbox), essentials only: its series and episode, its title and hook, what it holds, and
	the devices that keep it — each with the classes of this story it keeps (the story's rules) and where it stands.
	Only paired devices sync; a device is revoked here. How an agent connects stays one line at the foot.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { listMedia, listVaultDevices, revokeVaultDevice, type MediaItem, type VaultDevice } from '$lib/auth/client';
	import { command } from '$lib/native';
	import { CLASSES, TIERS, gb, type Copies, type Moving, type Network, type StoryView, type VaultStatus } from './vault';

	let { story }: { story: StoryView | null } = $props();

	let net = $state<Network | null>(null);
	let status = $state<VaultStatus | null>(null);
	let devices = $state<VaultDevice[]>([]);
	let mcp = $state<{ url: string; claude: string } | null>(null);
	let copied = $state(false);
	let revoking = $state<VaultDevice | null>(null);
	let files = $state<MediaItem[]>([]);
	let copies = $state<Record<string, Copies>>({});
	let moving = $state<Moving[]>([]);

	/** the story's files: those whose one story it is (the inbox: those that name none) */
	const mine = $derived(story ? files.filter((m) => (story.inbox ? !m.story : m.story === story.id)) : []);
	/** how far the story is at one destination: verified files and bytes, what is on its way, how fast */
	function sync(dest: 'avenSSD' | 'hetzner') {
		const wanted = mine.filter((m) => story?.rules[(m.class ?? 'default') as keyof StoryView['rules']]?.includes(dest));
		let ok = 0, okBytes = 0, sent = 0, rate = 0, going = 0;
		for (const m of wanted) {
			const c = copies[m.hash];
			if (dest === 'avenSSD' ? c?.here === 'verified' : c?.server === 'stored') (ok++, (okBytes += m.size));
			else {
				const t = moving.find((x) => x.hash === m.hash && x.dest === dest && !x.done && !x.aborted);
				if (t) (going++, (sent += t.sent), (rate += t.rate));
			}
		}
		const bytes = wanted.reduce((a, m) => a + m.size, 0);
		return { ok, total: wanted.length, pct: bytes ? Math.min(100, ((okBytes + sent) / bytes) * 100) : 100, going, rate };
	}

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
	}
	async function revoke() {
		if (!revoking) return;
		await revokeVaultDevice(revoking.endpoint_id);
		revoking = null;
		await load();
	}
	async function copy() {
		if (!mcp) return;
		await navigator.clipboard.writeText(mcp.claude);
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
	onMount(() => {
		void load();
		const readFiles = async () => {
			files = await listMedia().catch(() => files);
			copies = Object.fromEntries((await command<Copies[]>('vault_copies').catch(() => [])).map((c) => [c.hash, c]));
		};
		void readFiles();
		const slow = setInterval(readFiles, 10000);
		const live = setInterval(async () => (moving = await command<Moving[]>('vault_transfers').catch(() => [])), 1500);
		return () => (clearInterval(slow), clearInterval(live));
	});
</script>

{#if story}
	<p class="ep">{story.inbox ? 'Inbox' : [story.series, story.episode].filter(Boolean).join(' · ')}</p>
	<h3>{story.title}</h3>
	{#if story.description && !story.inbox}<p class="hook">{story.description}</p>{/if}
	<p class="count">
		{story.files} files · {gb(story.bytes)}{#each held as c (c)}<span> · {story.classes[c][0]} {c}</span>{/each}
	</p>
{/if}



<h4>Masters</h4>
<ul class="masters">
	{#each TIERS as t (t.tier)}
		{@const x = t.store ? sync(t.store) : null}
		<li class:off={!t.store}>
			<span class="tier" class:on={!!x && x.ok === x.total}>{t.tier}</span>
			<span class="who"><strong>{t.name}</strong> <small>{t.where}</small></span>
			{#if x}
				<span class="pct">{Math.floor(x.pct)}%</span>
				<span class="bar" class:done={x.ok === x.total}><i style:width="{x.pct}%"></i></span>
				{#if x.ok < x.total}<span class="n">{x.ok}/{x.total}{#if x.going} · ↻ {x.going} · {gb(x.rate)}/s{/if}</span>{/if}
			{/if}
		</li>
	{/each}
</ul>

{#if others.length}
	<h4>Other devices</h4>
	<ul class="devices">
		{#each others as d (d.endpoint_id)}
			<li>
				<span class="dot"></span>
				<div>
					<strong>{d.label || d.endpoint_id.slice(0, 10)}</strong>
					<button class="link" onclick={() => (revoking = d)}>revoke</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{#if revoking}
	<p class="confirm">Revoke {revoking.label || revoking.endpoint_id.slice(0, 10)}? It stops syncing at once. <button onclick={revoke}>Revoke</button> <button class="link" onclick={() => (revoking = null)}>Cancel</button></p>
{/if}

<div class="foot">
	{#if mcp}<button class="link" onclick={copy} title={mcp.claude}>{copied ? 'copied' : 'Copy the agents’ MCP command'}</button>{/if}
</div>

<style>
	.ep { margin: 0; font-family: ui-monospace, monospace; font-size: 0.7rem; letter-spacing: 0.02em; color: var(--dim); }
	h3 { margin: 0.2rem 0 0.4rem; font-size: 1.2rem; }
	.hook { margin: 0 0 0.5rem; font-size: 0.86rem; line-height: 1.4; }
	.count { margin: 0; font-size: 0.76rem; color: var(--dim); }
	h4 { margin: 1.6rem 0 0.6rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	.devices { display: flex; flex-direction: column; gap: 0.8rem; margin: 0; padding: 0; list-style: none; }
	.devices li { display: grid; grid-template-columns: 1.3rem 1fr; gap: 0.6rem; align-items: start; }
	.masters { display: flex; flex-direction: column; gap: 0.7rem; margin: 0; padding: 0; list-style: none; }
	.masters li { display: grid; grid-template-columns: 1.3rem 1fr auto; gap: 0.15rem 0.6rem; align-items: center; }
	.masters li.off { opacity: 0.4; }
	.who { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.84rem; }
	.masters .pct { font-size: 0.74rem; font-variant-numeric: tabular-nums; color: var(--dim); }
	.masters .bar { grid-column: 2 / -1; overflow: hidden; height: 4px; border-radius: 2px; background: var(--edge); }
	.masters .bar i { display: block; height: 100%; background: var(--accent); transition: width 1s linear; }
	.masters .bar.done i { background: var(--ok); }
	.masters .n { grid-column: 2 / -1; font-size: 0.72rem; color: var(--dim); }
	.tier { display: grid; place-items: center; width: 1.3rem; height: 1.3rem; margin-top: 0.05rem; border-radius: 50%; background: var(--edge); font-size: 0.68rem; font-weight: 700; color: var(--dim); }
	.tier.on { background: var(--ok); color: var(--on-ink); }
	.dot { width: 0.5rem; height: 0.5rem; margin-top: 0.35rem; border-radius: 50%; background: var(--edge); }
	strong { font-size: 0.86rem; }
	small { font-size: 0.72rem; color: var(--dim); }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.74rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.confirm { font-size: 0.78rem; color: var(--warn); }
	.confirm button:not(.link) { padding: 0.1rem 0.6rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.74rem; color: var(--on-ink); cursor: pointer; }
	.foot { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 1.8rem; padding-top: 0.8rem; border-top: 1px solid var(--edge); font-size: 0.76rem; color: var(--dim); }
	.foot .link { align-self: flex-start; }
</style>
