//! Real Lean in The OS (N3, avendb/docs/ARCHITECTURE.md §8, "AIPs"): the pinned Lean release, the version
//! avendb/spec/lean-toolchain names (`VERSION`, `RELEASES`), checks an AIP's objective, a file of Lean against the
//! spec's own AvenDB.Objective, on the device of whoever measures it, and the page records what it found as their
//! reading `lean:<key>` (`avendb::objective::verdict_name`): the AIP's Lean verdict (`AvenDB.Measurers.leanVerdict`).
//! Browsers keep avenDB's own engine, which reads the same subset of Lean (`avendb::objective`).
//!
//! Two walls stand between an objective and the Mac. The input wall: Lean runs only on a file avenDB's engine reads
//! (`avendb::objective::read`), a subset with no `#eval`, no macros and no options. The process wall: Lean runs under a
//! sandbox profile of its own (`PROFILE`, `sandbox-exec`), which lets it read its own folder and the system's libraries
//! and nothing else, write nothing (but the one folder its objective module is built in, once), reach no network and
//! start nothing; elaboration is held to `HEARTBEATS`, memory to `MEMORY_MB` and the clock to `CLOCK`. Only a Mac has
//! that sandbox, so only The OS on a Mac runs Lean (`LOCKED`).
//!
//! Lean comes only when the person asks (`leanGet`, behind a button in the Proposals app that names its sizes): the
//! release's archive straight from Lean's releases on GitHub, unpacked as it streams in, keeping only what checking an
//! objective needs (`keep`: `lean`, its shared libraries and the Init library's .olean files, 1,964 of its 18,534
//! files), into a folder of its own beside the device's shelves (`lean/<version>.part`), which is put in place
//! (`lean/<version>`) only once the archive's SHA-256 matched the one pinned here; nothing in it runs before. The spec's
//! Objective.lean, built into this device, is compiled there once per version of it (`objective/<key>`, its BLAKE3).
//!
//! The device's calls (`Service::call`, with no device open): `leanEngine` what Lean is here (`Lean::engine`),
//! `leanGet` getting it (`Lean::get`), `leanCheck [lean]` checking an objective with it (`Lean::check`).

use std::io::{self, Read, Write as _};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use avendb::objective;
use data_encoding::HEXLOWER;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

/// The Lean release the device runs, as avendb/spec/lean-toolchain pins the spec's.
pub const VERSION: &str = "4.35.0";

/// The spec's objective module, which every objective imports: the file Lean compiles on the device, once per version.
pub const OBJECTIVE: &str = include_str!("../../../spec/AvenDB/Objective.lean");

/// A release of Lean for one system: its archive on GitHub, the archive's SHA-256 and size, and how many bytes of it
/// the device keeps (`keep`).
pub struct Release {
    pub os: &'static str,
    pub arch: &'static str,
    pub asset: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
    pub kept: u64,
}

/// Lean `VERSION`'s releases, each archive's SHA-256 pinned here (read off the archives themselves, 2026-10-20).
pub const RELEASES: &[Release] = &[
    Release {
        os: "macos",
        arch: "aarch64",
        asset: "lean-4.35.0-darwin_aarch64.tar.zst",
        sha256: "c0c6f34f35ba1dcc5c4a5fd106fefab9eb5e8469712624dd2c868d51b63177c2",
        bytes: 570_422_530,
        kept: 543_661_464,
    },
    Release {
        os: "macos",
        arch: "x86_64",
        asset: "lean-4.35.0-darwin.tar.zst",
        sha256: "0b43be5c7ecfb36016566a41005ab62bdb04743e6bfd5837e45f796ef4750b4e",
        bytes: 576_516_478,
        kept: 549_832_184,
    },
    Release {
        os: "linux",
        arch: "x86_64",
        asset: "lean-4.35.0-linux.tar.zst",
        sha256: "7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d",
        bytes: 594_481_375,
        kept: 597_428_984,
    },
];

