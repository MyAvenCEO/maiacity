// The film's colour: color.js and transforms.js as units — the colour standard and a grade as data. The grade's maths
// (the CDL, the balance, the presets) is Rust's alone and tested there (vault/crates/vault-render tests/maths.rs,
// tests/gpu.rs), as is the render's colour path (vault/crates/vault-media tests/cst.rs and aces2.rs).
import { expect, test } from "bun:test";
import { detect, exrHeader, exrProfile, fromCct, MID_GREY_CCT, PROFILES, profileOf, REC709_TO_AP1, toCct } from "../../game/film/color.js";
import { cleanStack, cleanTool, newTool, TOOL } from "../../game/film/grade-tools.js";
import {
  canonical, DECODE, hashOf, HLG_SCALE, hlgToScene, monCurve, nitsToPq, pqToNits, rec709ToScene, sha256, SHAPER, shaperToCct,
  srgbToScene, TRANSFORMS,
} from "../../game/film/transforms.js";

// ── color.js ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("the ACEScct curve: 18% grey at 0.4135, and back", () => {
  expect(MID_GREY_CCT).toBeCloseTo(0.4135884, 6);
  for (const lin of [-0.005, 0, 0.001, 0.0078125, 0.18, 1, 16, 222]) expect(fromCct(toCct(lin))).toBeCloseTo(lin, 9);
});

test("detect: our own tag, Apple's metadata, HDR, EXR headers, stills, untagged video — and unknown", () => {
  expect(detect({ tags: { comment: "maiacity:color=acescct" } }).profile).toBe("acescct");
  expect(detect({}, { tags: { comment: "maiacity:color=apple-log-2" } }).profile).toBe("apple-log-2");
  expect(detect({ codec_name: "hevc", color_primaries: "bt2020" }, { tags: { "com.apple.quicktime.camera.log": "Apple Log" } }).profile).toBe("apple-log");
  // Apple's own identifiers (CoreVideo's kCVImageBufferLogTransferFunction_AppleLog2 / _AppleLog)
  expect(detect({ codec_name: "prores" }, { tags: { logs: "com.apple.apple-wide-gamut.apple-log" } }).profile).toBe("apple-log-2");
  expect(detect({ codec_name: "prores" }, { tags: { logs: "com.apple.rec2020.apple-log" } }).profile).toBe("apple-log");
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

test("a grade as data: every tool from the registry, checked, its defaults filled in", () => {
  // the balance's controls in the order they apply (vault-render tools.rs checks the same ranges: its test reads the registry)
  expect(TOOL.balance.params.map((p: any) => [p.key, p.min, p.max])).toEqual([
    ["temp", -2, 2], ["tint", -2, 2], ["exposure", -4, 4], ["contrast", -0.8, 1.5], ["highlights", -3, 3], ["shadows", -3, 3], ["sat", -1, 1],
  ]);
  expect(cleanTool({ tool: "balance", exposure: 9, temp: "x" })).toMatchObject({ exposure: 4, temp: 0 });
  expect(cleanTool({ tool: "cdl", slope: [9, 1, 1], power: [0, 1, 1] })).toMatchObject({ slope: [4, 1, 1], power: [0.1, 1, 1], sat: 1 });
  expect(cleanTool({ tool: "nothing" })).toBeNull();
  expect(cleanTool({ tool: "lut", hash: "x" })).toBeNull();
  // a mask holds tools of its own, three deep at most
  const deep = cleanTool({ tool: "window", tools: [{ tool: "key", tools: [{ tool: "window", tools: [{ tool: "window", tools: [{ tool: "grain" }] }] }] }] });
  expect(deep.tools[0].tools[0].tools[0].tools).toEqual([]);
  expect(newTool("vignette")).toEqual({ tool: "vignette", amount: 0.4, size: 0.9, softness: 0.5, roundness: 0 });
  expect(cleanStack({ tools: [] })).toBeNull();
  expect(cleanStack({ strength: 7, tools: [{ tool: "grain" }] })).toEqual({ tools: [{ tool: "grain", amount: 0.12, size: 1, chroma: 0 }] });
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

test("the colour tools, masks and textures as data: checked as Rust checks them", () => {
  const h = cleanTool({ tool: "hue", sat: 9, hue: [[400, 200], [10, -5]] });
  expect(h.sat).toBe(3);
  expect(h.hue).toEqual([[10, -5], [40, 90]]);
  expect(cleanTool({ tool: "split", sh_hue: 640, sh_amount: 0.4 })).toMatchObject({ sh_hue: 280, sh_amount: 0.4 });
  const w = cleanTool({ tool: "window", shape: "star", w: 9, track: "hand", mix: 3, tools: [{ tool: "balance", exposure: 0.3 }] });
  expect([w.shape, w.w, w.track, w.mix, w.tools[0].exposure]).toEqual(["ellipse", 4, "", 1, 0.3]);
  expect(cleanTool({ tool: "pop", amount: 5 }).amount).toBe(1);
});
