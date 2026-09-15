import { NAMES, api } from './bunny.mjs';

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
const scripts = (await api('/compute/script?page=1&perPage=100')).Items;
const mw = scripts.find((s) => s.ScriptType === 0);
console.log(`pull zone ${zone.Id}, middleware script ${mw.Id}, release ${mw.CurrentReleaseId}`);

const attempts = [
	['POST', `/pullzone/${zone.Id}`, { EdgeScriptId: -1 }],
	['POST', `/pullzone/${zone.Id}`, { MiddlewareScriptId: mw.Id }],
	['POST', `/compute/script/${mw.Id}/link/${zone.Id}`, undefined],
	['POST', `/compute/script/${mw.Id}/pullzone/${zone.Id}`, undefined],
	['POST', `/pullzone/${zone.Id}/edgescript`, { ScriptId: mw.Id }]
];

for (const [method, path, body] of attempts) {
	try {
		await api(path, { method, body });
		console.log(`ok   ${method} ${path} ${JSON.stringify(body ?? '')}`);
	} catch (e) {
		console.log(`fail ${method} ${path} :: ${e.message.split('→')[1]?.slice(0, 160)}`);
	}
}

const after = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
console.log(`result: MiddlewareScriptId=${after.MiddlewareScriptId} EdgeScriptId=${after.EdgeScriptId}`);
console.log('script linked zones: ' + JSON.stringify((await api(`/compute/script/${mw.Id}`)).LinkedPullZones));