/// Where the releases come from.
const RELEASES_URL: &str = "https://github.com/leanprover/lean4/releases/download";

/// Whether Lean runs here: only where its sandbox does, on a Mac.
pub const LOCKED: bool = cfg!(target_os = "macos");

/// How much elaboration a check may take, in Lean's heartbeats (its default is 200,000 too, set here so no file
/// changes it unseen).
const HEARTBEATS: u32 = 200_000;
/// How much memory Lean may take, in megabytes: a check takes about 500.
const MEMORY_MB: u32 = 1024;
/// How long a check, or compiling the objective module, may take on the clock.
const CLOCK: Duration = Duration::from_secs(60);
/// The longest objective file it checks.
const MAX_LEAN: usize = 64 * 1024;
/// How much free space getting Lean leaves on the disk beside what it keeps.
const SPARE: u64 = 500_000_000;

/// The release for this system, if Lean has one.
pub fn release() -> Option<&'static Release> {
    RELEASES.iter().find(|r| r.os == std::env::consts::OS && r.arch == std::env::consts::ARCH)
}

/// The engine a verdict names in its note: Lean's version, the first hex digits of its archive's SHA-256, and the
/// objective module's key, so a reader knows which Lean on which spec found it.
pub fn engine_name(r: &Release) -> String {
    format!("lean-{VERSION} {} objective {}", &r.sha256[..8], objective::key(OBJECTIVE))
}

/// The sandbox Lean runs in (`sandbox-exec -p`): nothing allowed but reading its own folder (`ROOT`) and what the
/// system's dynamic loader reads and maps, writing `/dev/null`, reading the system's settings, and running `LEAN`; with
/// `OUT`, writing that one folder too. No network, no other process, no file of the person's.
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "LEAN")))
(allow process-info* (target self))
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read*
  (subpath (param "ROOT"))
  (subpath "/usr/lib")
  (subpath "/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes")
  (subpath "/private/var/db/dyld")
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom"))
(allow file-map-executable
  (subpath (param "ROOT"))
  (subpath "/usr/lib")
  (subpath "/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes"))
(allow file-write-data (literal "/dev/null"))
"#;

/// What `PROFILE` adds where Lean builds the objective module: writing its one folder (`OUT`).
const PROFILE_OUT: &str = "(allow file-write* (subpath (param \"OUT\")))\n";

/// Of the archive's files (each path after its top folder), whether the device keeps it: `lean` itself, its shared
/// libraries, and the Init library's .olean files, all an objective's `import AvenDB.Objective` reaches. A path with
/// `..` or a root in it is never kept.
pub fn keep(rel: &Path) -> bool {
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return false;
    }
    let Some(rel) = rel.to_str() else { return false };
    const LIBS: [&str; 4] = ["libleanshared", "libleanshared_1", "libleanshared_2", "libInit_shared"];
    if rel == "bin/lean" {
        return true;
    }
    if let Some(lib) = rel.strip_prefix("lib/lean/").and_then(|r| r.strip_suffix(".dylib").or(r.strip_suffix(".so"))) {
        return LIBS.contains(&lib);
    }
    (rel.starts_with("lib/lean/Init/") || rel.starts_with("lib/lean/Init."))
        && (rel.ends_with(".olean") || rel.ends_with(".olean.server") || rel.ends_with(".olean.private"))
}

