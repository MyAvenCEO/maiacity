<!--
	A code view (kind html) in its box: an MCP App (spec 2026-01-26) and this page its host. THE boundary of generated
	code in our page:
	- an iframe with sandbox="allow-scripts" and NOT allow-same-origin: the browser gives it an opaque "null" origin.
	  It cannot read or change our page (parent.document throws), our cookies, localStorage, IndexedDB, OPFS (avenDB)
	  or passkeys; api.maia.city answers only origins it knows, never "null". No allow-top-navigation, -popups, -forms,
	  -modals or -downloads: it cannot leave its box, open windows, post forms, raise dialogs or save files. (MCP Apps
	  asks a web host for a proxy frame on a second origin; a frame with no origin at all is the stricter form of it.)
	- a CSP set before its own markup: no connection of any kind (connect-src 'none': no fetch, XHR, WebSocket,
	  EventSource or beacon), scripts only inline or from the pinned library files (game/genui/views.js LIBS), images,
	  fonts and media only from data: and blob:, no workers, no base, no forms. A later meta can only tighten it. A
	  Permissions Policy turns off camera, microphone, location, clipboard, payment and passkeys.
	- its one way out is postMessage, as MCP Apps' JSON-RPC. We take a message only from this frame's own window, only
	  JSON-RPC 2.0 of the METHODS we answer, size-capped; links, tool calls and resource reads are refused. What it
	  tells us reaches the page as plain data, never as markup or code.
	Left open: it can busy the CPU or GPU. In Safari and the Mac app a sandboxed frame shares our thread, so a frame
	that never yields can freeze the tab; that is why a code view runs only when someone presses Run.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { LIBS, LIMITS, METHODS, PROTOCOL } from '../../../game/genui/views.js';
	import { native } from '$lib/native';

	// `data`, when given, is the view's tool result as it moves on (a game's state): sent again whenever it changes
	let { view, data = undefined, onevent = () => {}, onerror = () => {} } = $props();
	let frame = $state();
	let ready = $state(false);
	const send = (m) => frame?.contentWindow?.postMessage({ jsonrpc: '2.0', ...m }, '*');
	const result = (d) => send({ method: 'ui/notifications/tool-result', params: { content: [], structuredContent: JSON.parse(JSON.stringify(d ?? {})) } });
	$effect(() => {
		const d = data === undefined ? undefined : $state.snapshot(data);
		if (ready && d !== undefined) result(d);
	});
	let height = $state(view.spec.height);
	// no device, no passkey, no clipboard, no payment: every powerful feature off, whatever the browser would allow
	const DENY = ['camera', 'microphone', 'geolocation', 'display-capture', 'clipboard-read', 'clipboard-write', 'payment', 'usb', 'serial', 'hid', 'publickey-credentials-get', 'publickey-credentials-create', 'storage-access'].map((f) => `${f} 'none'`).join('; ');

	const csp = (libs) =>
		[
			"default-src 'none'",
			`script-src 'unsafe-inline' ${libs.map((l) => LIBS[l].allow).join(' ')}`.trim(),
			"style-src 'unsafe-inline'",
			'img-src data: blob:',
			'font-src data:',
			'media-src data: blob:',
			"connect-src 'none'",
			"worker-src 'none'",
			"frame-src 'none'",
			"object-src 'none'",
			"base-uri 'none'",
			"form-action 'none'"
		].join('; ');

	// the page we write around the agent's html: the CSP first, then the libraries, then a bridge that reports errors
	const doc = $derived.by(() => {
		const libs = view.spec.libs ?? [];
		const imports = Object.assign({}, ...libs.map((l) => LIBS[l].imports ?? {}));
		const scripts = libs.filter((l) => LIBS[l].script).map((l) => `<script src="${LIBS[l].script}"><\/script>`);
		return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(libs)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${Object.keys(imports).length ? `<script type="importmap">${JSON.stringify({ imports })}<\/script>` : ''}
${scripts.join('\n')}
<script>
const log = (m) => parent.postMessage({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'error', data: String(m) } }, '*');
addEventListener('error', (e) => log(e.message || e));
addEventListener('unhandledrejection', (e) => log(e.reason && e.reason.message || e.reason));
<\/script>
</head><body>${view.spec.html}</body></html>`;
	});

	/** the host's answer to ui/initialize */
	const welcome = () => ({
		protocolVersion: PROTOCOL,
		hostInfo: { name: 'maiaCITY', version: '1.0.0' },
		hostCapabilities: { logging: {}, sandbox: { permissions: {}, csp: { connectDomains: [], resourceDomains: (view.spec.libs ?? []).map((l) => LIBS[l].allow) } } },
		hostContext: {
			theme: 'light',
			displayMode: 'inline',
			availableDisplayModes: ['inline'],
			containerDimensions: { width: frame?.clientWidth ?? 800, maxHeight: LIMITS.height[1] },
			locale: navigator.language,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			platform: native() ? 'desktop' : 'web'
		}
	});

	onMount(() => {
		const answer = (id, result) => id != null && send({ id, result });
		const refuse = (id, code, message) => id != null && send({ id, error: { code, message } });
		const take = (e) => {
			// only this frame's own window, only JSON-RPC 2.0, only small plain data
			if (!frame || e.source !== frame.contentWindow) return;
			const m = e.data;
			if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return;
			let size;
			try {
				size = JSON.stringify(m).length;
			} catch {
				return;
			}
			if (size > 4000) return refuse(m.id, -32600, 'Message too big.');
			if (!METHODS.includes(m.method)) return refuse(m.id, -32601, `${m.method.slice(0, 60)} is not available to a generated view.`);
			const p = m.params && typeof m.params === 'object' ? m.params : {};
			const plain = (v) => JSON.parse(JSON.stringify(v ?? null));
			switch (m.method) {
				case 'ui/initialize':
					return answer(m.id, welcome());
				case 'ui/notifications/initialized':
					// the view's tool input and result: what the agent handed it, nothing of ours
					send({ method: 'ui/notifications/tool-input', params: { arguments: plain(view.spec.input ?? {}) } });
					if (data === undefined) result(view.spec.data);
					ready = true;
					return;
				case 'ui/notifications/size-changed':
					if (Number.isFinite(p.height)) height = Math.round(Math.min(LIMITS.height[1], Math.max(LIMITS.height[0], p.height)));
					return;
				case 'notifications/message':
					if (p.level === 'error') onerror(String(typeof p.data === 'string' ? p.data : JSON.stringify(p.data)).slice(0, 300));
					else onevent({ name: 'log', value: plain(p.data) });
					return;
				case 'ui/update-model-context':
					onevent({ name: 'context', value: plain(p.structuredContent ?? p.content) });
					return answer(m.id, {});
				case 'ui/message':
					onevent({ name: 'message', value: plain(p.content) });
					return answer(m.id, {});
				case 'ui/request-display-mode':
					return answer(m.id, { mode: 'inline' });
				case 'ping':
					return answer(m.id, {});
			}
		};
		addEventListener('message', take);
		return () => removeEventListener('message', take);
	});
</script>

<iframe
	bind:this={frame}
	title={view.title}
	sandbox="allow-scripts"
	referrerpolicy="no-referrer"
	allow={DENY}
	srcdoc={doc}
	style:height="{height}px"
></iframe>

<style>
	iframe {
		display: block;
		width: 100%;
		border: 0;
		border-radius: 14px;
		background: #fff;
	}
</style>
