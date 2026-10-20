/**
 * The media vault, as the API sees it (vault/, .claude/skills/iroh/maiacity.md).
 *
 * The truth about media is an iroh-docs catalog every device keeps in full; the server peer (vault-server) mirrors it
 * into vault_files. Here: joining, what a paired device needs to find the server and write to the catalog, which the
 * server peer publishes into vault_config when it starts; and that mirror. Only paired devices (vault_devices) may
 * connect to the server peer and its relay; the routes that paired, listed and revoked them went, as nothing called
 * them, so a node is paired by a row written by hand.
 */
import { db } from "./pg";

/**
 * What a paired device needs to join: the server peer's node, the catalog's write ticket, and the server's catalog author
 * (its signed `blobs/<hash>` entries are what Object Storage holds).
 */
export async function joinInfo(): Promise<{ server: string | null; catalog: string | null; relay: string | null; author: string | null }> {
  const { rows } = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM vault_config WHERE key IN ('server', 'catalog', 'relay', 'author')",
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { server: get("server"), catalog: get("catalog"), relay: get("relay"), author: get("author") };
}

export type VaultFile = {
  hash: string;
  size: number;
  mime: string;
  kind: string;
  title: string;
  /** from the catalog's entry (the mirror keeps it in meta) */
  description: string;
  tags: string[];
  public: boolean;
  meta: Record<string, unknown>;
  stored: boolean;
  added: string;
};

/**
 * The mirror of the catalog, newest first — for the admin and the site: the descriptions only. What the vault server
 * derives from a file (its transcript, its shot analysis) lives under its own catalog keys (`transcript/<hash>`,
 * `analysis/<hash>`) on every Mac and in the bucket (LIBRARY/transcript/, LIBRARY/analysis/) — not here. (A
 * description from before the records may still carry a transcript: its words stay out.)
 */
export async function listVaultFiles(q: { kind?: string; tag?: string } = {}): Promise<VaultFile[]> {
  const { rows } = await db.query<VaultFile & { size: string }>(
    `SELECT hash, size, mime, kind, title, coalesce(meta->>'description', '') AS description, tags, public,
            meta #- '{meta,transcript,words}' #- '{meta,transcript,utterances}' AS meta, stored, added FROM vault_files
      WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR $2 = ANY(tags))
      ORDER BY added DESC`,
    [q.kind ?? null, q.tag ?? null],
  );
  return rows.map((r) => ({ ...r, size: Number(r.size) }));
}
