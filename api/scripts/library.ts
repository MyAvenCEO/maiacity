// EXR sequences, for the vault: a folder of frames packed into one tar, the same frames always the same bytes (and so
// the same hash). The files themselves live in the vault (scripts/film/vault.mjs) — the library/ folder this module
// once kept is retired.
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** A 512-byte POSIX ustar header, deterministic: no owner, no time, mode 0644. */
function tarHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, text: string) => h.set(new TextEncoder().encode(text), at);
  const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
  put(0, name);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, octal(size, 12));
  put(136, octal(0, 12));
  put(148, "        ");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  const sum = h.reduce((n, b) => n + b, 0);
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/**
 * Pack an EXR sequence (a folder of frames, in name order) into one tar: the frames renamed 000000.exr, 000001.exr, …,
 * with no dates or owners, so the same frames always give the same bytes and the same hash. Written to `out`.
 * Returns the number of frames.
 */
export async function packSequence(dir: string, out: string): Promise<{ frames: number; first: string }> {
  const names = (await readdir(dir)).filter((f) => /\.exr$/i.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!names.length) throw new Error(`${dir} holds no .exr frames`);
  const fh = await open(out, "w");
  try {
    for (const [i, f] of names.entries()) {
      const bytes = new Uint8Array(await readFile(join(dir, f)));
      await fh.write(tarHeader(`${String(i).padStart(6, "0")}.exr`, bytes.length));
      await fh.write(bytes);
      const pad = (512 - (bytes.length % 512)) % 512;
      if (pad) await fh.write(new Uint8Array(pad));
    }
    await fh.write(new Uint8Array(1024));
  } finally {
    await fh.close();
  }
  if ((await stat(out)).size < 1536) throw new Error("the tar came out empty");
  return { frames: names.length, first: join(dir, names[0]!) };
}
