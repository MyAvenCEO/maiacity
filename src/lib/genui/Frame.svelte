<!--
	A code view (kind html) in its box. THE boundary of generated code in our page:
	- an iframe with sandbox="allow-scripts" and NOT allow-same-origin: the browser gives it an opaque "null" origin.
	  It cannot read or change our page (parent.document throws), our cookies, localStorage, IndexedDB, OPFS (avenDB)
	  or passkeys; api.maia.city answers only origins it knows, never "null". No allow-top-navigation, -popups, -forms,
	  -modals or -downloads: it cannot leave its box, open windows, post forms, raise dialogs or save files.
	- a CSP set before its own markup: no connection of any kind (connect-src 'none': no fetch, XHR, WebSocket,
	  EventSource or beacon), scripts only inline or from the pinned library files (game/genui/views.js LIBS), images,
	  fonts and media only from data: and blob:, no workers, no base, no forms. A later meta can only tighten it.
	- its one way out is postMessage. We take a message only from this frame's own window and only of the shapes in
	  MESSAGES, size-capped, and hand it on as plain data.
	Left open: it can busy the CPU or GPU. In Safari and the Mac app a sandboxed frame shares our thread, so a frame
	that never yields can freeze the tab; that is why a code view runs only when someone presses Run.
-->
<script>
	import { onMount } from 'svelte';
	import { LIBS, MESSAGES } from '../../../game/genui/views.js';

	let { view, onevent = () => {}, onerror = () => {} } = $props();
	let frame = $state();
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
addEventListener('error', (e) => parent.postMessage({ type: 'genui:error', message: String(e.message || e) }, '*'));
addEventListener('unhandledrejection', (e) => parent.postMessage({ type: 'genui:error', message: String(e.reason && e.reason.message || e.reason) }, '*'));
<\/script>
</head><body>${view.spec.html}</body></html>`;
	});

	onMount(() => {
		const take = (e) => {
			// only this frame's own window, only the shapes we know, only small plain data
			if (!frame || e.source !== frame.contentWindow) return;
			const m = e.data;
			if (!m || typeof m !== 'object' || !MESSAGES.includes(m.type)) return;
			let s;
			try {
				s = JSON.stringify(m);
			} catch {
				return;
			}
			if (s.length > 2000) return;
			if (m.type === 'genui:error') onerror(String(m.message ?? '').slice(0, 300));
			else onevent({ name: String(m.name ?? '').slice(0, 40), value: JSON.parse(JSON.stringify(m.value ?? null)) });
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
	style:height="{view.spec.height}px"
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
