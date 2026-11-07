// An asset's levels of detail, as its card names them (play/SPEC.md §4.5 *Levels of detail*; intent a2935147).
//
// Every asset is drawn at four levels by one contract (play/site's renderer, lib/content/assets/render/): L0 its build,
// L1 and L2 its recipe's own where it declares them (`module.exports.levels = [{ values }, …]`, the same recipe built
// with those values), else derived from its build by simplifying it, and L3 its picture. A new version names which on
// its card, `lod: { levels: 'declared' | 'derived', budgets? }`; a version from before the contract names none and is
// read as derived (`lodOf`): no migration.
//
// play runs no code, so a recipe's declared levels are read here from its source as a plain literal (`levelsIn`) and
// written onto the card (`lod.values`), where the page reads them before it builds anything, as it reads its params.

export type Lod = { levels: "declared" | "derived"; budgets?: number[]; values?: Record<string, string | number>[] };

export class LodError extends Error {}

/** what a level's values may name: a parameter's id (as ./assetdocs.ts PARAM_KEY) */
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
/** how many levels a recipe may declare: L1 and L2 (L0 is its build, L3 its picture) */
export const DECLARED_MOST = 2;

/** the levels a card names: its own `lod`, or, a version from before the contract, derived */
export function lodOf(card: any): Lod {
  const l = card?.lod;
  if (l && (l.levels === "declared" || l.levels === "derived")) return l as Lod;
  return { levels: "derived" };
}

/** a card's `lod` as given, checked for shape; throws saying what is wrong */
export function lodGiven(v: unknown): Lod {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new LodError("lod is an object: { levels: 'declared' | 'derived', budgets? }.");
  const { levels, budgets, values, ...rest } = v as any;
  const extra = Object.keys(rest);
  if (extra.length) throw new LodError(`lod names only levels and budgets, not ${extra.join(", ")}.`);
  if (levels !== "declared" && levels !== "derived") throw new LodError("lod.levels is 'declared' (its recipe's own, module.exports.levels) or 'derived' (simplified from its build).");
  const out: Lod = { levels };
  if (budgets !== undefined) {
    if (!Array.isArray(budgets) || budgets.length > 4 || budgets.some((b) => !Number.isSafeInteger(b) || b < 1))
      throw new LodError("lod.budgets is a list of at most four triangle counts (whole numbers above 0), L0 first.");
    out.budgets = budgets;
  }
  // (values are read from the source, never taken as given: see `heldLod`)
  void values;
  return out;
}

/**
 * The levels a source declares, `module.exports.levels = [ … ]` (or `exports.levels = …`), read as a plain literal:
 * null where it declares none. Throws where it declares them as anything a literal is not (play runs no code).
 */
export function levelsIn(source: string): unknown[] | null {
  const m = /(?:module\.)?exports\.levels\s*=\s*/.exec(source);
  if (!m) return null;
  const read = literal(source, m.index + m[0].length);
  if (!Array.isArray(read)) throw new LodError("module.exports.levels is a list: [{ values: { … } }, …].");
  return read;
}

/**
 * A version's card's `lod` held to its source: given (refused without), its shape checked, and a declared one's levels
 * read from the source and written as `values`; a derived one's source declares none. `params`, the ids of the
 * parameters its card declares, which a level's values name.
 */
export function heldLod(given: unknown, source: string, params: string[], what = "A new asset version"): Lod {
  if (given === undefined || given === null)
    throw new LodError(
      `${what} names its levels of detail on its card: lod = { levels: 'declared' } when its recipe declares its own (module.exports.levels = [{ values }, …], L1 and L2), else { levels: 'derived' } (L1 and L2 simplified from its build, L3 its picture).`,
    );
  const lod = lodGiven(given);
  const declared = levelsIn(source);
  if (lod.levels === "derived") {
    if (declared) throw new LodError("Its source declares its own levels (module.exports.levels): name them with lod.levels 'declared'.");
    return lod;
  }
  if (!declared) throw new LodError("lod.levels is 'declared', but its source declares none: export them, module.exports.levels = [{ values: { … } }, …] (L1 and L2).");
  if (!declared.length || declared.length > DECLARED_MOST) throw new LodError(`module.exports.levels declares 1 or ${DECLARED_MOST} levels (L1, then L2): L0 is its build, L3 its picture.`);
  const values = declared.map((l: any, i) => {
    const v = l?.values;
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length) throw new LodError(`Level ${i + 1} of module.exports.levels is { values: { … } }, the values it is built with.`);
    for (const [k, x] of Object.entries(v)) {
      if (!KEY.test(k)) throw new LodError(`Level ${i + 1}: ${k} is no parameter's id.`);
      if (!params.includes(k)) throw new LodError(`Level ${i + 1} sets ${k}, which its card's params don't declare.`);
      if (typeof x !== "number" && typeof x !== "string") throw new LodError(`Level ${i + 1}: ${k} is a number or a string.`);
    }
    return v as Record<string, string | number>;
  });
  return { ...lod, values };
}

/**
 * A plain JavaScript literal read from `text` at `at`: arrays, objects (keys as names or strings), strings, numbers,
 * true, false and null, with comments and trailing commas; anything else refused.
 */
function literal(text: string, at: number): unknown {
  let i = at;
  const fail = (why: string): never => {
    throw new LodError(`module.exports.levels is written as a plain literal (lists, objects, numbers, strings): ${why} at character ${i}.`);
  };
  const space = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail("a comment never closed");
        i = end + 2;
      } else return;
    }
  };
  const str = (): string => {
    const q = text[i++];
    let out = "";
    while (i < text.length && text[i] !== q) {
      if (text[i] === "\\") {
        const c = text[++i];
        out += c === "n" ? "\n" : c === "t" ? "\t" : c;
        i++;
      } else if (text[i] === "\n") fail("a string across lines");
      else out += text[i++];
    }
    if (text[i] !== q) fail("a string never closed");
    i++;
    return out;
  };
  let depth = 0;
  const value = (): unknown => {
    space();
    const c = text[i];
    if (c === "[") {
      if (++depth > 8) fail("too deep");
      i++;
      const out: unknown[] = [];
      for (;;) {
        space();
        if (text[i] === "]") break;
        out.push(value());
        space();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("a list's items are parted by commas");
      }
      i++;
      depth--;
      return out;
    }
    if (c === "{") {
      if (++depth > 8) fail("too deep");
      i++;
      const out: Record<string, unknown> = {};
      for (;;) {
        space();
        if (text[i] === "}") break;
        let key: string;
        if (text[i] === "'" || text[i] === '"') key = str();
        else {
          const k = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 80));
          if (!k) fail("a key is a name or a string");
          key = k![0];
          i += key.length;
        }
        if (key === "__proto__") fail("no such key");
        space();
        if (text[i] !== ":") fail("a key is followed by ':'");
        i++;
        out[key] = value();
        space();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") fail("an object's entries are parted by commas");
      }
      i++;
      depth--;
      return out;
    }
    if (c === "'" || c === '"') return str();
    const n = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40));
    if (n) {
      i += n[0].length;
      return Number(n[0]);
    }
    for (const [w, v] of [["true", true], ["false", false], ["null", null]] as const)
      if (text.startsWith(w, i) && !/[A-Za-z0-9_$]/.test(text[i + w.length] ?? "")) {
        i += w.length;
        return v;
      }
    return fail("not a literal");
  };
  return value();
}
