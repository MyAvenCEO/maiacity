import { NAMES, api } from './bunny.mjs';

const zone = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
console.log(`pull zone type before: ${zone.Type} (0 = standard, 1 = volume)`);
try {
	await api(`/pullzone/${zone.Id}`, { method: 'POST', body: { Type: 1 } });
	console.log('pull zone set to volume');
} catch (e) {
	console.log('pull zone tier change failed: ' + e.message.split('→')[1]?.slice(0, 200));
}

const { Items } = await api('/videolibrary?page=1&perPage=100');
const lib = Items.find((l) => l.Name === NAMES.streamLibrary);
console.log('\nstream library tier-ish fields:');
for (const [k, v] of Object.entries(lib)) {
	if (/tier|type|pullzone|price|cost|replica/i.test(k)) console.log(`  ${k} = ${JSON.stringify(v)}`);
}

const streamZone = (await api('/pullzone')).find((z) => z.Id === lib.PullZoneId);
if (streamZone) {
	console.log(`\nstream pull zone ${streamZone.Name} type ${streamZone.Type}`);
	try {
		await api(`/pullzone/${streamZone.Id}`, { method: 'POST', body: { Type: 1 } });
		console.log('stream pull zone set to volume');
	} catch (e) {
		console.log('stream tier change failed: ' + e.message.split('→')[1]?.slice(0, 200));
	}
}

const after = (await api('/pullzone'));
for (const z of after) console.log(`final: ${z.Name} type=${z.Type}`);
