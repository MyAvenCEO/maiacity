//! Makes avenDB's master recovery key (`avendb::recovery`): 32 secret bytes from the machine's own randomness, and the
//! public half that every human vault adds as an owner. From `avendb/`:
//!
//! ```text
//! cargo run --release -p avendb --bin master-key -- new ~/Desktop/master-recovery
//! cargo run --release -p avendb --bin master-key -- id ~/Desktop/master-recovery.secret
//! ```
//!
//! `new` writes `<path>.secret`, the 32 bytes in 64 hex digits, readable by its owner alone, and `<path>.pub`, the
//! public half, a megabyte; it never writes over a file. `id` says which key a `.secret` or `.pub` file holds, to check
//! a copy against the other. Whoever holds the secret owns every vault that added the key: keep it offline, on paper or
//! a stick in a safe, and hand on the `.pub` file alone.

use std::fs::{self, File, OpenOptions};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use avendb::recovery::RecoveryKey;
use zeroize::Zeroizing;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let done = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["new", path] => new(Path::new(path)),
        ["id", file] => id(Path::new(file)),
        _ => Err("usage: master-key new <path> | master-key id <file.secret or file.pub>".into()),
    };
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("master-key: {why}");
            ExitCode::FAILURE
        }
    }
}

/// Makes a key: its secret in `<path>.secret`, its public half in `<path>.pub`.
fn new(path: &Path) -> Result<(), String> {
    let (secret_file, public_file) = (with_suffix(path, "secret"), with_suffix(path, "pub"));
    for file in [&secret_file, &public_file] {
        if file.exists() {
            return Err(format!("{} is there already, and is never written over", file.display()));
        }
    }
    let secret = random()?;
    eprintln!("making the key's McEliece pair, which takes a second or two");
    let key = RecoveryKey::of(*secret);
    let hex = Zeroizing::new(format!("{}\n", to_hex(&*secret)));
    write_new(&secret_file, hex.as_bytes(), true)?;
    write_new(&public_file, &key.to_bytes(), false)?;
    println!("The master recovery key {}", key.id().to_hex());
    println!("  secret: {}", secret_file.display());
    println!("          keep it offline (paper, or a stick in a safe), and never paste it anywhere");
    println!("  public: {} ({} bytes)", public_file.display(), key.to_bytes().len());
    println!("          hand on this file alone");
    Ok(())
}

/// Says which key `file` holds: its secret, in hex, or its public half.
fn id(file: &Path) -> Result<(), String> {
    let bytes = Zeroizing::new(fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?);
    let key = match RecoveryKey::from_bytes(&bytes) {
        Some(key) => key,
        None => {
            let text = std::str::from_utf8(&bytes).map_err(|_| "neither a .secret nor a .pub file")?;
            RecoveryKey::of(*from_hex(text.trim()).ok_or("neither a .secret nor a .pub file")?)
        }
    };
    println!("The master recovery key {}", key.id().to_hex());
    Ok(())
}

/// `path` with `.suffix` added to its name.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{suffix}"));
    PathBuf::from(name)
}

/// 32 bytes of the machine's own randomness.
fn random() -> Result<Zeroizing<[u8; 32]>, String> {
    let mut bytes = Zeroizing::new([0; 32]);
    let mut source = File::open("/dev/urandom").map_err(|e| format!("no randomness from the machine: {e}"))?;
    source.read_exact(&mut *bytes).map_err(|e| format!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

/// Writes `bytes` as file `path`, which must not be there yet; readable by its owner alone if `private`.
fn write_new(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    if private {
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    }
    let mut file = options.open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes).and_then(|()| file.sync_all()).map_err(|e| format!("{}: {e}", path.display()))
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(text: &str) -> Option<Zeroizing<[u8; 32]>> {
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let mut out = Zeroizing::new([0; 32]);
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}
