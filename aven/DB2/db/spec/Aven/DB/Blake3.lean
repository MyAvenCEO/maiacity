import Aven.Core.Blake3

/-!
# BLAKE3

The hash lives in the shared core (`Aven.Core.Blake3`); the store and the rest of `Aven.DB` name it here.
-/

namespace Aven.DB.Blake3

export Aven.Core.Blake3 (hash hex digest)

end Aven.DB.Blake3
