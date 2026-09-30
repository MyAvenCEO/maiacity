//! ONNX Runtime's prebuilt static library (ort's own download, built for macOS 13.4) asks the OS version at run time —
//! `__isPlatformVersionAtLeast`, from clang's runtime library. Rust links without clang's runtime, so it is linked
//! here, from the toolchain's own clang (Xcode's or the Command Line Tools'): nothing to install.

use std::process::Command;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = Command::new("xcrun").args(["clang", "--print-resource-dir"]).output().or_else(|_| Command::new("clang").arg("--print-resource-dir").output());
    let Ok(out) = out else {
        println!("cargo:warning=no clang found: ONNX Runtime may not link (__isPlatformVersionAtLeast)");
        return;
    };
    let dir = format!("{}/lib/darwin", String::from_utf8_lossy(&out.stdout).trim());
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
