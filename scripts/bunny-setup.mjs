// One-shot, idempotent provisioning of everything maiaCITY needs on Bunny.
import {
	NAMES,
	ensureHostnames,
	ensurePullZone,
	ensureStorageZone,
	ensureStreamLibrary,
	requestCertificate,
	storageBase
} from './bunny.mjs';

const out = [];
const log = (line) => {
	console.log(line);
	out.push(line);
};

const storage = await ensureStorageZone();
log(`storage zone: ${storage.Name} (id ${storage.Id}, region ${storage.Region}, tier ${storage.ZoneTier === 0 ? 'volume/HDD' : 'edge/SSD'})`);
log(`storage endpoint: ${storageBase(storage)}`);

const pullZone = await ensurePullZone(storage);
log(`pull zone: ${pullZone.Name} (id ${pullZone.Id}) → https://${pullZone.Name}.b-cdn.net`);

const added = await ensureHostnames(pullZone);
log(added.length ? `hostnames added: ${added.join(', ')}` : `hostnames already present: ${NAMES.hostnames.join(', ')}`);

for (const hostname of NAMES.hostnames) {
	const cert = await requestCertificate(hostname);
	log(cert.ok ? `certificate issued: ${hostname}` : `certificate pending for ${hostname} (DNS not pointing at Bunny yet)`);
}

const library = await ensureStreamLibrary();
log(`stream library: ${library.Name} (id ${library.Id})`);
log(`stream pull zone: ${library.PullZoneId ?? 'n/a'} · CDN ${library.VideoLibraryId ?? library.Id}`);

log('');
log('DNS to add for maia.city:');
log(`  maia.city      CNAME  ${pullZone.Name}.b-cdn.net   (or ALIAS/ANAME at the apex)`);
log(`  www.maia.city  CNAME  ${pullZone.Name}.b-cdn.net`);

if (process.env.GITHUB_STEP_SUMMARY) {
	const fs = await import('node:fs/promises');
	await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Bunny setup\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}
