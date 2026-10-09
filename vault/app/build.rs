//! The app's build: first avenDB's native device, the app's sidecar (avendb.rs), built from avendb/crates/avendb-device
//! in avenDB's own workspace and lockfile, and put where Tauri bundles it from (tauri.conf.json's `bundle.externalBin`:
//! binaries/avendb-device-<target>, which lands beside the app's binary as `avendb-device`); then Tauri's own.

use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    sidecar();
    tauri_build::build()
}

/// What the device's stand-in tells the app: the page then runs avenDB in the web view, as before it was native.
const STAND_IN: &str = concat!(
    r#"{"fatal": "avenDB's native device didn't build with the app, so the page runs it here instead: "#,
    r#"the app's build log says why"}"#
);

/// Builds avenDB's device for this build's target, in avenDB's profile for the app (`app`: optimised, and quick to
/// build again), in avendb/target, and puts it in binaries/ if it changed. When it doesn't build, a debug build of the
/// app gets a stand-in, so the app still runs, and tries again at its next build; a release build fails.
fn sidecar() {
    let app = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("the app's folder"));
    let avendb = app.join("../../avendb");
    let target = std::env::var("TARGET").expect("the build's target");
    let to = app.join("binaries").join(format!("avendb-device-{target}"));
    for source in ["crates", "Cargo.toml", "Cargo.lock"] {
        println!("cargo:rerun-if-changed={}", avendb.join(source).display());
    }
    let why = match build(&avendb, &target) {
        Ok(built) => match std::fs::read(&built) {
            Ok(bytes) => return put(&bytes, &to),
            Err(e) => format!("{}: {e}", built.display()),
        },
        Err(why) => why,
    };
    if std::env::var("PROFILE").as_deref() != Ok("debug") {
        panic!("avenDB's device didn't build: {why}");
    }
    for line in why.lines() {
        println!("cargo:warning=avenDB's device: {line}");
    }
    // a file that is never there: the next build of the app runs this again
    println!("cargo:rerun-if-changed={}", app.join("binaries/.retry").display());
    put(format!("#!/bin/sh\ncat <<'EOF'\n{STAND_IN}\nEOF\n").as_bytes(), &to);
}

/// Builds the device with cargo, as avenDB's workspace builds it, none of this build's own settings leaking in: the
/// device's binary, or why there is none.
fn build(avendb: &Path, target: &str) -> Result<PathBuf, String> {
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let mut command = Command::new(cargo);
    for (key, _) in std::env::vars_os() {
        let Some(key) = key.to_str() else { continue };
        let ours = key.starts_with("CARGO_") && !KEPT.iter().any(|kept| key.starts_with(kept));
        if ours || THIS_BUILD.contains(&key) {
            command.env_remove(key);
        }
    }
    let dir = avendb.join("target");
    let args = ["build", "--locked", "-p", "avendb-device", "--profile", "app", "--target", target];
    let out = command.current_dir(avendb).env("CARGO_TARGET_DIR", &dir).args(args).output();
    let out = out.map_err(|e| format!("cargo didn't run: {e}"))?;
    if !out.status.success() {
        let log = String::from_utf8_lossy(&out.stderr);
        let said: Vec<_> = log.lines().filter(|l| !l.trim_start().starts_with("Compiling")).collect();
        return Err(said[said.len().saturating_sub(40)..].join("\n"));
    }
    Ok(dir.join(target).join("app").join("avendb-device"))
}

/// The cargo settings of the person's own, which avenDB's build keeps: where cargo keeps its crates, how it reaches
/// them, and how it shows.
const KEPT: &[&str] =
    &["CARGO_HOME", "CARGO_NET_", "CARGO_HTTP_", "CARGO_REGISTRIES_", "CARGO_REGISTRY_", "CARGO_TERM_"];

/// What cargo tells this build script alone, which another cargo would take as its own: its jobserver, its wrapper,
/// its target and profile.
const THIS_BUILD: &[&str] = &[
    "MAKEFLAGS", "MFLAGS", "RUSTC_WORKSPACE_WRAPPER", "TARGET", "HOST", "OUT_DIR", "NUM_JOBS", "OPT_LEVEL", "DEBUG",
    "PROFILE", "RUSTDOC", "RUSTC_LINKER",
];

/// Puts `bytes` at `to`, executable, unless it holds them already: Tauri copies it beside the app's binary at each
/// build, and an unchanged device leaves binaries/ as it was.
fn put(bytes: &[u8], to: &Path) {
    if std::fs::read(to).is_ok_and(|held| held == bytes) {
        return;
    }
    let name = to.file_name().expect("a file").to_string_lossy();
    let part = to.with_file_name(format!("{name}.part"));
    std::fs::create_dir_all(to.parent().expect("binaries/")).expect("binaries/");
    std::fs::write(&part, bytes).expect("the device in binaries/");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).expect("the device, executable");
    }
    std::fs::rename(&part, to).expect("the device in binaries/");
}
