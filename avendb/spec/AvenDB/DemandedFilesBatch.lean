namespace AvenDB.DemandedFilesBatch
-- Grouping selected entries before scanning changes traversal only. Membership
-- still requires current demand, current keep selection, a held reference and
-- an opened file key. A group is not an authorization grant.
def perEntry (demanded wants references opens : Bool) : Bool :=
  demanded && wants && references && opens
def grouped (demanded wants references opens : Bool) : Bool :=
  (demanded && wants) && (references && opens)
theorem same_files (d w r o : Bool) : perEntry d w r o = grouped d w r o := by
  cases d <;> cases w <;> cases r <;> cases o <;> rfl
theorem no_key_no_file (d w r : Bool) : grouped d w r false = false := by
  cases d <;> cases w <;> cases r <;> rfl
theorem unselected_absent (d r o : Bool) : grouped d false r o = false := by
  cases d <;> cases r <;> cases o <;> rfl
end AvenDB.DemandedFilesBatch
