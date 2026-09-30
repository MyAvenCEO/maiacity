// The film's colour: color.js and transforms.js as units, and the worker's ffmpeg colour path measured against
// OpenColorIO itself and against the maths (skipped where ffmpeg or OCIO is missing on the machine).
import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdl, cleanCdl, detect, exrHeader, exrProfile, fromCct, isNeutral, MID_GREY_CCT, PRESETS, PROFILES, profileOf, REC709_TO_AP1, toCct } from "../../game/film/color.js";
import {
  canonical, DECODE, hashOf, HLG_SCALE, hlgToScene, monCurve, nitsToPq, OCIO_CONFIG, pqToNits, rec709ToScene, sha256, SHAPER, shaperToCct,
  srgbToScene, TRANSFORMS,
} from "../../game/film/transforms.js";

process.env.MAIACITY_CACHE ??= mkdtempSync(join(tmpdir(), "maiacity-color-test-"));
const hasFfmpeg = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout?.includes("zscale") ?? false;
const hasOcio = spawnSync("python3", ["-c", "import PyOpenColorIO, numpy"]).status === 0;

// ── color.js ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("the ACEScct curve: 18% grey at 0.4135, and back", () => {
  expect(MID_GREY_CCT).toBeCloseTo(0.4135884, 6);
  for (const lin of [-0.005, 0, 0.001, 0.0078125, 0.18, 1, 16, 222]) expect(fromCct(toCct(lin))).toBeCloseTo(lin, 9);
});

test("detect: our own tag, Apple's metadata, HDR, EXR headers, stills, untagged video — and unknown", () => {
  expect(detect({ tags: { comment: "maiacity:color=acescct" } }).profile).toBe("acescct");
  expect(detect({}, { tags: { comment: "maiacity:color=apple-log-2" } }).profile).toBe("apple-log-2");
  expect(detect({ codec_name: "hevc", color_primaries: "bt2020" }, { tags: { "com.apple.quicktime.camera.log": "Apple Log" } }).profile).toBe("apple-log");
  expect(detect({ color_transfer: "arib-std-b67", color_primaries: "bt2020" }).profile).toBe("hlg");
  expect(detect({ color_transfer: "smpte2084" }).profile).toBe("pq");
  const iphone = detect({ codec_name: "hevc", color_primaries: "bt2020", pix_fmt: "yuv420p10le" }, { tags: { "com.apple.quicktime.make": "Apple" } });
  expect(iphone.profile).toBe("unknown"); // which log it is must be said, not guessed
  expect(iphone.bitDepth).toBe(10);
  const exr = { codec_name: "exr", pix_fmt: "gbrpf32le" };
  expect(detect(exr, {}, "image", { exr: { chromaticities: [0.7347, 0.2653, 0, 1, 0.0001, -0.077, 0.32168, 0.33767] } }).profile).toBe("aces2065-1");
  expect(detect(exr, {}, "image", { exr: { chromaticities: [0.713, 0.293, 0.165, 0.83, 0.128, 0.044, 0.32168, 0.33767] } }).profile).toBe("acescg");
  expect(detect(exr, {}, "image", { exr: {} }).profile).toBe("linear-rec709"); // no chromaticities: Rec.709, by the spec
  expect(detect(exr, {}, "image", { exr: { aces: true } }).profile).toBe("aces2065-1");
  expect(detect(exr, {}, "image", { exr: { chromaticities: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329] } }).profile).toBe("unknown"); // P3: not ours
  expect(detect(exr).bitDepth).toBe(32);
  expect(detect(exr, {}, "video", { sequence: { color: { profile: "acescg" } } }).profile).toBe("acescg");
  expect(detect({ pix_fmt: "rgb24" }, {}, "image").profile).toBe("srgb");
  expect(detect({ pix_fmt: "yuv420p" }).profile).toBe("rec709");
  expect(detect({ pix_fmt: "yuv420p", color_primaries: "bt709" }).detectedFrom).toMatch(/Rec\.709/);
  expect(detect({ pix_fmt: "yuv420p10le" }).profile).toBe("unknown");
});

