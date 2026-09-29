/**
 * The media vault, as the API sees it (vault/, .claude/skills/iroh/maiacity.md).
 *
 * The truth about media is an iroh-docs catalog every device keeps in full; the server peer (vault-server) mirrors it
 * into vault_files. Here: pairing — a Mac signed in with the admin's key registers its iroh EndpointId, and only paired
 * devices may connect to the server peer and its relay — and joining: what a paired device needs to find the server and
 * write to the catalog. The server peer publishes that into vault_config when it starts.
 */
import { db } from "./pg";

export class VaultError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

export type VaultDevice = { endpoint_id: string; label: string; created: string; seen: string | null; revoked_at: string | null };

/** A Mac registers its node. The same node again only renews its label; a revoked node stays revoked. */
export async function pairDevice(founderId: string, endpointId: unknown, label: unknown): Promise<VaultDevice> {
  const id = String(endpointId ?? "").toLowerCase();
  if (!HEX64.test(id)) throw new VaultError("An iroh EndpointId is 64 hex characters.");
  const { rows } = await db.query<VaultDevice & { revoked_at: string | null }>(
    `INSERT INTO vault_devices (endpoint_id, founder_id, label) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint_id) DO UPDATE SET label = EXCLUDED.label
     RETURNING endpoint_id, label, created, seen, revoked_at`,
    [id, founderId, String(label ?? "").slice(0, 120)],
  );
  if (rows[0]!.revoked_at) throw new VaultError("This device was revoked. Pair it under a new key.", 403);
  return rows[0]!;
}

export async function listDevices(): Promise<VaultDevice[]> {
  const { rows } = await db.query<VaultDevice>(
    "SELECT endpoint_id, label, created, seen, revoked_at FROM vault_devices ORDER BY created DESC",
  );
  return rows;
}

export async function revokeDevice(endpointId: string): Promise<boolean> {
  const r = await db.query("UPDATE vault_devices SET revoked_at = now() WHERE endpoint_id = $1 AND revoked_at IS NULL", [
    endpointId.toLowerCase(),
  ]);
  return r.affectedRows > 0;
}

/** What a paired device needs to join: the server peer's node and the catalog's write ticket. */
export async function joinInfo(): Promise<{ server: string | null; catalog: string | null; relay: string | null }> {
  const { rows } = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM vault_config WHERE key IN ('server', 'catalog', 'relay')",
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { server: get("server"), catalog: get("catalog"), relay: get("relay") };
}

export type VaultFile = {
  hash: string;
  size: number;
  mime: string;
  kind: string;
  title: string;
  tags: string[];
  public: boolean;
  meta: Record<string, unknown>;
  stored: boolean;
  added: string;
};

/** The mirror of the catalog, newest first — for the admin and the site. */
export async function listVaultFiles(q: { kind?: string; tag?: string } = {}): Promise<VaultFile[]> {
  const { rows } = await db.query<VaultFile & { size: string }>(
    `SELECT hash, size, mime, kind, title, tags, public, meta, stored, added FROM vault_files
      WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR $2 = ANY(tags))
      ORDER BY added DESC`,
    [q.kind ?? null, q.tag ?? null],
  );
  return rows.map((r) => ({ ...r, size: Number(r.size) }));
}
