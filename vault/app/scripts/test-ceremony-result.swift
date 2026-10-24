// The shell test prepends CeremonyResult extracted from production Enclave.swift.
let expired = CeremonyResult()
expired.expire()
assert(!expired.finish(true, nil), "Late approval cannot revive an expired ceremony")
assert(!expired.read().0)
let approved = CeremonyResult()
assert(approved.finish(true, nil))
assert(!approved.finish(false, nil), "Only the first terminal result counts")
assert(approved.read().0)
for _ in 0..<1000 {
    let racing = CeremonyResult()
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.global().async { racing.expire(); group.leave() }
    group.enter()
    DispatchQueue.global().async { _ = racing.finish(true, nil); group.leave() }
    group.wait()
    let terminal = racing.read().0
    assert(!racing.finish(!terminal, nil))
    assert(racing.read().0 == terminal)
}
print("CeremonyResult: expiration, first completion and 1000 concurrent races passed")
