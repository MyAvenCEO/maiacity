import Aven.Runtime.Contract
import Aven.Runtime.Registry
import Aven.Runtime.RegistryExamples
import Aven.Runtime.Tree
import Aven.Runtime.Face
import Aven.Runtime.State
import Aven.Runtime.Markup

/-!
# Aven.Runtime

The model of `aven/runtimes` ([`README.md`](../../README.md)):

- `Contract`: a runtime as a pure function of its part and input, under fuel, memory and output limits; the host's
  checks; floors; the module a host admits; the append-only manifest.
- `Registry`: what a file really is, by its bytes, and how it shows, within which limits, served how.
- `Tree`: the node-tree allowlist, which the applier checks every tree against.
- `Face`: the face-runtime's output, which passes that check, with its a11y checked across markup and style.
- `State`: state-runtime, rules of updates by path and sends, each update touching only its path.
- `Markup`: face-runtime's input, markup drawn onto the node tree, every node passing the allowlist.

Values, the codec and hashes are `Aven.Core`'s, built by the docs thread. Until it lands, the contract is stated for
any part, input and output type and any hash, so nothing here defines its own.
-/
