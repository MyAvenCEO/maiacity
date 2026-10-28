import AvenDB.Objective
open AvenDB.Objective

namespace Objectives.Unmeasured

def nothing : Metric := metric "Nobody measured it" (atLeast (reading "never") 1)
def perZero : Metric := metric "Per zero" (atMost (reading "a" / reading "zero") 1)
def huge : Metric := metric "Too big" (atLeast (reading "big" * reading "big") 1)
def target : Metric := metric "Unmeasured target" (atLeast (reading "a") (reading "never"))
def worse : Metric := metric "Got worse" (atLeast (reading "falling") 10)
def flat : Metric := metric "One reading" (atLeast (reading "a") 10)
def small : Metric := metric "Fine digits" (atLeast (reading "a" * 0.0000019) 0.000001)
def mins : Metric := metric "Min" (atMost (min (reading "a") (reading "falling")) 2)

def objective : List Metric := [nothing, perZero, huge, target, worse, flat, small, mins]

end Objectives.Unmeasured
