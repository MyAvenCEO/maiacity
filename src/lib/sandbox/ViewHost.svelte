<!--
	THE VIEW HOST — every view on our pages, whoever made it (an agent over the MCP, a MIP's screen, a game's panel), shown
	the one way, merged or only proposed: there is no Run button and no trust to judge, because nothing a view brings can
	reach us.
	- The frame: sandbox="allow-scripts" without allow-same-origin (an opaque origin: no cookie, storage, OPFS, passkey
	  or page of ours), every device feature off (./policy.js), and a policy that lets in no connection and no script
	  but our engine's (by a nonce) and the blob: URLs it makes.
	- Its first document holds nothing of the view's: one script takes our view engine (./view/engine.js, frozen, its
	  bytes checked here against their BLAKE3 hash) and a MessageChannel port from this page, and starts it. From then
	  on only that engine writes the frame's DOM, from the view's HTML made safe (./view/sanitize.js). The engine is the
	  version the view names (its `engine`), never one below the floor (./engines.js `engineFor`).
	- A view's own script never runs in a window: the engine starts it in a worker inside the frame (./view/worker.js),
	  on a copy of the DOM, with its libraries (three, d3, the MCP Apps SDK) from frozen files of ours. No CDN.
	- Logic that decides (a view's `logic`) runs in QuickJS in the logic host (./view-logic.js); the frame only
	  shows the state it makes and names the events a person makes.
	- What comes back is plain data: events by name, a height, and MCP Apps JSON-RPC, of which only METHODS are answered
	  (game/code/views.js). A load we did not cause stops the view.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { LIMITS, METHODS, PROTOCOL } from '../../../game/code/views.js';
	import { loadLogic } from './view-logic.js';
	import { MCP_STYLES } from './view/theme.js';
	import { BUDGETS, DENY, SANDBOX } from './policy.js';
	import { bootDoc, engineCode, hasScript, viewOf, workerOf } from './view-host.js';
	import { engineFor } from './engines.js';

	// `data`, when given, is the view's input as it moves on (a game's state): drawn again whenever it changes
	let { view, data = undefined, onevent = () => {}, onerror = () => {} } = $props();
	const v = $derived(viewOf(view));
	const scripted = $derived(hasScript(v.html));
	// the view engine it runs on: the one it names, never below the floor; none, for one that names an engine not frozen
	const engine = $derived(engineFor('view', v.engine));

	let frame = $state();
	let stopped = $state('');
	let height = $state(0);
	const key = crypto.randomUUID();
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const doc = bootDoc(key, nonce);
	let port = null;
	let booted = false;
	let ready = false; // the view's script finished the MCP Apps handshake
	let logic = null;
	let shown = {};
	const send = (m) => port?.postMessage(m);
	const rpc = (m) => send({ op: 'rpc', msg: { jsonrpc: '2.0', ...m } });
	const plain = (x) => JSON.parse(JSON.stringify(x ?? null));

	/** the state the view shows: its input, or what its logic made of it */
	async function show(input) {
		if (logic) {
			const r = await logic.init(input);
			if (r.error) onerror(r.error);
			shown = r.data;
		} else shown = input;
		send({ op: 'state', state: plain(shown) });
		if (ready) rpc({ method: 'ui/notifications/tool-result', params: { content: [], structuredContent: plain(shown) } });
	}
	const input = () => plain(data === undefined ? v.data : $state.snapshot(data));
	// the data as last shown: the same data handed again (a page copies its state every few hundred ms) is not
	// shown again, so a view's logic keeps what it made of it until the data moves on
	let sent = '';
	$effect(() => {
		const d = data === undefined ? undefined : $state.snapshot(data);
		if (!booted || d === undefined) return;
		const json = JSON.stringify(d ?? null);
		if (json === sent) return;
		sent = json;
		show(JSON.parse(json));
	});

	async function event(e) {
		onevent(e);
		if (!logic) return;
		const r = await logic.on(e, plain(shown));
		if (r.error) onerror(r.error);
		shown = r.data;
		send({ op: 'state', state: plain(shown) });
		if (ready) rpc({ method: 'ui/notifications/tool-result', params: { content: [], structuredContent: plain(shown) } });
	}

	/** the host's answer to ui/initialize: only what a view needs to draw, nothing about the person or the device */
	const welcome = () => ({
		protocolVersion: PROTOCOL,
		hostInfo: { name: 'maiaCITY', version: '1.0.0' },
		hostCapabilities: { logging: {}, sandbox: { permissions: {}, csp: { connectDomains: [], resourceDomains: [] } } },
		hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'], containerDimensions: { width: frame?.clientWidth ?? 800, maxHeight: LIMITS.height[1] }, styles: { variables: { ...MCP_STYLES } } }
	});

	/** a JSON-RPC message from the view's script: only the METHODS we answer, small plain data */
	function take(m) {
		if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return;
		const answer = (id, result) => id != null && rpc({ id, result });
		const refuse = (id, code, message) => id != null && rpc({ id, error: { code, message } });
		if (JSON.stringify(m).length > BUDGETS.message) return refuse(m.id, -32600, 'Message too big.');
		if (!METHODS.includes(m.method)) return refuse(m.id, -32601, `${m.method.slice(0, 60)} is not available to a view.`);
		const p = m.params && typeof m.params === 'object' ? m.params : {};
		switch (m.method) {
			case 'ui/initialize':
				return answer(m.id, welcome());
			case 'ui/notifications/initialized':
				// the view's tool input and result: what its maker handed it and the state, nothing of ours
				ready = true;
				rpc({ method: 'ui/notifications/tool-input', params: { arguments: plain(v.input ?? {}) } });
				rpc({ method: 'ui/notifications/tool-result', params: { content: [], structuredContent: plain(shown) } });
				return;
			case 'ui/notifications/size-changed':
				if (Number.isFinite(p.height)) height = Math.round(Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], p.height)));
				return;
			case 'notifications/message':
				if (p.level === 'error') onerror(String(typeof p.data === 'string' ? p.data : JSON.stringify(p.data)).slice(0, 300));
				else onevent({ name: 'log', value: plain(p.data) });
				return;
			case 'ui/update-model-context':
				event({ name: 'context', value: plain(p.structuredContent ?? p.content) });
				return answer(m.id, {});
			case 'ui/message':
				onevent({ name: 'message', value: plain(p.content) });
				return answer(m.id, {});
			case 'ui/request-display-mode':
				return answer(m.id, { mode: 'inline' });
			case 'ping':
				return answer(m.id, {});
		}
	}

	function fromEngine(e) {
		const m = e.data;
		if (!m || typeof m !== 'object') return;
		switch (m.op) {
			case 'ready':
				return start();
			case 'event':
				if (typeof m.name === 'string') event({ name: m.name.slice(0, 40), value: plain(m.value) });
				return;
			case 'size':
				if (!v.height && Number.isFinite(m.height)) height = Math.round(Math.min(LIMITS.height[1], Math.max(24, m.height)));
				return;
			case 'rpc':
				return take(m.msg);
			case 'error':
				return onerror(String(m.message ?? '').slice(0, 300));
		}
	}

	async function start() {
		try {
			if (v.logic) logic = await loadLogic(v.logic);
			const worker = scripted ? await workerOf(v, engine.v) : null;
			const first = input();
			if (data !== undefined) sent = JSON.stringify(first);
			if (logic) {
				const r = await logic.init(first);
				if (r.error) onerror(r.error);
				shown = r.data;
			} else shown = first;
			send({ op: 'view', html: v.html, state: plain(shown), auto: !v.height, worker });
			booted = true;
		} catch (err) {
			stopped = `This view could not start: ${err.message || err}`;
			onerror(stopped);
		}
	}

	// the frame's document is loaded once; any other load is something leaving the box: the view is stopped
	let loads = 0;
	async function loaded() {
		if (++loads > 1) {
			port?.close();
			port = null;
			stopped = 'This view tried to leave its box, so it was stopped.';
			onerror(stopped);
			return;
		}
		try {
			if (!engine) throw new Error(`it is made for view engine ${String(v.engine).slice(0, 12)}, which this page does not have`);
			const code = await engineCode('view', engine.v);
			const ch = new MessageChannel();
			port = ch.port1;
			port.onmessage = fromEngine;
			frame.contentWindow.postMessage({ maiaView: key, code }, '*', [ch.port2]);
		} catch (err) {
			stopped = `This view could not start: ${err.message || err}`;
			onerror(stopped);
		}
	}

	onMount(() => {
		height = v.height ? Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], v.height)) : 60;
		return () => {
			port?.close();
			port = null;
			logic?.dispose();
		};
	});
</script>

{#if stopped}
	<p class="stopped">{stopped}</p>
{:else}
	<iframe bind:this={frame} title={v.title} sandbox={SANDBOX} referrerpolicy="no-referrer" allow={DENY} srcdoc={doc} onload={loaded} style:height="{height}px"></iframe>
{/if}

<style>
	.stopped {
		margin: 0;
		padding: 14px 16px;
		border-radius: 14px;
		background: #fff;
		color: #8a3a2a;
		font-size: 0.9rem;
	}
	iframe {
		display: block;
		width: 100%;
		border: 0;
		border-radius: 14px;
		background: transparent;
	}
</style>