/// Unpacks a release's archive as `from` reads it, into `into`, keeping only what `keep` keeps: its bytes counted in
/// `at` as they come, and checked against its SHA-256 once the last one is in. Fails, and leaves `into` unfit for use,
/// where they don't match, or where it keeps no `lean`.
pub fn unpack(from: impl Read, r: &Release, into: &Path, at: &AtomicU64) -> Result<u64> {
    let mut read = Hashing { inner: from, hash: Sha256::new(), at };
    let decoder = ruzstd::decoding::StreamingDecoder::new(&mut read).context("Lean's archive isn't zstd")?;
    let mut archive = tar::Archive::new(decoder);
    let mut kept = 0u64;
    let mut lean = false;
    for entry in archive.entries().context("Lean's archive isn't a tar")? {
        let mut entry = entry.context("reading Lean's archive")?;
        if entry.header().entry_type() != tar::EntryType::Regular {
            continue;
        }
        let path = entry.path().context("a path in Lean's archive")?.into_owned();
        // each path after the archive's top folder, lean-<version>-<system>/
        let rel: PathBuf = path.components().skip(1).collect();
        if !keep(&rel) {
            continue;
        }
        let to = into.join(&rel);
        std::fs::create_dir_all(to.parent().expect("a file in a folder"))?;
        let mut file = std::fs::File::create(&to).with_context(|| format!("writing {}", to.display()))?;
        kept += io::copy(&mut entry, &mut file)?;
        file.flush()?;
        lean |= rel == Path::new("bin/lean");
    }
    // the rest of the archive, read for its hash: zstd's end, tar's padding
    let mut rest = archive.into_inner();
    io::copy(&mut rest, &mut io::sink())?;
    drop(rest);
    io::copy(&mut read, &mut io::sink())?;
    let got = HEXLOWER.encode(&read.hash.finalize());
    ensure!(got == r.sha256, "Lean's archive isn't the one pinned: its SHA-256 is {got}, not {}", r.sha256);
    ensure!(lean, "Lean's archive holds no bin/lean");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(into.join("bin/lean"), std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(kept)
}

/// A reader that hashes and counts what it reads.
struct Hashing<'a, R> {
    inner: R,
    hash: Sha256,
    at: &'a AtomicU64,
}

impl<R: Read> Read for Hashing<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.hash.update(&buf[..n]);
        self.at.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

/// What a check found: whether Lean accepted the objective, and where it failed if it didn't.
#[derive(Debug, PartialEq)]
pub struct Found {
    pub ok: bool,
    /// The first error Lean reported: its line and column, and its message's first line.
    pub error: Option<(u64, u64, String)>,
}

/// Reads Lean's messages (`--json`, one a line) for what a check found: accepted where Lean exited cleanly with no
/// error, else its first error, or where it stopped with none, the first line it wrote on its standard error. Nothing
/// else of what Lean wrote is kept.
pub fn found(success: bool, stdout: &str, stderr: &str) -> Found {
    let error = stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|m| m["severity"] == "error")
        .map(|m| {
            let line = m["pos"]["line"].as_u64().unwrap_or(0);
            let column = m["pos"]["column"].as_u64().unwrap_or(0);
            let text: String = m["data"].as_str().unwrap_or("").lines().next().unwrap_or("").chars().take(160).collect();
            (line, column, text)
        });
    let error = match (success, error) {
        (true, None) => None,
        (false, None) => Some((0, 0, match stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
            Some(why) => format!("Lean stopped: {}", why.chars().take(160).collect::<String>()),
            None => "Lean stopped without a message".to_string(),
        })),
        (_, e) => e,
    };
    Found { ok: error.is_none(), error }
}

/// Lean on this device: where it keeps it, and the getting under way.
pub(crate) struct Lean {
    /// The folder it keeps Lean in, beside the device's shelves.
    dir: PathBuf,
    /// One getting at a time.
    once: tokio::sync::Mutex<()>,
    /// The getting under way: how many bytes of the archive are in.
    getting: Mutex<Option<Arc<AtomicU64>>>,
    /// Why the last getting failed, if it did.
    failed: Mutex<Option<String>>,
}

impl Lean {
    /// Lean kept in `dir`.
    pub(crate) fn new(dir: PathBuf) -> Self {
        Lean { dir, once: tokio::sync::Mutex::default(), getting: Mutex::default(), failed: Mutex::default() }
    }

    /// The folder of this version, once got.
    fn root(&self) -> PathBuf {
        self.dir.join(VERSION)
    }

    fn here(&self) -> bool {
        self.root().join("bin/lean").is_file()
    }

