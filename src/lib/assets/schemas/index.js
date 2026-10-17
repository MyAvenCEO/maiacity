/*
 * THE ASSET SCHEMAS — one place that names them:
 *
 * - `asset` (./asset.v1.json): an asset as an avenDB entry, the one thing of it avenDB reads. It is in avenDB's own
 *   schema subset, and a test runs it through avenDB's own schema parser (avendb/crates/avendb/tests/assets.rs). On the
 *   day assets move in, the Maia City COOP vault creates it as a `schema` entry, and its records are written under it;
 *   a later version comes with an avenDB lens from this one. An asset's versions are its entry's history, its variants
 *   avenDB variants (their own entries, linked to the version they came from), a change someone suggests a proposal.
 * - `card` (./card.v1.json): what an asset's pack says of it (its size, parts, sliders, levels of detail). A file of the
 *   entry, which avenDB keeps as bytes; our checker (./check.js) reads it, avenDB never does.
 *
 * Each is frozen by its version and the BLAKE3 hash of its bytes (./schemas.json, as the engines are in
 * ../engines.json): `<name>.v<n>.json` is never changed or taken out (./schemas.test.js refuses it), and a change is a
 * new version beside it, with a lens from the one before where avenDB reads it. The hash is the name avenDB gives the
 * same bytes: the blob its `create` of a `schema` entry answers, so the Maia City COOP's schema entries will be named
 * by these hashes.
 */
import ASSET from './asset.v1.json';
import CARD from './card.v1.json';
import { check, checkText } from './check.js';
import FROZEN from './schemas.json';

/**
 * every frozen schema, by name, oldest version first
 * @type {{ name: string, v: number, date: string, blake3: string, bytes: number, title: string, note: string }[]}
 */
export const SCHEMAS = FROZEN.schemas;

export { ASSET, CARD, check, checkText };

/** a card checked: `{ ok: true, value }` or `{ ok: false, errors }` @param {unknown} card */
export const checkCard = (card) => (typeof card === 'string' ? checkText(CARD, card) : check(CARD, card));
