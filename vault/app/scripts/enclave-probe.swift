// Probe (2026-10-19): can this Mac's Secure Enclave hold theOS's Touch ID key, a second owner of its person's avenDB
// vault? CryptoKit's post-quantum Enclave keys need macOS 26: ML-DSA-65 signs each ceremony's challenge, ML-KEM-768
// opens the key's secret, and one touch must cover both, also after the keys are loaded again from their blobs, as at
// every start of the app.
//
// Run:   swiftc -O vault/app/scripts/enclave-probe.swift -o /tmp/enclave-probe && /tmp/enclave-probe --kat --touch
// --kat prints a signature for avenDB's Rust side to check (sign.rs); --touch asks for a finger twice.
// Nothing is stored: every key lives in this process alone, its blob loaded again in memory, never written.
import CryptoKit
import Foundation
import LocalAuthentication

/// A shared secret's bytes, to compare two.
func bytes(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

/// One Touch ID approval on `ctx`, as the app asks for it.
func touch(_ ctx: LAContext, _ reason: String) -> Bool {
    let done = DispatchSemaphore(value: 0)
    var ok = false
    ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, e in
        ok = success
        if let e { print("Touch ID:", e) }
        done.signal()
    }
    done.wait()
    return ok
}

print("macOS", ProcessInfo.processInfo.operatingSystemVersionString)
print("Secure Enclave available:", SecureEnclave.isAvailable)
guard #available(macOS 26.0, *) else {
    print("RESULT: this macOS is older than 26, so no post-quantum Secure Enclave keys")
    exit(0)
}

let msg = Data((0..<32).map { UInt8($0) })
let context = Data("avenDB 2026-10-19 enclave signature".utf8)

// 1. ML-DSA-65 in the Enclave, no Touch ID: does this chip make one, sign with avenDB's context, and reload it?
do {
    let key = try SecureEnclave.MLDSA65.PrivateKey()
    let pub = key.publicKey.rawRepresentation
    let sig = try key.signature(for: msg, context: context)
    print("MLDSA65: public", pub.count, "bytes, signature", sig.count, "bytes, verifies with context:",
          key.publicKey.isValidSignature(sig, for: msg, context: context),
          "and fails without it:", !key.publicKey.isValidSignature(sig, for: msg))
    let blob = key.dataRepresentation
    let again = try SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: blob)
    print("MLDSA65 blob", blob.count, "bytes, reloads to the same key:", again.publicKey.rawRepresentation == pub)
    if CommandLine.arguments.contains("--kat") {
        // the message is the bytes 0 to 31; avenDB's Rust side checks these two lines
        print("KAT public", pub.base64EncodedString())
        print("KAT signature", sig.base64EncodedString())
    }
} catch {
    print("MLDSA65 FAILED:", error)
}

// 2. ML-KEM-768 in the Enclave: encapsulate to its public key, decapsulate inside the chip
do {
    let key = try SecureEnclave.MLKEM768.PrivateKey()
    let result = try key.publicKey.encapsulate()
    let shared = try key.decapsulate(result.encapsulated)
    print("MLKEM768: ciphertext", result.encapsulated.count, "bytes, shared secrets match:",
          bytes(shared) == bytes(result.sharedSecret))
} catch {
    print("MLKEM768 FAILED:", error)
}

// 3. Optional, a finger on Touch ID twice: keys locked to the current fingerprints, made on one approval; then, as at
// the app's next start, loaded again from their blobs, where one more approval must cover a signature and the secret
if CommandLine.arguments.contains("--touch") {
    var err: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                       [.privateKeyUsage, .biometryCurrentSet], &err) else {
        print("access control FAILED:", err!.takeRetainedValue())
        exit(1)
    }
    let ctx = LAContext()
    print("Touch ID approved:", touch(ctx, "make a test Touch ID key for theOS"))
    do {
        let key = try SecureEnclave.MLDSA65.PrivateKey(accessControl: access, authenticationContext: ctx)
        let kem = try SecureEnclave.MLKEM768.PrivateKey(accessControl: access, authenticationContext: ctx)
        let sealed = try kem.publicKey.encapsulate()
        let a = try key.signature(for: msg, context: context)
        print("behind Touch ID, made: signature verifies:", key.publicKey.isValidSignature(a, for: msg, context: context),
              "secret opens:", bytes(try kem.decapsulate(sealed.encapsulated)) == bytes(sealed.sharedSecret))
        // a fresh context that may not ask must not sign
        let quiet = LAContext()
        quiet.interactionNotAllowed = true
        let silent = try SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: key.dataRepresentation,
                                                         authenticationContext: quiet)
        do {
            _ = try silent.signature(for: msg)
            print("WARNING: signed with a fresh context and no Touch ID")
        } catch {
            print("fresh context without Touch ID refused, as it should:", error)
        }
        // the next start: both keys from their blobs, one approval, both uses
        let next = LAContext()
        print("Touch ID approved again:", touch(next, "open the test Touch ID key again"))
        let key2 = try SecureEnclave.MLDSA65.PrivateKey(dataRepresentation: key.dataRepresentation,
                                                       authenticationContext: next)
        let kem2 = try SecureEnclave.MLKEM768.PrivateKey(dataRepresentation: kem.dataRepresentation,
                                                        authenticationContext: next)
        let b = try key2.signature(for: msg, context: context)
        let secret = try kem2.decapsulate(sealed.encapsulated)
        print("RESULT reloaded, one touch: signature verifies:",
              key.publicKey.isValidSignature(b, for: msg, context: context),
              "secret opens:", bytes(secret) == bytes(sealed.sharedSecret))
    } catch {
        print("Touch ID keys FAILED:", error)
    }
}
