/-! Ownership/snapshot scheduling contract, not an extracted serializer proof. -/
namespace AvenDB.WorldSnapshot
structure Snapshot (Actor View : Type) where
  actor : Actor
  view : View

def encode (s : Snapshot Actor View) (render : Actor → View → Json) : Json :=
  render s.actor s.view

theorem same_encoding (s : Snapshot Actor View) (render : Actor → View → Json) :
    encode s render = render s.actor s.view := rfl

-- Subsequent live state is deliberately not an input to serialization.
def afterMutation (s : Snapshot Actor View) (_live : View) (render : Actor → View → Json) := encode s render

theorem frozen (s : Snapshot Actor View) (a b : View) (render : Actor → View → Json) :
    afterMutation s a render = afterMutation s b render := rfl
end AvenDB.WorldSnapshot

namespace AvenDB.WorldSnapshot
-- One per-node capture/encode permit bounds materialized snapshot overlap.
def enter (held : Bool) : Bool := !held
theorem held_excludes_second_capture : enter true = false := rfl
end AvenDB.WorldSnapshot
