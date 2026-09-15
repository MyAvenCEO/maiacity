import { NAMES, api } from './bunny.mjs';

const scripts = (await api('/compute/script?page=1&perPage=100')).Items;
for (const s of scripts) {
	const full = await api(`/compute/script/${s.Id}`);
	console.log(`${s.Id} ${s.Name} type=${s.ScriptType} release=${full.CurrentReleaseId} linked=${JSON.stringify(full.LinkedPullZones)}`);
}

const gate = scripts.find((s) => s.Name === 'maiacity-early-access') ?? scripts[0];
try {
	await api(`/compute/script/${gate.Id}/publish`, { method: 'POST', body: { Note: 'early access gate' } });
	console.log(`published ${gate.Id}`);
} catch (e) {
	console.log(`publish failed: ${e.message.split('→')[1]?.slice(0, 200)}`);
}

const after = await api(`/compute/script/${gate.Id}`);
console.log(`${gate.Id} release now: ${after.CurrentReleaseId}`);

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
console.log(`pull zone: EdgeScriptId=${zone.EdgeScriptId} phase=${zone.EdgeScriptExecutionPhase} MiddlewareScriptId=${zone.MiddlewareScriptId}`);
