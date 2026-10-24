// avenDB's Touch ID key in this Mac's Secure Enclave, for theOS: build.rs builds this file into a static library the
// app links, and src/enclave.rs calls `avendb_enclave` with one ask in JSON and frees the answer it gets back, in JSON,
// with `avendb_enclave_free`.
//
// The key (avendb/docs/ARCHITECTURE.md, "Touch ID on a Mac") is two keys in the Secure Enclave behind the fingers
// enrolled now (macOS 26): an ML-DSA-65 key that signs a ceremony's challenge with avenDB's context, and an ML-KEM-768
// key that opens a secret sealed to it as the keys are made, with the same touch. What leaves the Enclave is the
// ML-DSA key's public key, the blobs of both keys, which only this Mac's Enclave opens, and what each touch signs and
// opens. All bytes in base64, as avendb-device's lines carry them.
//
// - {"ready": true}: {"ready": bool}, whether this Mac can hold the key: macOS 26, a Secure Enclave, a finger enrolled
// - {"make": challenge, "why"}: one touch makes both keys: {public, key, kem, sealed, secret, sig}
// - {"sign": challenge, "key", "kem", "sealed", "why"}: one touch: {sig, secret}
// - whatever fails: {"error": why}
//
// `why` finishes the Touch ID sheet's sentence "theOS is trying to ...". vault/app/scripts/enclave-probe.swift showed
// each step on a Mac first.
import CryptoKit
import Foundation
import LocalAuthentication

/// What fails, said for the person.
struct Failure: Error {
    let why: String
}

/// avenDB's context for the key's signatures (avendb's `sign::ENCLAVE_CONTEXT`).
private let avendbContext = Data("avenDB 2026-10-19 enclave signature".utf8)

/// One ask at a time, so one Touch ID sheet at a time.
private let asking = NSLock()

/// The approval of the last `make`, the blob of the key it made, and when: it covers the next `sign` of that key, once,
/// within two minutes, so adding the key to the vault, while the person approves it with their passkey too, needs no
/// second touch.
private var made: (context: LAContext, key: Data, at: Date)?

@_cdecl("avendb_enclave")
public func avendbEnclave(_ ask: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    guard enterCeremonyQueue(asking, until: Date().addingTimeInterval(120)) else {
        return strdup(#"{"error":"Touch ID is busy. Please try again."}"#)
    }
    defer { asking.unlock() }
    return strdup(answer(to: String(cString: ask)))
}

@_cdecl("avendb_enclave_free")
public func avendbEnclaveFree(_ answer: UnsafeMutablePointer<CChar>?) {
    free(answer)
}

/// The answer to `text`, one ask in JSON, in JSON.
func answer(to text: String) -> String {
    let reply: [String: Any]
    do {
        reply = try handle(text)
    } catch let failure as Failure {
        reply = ["error": failure.why]
    } catch {
        reply = ["error": "the Secure Enclave: \(error)"]
    }
    let data = try? JSONSerialization.data(withJSONObject: reply, options: [.withoutEscapingSlashes])
    guard let data, let json = String(data: data, encoding: .utf8)
    else { return #"{"error":"the Secure Enclave's answer isn't JSON"}"# }
    return json
}

func handle(_ text: String) throws -> [String: Any] {
    guard let data = text.data(using: .utf8), let ask = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw Failure(why: "an ask for the Secure Enclave that isn't JSON") }
    if ask["ready"] != nil {
        return ["ready": ready()]
    }
    guard #available(macOS 26.0, *) else {
        throw Failure(why: "a Touch ID key for avenDB needs macOS 26 or later")
    }
    let why = ask["why"] as? String ?? "use avenDB"
    if let challenge = ask["make"] as? String {
        return try make(bytes(challenge, "challenge"), why)
    }
    if let challenge = ask["sign"] as? String {
        let (key, kem, sealed) = (ask["key"] as? String ?? "", ask["kem"] as? String ?? "", ask["sealed"] as? String ?? "")
        return try sign(bytes(challenge, "challenge"), key: bytes(key, "key"), kem: bytes(kem, "kem"),
                        sealed: bytes(sealed, "sealed"), why)
    }
    throw Failure(why: "an ask the Secure Enclave doesn't know")
}

/// Whether this Mac can hold the key: macOS 26 or later, a Secure Enclave, and a finger enrolled in Touch ID.
func ready() -> Bool {
    guard #available(macOS 26.0, *) else { return false }
    guard SecureEnclave.isAvailable else { return false }
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
}

