// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The economy sandbox (Sandbox 7, the avens trading) in the database: its configs, its game runs, and MIPs.
 *
 * A config is everything a valley runs on, named and versioned, as a list of config cards (game/economy/params.js): a
 * policy or world card holds the values of one part of the catalogue, and may carry code for the QuickJS sandbox; a
 * resource or recipe card holds its JSON. A config changes only through a MIP — a MaiaCity improvement proposal: a
 * title, a description in prose, and the cards themselves, complete, as they would be (and the ids of any to take out),
 * or a new config made from another, or a config deleted. Anyone who may play proposes (on the page, or an agent over
 * the studio's MCP); only the admin accepts or rejects, and accepting puts the cards in as they are and writes a new
 * version. Card code is only ever kept here as text: it runs in the page's QuickJS sandbox, never on the server.
 *
 * A run is one game played: the config it ran on (a full copy, with any local changes the player tried on top), its
 * seed and brain, and then every day's stats row, trades and Liquid decisions, as the page sends them.
 */
import { db } from "./pg";
import { PARAMS, SECTIONS, CARD_KINDS, HOOKS, applyCards, checkCard, defaultCards, paramsOf } from "../../game/economy/params.js";

export class EconomyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const SLUG = /^[a-z][a-z0-9-]{1,40}$/;
const ACTIONS = ["edit", "create", "delete"];
const MAX_CARDS = 100;
const MAX_MIP = 1_000_000; // one MIP's cards, in characters
const MAX_JSON = 2_000_000; // one request's days, in characters

const text = (v, max) => String(v ?? "").trim().slice(0, max);
// JSON goes in as text, cast in the query (`($n::text)::jsonb`): Bun's Postgres driver sends a string bound straight to
// a jsonb parameter as a JSON string, so the column would hold "[...]" and read back as text (0034 repairs those rows)
const json = (v) => JSON.stringify(v ?? null);

// ─────────────────────────────── configs ───────────────────────────────

const configRow = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  version: Number(r.version),
  cards: r.cards,
  // every value the cards hold, the catalogue's default where none does: what the valley runs on
  params: paramsOf(r.cards),
  created: r.created,
  updated: r.updated,
});