    /// What Lean is on this device: whether it runs here (`can`), whether it is here (`here`), the sizes getting it
    /// takes (`download`, `kept`, bytes), the getting under way (`getting`: `{at, of}`), why the last one failed
    /// (`failed`), and the engine a verdict names (`engine`).
    pub(crate) fn engine(&self) -> Value {
        let r = release();
        let getting = self.getting.lock().expect("the getting").clone();
        json!({
            "version": VERSION,
            "can": LOCKED && r.is_some(),
            "here": self.here(),
            "download": r.map(|r| r.bytes),
            "kept": r.map(|r| r.kept),
            "getting": getting.zip(r).map(|(at, r)| json!({ "at": at.load(Ordering::Relaxed), "of": r.bytes })),
            "failed": self.failed.lock().expect("the failure").clone(),
            "engine": r.map(engine_name),
        })
    }

    /// Gets Lean, unless it is here: the archive from GitHub by `curl` (always on a Mac), unpacked as it comes
    /// (`unpack`), and put in place once it checked out; then the objective module compiled. It answers `engine`.
    pub(crate) async fn get(&self) -> Result<Value> {
        ensure!(LOCKED, "Lean runs only in The OS on a Mac");
        let r = release().context("Lean has no release for this Mac")?;
        let _one = self.once.lock().await;
        if !self.here() {
            let at = Arc::new(AtomicU64::new(0));
            *self.getting.lock().expect("the getting") = Some(at.clone());
            let got = self.fetch(r, at).await;
            *self.getting.lock().expect("the getting") = None;
            *self.failed.lock().expect("the failure") = got.as_ref().err().map(|e| format!("{e:#}"));
            got?;
        }
        self.objective().await?;
        Ok(self.engine())
    }

