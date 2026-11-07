#!/usr/bin/env bun
/**
 * A machine's reference sheet (its "character sheet"): one clean-lit photographic plate of the one real machine, every
 * view and every detail the model is held to, made by Google's image model (Nano Banana Pro on fal) from the machine's
 * brief and data sheet, and kept on play among its files by its BLAKE3 hash. The plant skill's sheet (plant-skill
 * SKILL.md, "The reference sheet"), for a vehicle or a machine: a studio turnaround instead of a botanical plate.
 *
 *   bun .claude/skills/machine-skill/ours/sheet.ts --brief <brief.md> --out <dir> [--datasheet <datasheet.md>]
 *       [--label "Fiat 500 F, Rosso Corallo"] [--model fal-ai/nano-banana-pro] [--resolution 4K] [--aspect 16:9]
 *       [--n 1] [--search] [--no-upload]
 *
 * The brief is the machine and the plate's layout (ours.md, "The reference sheet"): what it is, exactly (make, model,
 * version, year), its measures, materials and colours with their sources, then `LAYOUT:` row by row. Each image is
 * written as sheet-<k>.png (as made) and sheet-<k>.jpg (at most 4 MB, for play), with prompt.txt and result.json beside
 * them, and kept at once in play's Library (the plant skill's `sheet.ts --upload`, the session's PLAY_MCP_TOKEN),
 * labelled "Reference sheet · <label> · <k>", its hash written to sheet-<k>.hash.
 */
import { $ } from "bun";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const briefFile = arg("brief");
const out = arg("out");
if (!briefFile || !out) {
  console.error("Give --brief <brief.md> and --out <dir>.");
  process.exit(1);
}
const brief = readFileSync(briefFile, "utf8").trim();
const datasheet = arg("datasheet") ? readFileSync(arg("datasheet")!, "utf8") : "";

// What makes the sheet measurable and true: one machine, one light, one background, orthographic views at one scale.
const PLATE = `A product-design reference sheet of ONE real machine, as a car maker's design studio or a museum photographs a restored original for its archive: one large photograph laid out as a clean grid of views and close-ups of exactly this machine, every one a real photograph of the real object, not an illustration, not a 3D render, not a toy or a model.

THE MACHINE (every view is exactly this make, model, version and year, true to its engineering and to the numbers given; where the brief names a detail, draw that detail as it really is), and the LAYOUT of the plate, row by row, each view in its own cell with white space round it and a short thin dark-grey label under it in plain sans-serif:
${brief}

LIGHT AND CAMERA: a pure white seamless studio background (#FFFFFF), large overhead softboxes, 5500 K daylight, soft and even, only a faint contact shadow under the tyres, no hard reflections of the studio, no vignette, no depth-of-field blur: everything sharp edge to edge. The turnaround views (side, front, rear, top) are straight-on orthographic views with a very long lens, no perspective, all at ONE scale, standing on one shared ground line, so their sizes compare. True colours as the paint, chrome, glass, rubber and fabric really look in daylight, nothing saturated or stylised. Ultra-detailed and photographic: panel gaps, chrome reflections, rubber seals, the texture of the canvas, the tread of the tyres, the louvres, the lamp lenses' optics readable.

DO NOT: drawings, sketches, blueprints, cartoons, painterly or CGI looks; people, hands, props, scenery, number plates with text, badges or brand lettering (leave every badge and script off, plates blank); any other model, version or modern replica; modern wheels or modifications; overlapping cells; decorative borders; text other than the labels.`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "prompt.txt"), PLATE + (datasheet ? `\n\n--- context: the data sheet ---\n${datasheet}` : ""));

const model = arg("model", "fal-ai/nano-banana-pro")!;
const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
if (!key) throw new Error("FAL_API_KEY is not set.");
const input: Record<string, unknown> = {
  prompt: PLATE,
  aspect_ratio: arg("aspect", "16:9"),
  resolution: arg("resolution", "4K"),
  output_format: "png",
  num_images: Number(arg("n", "1")),
  ...(flag("search") ? { enable_web_search: true } : {}),
  ...(datasheet && model.includes("nano-banana-pro") ? { context: [{ type: "text", text: `The machine's data sheet, the numbers every view keeps to:\n${datasheet}` }] } : {}),
};
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
const submit: any = await (await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(input) })).json();
if (!submit.status_url) throw new Error(JSON.stringify(submit));
console.error(`${model}: ${submit.request_id}`);
for (;;) {
  const st: any = await (await fetch(submit.status_url, { headers })).json();
  if (st.status === "COMPLETED") break;
  if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") throw new Error(JSON.stringify(st));
  await Bun.sleep(4000);
}
const result: any = await (await fetch(submit.response_url, { headers })).json();
if (!result.images?.length) throw new Error(JSON.stringify(result));
writeFileSync(join(out, "result.json"), JSON.stringify({ model, input: { ...input, prompt: "(prompt.txt)", context: input.context ? "(data sheet)" : undefined }, result }, null, 2));
const plantSheet = resolve(import.meta.dir, "../../plant-skill/scripts/sheet.ts");
for (const [k, img] of result.images.entries()) {
  const png = join(out, `sheet-${k + 1}.png`);
  writeFileSync(png, new Uint8Array(await (await fetch(img.url)).arrayBuffer()));
  const jpg = join(out, `sheet-${k + 1}.jpg`);
  for (const q of [92, 88, 84, 80, 75]) {
    await $`convert ${png} -quality ${q} ${jpg}`.quiet();
    if (statSync(jpg).size <= 3.9e6) break;
  }
  console.log(`${png}  ${img.width}×${img.height}  →  ${jpg} (${(statSync(jpg).size / 1e6).toFixed(2)} MB)`);
  if (!flag("no-upload")) {
    const name = arg("label") ?? brief.split("\n")[0].replace(/[*_#`]/g, "").trim().slice(0, 120);
    const kept = JSON.parse(await $`bun ${plantSheet} --upload ${jpg} --label ${`Reference sheet · ${name} · ${k + 1}`}`.text());
    writeFileSync(join(out, `sheet-${k + 1}.hash`), kept.hash);
    console.log(`  kept in play's Library: ${kept.hash}`);
  }
}