/** every config that is not deleted (or, with `deleted`, those too) */
export async function listConfigs({ deleted = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM econ_configs ${deleted ? "" : "WHERE deleted IS NULL"} ORDER BY created, id`);
  return rows.map(configRow);
}

/**
 * one config (or one of its past versions), with the history of its versions (which MIP made each)
 * @param {string} id @param {{ version?: number | string }} [opts]
 */
export async function getConfig(id, { version } = {}) {
  const { rows } = await db.query("SELECT * FROM econ_configs WHERE id = $1", [id]);
  if (!rows[0]) throw new EconomyError("No such config.", 404);
  const { rows: versions } = await db.query(
    "SELECT version, mip, at, body FROM econ_config_versions WHERE config_id = $1 ORDER BY version DESC",
    [id],
  );
  let cfg = configRow(rows[0]);
  if (version != null && Number(version) !== cfg.version) {
    const v = versions.find((x) => Number(x.version) === Number(version));
    if (!v) throw new EconomyError(`Config ${id} has no version ${version}.`, 404);
    cfg = { ...cfg, ...v.body, version: Number(v.version), params: paramsOf(v.body.cards) };
  }
  return { ...cfg, deleted: rows[0].deleted, versions: versions.map((v) => ({ version: Number(v.version), mip: v.mip == null ? null : Number(v.mip), at: v.at })) };
}

/** what a card may hold: every value (key, its card, label, unit, range, default), the cards they sit on, the kinds,
 * and the hooks its code may export (run in the page's QuickJS sandbox) */
export function catalogue() {
  return {
    params: PARAMS.map(({ key, view, section, label, unit, min, max, step, value, reset }) => ({
      key, card: SECTIONS.find((s) => s.name === section)?.id, view, label, unit, min, max, step, default: value, reset: !!reset,
    })),
    cards: SECTIONS,
    kinds: CARD_KINDS,
    hooks: HOOKS,
    code: "A card's code is JavaScript run in the page's QuickJS sandbox, one engine per card: export function <hook>({ aven, good, valley, value }) { return number }, where value is what the valley would use (or what an earlier card made of it); several cards exporting a hook run in the config's order. No network, page, keys or binary buffers; 8 MB and 25 ms a call. A hook that throws, runs too long or returns no number stops for the run and the valley uses its values. aven: { id, name, alive, hearts, health, grows, produce, stock, body: { water, food }, minted, decayed }. valley: { day, values (every param by key), avens, alive, hearts, prices, weather }.",
  };
}

// ─────────────────────────────── MIPs ───────────────────────────────

/**
 * Check a MIP against the configs as they are now; returns it cleaned, with `base`: each card it touches as it is now
 * (null for a new one), so it reads "from → to".
 *   { config, action: edit | create | delete, name?, about?, from?, cards: [card], remove: [card id] }
 */
async function checkMip(body, q = db) {
  const config = text(body?.config, 41);
  const action = body?.action ?? "edit";
  if (!ACTIONS.includes(action)) throw new EconomyError(`A MIP's action is one of ${ACTIONS.join(", ")}.`);
  const { rows } = await q.query("SELECT * FROM econ_configs WHERE id = $1", [config]);
  const cur = rows[0] ?? null;
  const live = cur && !cur.deleted ? cur : null;
  const name = body?.name == null ? null : text(body.name, 80) || null;
  const about = body?.about == null ? null : text(body.about, 2000);

  if (action === "delete") {
    if (!live) throw new EconomyError(`No config ${config} to delete.`);
    if (body?.cards?.length || body?.remove?.length) throw new EconomyError("A MIP that deletes a config carries no cards.");
    return { config, action, name: null, about: null, from: null, cards: [], remove: [], base: {}, base_version: Number(live.version) };
  }

  let from = null;
  let baseCards;
  if (action === "create") {
    if (!SLUG.test(config)) throw new EconomyError("A new config's id is lowercase letters, digits and dashes, 2 to 41 long, e.g. dry-valley.");
    if (cur) throw new EconomyError(cur.deleted ? `There was a config ${config} once: pick another id.` : `There is already a config ${config}.`);
    from = body?.from == null || body.from === "" ? null : text(body.from, 41);
    if (from) {
      const { rows: f } = await q.query("SELECT cards FROM econ_configs WHERE id = $1 AND deleted IS NULL", [from]);
      if (!f[0]) throw new EconomyError(`No config ${from} to start from.`);
      baseCards = f[0].cards;
    } else baseCards = defaultCards();
  } else {
    if (!live) throw new EconomyError(`No config ${config}.`);
    baseCards = live.cards;
  }

  const raw = body?.cards ?? [];
  if (!Array.isArray(raw)) throw new EconomyError("A MIP's cards are a list.");
  if (raw.length > MAX_CARDS) throw new EconomyError(`At most ${MAX_CARDS} cards in one MIP.`);
  if (json(raw).length > MAX_MIP) throw new EconomyError("That MIP is too large.", 413);
  const cards = [];
  for (const c of raw) {
    const r = checkCard(c);
    if (r.error) throw new EconomyError(r.error);
    if (cards.some((x) => x.id === r.card.id)) throw new EconomyError(`Card ${r.card.id} is in this MIP twice.`);
    cards.push(r.card);
  }
  const remove = [];
  for (const id of body?.remove ?? []) {
    const k = text(id, 41);
    if (!baseCards.some((c) => c.id === k)) throw new EconomyError(`There is no card ${k} to take out.`);
    if (cards.some((c) => c.id === k)) throw new EconomyError(`Card ${k} can't be put in and taken out at once.`);
    if (!remove.includes(k)) remove.push(k);
  }
  if (action === "edit" && !cards.length && !remove.length && name == null && about == null) throw new EconomyError("A MIP needs at least one card, or a card to take out, or a new name.");
  const base = Object.fromEntries([...cards.map((c) => c.id), ...remove].map((id) => [id, baseCards.find((c) => c.id === id) ?? null]));
  return { config, action, name: action === "create" ? name || config : name, about, from, cards, remove, base, base_version: live ? Number(live.version) : null };
}

const mipRow = (r) => ({
  number: Number(r.number),
  title: r.title,
  description: r.description,
  config: r.config_id,
  action: r.action,
  name: r.name,
  about: r.about,
  from: r.from_id,
  cards: r.cards,
  remove: r.remove,
  base: r.base,
  base_version: r.base_version == null ? null : Number(r.base_version),
  status: r.status,
  author: r.author,
  author_name: r.author_name ?? null,
  via: r.via,
  created: r.created,
  decided: r.decided,
  decided_by: r.decided_by,
  note: r.note,
  result: r.result,
});

const MIP_SELECT = "SELECT m.*, f.name AS author_name FROM mips m LEFT JOIN founders f ON f.id = m.author";

/** Propose: a title, a description in prose, and the cards. `via` says where it came from: the page or an agent over MCP. */
export async function createMip(author, body) {
  const title = text(body?.title, 160);
  if (!title) throw new EconomyError("A MIP needs a title.");
  const m = await checkMip(body);
  const via = body?.via === "mcp" ? "mcp" : "page";
  const { rows } = await db.query(
    `INSERT INTO mips (title, description, config_id, action, name, about, from_id, cards, remove, base, base_version, author, via)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ($8::text)::jsonb, ($9::text)::jsonb, ($10::text)::jsonb, $11, $12, $13) RETURNING number`,
    [title, text(body?.description, 20000), m.config, m.action, m.name, m.about, m.from, json(m.cards), json(m.remove), json(m.base), m.base_version, author, via],
  );
  return getMip(Number(rows[0].number));
}

export async function listMips(status) {
  const where = status ? "WHERE m.status = $1" : "";
  const { rows } = await db.query(`${MIP_SELECT} ${where} ORDER BY m.number DESC LIMIT 500`, status ? [status] : []);
  return rows.map(mipRow);
}

export async function getMip(number) {
  const { rows } = await db.query(`${MIP_SELECT} WHERE m.number = $1`, [number]);
  if (!rows[0]) throw new EconomyError("No such MIP.", 404);
  return mipRow(rows[0]);
}

/** Accept (put its cards in, as they are, and write a new version) or reject an open MIP. */
export async function decideMip(number, by, { accept, note } = {}) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query("SELECT * FROM mips WHERE number = $1 FOR UPDATE", [number]);
    const row = rows[0];
    if (!row) throw new EconomyError("No such MIP.", 404);
    if (row.status !== "open") throw new EconomyError(`MIP-${number} is already ${row.status}.`, 409);
    if (!accept) {
      await tx.query("UPDATE mips SET status = 'rejected', decided = now(), decided_by = $2, note = $3 WHERE number = $1", [number, by, text(note, 2000)]);
      return { number, status: "rejected" };
    }
    // the config may have moved on since it was proposed: check again, against now
    const m = await checkMip({ config: row.config_id, action: row.action, name: row.name, about: row.about, from: row.from_id, cards: row.cards, remove: row.remove }, tx);
    let result;
    if (m.action === "delete") {
      const { rows: n } = await tx.query("SELECT count(*)::int AS n FROM econ_configs WHERE deleted IS NULL");
      if (Number(n[0].n) <= 1) throw new EconomyError("That is the last config: the valley needs one to run on.", 409);
      await tx.query("UPDATE econ_configs SET deleted = now(), updated = now() WHERE id = $1", [m.config]);
      result = { config: m.config, deleted: true };
    } else {
      let cfg;
      if (m.action === "create") {
        const base = m.from ? (await tx.query("SELECT cards FROM econ_configs WHERE id = $1", [m.from])).rows[0].cards : defaultCards();
        cfg = { name: m.name, description: m.about ?? "", version: 1, cards: applyCards(base, m.cards, m.remove) };
        await tx.query("INSERT INTO econ_configs (id, name, description, version, cards) VALUES ($1, $2, $3, 1, ($4::text)::jsonb)", [m.config, cfg.name, cfg.description, json(cfg.cards)]);
      } else {
        const { rows: c } = await tx.query("SELECT * FROM econ_configs WHERE id = $1 FOR UPDATE", [m.config]);
        cfg = { name: m.name ?? c[0].name, description: m.about ?? c[0].description, version: Number(c[0].version) + 1, cards: applyCards(c[0].cards, m.cards, m.remove) };
        await tx.query("UPDATE econ_configs SET name = $2, description = $3, version = $4, cards = ($5::text)::jsonb, updated = now() WHERE id = $1", [m.config, cfg.name, cfg.description, cfg.version, json(cfg.cards)]);
      }
      await tx.query("INSERT INTO econ_config_versions (config_id, version, body, mip) VALUES ($1, $2, ($3::text)::jsonb, $4)", [m.config, cfg.version, json({ name: cfg.name, description: cfg.description, cards: cfg.cards }), number]);
      result = { config: m.config, version: cfg.version };
    }
    await tx.query(
      "UPDATE mips SET status = 'accepted', decided = now(), decided_by = $2, note = $3, result = ($4::text)::jsonb WHERE number = $1",
      [number, by, text(note, 2000), json(result)],
    );
    return { number, status: "accepted", ...result };
  });
}