test("profiles: the override wins; every profile has its input transform into ACEScct", () => {
  expect(profileOf({ profile: "rec709", override: "apple-log" })).toBe("apple-log");
  expect(profileOf(undefined)).toBe("unknown");
  // a profile no longer in the table counts as none: the override falls back to the detected one, else unknown
  expect(profileOf({ profile: "rec709", override: "legacy" })).toBe("rec709");
  expect(profileOf({ profile: "legacy" })).toBe("unknown");
  expect(Object.keys(PROFILES)).not.toContain("legacy");
  for (const [name, p] of Object.entries(PROFILES)) {
    expect(Object.keys(p).sort()).toEqual(["idt", "label", "linear", "log"]);
    if (name === "acescct") expect(p.idt).toBeNull();
    else expect(TRANSFORMS[p.idt as keyof typeof TRANSFORMS]).toBeDefined();
  }
  expect(PROFILES.rec709.idt).toBe("idt-rec709");
  expect(PROFILES.srgb.idt).toBe("idt-srgb");
  expect(detect({ tags: { comment: "maiacity:color=legacy" }, pix_fmt: "yuv420p", color_primaries: "bt709" }).profile).toBe("rec709");
});

test("an EXR header is read for its chromaticities and channels", () => {
  // magic, version, then attributes: name\0 type\0 size(u32) data … and a terminating \0
  const parts: number[] = [];
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); parts.push(...b); };
  const str = (s: string) => parts.push(...new TextEncoder().encode(s), 0);
  u32(20000630); u32(2);
  str("channels"); str("chlist");
  const ch: number[] = [];
  for (const c of ["B", "G", "R"]) ch.push(...new TextEncoder().encode(c), 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);
  ch.push(0);
  u32(ch.length); parts.push(...ch);
  str("chromaticities"); str("chromaticities"); u32(32);
  const f = new Uint8Array(32), v = new DataView(f.buffer);
  [0.7347, 0.2653, 0, 1, 0.0001, -0.077, 0.32168, 0.33767].forEach((x, i) => v.setFloat32(i * 4, x, true));
  parts.push(...f, 0);
  const h = exrHeader(new Uint8Array(parts));
  expect(h?.channels).toEqual(["B", "G", "R"]);
  expect(exrProfile(h)).toBe("aces2065-1");
  expect(exrHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
});

