// World clips in the render worker (contracts C1, C2, C4): one plate per delivery shape at that shape's resolution,
// rendered by stream B's renderPlate and cached by B's fingerprint — here with a fake renderer, as B's module is
// separate work. A plate is an ACEScct picture: it enters the timeline by the identity transform.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platesFor, RENDER_MODULE, SHOT_MODULE, worldModules } from "../../scripts/film/plates.mjs";
import { pieceFilters } from "../../scripts/film/picture.mjs";
import { codingOf } from "../../scripts/film/color/ffmpeg.mjs";

const clip = { id: "w1", kind: "world", shot: "shot-uuid", shotVersion: 3, in: 1.5, dur: 2, track: "V1", start: 10 };
const shapes = [{ aspect: "16:9", width: 3840, height: 2160 }, { aspect: "9:16", width: 1080, height: 1920 }];

function fakes() {
  const calls: any[] = [], fetched: any[] = [];
  const renderPlate = async (o: any) => {
    calls.push(o);
    writeFileSync(o.out, `plate ${o.shape}`);
    return { file: o.out, frames: Math.round((o.to - o.from) * o.fps), ev: 11.5 };
  };
  const fingerprint = (spec: any, what: any) => `fp-${spec.seconds}-${what.shape}-${what.width}`;
  const fetchShot = async (id: string, v: number | undefined) => (fetched.push([id, v]), { id, version: v, spec: { seconds: 8, fps: 30 } });
  return { calls, fetched, renderPlate, fingerprint, fetchShot };
}

test("a world clip gets one plate per shape, of its stretch of the shot, at the shape's own resolution", async () => {
  const cache = mkdtempSync(join(tmpdir(), "plates-"));
  const f = fakes();
  const plates = await platesFor(clip, shapes, { fps: 30, site: "http://localhost:5174", cache, ...f });
  expect(f.fetched).toEqual([["shot-uuid", 3]]); // the version it was cut with
  expect(f.calls.map((c) => [c.shape, c.width, c.height, c.from, c.to, c.fps])).toEqual([["16:9", 3840, 2160, 1.5, 3.5, 30], ["9:16", 1080, 1920, 1.5, 3.5, 30]]);
  expect(f.calls[0].spec).toEqual({ seconds: 8, fps: 30 });
  expect(f.calls[0].site).toBe("http://localhost:5174");
  for (const p of plates.values()) expect(existsSync(p.file)).toBe(true);
  expect(plates.get("16:9")!.reused).toBe(false);
  // rendered again: every plate from the cache, the renderer not called
  const again = await platesFor(clip, shapes, { fps: 30, site: "x", cache, ...f });
  expect(f.calls.length).toBe(2);
  expect([...again.values()].every((p) => p.reused)).toBe(true);
  expect(again.get("9:16")!.file).toBe(plates.get("9:16")!.file);
  // a trimmed clip is a different plate
  await platesFor({ ...clip, dur: 1 }, shapes.slice(0, 1), { fps: 30, site: "x", cache, ...f });
  expect(f.calls.length).toBe(3);
});

test("a world clip without a shot, or a shot without a spec, fails the render plainly", async () => {
  const cache = mkdtempSync(join(tmpdir(), "plates-"));
  const f = fakes();
  await expect(platesFor({ ...clip, shot: undefined }, shapes, { fps: 30, site: "x", cache, ...f })).rejects.toThrow(/names no shot/);
  await expect(platesFor(clip, shapes, { fps: 30, site: "x", cache, ...f, fetchShot: async () => null })).rejects.toThrow(/has no spec/);
});

test("until stream B's renderer is in the build, world clips say so", async () => {
  if (existsSync(RENDER_MODULE) && existsSync(SHOT_MODULE)) return; // B's modules are here: nothing to check
  await expect(worldModules()).rejects.toThrow(/stream B's plate renderer/);
});

const hasOcio = spawnSync("python3", ["-c", "import PyOpenColorIO, numpy"]).status === 0;

test.skipIf(!hasOcio)("a plate enters the timeline as ACEScct: identity input transform, then grade and the output transform", () => {
  const source = { profile: "acescct", coding: codingOf({ pix_fmt: "yuv420p10le", color_space: "bt709", height: 2160 }), width: 3840, height: 2160 } as any;
  const p = pieceFilters({ source, W: 3840, H: 2160, frames: 60, fps: 30, look: null });
  expect(Object.keys(p.used).sort()).toEqual(["idt-acescct", "odt-rec709"]);
  expect(p.filters.some((x) => x.startsWith("zscale=w="))).toBe(false); // native resolution: no scaling
  expect(p.filters.at(-2)).toBe("format=yuv420p10le");
});