/** The author takes back an open MIP of their own. */
export async function withdrawMip(number, who) {
  const r = await db.query("UPDATE mips SET status = 'withdrawn', decided = now(), decided_by = $2 WHERE number = $1 AND status = 'open' AND author = $2", [number, who]);
  if (!r.affectedRows) throw new EconomyError("Only an open MIP of your own can be withdrawn.", 409);
  return getMip(number);
}

// ─────────────────────────────── runs ───────────────────────────────

const runRow = (r) => ({
  id: r.id,
  config_id: r.config_id,
  config_version: r.config_version == null ? null : Number(r.config_version),
  seed: r.seed == null ? null : Number(r.seed),
  brain: r.brain,
  started: r.started,
  updated: r.updated,
  ended: r.ended,
  days: Number(r.days),
  alive: r.alive == null ? null : Number(r.alive),
  summary: r.summary,
  player: r.player,
});

/** A run begins: the config it runs on (a full copy of what the valley uses, local changes included), seed and brain,
 * and its summary so far (who its avens are). */
export async function startRun(player, body) {
  const config = body?.config;
  if (!config || typeof config !== "object" || typeof config.params !== "object") throw new EconomyError("A run needs the config it runs on: { cards, params, local }.");
  if (json(config).length > MAX_JSON) throw new EconomyError("That config is too large.", 413);
  let configId = body?.config_id == null ? null : text(body.config_id, 41);
  if (configId && !(await db.query("SELECT 1 FROM econ_configs WHERE id = $1", [configId])).rows.length) configId = null;
  const { rows } = await db.query(
    `INSERT INTO econ_runs (id, config_id, config_version, config, seed, brain, player, summary)
     VALUES ($1, $2, $3, ($4::text)::jsonb, $5, $6, $7, ($8::text)::jsonb) RETURNING *`,
    [crypto.randomUUID(), configId, body?.config_version == null ? null : Number(body.config_version), json(config), Number.isFinite(Number(body?.seed)) ? Math.trunc(Number(body.seed)) : null, text(body?.brain, 80), player, json(body?.summary ?? {})],
  );
  return runRow(rows[0]);
}

