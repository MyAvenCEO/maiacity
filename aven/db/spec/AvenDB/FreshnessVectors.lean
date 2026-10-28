import AvenDB.Freshness
import AvenDB.Json

/-!
# Freshness vectors

`vectors/freshness.json`, the cases the Rust engine replays (`crates/avendb/tests/all/freshness_vectors.rs`): what a device
hears (its live peers, those of them not yet heard, the stamp of its last current read) against each kind of coverage,
with the freshness the model gives the read (`Freshness.of`), what an action does with it (`act`), and whether its
sheet opens by itself (`pops`) or when the person asks (`asked`).
-/

namespace AvenDB.FreshnessVectors

open AvenDB.Json AvenDB.Coverage AvenDB.Freshness

def coverageJson : Coverage → String
  | .complete => obj [("state", str "complete")]
  | .«partial» rows known waiting logs =>
    obj [("state", str "partial"), ("have", nat rows), ("known", nat known), ("waits", nat waiting.length),
         ("logs", nat logs)]
  | .denied => obj [("state", str "denied")]

def freshJson : Freshness → String
  | .current => obj [("state", str "current")]
  | .offline t => obj [("state", str "offline"), ("asOf", nat t)]
  | .behind l w u => obj [("state", str "behind"), ("logs", nat l), ("waits", nat w), ("unheard", nat u)]

def actJson : Act → String
  | .go => str "go"
  | .wait => str "wait"
  | .confirm _ => str "confirm"

def heards : List (String × Heard) :=
  [("no peer, never current", ⟨0, 0, 0⟩), ("no peer, current before", ⟨0, 0, 1793120000000⟩),
   ("3 peers heard", ⟨3, 0, 1793120000000⟩), ("3 peers, 1 not heard yet", ⟨3, 1, 1793120000000⟩)]

def coverages : List (String × Coverage) :=
  [("complete", .complete), ("2778 logs behind", .«partial» 4 4 [] 2778),
   ("2 candidates wait", .«partial» 3 5 [(7, .record), (8, .semantics)] 0),
   ("waiting and behind", .«partial» 1 2 [(9, .history)] 3), ("denied", .denied)]

def caseJson (hn : String) (h : Heard) (cn : String) (c : Coverage) : String :=
  let f := of h c
  obj [("name", str (hn ++ "; " ++ cn)), ("live", nat h.live), ("unheard", nat h.unheard), ("asOf", nat h.asOf),
       ("coverage", coverageJson c), ("fresh", freshJson f), ("act", actJson (act f)), ("pops", bool (opens f false)),
       ("asked", bool (opens f true))]

def render : String :=
  lines (heards.flatMap fun (hn, h) => coverages.map fun (cn, c) => caseJson hn h cn c) ++ "\n"

end AvenDB.FreshnessVectors
