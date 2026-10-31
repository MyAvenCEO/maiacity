import Aven.DB.Docs.Loro
import Aven.DB.Docs.OpIds
import Aven.DB.Docs.Counts
import Aven.DB.Docs.Writers
import Aven.DB.Docs.Checkpoint
import Aven.DB.Docs.Fit
import Aven.DB.Docs.Changes
import Aven.DB.Docs.Limits
import Aven.DB.Docs.Lens
import Aven.DB.Docs.Merge
import Aven.DB.Docs.Index
import Aven.DB.Docs.Walk
import Aven.DB.Docs.Key
import Aven.DB.Docs.Directory
import Aven.DB.Docs.Genesis
import Aven.DB.Docs.Body
import Aven.DB.Docs.Segment
import Aven.DB.Docs.Head

/-!
# Aven.DB.Docs: the docs layer's model

On top of the shared core (`Aven.Core`: Values, the codec, envelopes, logs, splits), the docs layer's own laws
(`db/docs/README.md`, "What Lean proves"):

- `Loro`: Loro by its stated properties: convergence, and a snapshot as a cache;
- `OpIds`: an envelope's Loro dependencies and its hashes name the same past;
- `Counts`: what counts is fit, authorized and not a split; revocations only narrow it; splits are final; writer ids;
- `Writers`: the writer id, defined once: BLAKE3's key derivation over the device, the Doc, the branch and the
  generation;
- `Checkpoint`: a checkpoint that checks is the replay of what it covers;
- `Fit`: rules on single values survive a merge, judged per envelope, and size rules don't;
- `Changes`: what an envelope does to a Doc's Records, the view fit and the engine's footprint both read;
- `Limits`: every input bounded before Loro sees it: capped reads, depth, fan-out, Records, ops, segments, blobs;
- `Lens`: a read through a lens commutes with a merge;
- `Merge`: three-way merges place by place, and backing out a commit;
- `Index`: directories and indexes as Prolly trees: the same entries make the same nodes, folds in steps equal folds
  at once, and a lookup finds every entry in its range;
- `Walk`: a lookup walks down from the root through the store, opening only the children whose span meets the range,
  and finds exactly the fold's entries in the range; a fold is a checkpoint;
- `Key`: index keys in an order-preserving encoding: comparing keys bytewise is comparing their tuples;
- `Genesis`: a Doc's genesis, named by A30, and the built-in types named by their labels;
- `Body`: what a docs envelope carries inside Core's, its ops half-open, so a log's ops never overlap;
- `Segment`: a writer's closed run of one log, signed and sealed;
- `Head`: a peer's own record of what it holds of a Doc;
- `Directory`: every Doc listed now was listed at the last fold or is unfolded, and one that isn't unfolded has the
  entries it had then.
-/