test("the grade: CDL maths, presets, cleaning", () => {
  expect(cdl(PRESETS.neutral.cdl, [0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
  const g = { slope: [2, 1, 1], offset: [0.1, 0, 0], power: [1, 2, 1], sat: 1 } as const;
  const [r, gg] = cdl(g as any, [0.2, 0.5, 0.5]);
  expect(r).toBeCloseTo(0.5, 12);
  expect(gg).toBeCloseTo(0.25, 12);
  expect(cdl({ slope: [1, 1, 1], offset: [-0.5, 0, 0], power: [2, 1, 1], sat: 1 }, [0.2, 0, 0])[0]).toBe(0); // negatives held at 0 before a power
  expect(isNeutral(cleanCdl({}))).toBe(true);
  expect(cleanCdl({ slope: [9, 1, 1] })!.slope[0]).toBe(4);
  for (const p of Object.values(PRESETS)) expect(cleanCdl(p.cdl) === null).toBe(isNeutral(p.cdl));
});

// ── transforms.js ─────────────────────────────────────────────────────────────────────────────────────────────────

test("hashes: SHA-256 as the standard says, and the same config gives the same hash however it is written", () => {
  expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  expect(hashOf({ x: 1, y: 2 })).toBe(hashOf({ y: 2, x: 1 }));
  expect(hashOf(TRANSFORMS["odt-rec709"])).not.toBe(hashOf(TRANSFORMS["idt-rec709"]));
  expect(hashOf(TRANSFORMS["odt-rec709"])).toMatch(/^[0-9a-f]{16}$/);
});

/** One pixel through a `math` input transform, as cst.rs `Journey::apply` does it: curve × scale, 3×3, ACEScct. */
const journey = (name: keyof typeof TRANSFORMS, rgb: number[]) => {
  const c = TRANSFORMS[name] as { kind: "math"; decode: keyof typeof DECODE; scale: number; matrix: number[][] | null };
  const lin = rgb.map((v) => DECODE[c.decode](v) * c.scale);
  return (c.matrix ? c.matrix.map((row) => row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!) : lin).map(toCct);
};

test("Rec.709 and sRGB are camera-curve journeys into ACEScct, formula for formula as cst.rs", () => {
  for (const [name, decode] of [["idt-rec709", "rec709"], ["idt-srgb", "srgb"]] as const)
    expect(TRANSFORMS[name]).toEqual({ kind: "math", decode, scale: 1, matrix: REC709_TO_AP1, to: "acescct" });
  // the curves: OCIO's ExponentWithLinear (moncurve) — 1/0.45 and 0.099; 2.4 and 0.055; the toe joined continuously
  expect(rec709ToScene(0)).toBe(0);
  expect(rec709ToScene(1)).toBeCloseTo(1, 14);
  expect(rec709ToScene(0.5)).toBeCloseTo(0.25958940050628576, 14);
  expect(rec709ToScene(0.04)).toBeCloseTo(0.04 * 0.22154349835491097, 14); // the toe: slope 1/4.514, not BT.709's 1/4.5
  expect(srgbToScene(0.5)).toBeCloseTo(0.21404114048223255, 14); // IEC 61966-2-1
  expect(srgbToScene(0.02)).toBeCloseTo(0.02 * 0.07738015446708736, 14); // slope 1/12.923, not IEC's 1/12.92
  expect(srgbToScene(-0.01)).toBeCloseTo(-0.01 * 0.07738015446708736, 14); // below 0 the toe carries on
  for (const [g, o] of [[1 / 0.45, 0.099], [2.4, 0.055]] as const) {
    const brk = o / (g - 1);
    expect(monCurve(brk - 1e-12, g, o)).toBeCloseTo(monCurve(brk, g, o), 10); // continuous at the break
  }
  expect(DECODE.rec709).toBe(rec709ToScene);
  expect(DECODE.srgb).toBe(srgbToScene);
  // mid grey: the Rec.709 code value of 18% (1.099 · 0.18^0.45 − 0.099) lands on ACEScct 0.4135884
  const grey = 1.099 * 0.18 ** 0.45 - 0.099;
  expect(rec709ToScene(grey)).toBeCloseTo(0.18, 12);
  for (const v of journey("idt-rec709", [grey, grey, grey])) expect(v).toBeCloseTo(0.4135884, 6);
  // cst.rs's reference (vault-media/tests/cst_reference.txt, colour-science 0.4.7 in float64): within 1e-5 ACEScct
  const reference: [keyof typeof TRANSFORMS, number[], number[]][] = [
    ["idt-rec709", [0, 0, 0], [0.0729055341958, 0.0729055341958, 0.0729055341958]],
    ["idt-rec709", [0.05, 0.05, 0.05], [0.18400307071, 0.18400307071, 0.18400307071]],
    ["idt-rec709", [0.18, 0.18, 0.18], [0.30392511934, 0.30392511934, 0.30392511934]],
    ["idt-rec709", [0.5, 0.5, 0.5], [0.443738777504, 0.443738777504, 0.443738777504]],
    ["idt-rec709", [1, 1, 1], [0.554794520548, 0.554794520548, 0.554794520548]],
    ["idt-rec709", [1, 0, 0], [0.51450845875, 0.336043711423, 0.235152954475]],
    ["idt-rec709", [0.05, 0.4, 1], [0.375180096048, 0.410200511868, 0.545105604054]],
    ["idt-rec709", [0.4, 0.05, 0.05], [0.373290696102, 0.242143089416, 0.205691380663]],
    ["idt-srgb", [0.01, 0.01, 0.01], [0.0810615864415, 0.0810615864415, 0.0810615864415]],
    ["idt-srgb", [0.18, 0.18, 0.18], [0.258012282599, 0.258012282599, 0.258012282599]],
    ["idt-srgb", [0.5, 0.5, 0.5], [0.427851599677, 0.427851599677, 0.427851599677]],
    ["idt-srgb", [0, 1, 0], [0.465843712057, 0.547601412865, 0.372712429302]],
    ["idt-srgb", [0.05, 0.4, 1], [0.360880099152, 0.390193183775, 0.54468374569]],
    ["idt-srgb", [0.4, 0.05, 0.05], [0.349827502563, 0.197095964253, 0.142407408653]],
  ];
  for (const [name, rgb, want] of reference) journey(name, rgb).forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(1e-5));
});

test("HDR signals as scene light: BT.2408's grey lands on 18%; PQ both ways", () => {
  expect(hlgToScene(0.38) * HLG_SCALE).toBeCloseTo(0.18, 10);
  expect(hlgToScene(-0.1)).toBe(0); // below 0 held at 0, as cst.rs
  expect(hlgToScene(0.75) * HLG_SCALE).toBeCloseTo(0.99, 2); // HLG reference white ≈ scene 1.0
  expect(hlgToScene(1)).toBeCloseTo(1, 6);
  expect(pqToNits(1)).toBeCloseTo(10000, 3);
  for (const n of [0.01, 1, 26, 100, 203, 1000, 4000]) expect(pqToNits(nitsToPq(n))).toBeCloseTo(n, 6);
  expect(nitsToPq(203)).toBeCloseTo(0.5807, 3); // BT.2408's 58% PQ reference white
  // the shaper's LUT entry: PQ of the offset linear value, back to ACEScct
  for (const lin of [0, 0.01, 0.18, 1, 100]) expect(shaperToCct(nitsToPq(((lin + SHAPER.offset) / (1 + SHAPER.offset)) * SHAPER.npl))).toBeCloseTo(toCct(lin), 8);
});

// ── the ffmpeg colour path ────────────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasOcio)("every clip takes the one path", () => {
  test("input transform → grades → output transform; unknown colour and profiles from an older table as Rec.709", async () => {
    const { clipColor, codingOf } = await import("../../scripts/film/color/ffmpeg.mjs");
    const coding = codingOf({ pix_fmt: "yuv420p", color_space: "bt709", height: 1080 });
    for (const [profile, idt] of [["rec709", "idt-rec709"], ["srgb", "idt-srgb"], ["unknown", "idt-rec709"], ["legacy", "idt-rec709"], ["acescct", "idt-acescct"]] as const) {
      const c = clipColor({ profile: profile as any, coding, grade: null, look: null });
      expect(Object.keys(c.used).sort()).toEqual([idt, "odt-rec709"]);
      expect(c.before[0]).toBe("zscale=min=709:rin=limited:r=full");
      expect(c.after.at(-2)).toBe("format=yuv420p10le");
      expect(c).not.toHaveProperty("bypass");
    }
    // Rec.709 and sRGB by exact maths: their curve as a 1D LUT, the 3×3 into AP1, the ACEScct shaper — no 3D LUT
    const rec = clipColor({ profile: "rec709", coding, grade: PRESETS.warm.cdl, look: PRESETS.cold.cdl });
    expect(rec.before.filter((f) => f.startsWith("lut3d"))).toEqual([]);
    expect(rec.before.filter((f) => f.startsWith("colorchannelmixer")).length).toBe(1);
    expect(Object.keys(rec.used).sort()).toEqual(["grade:clip", "grade:look", "idt-rec709", "odt-rec709"]);
    expect(clipColor({ profile: "srgb", coding }).used["idt-srgb"]).not.toBe(rec.used["idt-rec709"]);
  }, 60000);
});

