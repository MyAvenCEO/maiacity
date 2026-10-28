use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    enclave();
    tauri_build::build()
}

/// The Secure Enclave's bridge (enclave/Enclave.swift), built by swiftc into a static library the app links, its
/// Swift runtime the one macOS ships, and `cfg(enclave)` set for src/enclave.rs. Where it doesn't build, as without
/// Xcode's command line tools or with an SDK older than macOS 26's, the app builds without it and offers no Touch ID.
fn enclave() {
    println!("cargo::rustc-check-cfg=cfg(enclave)");
    let source = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("the app's folder")).join("enclave");
    println!("cargo:rerun-if-changed={}", source.display());
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    match swift(&source.join("Enclave.swift")) {
        Ok(()) => println!("cargo:rustc-cfg=enclave"),
        Err(why) => why.lines().for_each(|line| println!("cargo:warning=Touch ID's bridge: {line}")),
    }
}

/// Builds `source` into libavendb_enclave.a in OUT_DIR, for this build's target and the app's oldest macOS, and links
/// it: or why not.
fn swift(source: &Path) -> Result<(), String> {
    let run = |program: &str, args: &[&str]| -> Result<String, String> {
        let out = Command::new(program).args(args).output().map_err(|e| format!("{program} didn't run: {e}"))?;
        let said = String::from_utf8_lossy(if out.status.success() { &out.stdout } else { &out.stderr });
        if out.status.success() { Ok(said.trim().to_string()) } else { Err(format!("{program}: {said}")) }
    };
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => return Err(format!("no Swift target for {other}")),
    };
    // the oldest macOS the app runs on, as Tauri builds it (tauri.conf.json's minimumSystemVersion)
    let oldest = std::env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "13.0".into());
    let sdk = run("xcrun", &["--sdk", "macosx", "--show-sdk-path"])?;
    let swiftc = run("xcrun", &["--sdk", "macosx", "--find", "swiftc"])?;
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("the build's folder"));
    let lib = out.join("libavendb_enclave.a");
    let target = format!("{arch}-apple-macos{oldest}");
    let (lib_text, source_text) = (lib.to_string_lossy(), source.to_string_lossy());
    let args = [
        "-emit-library", "-static", "-parse-as-library", "-swift-version", "5", "-O", "-module-name", "AvendbEnclave",
        "-target", target.as_str(), "-sdk", sdk.as_str(), "-o", &*lib_text, &*source_text,
    ];
    run(&swiftc, &args)?;
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=avendb_enclave");
    // Swift's runtime: the SDK's stubs to link against, the toolchain's compatibility libraries for older macOS, and
    // the runtime macOS keeps in /usr/lib/swift at run time
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    if let Some(toolchain) = Path::new(&swiftc).parent().and_then(Path::parent) {
        println!("cargo:rustc-link-search=native={}", toolchain.join("lib/swift/macosx").display());
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    for framework in ["CryptoKit", "LocalAuthentication", "Security", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    Ok(())
}
