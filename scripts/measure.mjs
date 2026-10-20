#!/usr/bin/env bun
// @ts-nocheck — plain JS, kept loose on purpose
// THE MEASURER — the job that measures Maia City's AIPs with the measuring logic their objectives name, as a vault of
// its own, never the AIP's author (src/lib/proposals/measure.js; avendb/docs/ARCHITECTURE.md §8, "AIPs", N2). Its
// key is a device of a device vault Maia City owns, which holds Maia City's Measurer group: so what it records counts
// as `measured "name"`. It runs on avenDB's server (docker-compose.yml `measurer`), never on a Mac: each round opens
// its agent device, measures what changed, and lets the device close once idle, so it holds Maia City only while it
// measures.
//
//   bun scripts/measure.mjs [--every <minutes>] [--dry] [--device <avendb-device>] [--dir <folder>]
//
// Its key: AVENDB_MEASURER_KEY (66 hex digits, as The OS app showed it once). Its agent: `avendb-device agent cloud`,
// --device or AVENDB_DEVICE, else avendb-device on the PATH, keeping its shelf in --dir or AVENDB_MEASURER_DIR. Without
// --every it runs one round and ends; --dry writes nothing and prints what it would record.
import { measureRound } from "../src/lib/proposals/measure.js";
import { session } from "./agent.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const key = process.env.AVENDB_MEASURER_KEY ?? "";
if (!/^[0-9a-f]{64,66}$/i.test(key.trim())) {
  console.error(
    'the Measurer has no key: AVENDB_MEASURER_KEY holds the 66 hex digits The OS app showed once ("Add a Measurer")',
  );
  process.exit(2);
}
const every = Number(value("--every") ?? 0);
const device = {
  command: value("--device") ?? process.env.AVENDB_DEVICE ?? "avendb-device",
  args: [
    "agent",
    "cloud",
    "--dir",
    value("--dir") ??
      process.env.AVENDB_MEASURER_DIR ??
      `${process.env.HOME ?? "."}/avenDB/measurer`,
  ],
  // its key as the agent reads one; nothing else of the Measurer's environment needs to reach it
  env: {
    ...process.env,
    AVENDB_AGENT_KEY: key.trim(),
    AVENDB_MEASURER_KEY: "",
  },
};

const at = () => new Date().toISOString().slice(0, 19);

/** one round: Maia City's AIPs measured where they changed; what it did, said in the log */
async function round(agent) {
  const city = await agent.city();
  const me = (await agent.call("avendb_vaults", {})).me?.vault;
  if (!me) throw new Error("the Measurer acts as no vault");
  const ask = (op) => agent.call("avendb_ask", { op });
  const run = (op) => agent.call("avendb_run", { op });
  const done = await measureRound({
    ask,
    run,
    vault: city.id,
    me,
    dry: flag("--dry"),
  });
  for (const d of done) {
    const what = d.error
      ? `failed: ${d.error}`
      : d.readings.map(([n, v]) => `${n} ${v}`).join(", ");
    console.log(
      `${at()} AIP ${d.aip.slice(0, 8)} logic "${d.logic}"${d.side ? ` on ${d.side === "main" ? "main" : "the proposal"}` : ""}: ${what}`,
    );
  }
  if (!done.length) console.log(`${at()} nothing to measure`);
}

const agent = session(device, "measurer");
await agent.open();
for (;;) {
  try {
    await round(agent);
  } catch (e) {
    console.error(`${at()} the round failed: ${e.message}`);
  }
  if (!(every > 0)) break;
  await new Promise((ok) => setTimeout(ok, every * 60_000));
}
agent.close();
process.exit(0);