// ── the ffmpeg colour path, measured ──────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasFfmpeg || !hasOcio)("the worker's colour path against OCIO", () => {
  let m: typeof import("../../scripts/film/color/measure.mjs");
  let fx: typeof import("../../scripts/film/color/ffmpeg.mjs");
  beforeAll(async () => {
    m = await import("../../scripts/film/color/measure.mjs");
    fx = await import("../../scripts/film/color/ffmpeg.mjs");
  });
  const lin = () => {
    const r = m.rng(3);
    return [...Array(3000)].map(() => [0, 0, 0].map(() => (r() < 0.03 ? -r() * 0.005 : 2 ** (r() * 20 - 12))));
  };

  test("linear light → ACEScct (3×3 + PQ-shaped 1D LUT) is within 0.05 10-bit code values of OCIO", () => {
    const px = lin();
    const shaper = m.diff(m.throughFfmpeg(px, fx.linearToCct().filters), px.map((p) => p.map(toCct)));
    expect(shaper.max).toBeLessThan(0.05);
    for (const [name, src] of [["idt-aces2065-1", "ACES2065-1"], ["idt-acescg", "ACEScg"], ["idt-linear-rec709", "Linear Rec.709 (sRGB)"]] as const) {
      const got = m.throughFfmpeg(px, fx.idtFilters(name).filters);
      const want = m.throughOcio({ kind: "ocio-convert", config: OCIO_CONFIG, src, dst: "ACEScct" }, px);
      // far outside AP1 (linear below −1/128) the shaper holds; the output transform's domain starts at 0 anyway
      const keep = want.map((p) => p.every((v) => v >= toCct(-SHAPER.offset)));
      const d = m.diff(got.filter((_, i) => keep[i]), want.filter((_, i) => keep[i]));
      expect(d.max).toBeLessThan(0.05);
    }
  }, 60000);

  test("the output transform (129³, tetrahedral) matches OCIO on realistic scene colours", () => {
    const px = m.realistic(m.rng(5));
    const d = m.diff(m.throughFfmpeg(px, fx.odtFilters().filters), m.throughOcio(TRANSFORMS["odt-rec709"], px));
    expect(d.p99).toBeLessThan(1.5);
    expect(d.max).toBeLessThan(8);
    // an ACEScct grey ramp: every step within 2 code values
    const ramp = [...Array(256)].map((_, i) => { const v = 0.1 + (i / 255) * 0.75; return [v, v, v]; });
    expect(m.diff(m.throughFfmpeg(ramp, fx.odtFilters().filters), m.throughOcio(TRANSFORMS["odt-rec709"], ramp)).max).toBeLessThan(2);
  }, 60000);

  test("camera log: Apple Log (65³) within ~2 code values of OCIO; Apple Log 2 by exact maths, within 0.05", () => {
    const r = m.rng(7);
    const px = [...Array(3000)].map(() => { const base = 0.15 + r() * 0.65; return [0, 0, 0].map(() => base + (r() - 0.5) * 0.12); });
    const v1 = m.diff(m.throughFfmpeg(px, fx.idtFilters("idt-apple-log").filters), m.throughOcio(TRANSFORMS["idt-apple-log"], px));
    expect(v1.max).toBeLessThan(2.5);
    // Apple Log 2: curve (1D) → one 3×3 → the PQ-shaped ACEScct encoding, no 3D LUT. Below the shaper's floor
    // (linear −1/128, under ACEScct 0) it holds — the grade and the output transform start at 0 anyway.
    const f = fx.idtFilters("idt-apple-log-2").filters;
    expect(f.some((x) => x.startsWith("lut3d"))).toBe(false);
    const got = m.throughFfmpeg(px, f), want = m.throughOcio(TRANSFORMS["idt-apple-log-2"], px);
    const keep = want.map((p) => p.every((v) => v >= toCct(-SHAPER.offset)));
    expect(m.diff(got.filter((_, i) => keep[i]), want.filter((_, i) => keep[i])).max).toBeLessThan(0.05);
  }, 60000);

  test("saturated colours at the gamut edge: the render's 129³ output transform stays close to OCIO", () => {
    // pure and near-pure Rec.709 primaries and secondaries, taken into ACEScct by their journey — where ACES 2.0 bends
    const r = m.rng(11);
    const edge = [...Array(2000)].map(() => { const c = [0, 1, 2].map(() => (r() < 0.5 ? r() * 0.08 : 0.85 + r() * 0.15)); return c; });
    const cct = edge.map((p) => journey("idt-rec709", p));
    const d = m.diff(m.throughFfmpeg(cct, fx.odtFilters().filters), m.throughOcio(TRANSFORMS["odt-rec709"], cct));
    expect(d.p99).toBeLessThan(20); // measured with bake.py's tetrahedral: 129³ ~12, 65³ ~27
  }, 120000);

  test("Rec.709, sRGB, HLG and PQ by exact maths in ffmpeg match their journeys", () => {
    const px = [...Array(400)].map((_, i) => { const v = i / 399; return [v, v * 0.9, v * 0.8]; });
    for (const name of ["idt-rec709", "idt-srgb", "idt-hlg", "idt-pq"] as const) {
      const f = fx.idtFilters(name).filters;
      expect(f.some((x) => x.startsWith("lut3d"))).toBe(false);
      expect(m.diff(m.throughFfmpeg(px, f), px.map((p) => journey(name, p))).max).toBeLessThan(0.1);
    }
  }, 60000);

  test("the grade in ffmpeg is cdl() of color.js", () => {
    const r = m.rng(11);
    const px = [...Array(2000)].map(() => [r() * 1.2, r() * 1.2, r() * 1.2]);
    for (const p of Object.values(PRESETS)) {
      const got = m.throughFfmpeg(px, fx.cdlFilters(p.cdl).filters);
      expect(m.diff(got, px.map((x) => cdl(p.cdl, x as [number, number, number]))).max).toBeLessThan(0.05);
    }
  }, 60000);

  test("a Rec.709 clip goes the one path: idt-rec709 → (grade) → odt-rec709, 10-bit YUV out", async () => {
    const { pieceFilters } = await import("../../scripts/film/picture.mjs");
    const { sourceOf } = await import("../../scripts/film/sources.mjs");
    const dir = mkdtempSync(join(tmpdir(), "maiacity-rec709-"));
    const file = join(dir, "rec709.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=1", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", file]);
    const src = sourceOf(file, null);
    expect(src.profile).toBe("rec709");
    for (const look of [null, PRESETS.cold.cdl]) {
      const piece = pieceFilters({ source: src, W: 1920, H: 1080, frames: 10, fps: 30, look });
      expect(Object.keys(piece.used).sort()).toEqual(look ? ["grade:look", "idt-rec709", "odt-rec709"] : ["idt-rec709", "odt-rec709"]);
      const out = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-filter_complex", `[0:v]${piece.filters.join(",")}[v]`, "-map", "[v]", "-frames:v", "10", "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
      expect(out.status).toBe(0);
      expect(out.stdout.length).toBe(1920 * 1080 * 1.5 * 2 * 10);
    }
  }, 60000);
});
