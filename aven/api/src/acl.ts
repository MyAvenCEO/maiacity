/**
 * CAPABILITY-BASED ACCESS — roles are bundles of capabilities, kept in the database.
 *
 * A route never asks "is this an admin"; it asks `can(user, 'coop:create')`. The catalogue of capabilities lives
 * in caps.ts; which role holds which lives in the `roles` table (name → a comma list), seeded from ROLE_CAPS. The
 * bundles are read once at boot and kept in memory, so a check costs a lookup, not a query. No route edits them any
 * more: the routes that listed, made, changed and gave out roles went with the admin's page of them, as every page of
 * the app opens by Maia City's cap groups in avenDB ($lib/app/access.svelte.js); a role is changed in SQL, and
 * `loadRoles` (each boot) reads it again.
 */
import { db, type Queryable } from "./pg";
import { CAPABILITIES, ROLE_CAPS } from "./caps";

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
