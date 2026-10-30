import Aven.Actor.Deadlines
import Aven.Runtime.State
import Aven.Runtime.Markup
import Aven.Runtime.StateExamples

/-!
# Actors and their runtimes

The runtimes live in `aven/runtimes` and know nothing of actors; this file joins them.

- `stateTurn`: a state-runtime part (`Aven.Runtime.State`) as an actor's turn. The kernel hands the runtime a neutral
  input: the sender's address and the ask's name as Values, the turn's time and seed, and the current phase. Each
  neutral send becomes an effect, and a send the kernel can't make one of (a target that is no address, a reply to
  something that is no ask) refuses the whole turn, which is journaled as an error, never dropped.
- `stateTurn_phase`: a state-runtime turn moves only where its machine allows, when the part fits the machine.
- `runTurn_state`: the kernel takes every answer of such a turn as it is: `runTurn` never refuses it for its phase,
  so `machine_sound` covers it like any turn.
- `partMachine`: the machine a part's statechart draws, which the part always fits (`fits_machine`).
- `face_actor_checked`: what a face actor's face-runtime gives back passes the applier's check, before the applier
  draws it.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)
open Aven.Runtime (FacePart Placement FaceOut faceRun treeLimits StatePart StateInput Msg Out StateOut step ascii)

/-! ## state-runtime -/

/-- An address as the runtimes see it: `[scope, id, n]`. -/
def addrValue (a : Addr) : Value := .array [.text (ascii a.scope), .text (ascii a.id), .uint a.n]

def addrOf? : Value → Option Addr
  | .array [.text s, .text i, .uint n] =>
    (String.fromUTF8? ⟨s.toArray⟩).bind fun s => (String.fromUTF8? ⟨i.toArray⟩).map fun i => ⟨s, i, n⟩
  | _ => none

/-- A message's name as the runtimes see it: `[sender, to, seq]`. -/
def msgIdValue (i : MsgId) : Value := .array [addrValue i.sender, addrValue i.to, .uint i.seq]

def msgIdOf? : Value → Option MsgId
  | .array [s, t, .uint q] => (addrOf? s).bind fun s => (addrOf? t).map fun t => ⟨s, t, q⟩
  | _ => none

/-- The neutral message the runtime reads. -/
def Message.toMsg (m : Message) : Msg :=
  ⟨addrValue m.sender, m.name, m.payload, if m.kind.isAsk then some (msgIdValue m.id) else none⟩

/-- A neutral send as an effect, where the kernel can make one. -/
def outEffect : Out → Option Effect
  | .tell to name p => (addrOf? to).map fun a => .tell a name p
  | .ask to name p within => (addrOf? to).map fun a => .ask a name p within
  | .reply re p => (msgIdOf? re).map fun i => .reply i p

/-- A state-runtime part as an actor's turn: its phase is always the one the step moved to. -/
def stateTurn (sp : StatePart) (st : Value) (m : Message) (g : Given) (ph : String) : Option Output :=
  match step sp ⟨st, m.toMsg, g.now, g.seed, ph⟩ with
  | .error _ => none
  | .ok o => (Aven.Runtime.mapM outEffect o.sends).map fun fx => ⟨o.state, fx, some o.phase⟩

/-- A state-runtime turn moves only where its machine allows, when the part fits the machine. -/
theorem stateTurn_phase {sp : StatePart} {mc : Machine} (hfit : sp.fits mc.allows = true) {st : Value}
    {m : Message} {g : Given} {ph : String} {o : Output} (h : stateTurn sp st m g ph = some o) :
    ∃ p, o.phase = some p ∧ mc.allows m.name ph p = true := by
  unfold stateTurn at h
  split at h
  · simp at h
  · next so hstep =>
    simp only [Option.map_eq_some_iff] at h
    obtain ⟨fx, -, rfl⟩ := h
    exact ⟨so.phase, rfl, Aven.Runtime.step_allowed hfit hstep⟩

/-- The kernel takes a state-runtime turn's answer as it is: `runTurn` never refuses it for its phase, so
`machine_sound` covers it like any turn. -/
theorem runTurn_state {sp : StatePart} {d : Def} {mc : Machine} (hm : d.machine = some mc)
    (hturn : d.turn = stateTurn sp) (hfit : sp.fits mc.allows = true) {st : Value} {m : Message} {g : Given}
    {ph : String} {o : Output} (h : stateTurn sp st m g ph = some o) :
    ∃ p, runTurn d st m g ph = some (o.state, p, o.effects) ∧ mc.allows m.name ph p = true := by
  obtain ⟨p, hp, hallow⟩ := stateTurn_phase hfit h
  refine ⟨p, ?_, hallow⟩
  simp [runTurn, hturn, h, hm, hp, hallow]

/-- The machine a part's statechart draws: its initial phase, and per phase the messages it moves on and where. -/
def partMachine (sp : StatePart) : Machine :=
  let phases := (sp.initial :: sp.edges.flatMap fun e => [e.2.1, e.2.2]).eraseDups
  ⟨sp.initial, phases.map fun ph =>
    (ph, ((sp.edges.filter (·.2.1 == ph)).map (·.1)).eraseDups.map fun n =>
      (n, (sp.edges.filter fun e => e.1 == n && e.2.1 == ph).map (·.2.2)))⟩

/-- A part always fits the machine its statechart draws. -/
theorem fits_machine (sp : StatePart) : sp.fits (partMachine sp).allows = true := by
  unfold Aven.Runtime.StatePart.fits
  rw [List.all_eq_true]
  rintro ⟨n, f, t⟩ he
  show (Machine.targets (partMachine sp) f n).contains t = true
  simp only [Machine.targets, partMachine, List.contains_iff_mem, List.mem_flatMap, List.mem_filter,
    List.mem_map, beq_iff_eq]
  have hf : f ∈ (sp.initial :: sp.edges.flatMap fun e => [e.2.1, e.2.2]).eraseDups :=
    List.mem_eraseDups.mpr (List.mem_cons_of_mem _ (List.mem_flatMap.mpr ⟨_, he, by simp⟩))
  have hn : n ∈ ((sp.edges.filter (·.2.1 == f)).map (·.1)).eraseDups :=
    List.mem_eraseDups.mpr (List.mem_map.mpr ⟨_, List.mem_filter.mpr ⟨he, by simp⟩, rfl⟩)
  exact ⟨_, ⟨⟨f, hf, rfl⟩, rfl⟩, _, ⟨List.mem_map.mpr ⟨n, hn, rfl⟩, rfl⟩,
    List.mem_map.mpr ⟨(n, f, t), List.mem_filter.mpr ⟨he, by simp⟩, rfl⟩⟩

-- The machines the runtimes' example statecharts draw pass admission, and each part fits its own.
#guard [Aven.Runtime.taskPart, Aven.Runtime.listPart].all fun sp => (partMachine sp).wellFormed (sp.edges.map (·.1))

/-! ## face-runtime -/

/-- A face actor's face passes the applier's check before the applier draws it. -/
theorem face_actor_checked {fp : FacePart} {data : Value} {o : FaceOut} {pls : List Placement}
    (h : faceRun fp data = some (o, pls)) : Aven.Runtime.check treeLimits o.tree = true :=
  Aven.Runtime.face_passes_check (Aven.Runtime.faceRun_ok h)

end Aven.Actor
