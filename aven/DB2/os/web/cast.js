// The cast's vaults own vaults (SANDBOX.md, "Vaults own vaults"). Who may act for whom is avenID's; until avenID runs
// in the Peer-Light, avenOS reads the box's fixed tree from the cast. The sandbox's check holds these views to values
// written out by hand.
const parse = (owner) => {
	const [kind, id] = owner.split(':');
	return { kind, id };
};
export const owners = (cast, id) => (cast.vaults[id]?.owners ?? []).map(parse);
const ownerVaults = (cast, id) => owners(cast, id).filter((owner) => owner.kind === 'vault').map((owner) => owner.id);

// The vaults a vault owns directly, in the cast's order.
export const owned = (cast, id) => Object.keys(cast.vaults).filter((child) => ownerVaults(cast, child).includes(id));

// Everything below a vault: what it governs, and all it may see.
export function governs(cast, id) {
	const below = [];
	for (let at = -1; at < below.length; at++)
		for (const child of owned(cast, at < 0 ? id : below[at])) if (child !== id && !below.includes(child)) below.push(child);
	return below;
}

// The vaults above a vault, nearest first: aven-peer → aven → alice.
export function chain(cast, id) {
	const above = [];
	for (let at = ownerVaults(cast, id)[0]; at && !above.includes(at); at = ownerVaults(cast, at)[0]) above.push(at);
	return above;
}

// The vault a device acts for: the vault that owns its device vault.
export const actsFor = (cast, device) => ownerVaults(cast, device)[0];

// The vaults one can act as: people's only. A network's vault (Aven) acts through its own devices, within the rights
// its owner gives it, and no person switches into it: its admin manages it as herself, through the tree. A device acts as the person it serves; without a device, the box's
// own view holds every test key and can act as any person.
export const accounts = (cast, device) =>
	(device ? [actsFor(cast, device)] : Object.keys(cast.vaults)).filter((id) => cast.vaults[id]?.kind === 'person');

// The devices a vault acts through: the device vaults it owns directly (the Aven Peer for Aven).
export const devicesOf = (cast, id) => owned(cast, id).filter((child) => cast.vaults[child].kind === 'device');

// The peers a vault sees: those whose device vaults it governs.
export const peersOf = (cast, id) => Object.keys(cast.peers).filter((peer) => governs(cast, id).includes(peer));

export const vaultName = (cast, id) => cast.vaults[id]?.name ?? id;
export const key = (cast, id) => cast.keys[id];
// An owner as a person reads it: another vault by name, a key by the start of its public half.
export const ownerName = (cast, owner) =>
	owner.kind === 'vault' ? vaultName(cast, owner.id) : `key ${key(cast, owner.id).slice(0, 8)}…`;
