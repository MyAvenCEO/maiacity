/**
 * Signing a terminal in with the admin's passkey — the device flow.
 *
 * Passkeys belong to maia.city, so a terminal cannot use one itself. Instead it asks for a device code, shows a
 * link, and waits; the admin opens the link on maia.city, sees what is asked, and approves it with their passkey
 * session. The terminal then receives a key — shown once, kept only as its hash — that can do exactly the
 * capabilities it asked for and the admin holds, never more. Revoked keys stop at once.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./pg";
import { can } from "./acl";
import { CAPABILITIES } from "./caps";

export class KeyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const TTL_MIN = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const userCode = () => {
  const b = randomBytes(8);
  const c = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};

/** A terminal asks: here is its code, the link to approve it, and how long it has. */
export async function startDevice(scope: unknown, label: unknown) {
  const caps = String(scope ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!caps.length || caps.some((c) => !(c in CAPABILITIES))) throw new KeyError("Ask for known capabilities.");
  const device_code = randomBytes(32).toString("base64url");
  const user_code = userCode();
  await db.query(
    `INSERT INTO device_codes (device_code, user_code, scope, label, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [device_code, user_code, caps.join(","), String(label ?? "a terminal").slice(0, 80), String(TTL_MIN)],
  );
  return { device_code, user_code, expires_in: TTL_MIN * 60, interval: 3 };
}

/** What the approval page shows. */
export async function deviceInfo(user_code: string) {
  const { rows } = await db.query<{ scope: string; label: string; approved_at: string | null; expires_at: string }>(
    "SELECT scope, label, approved_at, expires_at FROM device_codes WHERE user_code = $1 AND used_at IS NULL AND expires_at > now()",
    [user_code.toUpperCase()],
  );
  if (!rows[0]) throw new KeyError("This code is unknown, used or expired. Start again in the terminal.", 404);
  return { ...rows[0], scope: rows[0].scope.split(","), descriptions: rows[0].scope.split(",").map((c) => CAPABILITIES[c] ?? c) };
}

/** The admin says yes — but only for what they can do themselves. */
export async function approveDevice(user_code: string, me: { id: string; role: string }) {
  const info = await deviceInfo(user_code);
  const missing = info.scope.filter((c) => !can(me, c));
  if (missing.length) throw new KeyError(`You cannot hand on what you do not hold: ${missing.join(", ")}.`, 403);
  await db.query("UPDATE device_codes SET founder_id = $2, approved_at = now() WHERE user_code = $1", [user_code.toUpperCase(), me.id]);
}

/** The terminal asks again: once approved, it gets its key — exactly once. */
export async function redeemDevice(device_code: unknown): Promise<{ key: string } | { pending: true }> {
  const { rows } = await db.query<{ founder_id: string | null; scope: string; label: string; used_at: string | null; expired: boolean }>(
    "SELECT founder_id, scope, label, used_at, expires_at < now() AS expired FROM device_codes WHERE device_code = $1",
    [String(device_code ?? "")],
  );
  const d = rows[0];
  if (!d || d.used_at || d.expired) throw new KeyError("This code is unknown, used or expired. Start again.", 410);
  if (!d.founder_id) return { pending: true };
  const key = `mck_${randomBytes(32).toString("base64url")}`;
  await db.transaction(async (tx) => {
    await tx.query("UPDATE device_codes SET used_at = now() WHERE device_code = $1", [device_code]);
    await tx.query("INSERT INTO api_keys (founder_id, hash, scope, label) VALUES ($1, $2, $3, $4)", [d.founder_id, hash(key), d.scope, d.label]);
  });
  return { key };
}

/** Who a bearer key speaks for, and what it may do: the key's scope, and never more than their role holds now. */
export async function keyHolder(req: Request): Promise<{ id: string; role: string; scope: string[] } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer (mck_[\w-]+)$/.exec(auth)?.[1];
  if (!key) return null;
  const { rows } = await db.query<{ id: string; role: string; scope: string }>(
    `UPDATE api_keys k SET last_used = now() FROM founders f
      WHERE k.hash = $1 AND k.revoked_at IS NULL AND f.id = k.founder_id
      RETURNING f.id, f.role, k.scope`,
    [hash(key)],
  );
  return rows[0] ? { id: rows[0].id, role: rows[0].role, scope: rows[0].scope.split(",") } : null;
}

export async function revokeKey(req: Request): Promise<boolean> {
  const key = /^Bearer (mck_[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!key) return false;
  const r = await db.query("UPDATE api_keys SET revoked_at = now() WHERE hash = $1 AND revoked_at IS NULL", [hash(key)]);
  return r.affectedRows > 0;
}
