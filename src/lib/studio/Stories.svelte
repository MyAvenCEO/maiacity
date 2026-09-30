<!--
	Stories — the buckets everything of one story lives in (originals, proxies, sound, stills, metadata, deliveries), and
	the inbox for what belongs to none yet. Pick the one a batch goes into; make a new one, or change one: a title of at
	most five words, the full hook as its description, its series and episode. Each class of its files is kept in its
	destinations (for now every class: this Mac's avenSSD and the server's Object Storage). Only the admin's app writes.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { command } from '$lib/native';
	import { CLASSES, className, gb, tiersOf, type Story, type StoryView } from './vault';

	let { chosen = $bindable(null), list = $bindable([]) }: { chosen?: string | null; list?: StoryView[] } = $props();

	let stories = $state<StoryView[]>([]);
	$effect(() => void (list = stories));
	let editing = $state<Story | null>(null);
	let error = $state('');

	export async function load() {
		try {
			stories = await command<StoryView[]>('stories_list');
			if (!chosen || !stories.some((s) => s.id === chosen)) chosen = stories.find((s) => s.inbox)?.id ?? null;
		} catch (e) {
			error = String(e);
		}
	}

	const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
	const blank = (): Story => ({
		id: '',
		title: '',
		description: '',
		series: stories.find((s) => s.series)?.series ?? 'The Journey of Maia City',
		episode: '',
		rules: { default: ['avenSSD', 'hetzner'], original: ['avenSSD', 'hetzner'], proxy: ['avenSSD', 'hetzner'], delivery: ['avenSSD', 'hetzner'] },
		created: ''
	});

	/** removing a story waits for the admin to confirm it; only an empty one, never the inbox */
	let removing = $state<StoryView | null>(null);
	async function remove() {
		if (!removing) return;
		error = '';
		try {
			await command('story_delete', { id: removing.id });
			removing = null;
			await load();
		} catch (e) {
			error = String(e);
		}
	}

	async function save() {
		if (!editing) return;
		error = '';
		try {
			const saved = await command<Story>('story_save', { story: editing });
			editing = null;
			await load();
			chosen = saved.id;
		} catch (e) {
			error = String(e);
		}
	}

	onMount(load);
</script>

<div class="stories">
	<div class="head">
		<h2>Stories</h2>
		<button class="link" onclick={() => (editing = blank())}>+ New story</button>
	</div>
	<ul>
		{#each stories as s (s.id)}
			<li class:on={chosen === s.id} class:inbox={s.inbox}>
				<button class="pick" onclick={() => (chosen = s.id)}>
					<span class="ep">{s.inbox ? 'INBOX' : s.episode || '—'}</span>
					<span class="t">{s.title}</span>
					<small>{s.files} files · {gb(s.bytes)}</small>
				</button>
				{#if !s.inbox}
					<button class="link edit" onclick={() => (editing = { ...s, rules: { ...s.rules } })}>edit</button>
					{#if s.files === 0}<button class="link edit" onclick={() => (removing = s)}>delete</button>{/if}
				{/if}
			</li>
		{/each}
	</ul>

	{#if removing}
		<p class="confirm">
			Delete the empty story “{removing.title}” ({removing.episode || 'no episode'})?
			<button class="primary" onclick={remove}>Delete</button>
			<button class="link" onclick={() => (removing = null)}>Cancel</button>
		</p>
	{/if}

	{#if editing}
		<form class="editor" onsubmit={(e) => (e.preventDefault(), save())}>
			<label>Title <span class:bad={words(editing.title) > 5}>{words(editing.title)}/5 words</span>
				<input bind:value={editing.title} placeholder="The 1 Million Lives Decision" />
			</label>
			<label>Description · the full hook
				<textarea bind:value={editing.description} rows="3"></textarea>
			</label>
			<div class="two">
				<label>Series <input bind:value={editing.series} /></label>
				<label>Episode <input bind:value={editing.episode} placeholder="DAY 0001" /></label>
			</div>
			<div class="rules">
				{#each CLASSES as c (c)}
					<span><b>{className(c, 2)}</b> {tiersOf(editing.rules[c]).join(' + ')}</span>
				{/each}
			</div>
			<div class="actions">
				<button class="primary" disabled={!editing.title.trim() || words(editing.title) > 5}>{editing.id ? 'Save' : 'Create story'}</button>
				<button type="button" class="link" onclick={() => (editing = null)}>Cancel</button>
			</div>
		</form>
	{/if}
	{#if error}<p class="err">{error}</p>{/if}


</div>

<style>
	.head { display: flex; align-items: baseline; justify-content: space-between; }
	h2 { margin: 0 0 0.6rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	ul { display: flex; flex-direction: column; gap: 0.3rem; margin: 0 0 0.6rem; padding: 0; list-style: none; }
	li { display: flex; align-items: center; gap: 0.4rem; border: 1px solid var(--edge); border-radius: 10px; background: var(--raised); }
	li.on { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
	li.inbox .ep { color: var(--accent); }
	.pick { display: grid; grid-template-columns: auto 1fr; gap: 0 0.5rem; flex: 1; padding: 0.5rem 0.7rem; border: 0; background: none; font: inherit; text-align: left; color: var(--ink); cursor: pointer; }
	.ep { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--dim); align-self: center; }
	.t { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.86rem; }
	.pick small { grid-column: 2; font-size: 0.72rem; color: var(--dim); }
	.edit { margin-right: 0.6rem; font-size: 0.74rem; }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.78rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.editor { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.8rem; padding: 0.7rem; border: 1px solid var(--edge); border-radius: 10px; background: var(--bg); }
	label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.74rem; color: var(--dim); }
	label span { align-self: flex-end; margin-top: -1rem; font-size: 0.7rem; }
	label span.bad { color: var(--bad); }
	input, textarea { padding: 0.4rem 0.55rem; border: 1px solid var(--edge); border-radius: 8px; background: var(--raised); font: inherit; font-size: 0.84rem; color: var(--ink); resize: vertical; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
	.rules { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.72rem; color: var(--dim); }
	.rules b { display: inline-block; width: 4.3rem; font-weight: 600; color: var(--ink); }
	.actions { display: flex; align-items: center; gap: 0.8rem; }
	.primary { padding: 0.4rem 1rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.82rem; color: var(--on-ink); cursor: pointer; }
	.primary:disabled { opacity: 0.5; cursor: default; }
	.err { color: var(--bad); font-size: 0.8rem; }
	.confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0 0 0.8rem; font-size: 0.8rem; color: var(--warn); }
</style>
