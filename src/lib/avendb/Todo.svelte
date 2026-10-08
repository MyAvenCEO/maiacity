<!--
	A todo as an app shows it: its title, where it stands, its notes and when it is due; and, where the app may edit it,
	a form for each. The v2 app says open, doing or done; the v1 app only knows done or not.
-->
<script>
	/**
	 * @type {{
	 *   value: any,
	 *   app?: string,
	 *   editable?: boolean,
	 *   onsave?: (value: any) => Promise<boolean>
	 * }}
	 */
	let { value, app = 'v2', editable = false, onsave } = $props();

	let editing = $state(false);
	let saving = $state(false);
	/** @type {any} */
	let draft = $state(null);

	const status = $derived(app === 'v1' ? (value?.done ? 'done' : 'open') : (value?.status ?? 'open'));

	function edit() {
		draft = JSON.parse(JSON.stringify(value ?? {}));
		draft.due ??= '';
		editing = true;
	}

	async function save() {
		if (!onsave) return;
		const next = { ...draft };
		if (!next.due) delete next.due;
		saving = true;
		const ok = await onsave(next);
		saving = false;
		if (ok) editing = false;
	}
</script>

{#if editing && draft}
	<div class="form">
		<label>Title <input class="field" bind:value={draft.title} /></label>
		{#if app === 'v1'}
			<label class="check"><input type="checkbox" bind:checked={draft.done} /> Done</label>
		{:else}
			<label>Status
				<select class="field" bind:value={draft.status}>
					<option value="open">Open</option>
					<option value="doing">Doing</option>
					<option value="done">Done</option>
				</select>
			</label>
		{/if}
		<label>Notes <textarea class="field" rows="4" bind:value={draft.notes}></textarea></label>
		<label>Due <input class="field" type="date" bind:value={draft.due} /></label>
		<div class="row">
			<button class="btn primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</button>
			<button class="btn quiet" onclick={() => (editing = false)}>Cancel</button>
		</div>
	</div>
{:else}
	<article class="todo">
		<p class="title">
			<span class="state {status}">{status === 'done' ? '✓' : status === 'doing' ? '…' : ''}</span>
			<b>{value?.title || 'Untitled'}</b>
			<span class="chip" class:ok={status === 'done'} class:warn={status === 'doing'}>{status}</span>
		</p>
		{#if value?.notes}<p class="notes">{value.notes}</p>{/if}
		{#if value?.due}<p class="soft">Due {value.due}</p>{/if}
	</article>
	{#if editable}<button class="btn" onclick={edit}>Edit</button>{/if}
{/if}

<style>
	.todo {
		max-width: 60ch;
		margin-bottom: 1rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		font-size: 1.1rem;
	}

	.state {
		display: inline-grid;
		place-items: center;
		width: 1.3rem;
		height: 1.3rem;
		border: 1.5px solid rgb(0 0 0 / 0.35);
		border-radius: 6px;
		font-size: 0.8rem;
	}

	.state.done {
		border-color: var(--ok);
		background: var(--ok);
		color: #fff;
	}

	.state.doing {
		border-color: #c99a2e;
		color: #8a6512;
	}

	.notes {
		margin: 0.7rem 0 0.3rem;
		white-space: pre-wrap;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 36rem;
	}

	.form label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.84rem;
		color: var(--soft);
	}

	.form label.check {
		flex-direction: row;
		align-items: center;
		color: inherit;
	}
</style>
