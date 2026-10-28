/-! Announcements may wake once authoritative persistence completes; optional
restart accelerators are not part of that gate. This is a scheduling model only. -/
namespace AvenDB.DurableAnnounce

def publishable (journal receipts : Bool) : Bool := journal && receipts

theorem no_early_journal (receipts : Bool) : publishable false receipts = false := rfl

theorem no_early_receipt : publishable true false = false := rfl

theorem durable_ready : publishable true true = true := rfl

def gate (journal receipts _derived : Bool) : Bool := publishable journal receipts

theorem derived_independent (journal receipts a b : Bool) :
    gate journal receipts a = gate journal receipts b := rfl

end AvenDB.DurableAnnounce
