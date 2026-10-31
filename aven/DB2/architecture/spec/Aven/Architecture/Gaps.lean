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
    theorems := ["rule2_prev_fixed", "rule2_dep_fixed", "rule2_ops_are_hashes"],
    restsOn := ["Aven.Core.Envelope.name_inj", "Aven.DB.Docs.same_past", "Aven.Core.Past.reaches_iff"],
    missing := [] },
  { rule := 3, title := "One writer per log, and a log never waits",
    theorems := ["rule3_chain_whole", "rule3_split_final", "rule3_never_waits", "rule3_split_spreads"],
    restsOn := ["Aven.Core.log_no_split", "Aven.DB.Docs.split_final", "Aven.ID.Node.write_fits",
      "Aven.ID.Node.write_chain", "Aven.ID.Node.split_spreads"],
    missing := [] },
  { rule := 4, title := "Readers judge",
    theorems := ["rule4_order_free", "rule4_lowered_alike", "rule4_fit_merges", "authorized", "contentOk",
      "rule4_one_verdict", "rule4_readers_agree", "rule4_content", "rule4_reading_writes_nothing",
      "rule4_merge_whole", "rule4_delete_ends"],
    restsOn := ["Aven.Core.reaches_mono", "Aven.DB.Engine.readers_agree", "Aven.DB.Docs.fit_envelopes", "Aven.ID.verdict",
      "Aven.ID.liveWith_iff", "Aven.ID.delete_ends", "Aven.ID.deleted_agree", "Aven.ID.Reader.Own",
      "Aven.ID.counts_iff", "Aven.ID.readers_agree", "Aven.ID.freshEpoch", "Aven.DB.Engine.footprint_steps",
      "Aven.DB.Engine.diff_footprint", "Aven.DB.Docs.fit_diff", "Aven.ID.chain_writes_nothing",
      "Aven.ID.merge_covered", "Aven.ID.merge_within_device", "Aven.DB.Engine.merge_steps",
      "Aven.DB.Engine.verdictFootprint_iff", "Aven.DB.Engine.commit_types_kept"],
    missing := [] },
  { rule := 5, title := "Reading is holding the key",
    theorems := ["rule5_keeper_blind", "rule5_read_is_key", "rule5_epoch_fresh"],
    restsOn := ["Aven.ID.WorldOf.keeper_blind", "Aven.ID.outside_blind", "Aven.ID.WorldOf.confidential",
      "Aven.ID.stale_refused"],
    missing := [] },
  { rule := 6, title := "Demand never grants",
    theorems := ["served", "rule6_wants_caps", "rule6_keeper"],
    restsOn := ["Aven.DB.Engine.served_eq_wants_caps", "Aven.ID.Grant.reaches", "Aven.ID.Keep.served_current"],
    missing := [] },
  { rule := 7, title := "No privilege by position",
    theorems := ["rule7_granted", "rule7_no_only_source", "rule7_hosting_explicit"],
    restsOn := ["Aven.ID.World.keeper_blind", "Aven.ID.Sealed.root_by_writer", "Aven.ID.Node.no_only_relay",
      "Aven.ID.Node.no_only_holder", "Aven.Actor.hosting_explicit"],
    missing := [] },
  { rule := 8, title := "Derived state is a cache or a checkpoint",
    theorems := ["rule8_cache_or_checkpoint", "rule8_checkpoint_by_writer", "rule8_index_root"],
    restsOn := ["Aven.DB.Docs.Loro.snapshot_load", "Aven.DB.Docs.checked_is_replay", "Aven.DB.Docs.checked_names",
      "Aven.DB.Docs.checkpoint_by_writer", "Aven.Runtime.deterministic", "Aven.ID.Sealed.sealed_roots_agree", "Aven.Architecture.Sealed.docsRoot_set"],
    missing := [] },
  { rule := 9, title := "Sealed beyond the device",
    theorems := ["rule9_keeper", "rule9_sealed"],
    restsOn := ["Aven.ID.World.keeper_blind", "Aven.ID.Node.no_plain_to_nonreader", "Aven.ID.Node.relay_blind",
      "Aven.ID.Node.keeper_blind"],
    missing := [] },
  { rule := 10, title := "Every input has a limit",
    theorems := ["rule10_limits", "rule10_inputs", "rule10_pages", "rule10_quota"],
    restsOn := ["Aven.DB.Engine.length_le_bound", "Aven.DB.Engine.work_le_cost", "Aven.Runtime.run_ok_fits",
      "Aven.DB.Docs.Index.chunks_size", "Aven.Peer.Wire.maxFrame", "Aven.DB.Docs.capped_holds",
      "Aven.DB.Docs.capped_within", "Aven.DB.Docs.admitted_bounded", "Aven.DB.Docs.segment_records",
      "Aven.DB.Docs.blob_bounded", "Aven.DB.Engine.page_bounded", "Aven.ID.Books.quota",
      "Aven.Peer.Serve.Keeper.admitted_within", "Aven.Peer.Serve.Keeper.over_quota_sheds"],
    missing := [] },
  { rule := 11, title := "Every wait ends",
    theorems := ["rule11_waits_named", "rule11_waits_isolated", "rule11_stall_raised"],
    restsOn := ["Aven.ID.waits_named", "Aven.DB.Engine.waits_isolated", "Aven.DB.Engine.stall_raised"],
    missing := [] },
  { rule := 12, title := "Order is causal; time is a claim",
    theorems := ["rule12_causal", "rule12_time_acked"],
    restsOn := ["Aven.Core.Reaches", "Aven.ID.time_acked", "Aven.ID.claimed_late", "Aven.Core.Past.inPast_iff"],
    missing := [] },
  { rule := 13, title := "Keys live only in the safe",
    theorems := ["rule13_safe"],
    restsOn := ["Aven.ID.Safe.safe_holds", "Aven.ID.Safe.stays_inside"],
    missing := [] },
  { rule := 14, title := "One protocol of ours",
    theorems := [], restsOn := [],
    missing := ["a property of the node, not a theorem: held by every format's vectors and the box's check; aven/db/1's messages beyond Aven.Peer.Wire are unmodelled"] }]

#guard rules.length = 14

end Aven.Architecture
