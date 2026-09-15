import { NAMES, api } from './bunny.mjs';

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
const mw = (await api('/compute/script?page=1&perPage=100')).Items.find((s) => s.ScriptType === 0);

const steps = [
	['clear EdgeScriptId (0)', { EdgeScriptId: 0 }],
	['link middleware', { MiddlewareScriptId: mw.Id }]
];

for (const [label, body] of steps) {
	try {
		await api(`/pullzone/${zone.Id}`, { method: 'POST', body });
		console.log(`ok   ${label}`);
	} catch (e) {
		console.log(`fail ${label} :: ${e.message.split('→')[1]?.slice(0, 160)}`);
	}
}

const now = (await api('/pullzone')).find((z) => z.Id === zone.Id);
console.log(`EdgeScriptId=${now.EdgeScriptId} MiddlewareScriptId=${now.MiddlewareScriptId}`);
await api(`/pullzone/${zone.Id}/purgeCache`, { method: 'POST' });
const res = await fetch('https://maia.city/', { redirect: 'manual' });
console.log(`test: ${res.status} ${res.headers.get('www-authenticate') ?? ''}`);
