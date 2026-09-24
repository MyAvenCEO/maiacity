/**
 * CAPABILITY-BASED ACCESS — roles are bundles of capabilities.
 *
 * A route never asks "is this an admin"; it asks `can(user, 'coop:create')`.
 * Roles and their capabilities live in game/policy.roles.json and may
 * inherit one another, so founders can do everything citizens can, and the
 * admin everything founders can. Pure: no database in here.
 */
import rolesJson from '../../game/policy.roles.json' with { type: 'json' }

export type Capability = string
export type RolesPolicy = {
	default: string
	firstSignupBecomes: string
	assignable: string[]
	roles: Record<string, { inherits?: string; capabilities: Capability[] }>
}
export const rolesPolicy = rolesJson as unknown as RolesPolicy

export const ROLES = Object.keys(rolesPolicy.roles)
export const isRole = (r: unknown): r is string => typeof r === 'string' && r in rolesPolicy.roles

/** Every capability a role has, its own and inherited. */
export function capabilities(role: string): Set<Capability> {
	const out = new Set<Capability>()
	const seen = new Set<string>()
	let current: string | undefined = role
	while (current && !seen.has(current)) {
		seen.add(current)
		const def: { inherits?: string; capabilities: Capability[] } | undefined = rolesPolicy.roles[current]
		if (!def) break
		for (const c of def.capabilities) out.add(c)
		current = def.inherits
	}
	return out
}

export function can(user: { role: string } | null | undefined, capability: Capability): boolean {
	return !!user && capabilities(user.role).has(capability)
}

export class Forbidden extends Error {
	constructor(public capability: Capability) {
		super(`This needs ${capability}.`)
	}
}

/** Throw unless the user has the capability. */
export function require(user: { role: string } | null | undefined, capability: Capability): void {
	if (!can(user, capability)) throw new Forbidden(capability)
}
