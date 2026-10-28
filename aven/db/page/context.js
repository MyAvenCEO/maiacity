/**
 * Which identities this device can act for, as the core's World reports them. Knowing a vault, reading its
 * public entries or holding one of its shares does not make it an identity the person can switch to.
 * `via` is State::via for the current signer: [] for direct membership, an owner path for inherited authority,
 * null when it cannot act for that vault. The person's own vault stays first.
 * @param {import('./vaults.js').WorldView | null | undefined} world
 * @returns {import('./vaults.js').VaultView[]}
 */
export function contextVaults(world) {
	if (!world) return [];
	const own = world.vaults.find((v) => v.id === world.mine);
	const others = world.vaults.filter((v) =>
		v.id !== world.mine && Array.isArray(v.via) && !(v.kind === 'device' && !v.devices?.length)
	);
	return own ? [own, ...others] : others;
}

/**
 * Resolve a requested or remembered context against current authority. Invalid selections fall back to the
 * person's own known vault, never another known/readable vault or an arbitrary first item.
 * @param {import('./vaults.js').WorldView | null | undefined} world
 * @param {string} requested
 * @returns {string}
 */
export function selectedVault(world, requested) {
	const allowed = contextVaults(world);
	return allowed.find((v) => v.id === requested)?.id ?? allowed.find((v) => v.id === world?.mine)?.id ?? '';
}

/**
 * The session's selection boundary, with reactive state supplied by its owner. Reads recheck authority;
 * writes reject invalid IDs; a fresh World reconciles remembered state so revoked selections cannot reappear
 * automatically if authority is later granted again. No selection is saved to the device or localStorage.
 * @param {{ world: () => import('./vaults.js').WorldView | null, read: () => string, write: (id: string) => void }} state
 */
export function createVaultContext(state) {
	return {
		get current() {
			return selectedVault(state.world(), state.read());
		},
		set current(id) {
			state.write(selectedVault(state.world(), id));
		},
		reconcile() {
			state.write(selectedVault(state.world(), state.read()));
		}
	};
}
