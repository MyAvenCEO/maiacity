/**
 * CAPABILITY-BASED ACCESS — roles are bundles of capabilities, kept in the database.
 *
 * A route never asks "is this an admin"; it asks `can(user, 'coop:create')`. The catalogue of capabilities lives
 * in caps.ts; which role holds which lives in the `roles` table (name → a comma list), seeded from ROLE_CAPS and
 * edited by whoever holds roles:admin. The bundles are read once at boot and kept in memory, so a check costs a
 * lookup, not a query; every edit goes through here and refreshes them.
 */
import { db, type Queryable } from "./pg";
import { CAPABILITIES, FIRST_SIGNUP_ROLE, PROTECTED_ROLES, ROLE_CAPS } from "./caps";

export type Capability = string;

/** role name → the capabilities it holds, only those the catalogue knows */
let bundles = new Map<string, Set<Capability>>();

/** The comma list of a role's row as a list — trimmed, without blanks. */
export const capsOf = (csv: string | null | undefined): Capability[] =>
  (csv ?? "").split(",").map((c) => c.trim()).filter(Boolean);

/** Read every role's bundle from the database into memory. */
export async function loadRoles(q: Queryable = db): Promise<void> {
  const { rows } = await q.query<{ name: string; capabilities: string }>("SELECT name, capabilities FROM roles");
  bundles = new Map(rows.map((r) => [r.name, new Set(capsOf(r.capabilities).filter((c) => c in CAPABILITIES))]));
}

/** The marker row in `secrets`: every capability the reconcile has already handed to the built-in roles. */
const RECONCILED_KEY = "caps_reconciled";

/**
 * Seed the built-in roles on an empty table, then hand each capability that is NEW in ROLE_CAPS to the built-in
 * roles that name it — exactly once, the first time it appears there. The marker row remembers which ones already
 * were, so a cap the admin took away on purpose stays away at the next boot. Nothing is ever removed here.
 */
export async function initRoles(): Promise<void> {
  const { rows: existing } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM roles");
  if (Number(existing[0]?.n ?? 0) === 0)
    for (const [name, caps] of Object.entries(ROLE_CAPS))
      await db.query("INSERT INTO roles (name, capabilities) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [name, caps.join(",")]);

  const { rows: marker } = await db.query<{ value: string }>("SELECT value FROM secrets WHERE key = $1", [RECONCILED_KEY]);
  const done = new Set<string>(marker[0] ? (JSON.parse(marker[0].value) as string[]) : []);
  const fresh = [...new Set(Object.values(ROLE_CAPS).flat())].filter((c) => !done.has(c));
  if (fresh.length) {
    const { rows } = await db.query<{ name: string; capabilities: string }>("SELECT name, capabilities FROM roles");
    const held = new Map(rows.map((r) => [r.name, capsOf(r.capabilities)]));
    for (const [name, wanted] of Object.entries(ROLE_CAPS)) {
      const has = held.get(name);
      if (!has) continue; // a built-in role somebody deleted is not brought back here
      const missing = wanted.filter((c) => fresh.includes(c) && !has.includes(c));
      if (missing.length) await db.query("UPDATE roles SET capabilities = $1 WHERE name = $2", [[...has, ...missing].join(","), name]);
    }
    for (const c of fresh) done.add(c);
    await db.query(
      "INSERT INTO secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [RECONCILED_KEY, JSON.stringify([...done])],
    );
  }
  await loadRoles();
}

/** Every capability a role holds. Only what the role names — no inheritance, no wildcard. */
export function capabilities(role: string): Set<Capability> {
  return new Set(bundles.get(role) ?? []);
}

export function can(user: { role: string } | null | undefined, capability: Capability): boolean {
  return !!user && !!bundles.get(user.role)?.has(capability);
}

export class Forbidden extends Error {
  constructor(public capability: Capability) {
    super(`This needs the right to ${(CAPABILITIES[capability] ?? capability).toLowerCase()}.`);
  }
}

/** Throw unless the user has the capability. */
export function require(user: { role: string } | null | undefined, capability: Capability): void {
  if (!can(user, capability)) throw new Forbidden(capability);
}

// ─────────────────────────────── managing the roles ───────────────────────────────

export class RoleError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const ROLE_NAME = /^[a-z][a-z0-9-]{1,30}$/;

/** Every role, with what it holds and how many people have it. */
export async function listRoles() {
  const { rows } = await db.query<{ name: string; capabilities: string; people: number }>(`
    SELECT r.name, r.capabilities, count(f.id)::int AS people
      FROM roles r LEFT JOIN founders f ON f.role = r.name
     GROUP BY r.name, r.capabilities ORDER BY r.name`);
  return rows.map((r) => ({
    name: r.name,
    capabilities: capsOf(r.capabilities).filter((c) => c in CAPABILITIES),
    people: Number(r.people),
    protected: PROTECTED_ROLES.includes(r.name),
  }));
}

/** Set exactly what a role holds. The admin role always keeps roles:admin, so nobody locks the city out of itself. */
export async function setRoleCaps(name: string, caps: unknown): Promise<void> {
  if (!Array.isArray(caps)) throw new RoleError("Give the role a list of capabilities.");
  const unknown = caps.filter((c) => typeof c !== "string" || !(c in CAPABILITIES));
  if (unknown.length) throw new RoleError(`Not a capability: ${unknown.join(", ")}.`);
  const list = [...new Set(caps as string[])];
  if (name === FIRST_SIGNUP_ROLE && !list.includes("roles:admin"))
    throw new RoleError("The admin role keeps the right to manage roles, or nobody could.");
  const r = await db.query("UPDATE roles SET capabilities = $1 WHERE name = $2", [list.join(","), name]);
  if (!r.affectedRows) throw new RoleError("No such role.", 404);
  await loadRoles();
}

export async function createRole(name: unknown, caps: unknown = []): Promise<void> {
  const n = String(name ?? "").trim().toLowerCase();
  if (!ROLE_NAME.test(n)) throw new RoleError("A role name is 2–31 lowercase letters, digits or dashes, starting with a letter.");
  const r = await db.query("INSERT INTO roles (name, capabilities) VALUES ($1, '') ON CONFLICT (name) DO NOTHING", [n]);
  if (!r.affectedRows) throw new RoleError("That role already exists.", 409);
  await setRoleCaps(n, caps);
}

/** Delete a role nobody holds. The built-in default and admin roles stay. */
export async function deleteRole(name: string): Promise<void> {
  if (PROTECTED_ROLES.includes(name)) throw new RoleError("This role cannot be deleted.");
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM founders WHERE role = $1", [name]);
  if (Number(rows[0]?.n ?? 0) > 0) throw new RoleError("Somebody still has this role: give them another one first.", 409);
  const r = await db.query("DELETE FROM roles WHERE name = $1", [name]);
  if (!r.affectedRows) throw new RoleError("No such role.", 404);
  await loadRoles();
}

/** Give a person a role. The first admin cannot be demoted by anyone, not even another admin. */
export async function assignRole(founderId: string, role: unknown): Promise<{ id: string; role: string }> {
  const r = String(role ?? "");
  if (!bundles.has(r)) throw new RoleError("No such role.");
  const { rows } = await db.query<{ id: string; role: string }>(
    `UPDATE founders SET role = $1
      WHERE id = $2 AND number <> (SELECT min(number) FROM founders)
      RETURNING id, role`,
    [r, founderId],
  );
  if (!rows[0]) throw new RoleError("No such citizen, or they are the first admin.", 404);
  return rows[0];
}