    async fn fetch(&self, r: &'static Release, at: Arc<AtomicU64>) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let free = free_bytes(&self.dir);
        if let Some(free) = free {
            ensure!(
                free >= r.kept + SPARE,
                "Lean needs {} MB on this Mac's disk and {} MB is free",
                (r.kept + SPARE) / 1_000_000,
                free / 1_000_000
            );
        }
        let part = self.dir.join(format!("{VERSION}.part"));
        // what a getting that stopped half way unpacked: its own, never run, unpacked again from the start
        if part.exists() {
            std::fs::remove_dir_all(&part)?;
        }
        std::fs::create_dir_all(&part)?;
        let url = format!("{RELEASES_URL}/v{VERSION}/{}", r.asset);
        let into = part.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut curl = std::process::Command::new("curl")
                .args(["--fail", "--location", "--silent", "--show-error", "--proto", "=https", "--proto-redir", "=https"])
                .arg(&url)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .context("curl didn't start")?;
            let stdout = curl.stdout.take().expect("curl's output");
            let unpacked = unpack(stdout, r, &into, &at);
            let out = curl.wait_with_output()?;
            if !out.status.success() {
                bail!("getting Lean failed: {}", String::from_utf8_lossy(&out.stderr).trim());
            }
            unpacked.map(|_| ())
        })
        .await
        .map_err(|e| anyhow!("getting Lean failed: {e}"))??;
        std::fs::rename(&part, self.root())?;
        Ok(())
    }

    /// The objective module's folder for this version of it, compiled once (`lean -o`): the source built into this
    /// device, and its .olean beside it.
    async fn objective(&self) -> Result<PathBuf> {
        let dir = self.root().join("objective").join(objective::key(OBJECTIVE));
        if dir.join("AvenDB/Objective.olean").is_file() {
            return Ok(dir.canonicalize()?);
        }
        let part = dir.with_extension("part");
        if part.exists() {
            std::fs::remove_dir_all(&part)?;
        }
        std::fs::create_dir_all(part.join("AvenDB"))?;
        std::fs::write(part.join("AvenDB/Objective.lean"), OBJECTIVE)?;
        let part = part.canonicalize()?;
        let mut run = self.command(&part, Some(&part))?;
        run.args(["-o", "AvenDB/Objective.olean", "AvenDB/Objective.lean"]).current_dir(&part);
        let (success, stdout, stderr) = within(run, None).await?;
        let f = found(success, &stdout, &stderr);
        if let Some((line, column, text)) = f.error {
            bail!("Lean didn't compile the objective module: {line}:{column} {text}");
        }
        std::fs::rename(&part, &dir)?;
        Ok(dir.canonicalize()?)
    }

    /// Lean run locked down (`PROFILE`), with no environment but where its modules are: its own and the objective
    /// module's, at `objective`; writing `out` alone, where named.
    fn command(&self, objective: &Path, out: Option<&Path>) -> Result<tokio::process::Command> {
        let root = self.root().canonicalize().context("Lean isn't here")?;
        let lean = root.join("bin/lean");
        let path = std::env::join_paths([root.join("lib/lean"), objective.to_path_buf()])?;
        let mut run = if LOCKED {
            let mut profile = PROFILE.to_string();
            let mut run = tokio::process::Command::new("/usr/bin/sandbox-exec");
            run.arg("-D").arg(format!("ROOT={}", root.display()));
            run.arg("-D").arg(format!("LEAN={}", lean.display()));
            if let Some(out) = out {
                profile.push_str(PROFILE_OUT);
                run.arg("-D").arg(format!("OUT={}", out.display()));
            }
            run.arg("-p").arg(profile).arg(&lean);
            run
        } else if cfg!(test) {
            // a test's own Lean, on a system with no sandbox: never in the app
            tokio::process::Command::new(&lean)
        } else {
            bail!("Lean runs only in The OS on a Mac");
        };
        run.env_clear()
            .env("LEAN_PATH", path)
            .current_dir(&root)
            .args(["--json", "--threads=1"])
            .arg(format!("--memory={MEMORY_MB}"))
            .arg(format!("-DmaxHeartbeats={HEARTBEATS}"))
            .arg("-DwarningAsError=true")
            .kill_on_drop(true);
        Ok(run)
    }

    /// Checks objective `lean` with Lean: first by avenDB's engine (the input wall), then by Lean on its standard input.
    /// It answers `{ok, key, engine, error, ms}`: whether Lean accepted it, the objective's key (`objective::key`), the
    /// engine (`engine_name`), Lean's first error (`{line, column, message}`) and how long it took.
    pub(crate) async fn check(&self, lean: &str) -> Result<Value> {
        ensure!(LOCKED || cfg!(test), "Lean runs only in The OS on a Mac");
        ensure!(lean.len() <= MAX_LEAN, "an objective of at most {} KB", MAX_LEAN / 1024);
        objective::read(lean).map_err(|e| anyhow!("avenDB's engine doesn't read it, so Lean won't: {e}"))?;
        let r = release().context("Lean has no release for this Mac")?;
        ensure!(self.here(), "Lean isn't on this Mac yet");
        // one compile of the objective module at a time, as a getting compiles it too
        let module = {
            let _one = self.once.lock().await;
            self.objective().await?
        };
        let t = Instant::now();
        let mut run = self.command(&module, None)?;
        run.arg("--stdin");
        let (success, stdout, stderr) = within(run, Some(lean.as_bytes())).await?;
        let f = found(success, &stdout, &stderr);
        Ok(json!({
            "ok": f.ok,
            "key": objective::key(lean),
            "engine": engine_name(r),
            "error": f.error.map(|(line, column, message)| json!({ "line": line, "column": column, "message": message })),
            "ms": t.elapsed().as_millis() as u64,
        }))
    }
}

