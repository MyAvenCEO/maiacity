import { NAMES, api } from './bunny.mjs';

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
console.log('all script/enable fields:');
for (const [k, v] of Object.entries(zone)) {
	if (/script|compute|middleware|enableedge/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`);
}

for (const phase of [1, 2, 3, 0]) {
	try {
		await api(`/pullzone/${zone.Id}`, { method: 'POST', body: { EdgeScriptExecutionPhase: phase } });
		const now = (await api('/pullzone')).find((z) => z.Id === zone.Id);
		console.log(`phase ${phase} accepted → now ${now.EdgeScriptExecutionPhase}`);
		await api(`/pullzone/${zone.Id}/purgeCache`, { method: 'POST' });
		const res = await fetch('https://maia.city/', { redirect: 'manual' });
		console.log(`   test: ${res.status} ${res.headers.get('www-authenticate') ?? ''}`);
		if (res.status === 401) break;
	} catch (e) {
		console.log(`phase ${phase} failed: ${e.message.split('→')[1]?.slice(0, 120)}`);
	}
}