/** More days of a run: each its stats row, trades and decisions; and where the run stands now. */
export async function addDays(id, body) {
  const days = body?.days;
  if (!Array.isArray(days)) throw new EconomyError("Send { days: [{ day, stats, trades, decisions }] }.");
  if (json(days).length > MAX_JSON) throw new EconomyError("Too much at once: send fewer days.", 413);
  const { rows } = await db.query("SELECT id, ended FROM econ_runs WHERE id = $1", [id]);
  if (!rows[0]) throw new EconomyError("No such run.", 404);
  for (const d of days) {
    const day = Number(d?.day);
    if (!Number.isInteger(day) || day < 0) throw new EconomyError("Every day needs its number.");
    await db.query(
      `INSERT INTO econ_run_days (run_id, day, stats, trades, decisions) VALUES ($1, $2, ($3::text)::jsonb, ($4::text)::jsonb, ($5::text)::jsonb)
       ON CONFLICT (run_id, day) DO UPDATE SET stats = EXCLUDED.stats, trades = EXCLUDED.trades, decisions = EXCLUDED.decisions`,
      [id, day, json(d.stats ?? {}), json(d.trades ?? []), json(d.decisions ?? [])],
    );
  }
  const last = days.reduce((n, d) => Math.max(n, Number(d.day) || 0), 0);
  await db.query(
    `UPDATE econ_runs SET updated = now(), days = GREATEST(days, $2), alive = COALESCE($3, alive),
       summary = CASE WHEN ($4::text)::jsonb IS NULL THEN summary ELSE ($4::text)::jsonb END, ended = CASE WHEN $5 THEN now() ELSE ended END
     WHERE id = $1`,
    [id, last, body?.alive == null ? null : Number(body.alive), body?.summary == null ? null : json(body.summary), !!body?.ended],
  );
  return { id, days: last };
}

export async function listRuns(limit = 100) {
  const { rows } = await db.query("SELECT id, config_id, config_version, seed, brain, started, updated, ended, days, alive, summary, player FROM econ_runs ORDER BY started DESC LIMIT $1", [Math.min(500, Math.max(1, Number(limit) || 100))]);
  return rows.map(runRow);
}

/**
 * One run: its config and its days (all, or `from`..`to`), each with stats, and trades and decisions when asked.
 * @param {string} id @param {{ from?: number | string, to?: number | string, detail?: boolean }} [opts]
 */
export async function getRun(id, { from, to, detail = false } = {}) {
  const { rows } = await db.query("SELECT * FROM econ_runs WHERE id = $1", [id]);
  if (!rows[0]) throw new EconomyError("No such run.", 404);
  const lo = Number.isFinite(Number(from)) ? Number(from) : 0;
  const hi = Number.isFinite(Number(to)) ? Number(to) : 1e9;
  const { rows: days } = await db.query(
    `SELECT day, stats${detail ? ", trades, decisions" : ""} FROM econ_run_days WHERE run_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day`,
    [id, lo, hi],
  );
  return { ...runRow(rows[0]), config: rows[0].config, day_rows: days.map((d) => ({ ...d, day: Number(d.day) })) };
}

export async function deleteRun(id) {
  const r = await db.query("DELETE FROM econ_runs WHERE id = $1", [id]);
  if (!r.affectedRows) throw new EconomyError("No such run.", 404);
}