/// Runs `run` on `input`, held to `CLOCK`: whether it exited cleanly, and what it wrote on its standard output and
/// its standard error.
async fn within(mut run: tokio::process::Command, input: Option<&[u8]>) -> Result<(bool, String, String)> {
    use tokio::io::AsyncWriteExt as _;
    run.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = run.spawn().context("Lean didn't start")?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(input).await?;
        drop(stdin);
    }
    let out = tokio::time::timeout(CLOCK, child.wait_with_output())
        .await
        .map_err(|_| anyhow!("Lean ran longer than {} s", CLOCK.as_secs()))??;
    let (stdout, mut stderr) = (String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned());
    if !out.status.success() && stdout.is_empty() {
        tracing::warn!("Lean stopped ({}): {}", out.status, stderr.trim());
        // a Lean that wrote nothing, as one a signal stopped, says how it ended (`found`)
        if stderr.trim().is_empty() {
            stderr = out.status.to_string();
        }
    }
    Ok((out.status.success(), stdout, stderr))
}

/// The bytes free on the disk `path` is on, where the system says.
#[cfg(unix)]
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt as _;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut fs: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid C string, `fs` a statvfs for the call to fill
    if unsafe { libc::statvfs(c.as_ptr(), &mut fs) } != 0 {
        return None;
    }
    Some(fs.f_bavail as u64 * fs.f_frsize as u64)
}