/// The bytes `text` holds in base64, named `name` where they don't.
func bytes(_ text: String, _ name: String) throws -> Data {
    guard let data = Data(base64Encoded: text) else { throw Failure(why: "the Secure Enclave's \(name) isn't base64") }
    return data
}

/// A shared secret's bytes.
func raw(_ key: SymmetricKey) -> Data {
    key.withUnsafeBytes { Data($0) }
}

// BEGIN ceremony result state (also exercised without invoking biometrics).
func enterCeremonyQueue(_ queue: NSLock, until deadline: Date) -> Bool {
    queue.lock(before: deadline)
}
final class CeremonyResult {
    private let lock = NSLock()
    private var terminal = false
    private var result: (Bool, Error?) = (false, nil)

    @discardableResult func finish(_ success: Bool, _ error: Error?) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !terminal else { return false }
        terminal = true; result = (success, error)
        return true
    }
    func expire() { _ = finish(false, nil) }
    func read() -> (Bool, Error?) {
        lock.lock(); defer { lock.unlock() }
        return result
    }
}
// END ceremony result state.

/// A touch for `why`: the approval, which the keys then use without asking again. Touch ID alone, no password instead.
func approved(_ why: String) throws -> LAContext {
    let context = LAContext()
    context.localizedFallbackTitle = ""
    var unable: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &unable) else {
        throw Failure(why: "Touch ID isn't ready on this Mac: \(unable?.localizedDescription ?? "no finger enrolled")")
    }
    let done = DispatchSemaphore(value: 0)
    let result = CeremonyResult()
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: why) { success, error in
        if result.finish(success, error) { done.signal() }
    }
    guard done.wait(timeout: .now() + 120) == .success else {
        result.expire()
        context.invalidate()
        throw Failure(why: "Touch ID timed out. Please try again.")
    }
    let (ok, failed) = result.read()
    guard ok else { throw Failure(why: "Touch ID: \(failed?.localizedDescription ?? "not approved")") }
    return context
}

/// Both keys made behind the fingers enrolled now, on one touch: the ML-DSA key's public key and signature over
/// `challenge`, both keys' blobs, a secret sealed to the ML-KEM key, and that secret, opened by the Enclave to show it
/// opens.
@available(macOS 26.0, *)
func make(_ challenge: Data, _ why: String) throws -> [String: Any] {
    let context = try approved(why)
    var unable: Unmanaged<CFError>?
    let flags: SecAccessControlCreateFlags = [.privateKeyUsage, .biometryCurrentSet]
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &unable)
    else { throw Failure(why: "no access control for the key: \(String(describing: unable?.takeRetainedValue()))") }
    let key = try SecureEnclave.MLDSA65.PrivateKey(accessControl: access, authenticationContext: context)
    let kem = try SecureEnclave.MLKEM768.PrivateKey(accessControl: access, authenticationContext: context)
    let sealed = try kem.publicKey.encapsulate()
    let secret = raw(try kem.decapsulate(sealed.encapsulated))
    guard secret == raw(sealed.sharedSecret) else { throw Failure(why: "the Secure Enclave didn't open its own secret") }
    let sig = try key.signature(for: challenge, context: avendbContext)
    made = (context, key.dataRepresentation, Date())
    return [
        "public": key.publicKey.rawRepresentation.base64EncodedString(),
        "key": key.dataRepresentation.base64EncodedString(),
        "kem": kem.dataRepresentation.base64EncodedString(),
        "sealed": sealed.encapsulated.base64EncodedString(),
        "secret": secret.base64EncodedString(),
        "sig": sig.base64EncodedString(),
    ]
}

/// One touch for `why`, or the make's just before for the key it made: the signature of the key `key` over `challenge`
/// and the secret `sealed` that the key `kem` opens.
@available(macOS 26.0, *)
func sign(_ challenge: Data, key: Data, kem: Data, sealed: Data, _ why: String) throws -> [String: Any] {
    let last = made
    made = nil
    let context: LAContext
    if let last, last.key == key, Date().timeIntervalSince(last.at) < 120 {
        context = last.context
    } else {
        context = try approved(why)
    }
    let signer = try SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: key, authenticationContext: context)
    let opener = try SecureEnclave.MLKEM768.PrivateKey(dataRepresentation: kem, authenticationContext: context)
    let sig = try signer.signature(for: challenge, context: avendbContext)
    let secret = raw(try opener.decapsulate(sealed))
    return ["sig": sig.base64EncodedString(), "secret": secret.base64EncodedString()]
}
