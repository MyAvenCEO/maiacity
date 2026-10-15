// A name of 32 bytes as it reads in an address ($lib/ids.js): lower-case base32 without padding, 52 letters, as an iroh
// doc id reads. Only such a segment at the root is a Maia Universe post (/<doc>/?t=<title>) or a build of an asset's
// recipe (/<its hash>/?t=<label>&its=values); every other root address keeps its own page.
import { ID } from '$lib/ids.js';

export const match = (param) => ID.test(param);
