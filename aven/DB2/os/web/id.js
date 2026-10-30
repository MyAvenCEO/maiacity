// avenOS reads the vault tree through avenID: aven-id's queries as wasm, built by id/core/wasm/build.sh into
// target/wasm/aven-id, which Vite's alias `aven-id` points at. `new Cast` refuses a tree that is not well formed. Who
// may act for whom, what a vault governs and sees, is answered there; only how a page names things stays here.
import init, { Cast } from 'aven-id';
import castText from '../../sandbox/cast.json?raw';

await init();
export const tree = new Cast(castText);

export const vaultName = (id) => tree.name(id) ?? id;
// A vault's owners as the cast writes them, `key:<id>` or `vault:<id>`, split for the page.
export const owners = (id) =>
	tree.owners(id).map((owner) => {
		const [kind, of] = owner.split(':');
		return { kind, id: of };
	});
// An owner as a person reads it: another vault by name, a key by the start of its public half.
export const ownerName = (owner) => (owner.kind === 'vault' ? vaultName(owner.id) : `key ${tree.key(owner.id).slice(0, 8)}…`);
