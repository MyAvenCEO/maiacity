// Actual browser fixture: production remote worker and its private carrier bridge, fresh OPFS stores/passkeys.
import * as avendb from '/client/remote.js';
import { create, ceremony } from '/passkey.js';
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
let device, actor;
const fileScope = hex(crypto.getRandomValues(new Uint8Array(16)));
let fileRevision = 0;
const run = async (op) => { const out = await device.run(op); if (!('ok' in out)) throw new Error(JSON.stringify(out)); return out.ok; };
const record = (text) => ({ kind: 'document', title: text, blocks: [{ id: 1, type: 'heading', level: 1, text }, { id: 2, type: 'paragraph', text }] });
window.fixture = {
    async start({ name, relay, server, offer }) {
        await avendb.load();
        const store = await avendb.openStore(name);
        const made = server ? await create(name) : null;
        const salt = await avendb.prfSalt();
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const deviceSalt = await avendb.deviceSalt(nonce);
        let credential = made?.id;
        const unlock = async (challenge) => { const answer = await ceremony(credential, challenge, salt, deviceSalt); credential = answer.id; return { ...answer, nonce: nonce.slice() }; };
        const sign = (challenge) => ceremony(credential, challenge, salt);
        device = server
            ? await avendb.Device.found(name, relay, server, made.spki, unlock, sign, undefined, undefined, store)
            : await avendb.Device.link(name, relay, offer, unlock, undefined, store);
        await device.keep(hex(nonce), credential);
        actor = await device.vault();
        return { endpoint: device.endpoint(), id: device.id(), offer: device.offer(), vault: actor };
    },
    async write(text) { return (await run({ op: 'create', vault: actor, type: 'note', value: record(text) })).entry; },
    async text(entry) { const out = await device.run({ op: 'get', entry }); return out.ok?.record?.blocks?.find((b) => b.id === 2)?.text; },
    async bring(seed = 7) {
        const len = (1 << 20) + 113;
        const out = await device.run({ op: 'put_file', vault: actor, name: 'carrier.bin', media: 'application/octet-stream', tags: [], len }, undefined,
            (at, n) => Uint8Array.from({ length: n }, (_, i) => ((at + i) * seed) % 251));
        if (!out.ok) throw new Error('file write failed');
        return { ...out.ok, len, seed };
    },
    async readFile(file) {
        // Production reads are local-only. Register view demand so the normal
        // authorized background file lane hydrates this entry before reading it.
        await run({ op: 'demand', scope: fileScope, revision: ++fileRevision, entries: [file.entry] });
        let out;
        try { out = await device.run({ op: 'read_file', root: file.root, size: file.size, from: 0, to: file.len }); }
        catch (error) {
            if (/no blob [0-9a-f]{64} on the shelf|[0-9a-f]{64} lacks [0-9]+\.\.[0-9]+/.test(String(error))) return false;
            throw error;
        }
        // The signed file entry can arrive after its demand; refusal remains a
        // non-success until the bounded outer wait sees an authorized exact read.
        if (!out.ok) return false;
        if (out.bytes?.length !== file.len || !out.bytes.every((b, i) => b === (i * file.seed) % 251)) throw new Error('carrier file bytes differ');
        await run({ op: 'demand', scope: fileScope, revision: ++fileRevision, entries: [] });
        return true;
    },
    async close() { await device.close(); device.free(); },
};
