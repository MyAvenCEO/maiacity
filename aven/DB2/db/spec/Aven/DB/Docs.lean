import Aven.DB.Docs.Loro
import Aven.DB.Docs.Counts
import Aven.DB.Docs.Checkpoint
import Aven.DB.Docs.Fit
import Aven.DB.Docs.Lens
import Aven.DB.Docs.Merge

/-!
# Aven.DB.Docs: the docs layer's model

On top of the shared core (`Aven.Core`: Values, the codec, envelopes, logs, splits), the docs layer's own laws
(`db/docs/README.md`, "What Lean proves"):

- `Loro`: Loro by its stated properties: convergence, and a snapshot as a cache;
- `Counts`: what counts is fit, authorized and not a split; revocations only narrow it; splits are final; writer ids;
- `Checkpoint`: a checkpoint that checks is the replay of what it covers;
- `Fit`: rules on single values survive a merge, and size rules don't;
- `Lens`: a read through a lens commutes with a merge;
- `Merge`: three-way merges place by place, and backing out a commit.
-/
