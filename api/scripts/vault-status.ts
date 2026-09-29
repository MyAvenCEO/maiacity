// The vault as production sees it: the server peer's published node, the paired devices, and how many files of the
// mirror are stored in Object Storage (read-only; uses this terminal's key).
//
//   bun api/scripts/vault-status.ts [--files]
import { call, mb, say } from "./media-client";

const join = await call<{ server: string | null; catalog: string | null; relay: string | null }>("/api/vault/join");
const devices = await call<{ endpoint_id: string; label: string; seen: string | null; revoked_at: string | null }[]>("/api/vault/devices");
const files = await call<{ hash: string; size: number; stored: boolean; public: boolean; title: string }[]>("/api/vault/files");
say(`server peer: ${join.server ? join.server.slice(0, 16) + "…" : "not started"} · relay ${join.relay ?? "—"}`);
say(`paired devices: ${devices.filter((d) => !d.revoked_at).length}`);
for (const d of devices) say(`  ${d.endpoint_id.slice(0, 16)}…  ${d.label}${d.revoked_at ? "  (revoked)" : ""}`);
const stored = files.filter((f) => f.stored);
say(`mirror: ${files.length} files (${mb(files.reduce((n, f) => n + f.size, 0))}) · in Object Storage: ${stored.length} (${mb(stored.reduce((n, f) => n + f.size, 0))})`);
if (process.argv.includes("--files")) for (const f of files) say(`  ${f.stored ? "✓" : "…"} ${f.hash.slice(0, 12)}  ${mb(f.size).padStart(9)}  ${f.public ? "public " : "private"}  ${f.title}`);
