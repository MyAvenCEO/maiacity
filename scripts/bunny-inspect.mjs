import { NAMES, api } from './bunny.mjs';

const zones = await api('/pullzone');
const zone = zones.find((z) => z.Name === NAMES.pullZone);
console.log('pull zone script-related fields:');
for (const [k, v] of Object.entries(zone)) {
	if (/script|compute|edge|middleware/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`);
}

try {
	const scripts = await api('/compute/script?page=1&perPage=50');
	console.log('\ncompute/script list:', JSON.stringify(scripts).slice(0, 800));
} catch (e) {
	console.log('\ncompute/script list failed:', e.message.slice(0, 300));
}
