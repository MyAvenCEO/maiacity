import Aven.Architecture.Rules

/-!
# What each rule rests on, and what is missing

For each of ARCHITECTURE.md's rules: the theorems here that compose it, the parts' theorems they rest on, and what no
model states yet. Each gap is something to model, or a sign the rule should change; the architect tunes ARCHITECTURE.md
from this list. `rules.json` exports it.
-/

namespace Aven.Architecture

structure RuleStatus where
  rule : Nat
  title : String
  theorems : List String
  restsOn : List String
  missing : List String

def rules : List RuleStatus := [
  { rule := 1, title := "One codec for everything signed",
    theorems := ["rule1_canonical", "rule1_labelled", "rule1_named"],
    restsOn := ["Aven.Core.encode_decodeAll", "Aven.Core.signing_separates", "Aven.Core.nameOf_inj"],
    missing := [] },
  { rule := 2, title := "History names its past by hash",
    theorems := ["rule2_prev_fixed", "rule2_dep_fixed", "rule2_ops_are_hashes", "capsView"],
    restsOn := ["Aven.Core.Envelope.name_inj", "Aven.DB.Docs.same_past"],
    missing := [] },
  { rule := 3, title := "One writer per log, and a log never waits",
    theorems := ["rule3_chain_whole", "rule3_split_final"],
    restsOn := ["Aven.Core.chain_no_split", "Aven.DB.Docs.split_final"],
    missing := ["a writer's own log never waiting for a peer: no model of the writer's side",
      "a split shown to every reader: how its proof spreads is PEERS'"] },
  { rule := 4, title := "Readers judge",
    theorems := ["rule4_order_free", "rule4_lowered_alike", "rule4_fit_merges", "authorized"],
    restsOn := ["Aven.Core.reaches_mono", "Aven.DB.Engine.readers_agree", "Aven.DB.Docs.fit_envelopes", "Aven.ID.verdict"],
    missing := ["one reader verdict joining signature, cap chain (caps' chainOk), footprint (engine's check_sound) and fit: docs' Verdicts takes fit and authorized as parameters, and caps' chain checks take caps, not envelopes"] },
  { rule := 5, title := "Reading is holding the key",
    theorems := ["rule5_keeper_blind", "rule5_read_is_key"],
    restsOn := ["Aven.ID.World.keeper_blind", "Aven.ID.outside_blind", "Aven.ID.World.confidential"],
    missing := ["caps' keys and segments are strings: no link yet from Core's envelopes and the docs layer's segments to their sealing"] },
  { rule := 6, title := "Demand never grants",
    theorems := ["served", "rule6_wants_caps", "rule6_keeper"],
    restsOn := ["Aven.DB.Engine.served_eq_wants_caps", "Aven.ID.Grant.reaches", "Aven.ID.Keep.served_current"],
    missing := [] },
  { rule := 7, title := "No privilege by position",
    theorems := ["rule7_granted"],
    restsOn := ["Aven.ID.World.keeper_blind", "Aven.Architecture.Sealed.root_by_writer"],
    missing := ["hosting as an explicit read cap per actor (A16): not in caps' or the actors' models",
      "no peer as the only source: several sources and relays are PEERS'"] },
  { rule := 8, title := "Derived state is a cache or a checkpoint",
    theorems := ["rule8_cache_or_checkpoint", "rule8_index_root"],
    restsOn := ["Aven.DB.Docs.Loro.snapshot_load", "Aven.DB.Docs.checked_is_replay", "Aven.DB.Docs.checked_names",
      "Aven.Runtime.deterministic", "Aven.Architecture.Sealed.sealed_roots_agree"],
    missing := ["a checkpoint's signature: docs' Checkpoint is checked by replay, and who may sign one a reader takes is open (docs open question 6)"] },
  { rule := 9, title := "Sealed beyond the device",
    theorems := ["rule9_keeper"],
    restsOn := ["Aven.ID.World.keeper_blind"],
    missing := ["what leaves a device at all: no model of the node; PEERS' Lean"] },
  { rule := 10, title := "Every input has a limit",
    theorems := ["rule10_limits"],
    restsOn := ["Aven.DB.Engine.length_le_bound", "Aven.DB.Engine.work_le_cost", "Aven.Runtime.run_ok_fits",
      "Aven.DB.Docs.Index.chunks_size", "Aven.DB.Wire.maxFrame"],
    missing := ["limits on envelopes, blobs, chunks, pages and fan-out before they cost memory (docs rule 24): not modelled",
      "a quota per vault: caps' uploader_pays counts bytes but sets no limit"] },
  { rule := 11, title := "Every wait ends",
    theorems := ["rule11_waits_named"],
    restsOn := ["Aven.ID.waits_named"],
    missing := ["the stall alarm, and that a wait never blocks unrelated work: no model of the committer's queue"] },
  { rule := 12, title := "Order is causal; time is a claim",
    theorems := ["rule12_causal"],
    restsOn := ["Aven.Core.Reaches"],
    missing := ["caps' time conditions judged by acks (time_acked): not in caps' Lean yet"] },
  { rule := 13, title := "Keys live only in the safe",
    theorems := [], restsOn := [],
    missing := ["the safe (caps D17) has no model: no part says where a secret may be held"] },
  { rule := 14, title := "One protocol of ours",
    theorems := [], restsOn := [],
    missing := ["a property of the node, not a theorem: held by every format's vectors and the box's check; aven/db/1's messages beyond Aven.DB.Wire are unmodelled"] }]

#guard rules.length = 14

end Aven.Architecture