#[cfg(not(unix))]
fn free_bytes(_: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = "import AvenDB.Objective\nopen AvenDB.Objective\n\n/-- At least 50 frames a second. -/\ndef fps : Metric := metric \"Frames per second\" (atLeast (reading \"fps\") 50)\n\ndef objective : List Metric := [fps]\n";

    #[test]
    fn the_version_is_the_spec_s() {
        let toolchain = include_str!("../../../spec/lean-toolchain").trim();
        assert_eq!(toolchain, format!("leanprover/lean4:v{VERSION}"));
        assert!(RELEASES.iter().all(|r| r.asset.starts_with(&format!("lean-{VERSION}-")) && r.sha256.len() == 64));
    }

    #[test]
    fn it_keeps_lean_its_libraries_and_init_alone() {
        for p in [
            "bin/lean",
            "lib/lean/libleanshared.dylib",
            "lib/lean/libInit_shared.so",
            "lib/lean/Init.olean",
            "lib/lean/Init/Prelude.olean.server",
            "lib/lean/Init/Data/List/Basic.olean.private",
        ] {
            assert!(keep(Path::new(p)), "{p}");
        }
        for p in [
            "bin/lake",
            "lib/lean/libLake_shared.dylib",
            "lib/lean/Init/Prelude.ilean",
            "lib/lean/Lean/Elab.olean",
            "lib/lean/Init/../../../../.ssh/id.olean",
            "/lib/lean/Init.olean",
            "include/lean/lean.h",
        ] {
            assert!(!keep(Path::new(p)), "{p}");
        }
    }

    /// A tar.zst of `files`, each under a top folder as Lean's are.
    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (path, bytes) in files {
            let mut h = tar::Header::new_gnu();
            h.set_size(bytes.len() as u64);
            h.set_mode(0o644);
            h.set_cksum();
            tar.append_data(&mut h, format!("lean-{VERSION}-test/{path}"), *bytes).unwrap();
        }
        let tar = tar.into_inner().unwrap();
        ruzstd::encoding::compress_to_vec(&tar[..], ruzstd::encoding::CompressionLevel::Fastest)
    }

    fn pinned(bytes: &[u8]) -> Release {
        let sha256: &'static str = HEXLOWER.encode(&Sha256::digest(bytes)).leak();
        Release { os: "test", arch: "test", asset: "test", sha256, bytes: bytes.len() as u64, kept: 0 }
    }

    #[test]
    fn it_unpacks_what_it_keeps_and_only_the_archive_pinned() {
        let zst = archive(&[("bin/lean", b"lean"), ("bin/lake", b"lake"), ("lib/lean/Init.olean", b"init")]);
        let dir = tempdir();
        let at = AtomicU64::new(0);
        let kept = unpack(&zst[..], &pinned(&zst), &dir, &at).unwrap();
        assert_eq!(kept, 8);
        assert_eq!(at.load(Ordering::Relaxed), zst.len() as u64);
        assert_eq!(std::fs::read(dir.join("bin/lean")).unwrap(), b"lean");
        assert!(dir.join("lib/lean/Init.olean").is_file());
        assert!(!dir.join("bin/lake").exists());

        let other = tempdir();
        let mut wrong = pinned(&zst);
        wrong.sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
        let e = unpack(&zst[..], &wrong, &other, &AtomicU64::new(0)).unwrap_err();
        assert!(format!("{e}").contains("isn't the one pinned"), "{e}");

        let none = archive(&[("lib/lean/Init.olean", b"init")]);
        let e = unpack(&none[..], &pinned(&none), &tempdir(), &AtomicU64::new(0)).unwrap_err();
        assert!(format!("{e}").contains("no bin/lean"), "{e}");
    }

    #[test]
    fn it_reads_lean_s_first_error() {
        let ok = found(true, "", "");
        assert_eq!(ok, Found { ok: true, error: None });
        let msg = r#"{"severity":"information","pos":{"line":1,"column":0},"data":"hi"}
{"severity":"error","pos":{"line":3,"column":56},"data":"Application type mismatch: The argument\n  \"no\""}
{"severity":"error","pos":{"line":4,"column":0},"data":"second"}"#;
        let f = found(false, msg, "");
        assert_eq!(f, Found { ok: false, error: Some((3, 56, "Application type mismatch: The argument".into())) });
        assert!(!found(false, "", "").ok);
        let died = found(false, "", "\ndyld: Library not loaded\nmore");
        assert_eq!(died.error, Some((0, 0, "Lean stopped: dyld: Library not loaded".into())));
        assert!(!found(true, r#"{"severity":"error","pos":{"line":1,"column":0},"data":"x"}"#, "").ok);
    }

    #[test]
    fn it_answers_what_lean_is_here() {
        let lean = Lean::new(tempdir());
        let e = lean.engine();
        assert_eq!(e["version"], VERSION);
        assert_eq!(e["here"], false);
        assert_eq!(e["getting"], Value::Null);
    }

    fn tempdir() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir()
            .join(format!("avendb-lean-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// With a release's archive at `AVENDB_LEAN_ARCHIVE` (this system's, as `release` names it): unpacks it, compiles
    /// the objective module, and checks an objective Lean accepts and one it doesn't. Skipped without one.
    #[tokio::test]
    async fn real_lean_checks_an_objective() {
        let Some(path) = std::env::var_os("AVENDB_LEAN_ARCHIVE") else { return };
        let r = release().unwrap();
        let lean = Lean::new(tempdir());
        let file = std::fs::File::open(path).unwrap();
        unpack(io::BufReader::new(file), r, &lean.root(), &AtomicU64::new(0)).unwrap();
        checks(&lean).await;
    }

    /// What every Lean here must answer, then that its sandbox holds.
    async fn checks(lean: &Lean) {
        let got = lean.check(OK).await.unwrap();
        assert_eq!(got["ok"], true, "{got}");
        assert_eq!(got["key"], objective::key(OK));
        // avenDB's engine reads a file with no import; Lean, which has no AvenDB.Objective without it, doesn't
        let bad = OK.replacen("import AvenDB.Objective\n", "", 1);
        let got = lean.check(&bad).await.unwrap();
        assert_eq!(got["ok"], false, "{got}");
        assert_eq!(got["error"]["line"], 1, "{got}");
        let e = lean.check("#eval IO.println \"hi\"").await.unwrap_err();
        assert!(format!("{e}").contains("doesn't read it"), "{e}");
    }

    /// The real thing on a Mac (CI's macOS job, `.github/workflows/mac.yml`): Lean got from GitHub as The OS gets it,
    /// checks objectives, and its sandbox keeps Lean from the person's files, from writing, and from starting anything,
    /// even where a file got past the input wall.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "gets Lean from GitHub: run on a Mac with --ignored"]
    async fn lean_on_a_mac() {
        let lean = Lean::new(tempdir());
        let e = match lean.get().await {
            Ok(e) => e,
            Err(e) => {
                bisect(&lean).await;
                panic!("{e:#}");
            }
        };
        assert_eq!(e["here"], true, "{e}");
        checks(&lean).await;
        // past the input wall: Lean itself, as a file that tries what the sandbox stops
        let home = std::env::var("HOME").unwrap();
        let escape = format!(
            "def tryIt (what : String) (act : IO Unit) : IO Unit := do\n  match ← act.toBaseIO with\n  | .ok _ => IO.println s!\"ESCAPED {{what}}\"\n  | .error e => IO.println s!\"stopped {{what}}: {{e}}\"\n#eval tryIt \"read\" (do let _ ← IO.FS.readFile \"/etc/hosts\"; pure ())\n#eval tryIt \"home\" (do let _ ← System.FilePath.readDir \"{home}\"; pure ())\n#eval tryIt \"write\" (IO.FS.writeFile \"{home}/lean-escaped\" \"x\")\n#eval tryIt \"run\" (do let _ ← IO.Process.output {{ cmd := \"/usr/bin/true\" }}; pure ())\n"
        );
        let module = lean.objective().await.unwrap();
        let mut run = lean.command(&module, None).unwrap();
        run.arg("--stdin");
        let (_, out, err) = within(run, Some(escape.as_bytes())).await.unwrap();
        println!("{out}\n{err}");
        assert!(!out.contains("ESCAPED"), "{out}");
        assert_eq!(out.matches("stopped").count(), 4, "{out}");
        assert!(!Path::new(&home).join("lean-escaped").exists());
    }

    /// Where compiling the objective module fails on a Mac: with no sandbox, in a sandbox that allows everything, and in
    /// Lean's own (`PROFILE`), each how it ended and the first lines it wrote, for the log.
    #[cfg(target_os = "macos")]
    async fn bisect(lean: &Lean) {
        let root = lean.dir.join(format!("{VERSION}.part"));
        let root = if root.join("bin/lean").is_file() { root } else { lean.root() };
        let Ok(root) = root.canonicalize() else { return println!("bisect: no Lean unpacked") };
        let bin = root.join("bin/lean");
        for (name, profile) in [("no sandbox", None), ("allow default", Some("(version 1)\n(allow default)\n".to_string())), ("PROFILE", Some(format!("{PROFILE}{PROFILE_OUT}")))] {
            let dir = tempdir();
            std::fs::create_dir_all(dir.join("AvenDB")).unwrap();
            std::fs::write(dir.join("AvenDB/Objective.lean"), OBJECTIVE).unwrap();
            let dir = dir.canonicalize().unwrap();
            let mut run = match &profile {
                None => tokio::process::Command::new(&bin),
                Some(p) => {
                    let mut run = tokio::process::Command::new("/usr/bin/sandbox-exec");
                    run.arg("-D").arg(format!("ROOT={}", root.display()));
                    run.arg("-D").arg(format!("LEAN={}", bin.display()));
                    run.arg("-D").arg(format!("OUT={}", dir.display()));
                    run.arg("-p").arg(p).arg(&bin);
                    run
                }
            };
            let path = std::env::join_paths([root.join("lib/lean"), dir.clone()]).unwrap();
            run.env_clear()
                .env("LEAN_PATH", path)
                .current_dir(&dir)
                .args(["--json", "--threads=1"])
                .arg(format!("--memory={MEMORY_MB}"))
                .args(["-o", "AvenDB/Objective.olean", "AvenDB/Objective.lean"]);
            match within(run, None).await {
                Ok((ok, out, err)) => println!(
                    "bisect {name}: ok {ok}\n  out: {}\n  err: {}",
                    out.lines().take(5).collect::<Vec<_>>().join("\n       "),
                    err.lines().take(8).collect::<Vec<_>>().join("\n       ")
                ),
                Err(e) => println!("bisect {name}: {e:#}"),
            }
        }
    }
}
