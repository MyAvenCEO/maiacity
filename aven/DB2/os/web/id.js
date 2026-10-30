// avenOS reads the vault tree through avenID: aven-id's queries as wasm, built by id/core/wasm/build.sh into
// target/wasm/aven-id, which Vite's alias `aven-id` points at. `new Cast` refuses a tree that is not well formed. Who
// may act for whom, what a vault governs and sees, is answered there; only how a page names things stays here.
import init, { Cast } from 'aven-id';
import castText from '../../sandbox/cast.json?raw';

await init();
export let tree = new Cast(castText);
// On an Aven Peer's host without a cast (Network.svelte) the tree is the network's, as its Aven Peer tells it.
export function useTree(json) {
	tree = new Cast(json);
}
// What a passkey signs and what browsers and passkeys are called, as aven-id computes them (PRODUCTION.md, Part A)
export { challenge, claimText, deviceId, passkeyId, personId, signInText } from 'aven-id';
// and invites, withdrawals and joins (MILESTONE2.md): their texts, an invite's id, and the one-time key a link carries
export { inviteId, inviteText, joinText, oneTimePublic, signJoin, withdrawText } from 'aven-id';

export const vaultName = (id) => tree.name(id) ?? id;
// A vault's owners as the cast writes them, `key:<id>` or `vault:<id>`, split for the page.
export const owners = (id) =>
	tree.owners(id).map((owner) => {
		const [kind, of] = owner.split(':');
		return { kind, id: of };
	});
// An owner as a person reads it: another vault by name, a key by the start of its public half.
export const ownerName = (owner) => (owner.kind === 'vault' ? vaultName(owner.id) : `key ${tree.key(owner.id).slice(0, 8)}…`);
