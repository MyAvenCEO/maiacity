#!/bin/sh
# Checks The OS's Secure Enclave bridge (vault/app/enclave/Enclave.swift) on this Mac without building the app: builds
# it into the static library build.rs builds, links that into a small Rust program the way the app links it, and asks
# it whether this Mac can hold avenDB's Touch ID key. With --touch it also makes a test key on one touch and signs with
# it twice: first on that same touch, as the app adds the key to the vault, then on a new touch, as the app opens.
# Nothing is kept: the test key's blobs live in this run alone.
#
# Run from the repo:  sh vault/app/scripts/enclave-check.sh --touch
# or with the Swift file elsewhere:  ENCLAVE=/path/to/Enclave.swift sh enclave-check.sh --touch
set -eu
here=$(cd "$(dirname "$0")" && pwd)
source=${ENCLAVE:-$here/../enclave/Enclave.swift}
out=$(mktemp -d /tmp/enclave-check.XXXXXX)
sdk=$(xcrun --sdk macosx --show-sdk-path)
swiftc=$(xcrun --sdk macosx --find swiftc)
toolchain=$(dirname "$(dirname "$swiftc")")

"$swiftc" -emit-library -static -parse-as-library -swift-version 5 -O -module-name AvendbEnclave \
    -target "$(uname -m)-apple-macos13.0" -sdk "$sdk" -o "$out/libavendb_enclave.a" "$source"
echo "Swift bridge built: $(wc -c < "$out/libavendb_enclave.a") bytes"

cat > "$out/check.rs" <<'RUST'
use std::ffi::{CStr, CString, c_char};

unsafe extern "C" {
    fn avendb_enclave(ask: *const c_char) -> *mut c_char;
    fn avendb_enclave_free(answer: *mut c_char);
}

fn ask(json: &str) -> String {
    let ask = CString::new(json).expect("no NUL");
    unsafe {
        let answer = avendb_enclave(ask.as_ptr());
        let text = CStr::from_ptr(answer).to_string_lossy().into_owned();
        avendb_enclave_free(answer);
        text
    }
}

/// The string at `key` in `answer`, as its JSON has it (a `/` written `\/`).
fn field<'a>(answer: &'a str, key: &str) -> &'a str {
    let tag = format!("\"{key}\":\"");
    let Some(start) = answer.find(&tag).map(|i| i + tag.len()) else { return "" };
    answer[start..].find('"').map_or("", |end| &answer[start..start + end])
}

/// How many bytes the base64 at `key` in `answer` holds.
fn size(answer: &str, key: &str) -> usize {
    let text = field(answer, key).replace("\\/", "/");
    (text.len() / 4 * 3).saturating_sub(text.chars().rev().take_while(|&c| c == '=').count())
}

fn main() {
    println!("ready: {}", ask(r#"{"ready":true}"#));
    if !std::env::args().any(|a| a == "--touch") {
        return;
    }
    // the bytes 0 to 31
    let challenge = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
    let made = ask(&format!(r#"{{"make":"{challenge}","why":"make a test Touch ID key for a check of The OS"}}"#));
    if made.contains("\"error\"") {
        println!("make FAILED: {made}");
        return;
    }
    let sizes: Vec<_> = ["public", "key", "kem", "sealed", "secret", "sig"]
        .iter()
        .map(|k| format!("{k} {}", size(&made, k)))
        .collect();
    println!("made, bytes: {}", sizes.join(", "));
    let sign = |why: &str| {
        let (key, kem, sealed) = (field(&made, "key"), field(&made, "kem"), field(&made, "sealed"));
        let ask_text = format!(r#"{{"sign":"{challenge}","key":"{key}","kem":"{kem}","sealed":"{sealed}","why":"{why}"}}"#);
        let answer = ask(&ask_text);
        let ok = !answer.contains("\"error\"") && field(&answer, "secret") == field(&made, "secret");
        if !ok {
            println!("{why}: FAILED: {answer}");
        }
        // an ML-DSA-65 signature is 3309 bytes
        ok && size(&answer, "sig") == 3309
    };
    let first = sign("sign with the test key on the same touch");
    let second = sign("sign with the test key again");
    println!("RESULT: signed on the make's touch: {first}, signed on a new touch: {second}");
}
RUST

rustc --edition 2024 -O -o "$out/check" "$out/check.rs" \
    -L "$out" -l static=avendb_enclave \
    -L "$sdk/usr/lib/swift" -L "$toolchain/lib/swift/macosx" -C link-arg=-Wl,-rpath,/usr/lib/swift \
    -l framework=CryptoKit -l framework=LocalAuthentication -l framework=Security -l framework=Foundation
echo "linked into Rust as the app links it"
"$out/check" "$@"
