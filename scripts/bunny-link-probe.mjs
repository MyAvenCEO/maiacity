import { NAMES, api } from './bunny.mjs';

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
const scripts = (await api('/compute/script?page=1&perPage=100')).Items;
const mw = scripts.find((s) => s.ScriptType === 0);
console.log(`zone ${zone.Id} · middleware ${mw.Id} · release ${mw.CurrentReleaseId}`);

const attempts = [
	['POST', `/pullzone/${zone.Id}`, { MiddlewareScriptId: mw.Id }],
	['POST', `/pullzone/${zone.Id}`, { MiddlewareScriptId: mw.Id, EdgeScriptId: 0 }],
	['POST', `/pullzone/${zone.Id}`, { EdgeScriptId: mw.Id, EdgeScriptExecutionPhase: 0 }],
	['POST', `/pullzone/${zone.Id}`, { EdgeScriptId: mw.Id, EdgeScriptExecutionPhase: 1 }]
];

for (const [method, path, body] of attempts) {
	try {
		await api(path, { method, body });
		console.log(`ok   ${JSON.stringify(body)}`);
		break;
	} catch (e) {
		console.log(`fail ${JSON.stringify(body)} :: ${e.message.split('→')[1]?.slice(0, 120)}`);
	}
}

const after = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
console.log(`result: MiddlewareScriptId=${after.MiddlewareScriptId} EdgeScriptId=${after.EdgeScriptId} phase=${after.EdgeScriptExecutionPhase}`);
