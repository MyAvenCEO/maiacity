/**
 * The public copies. Postgres keeps every file; Bunny hands them out — images, sounds and documents from the
 * storage zone behind the CDN (maia.city/media/<cid>.<ext>), videos from Bunny Stream. A CID's bytes never change,
 * so a copy made once is good for good. Everything is derived from BUNNY_API_KEY (the account key): the storage
 * zone's password and the Stream library's key are read from the account API, never stored.
 */
import { EXT, markDistributed, mediaBytes, undistributed } from "./media";

const API = "https://api.bunny.net";
const STORAGE_ZONE = "maiacity";
const STREAM_LIBRARY = "maiaCITY";

const key = () => process.env.BUNNY_API_KEY?.trim() ?? "";
export const canDistribute = () => !!key();

async function account<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { AccessKey: key(), accept: "application/json" } });
  if (!res.ok) throw new Error(`Bunny ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

let zone: Promise<{ base: string; password: string }> | null = null;
const storage = () =>
  (zone ??= account<any[]>("/storagezone").then((zones) => {
    const z = zones.find((x) => x.Name === STORAGE_ZONE);
    if (!z) throw new Error(`no storage zone ${STORAGE_ZONE}`);
    const host = z.Region === "DE" ? "storage.bunnycdn.com" : `${String(z.Region).toLowerCase()}.storage.bunnycdn.com`;
    return { base: `https://${host}/${z.Name}`, password: z.Password as string };
  }));

let lib: Promise<{ id: number; key: string }> | null = null;
const stream = () =>
  (lib ??= account<{ Items: any[] }>("/videolibrary?page=1&perPage=100").then(({ Items }) => {
    const l = Items.find((x) => x.Name === STREAM_LIBRARY);
    if (!l) throw new Error(`no stream library ${STREAM_LIBRARY}`);
    return { id: l.Id as number, key: l.ApiKey as string };
  }));

async function distributeOne(m: { cid: string; mime: string; kind: string; path: string | null }) {
  const body = new Blob([(await mediaBytes(m.cid)) as BlobPart]);
  if (m.kind === "video") {
    const { id, key: libKey } = await stream();
    const vapi = `https://video.bunnycdn.com/library/${id}`;
    const title = m.path?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? m.cid;
    const created = await (await fetch(`${vapi}/videos`, { method: "POST", headers: { AccessKey: libKey, "content-type": "application/json" }, body: JSON.stringify({ title }) })).json();
    const up = await fetch(`${vapi}/videos/${created.guid}`, { method: "PUT", headers: { AccessKey: libKey }, body });
    if (!up.ok) throw new Error(`Stream upload ${m.cid} → ${up.status}`);
    await markDistributed(m.cid, { stream_guid: created.guid });
  } else {
    const { base, password } = await storage();
    const cdnPath = `media/${m.cid}.${EXT[m.mime] ?? "bin"}`;
    const res = await fetch(`${base}/${cdnPath}`, { method: "PUT", headers: { AccessKey: password, "content-type": "application/octet-stream" }, body });
    if (!res.ok) throw new Error(`CDN upload ${cdnPath} → ${res.status}`);
    await markDistributed(m.cid, { cdn_path: cdnPath });
  }
}

let running: Promise<{ done: number; failed: string[] }> | null = null;
/** Copy out everything that has no public copy yet — one run at a time; a second call joins the first. */
export function distributePending(): Promise<{ done: number; failed: string[] }> {
  if (!canDistribute()) return Promise.resolve({ done: 0, failed: [] });
  return (running ??= (async () => {
    let done = 0;
    const failed: string[] = [];
    try {
      for (const m of await undistributed()) {
        try {
          await distributeOne(m);
          done++;
        } catch (e) {
          console.error(`distribute ${m.cid}:`, (e as Error).message);
          failed.push(m.cid);
        }
      }
    } finally {
      running = null;
    }
    return { done, failed };
  })());
}
