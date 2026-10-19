//! Makes avenDB's master recovery key (`avendb::recovery`): 32 secret bytes from the machine's own randomness, and the
//! public half that every human vault adds as an owner. From `avendb/`:
//!
//! ```text
//! cargo run --release -p avendb --bin master-key -- new ~/Desktop/master-recovery
//! cargo run --release -p avendb --bin master-key -- pub ~/Desktop/master-recovery
//! cargo run --release -p avendb --bin master-key -- id ~/Desktop/master-recovery.pub
//! cargo run --release -p avendb --bin master-key -- id
//! ```
//!
//! `new` prints the secret in the terminal, 64 hex digits to copy and keep, and writes it nowhere: its one file is
//! `<path>.pub`, the public half, a megabyte, nearly all of it the McEliece key, with the key's standing consent to be
//! added as an owner; it never writes over a file. `pub` asks for the secret and writes `<path>.pub` again from it,
//! over a `.pub` file of an older format. `id` says which key a `.pub` file holds, or, with no file, the keys the
//! secret it asks for makes in each signature suite, to check one against the other: a key made before the key move
//! (2026-10-19) is in SLH-DSA, a new one in ML-DSA-65, from the same secret. Whoever holds the secret owns every vault
//! that added the key: keep it offline, on paper or in a safe, and hand on the `.pub` file alone.

use std::fs::{self, OpenOptions};
use std::io::{BufRead as _, IsTerminal as _, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use avendb::recovery::RecoveryKey;
use avendb::sign::SUITES;
use zeroize::Zeroizing;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let done = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["new", path] => new(Path::new(path)),
        ["pub", path] => public(Path::new(path)),
        ["id", file] => id(Some(Path::new(file))),
        ["id"] => id(None),
        _ => Err("usage: master-key new <path> | pub <path> | id [file.pub]".into()),
    };
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("master-key: {why}");
            ExitCode::FAILURE
        }
    }
}

/// Makes a key: its public half in `<path>.pub`, its secret in the terminal alone.
fn new(path: &Path) -> Result<(), String> {
    let public_file = with_suffix(path, "pub");
    if public_file.exists() {
        return Err(format!("{} is there already, and is never written over", public_file.display()));
    }
    let secret = random()?;
    eprintln!("making the key's McEliece pair, which takes a second or two");
    let key = RecoveryKey::of(*secret);
    write_new(&public_file, &key.to_bytes())?;
    println!("The master recovery key {}", key.id().to_hex());
    println!();
    println!("  secret: {}", Zeroizing::new(to_hex(&*secret)).as_str());
    println!();
    println!("          copy it now and keep it offline (paper, or a safe): it is written nowhere else.");
    println!("          Never paste it into a chat or a file, and clear this terminal after (Cmd+K).");
    told(&public_file, &key);
    Ok(())
}

/// Writes the public half of the key whose secret it asks for as `<path>.pub` again: over a file of an older format,
/// never over one that holds the key already, nor another key.
fn public(path: &Path) -> Result<(), String> {
    let public_file = with_suffix(path, "pub");
    let secret = asked()?;
    eprintln!("making the key's McEliece pair, which takes a second or two");
    let key = RecoveryKey::of(*secret);
    if let Some(there) = fs::read(&public_file).ok().and_then(|bytes| RecoveryKey::from_bytes(&bytes)) {
        return Err(match there.id() == key.id() {
            true => format!("{} holds this key already", public_file.display()),
            false => format!(
                "{} holds another key, or this secret's key in SLH-DSA from before the key move, and is never written \
                 over: write this one to another path",
                public_file.display()
            ),
        });
    }
    let new = with_suffix(path, "pub.new");
    _ = fs::remove_file(&new);
    write_new(&new, &key.to_bytes())?;
    fs::rename(&new, &public_file).map_err(|e| format!("{}: {e}", public_file.display()))?;
    println!("The master recovery key {}", key.id().to_hex());
    told(&public_file, &key);
    Ok(())
}

/// Says which key the `.pub` file `file` holds, or, with none, the secret it asks for.
fn id(file: Option<&Path>) -> Result<(), String> {
    let key = match file {
        Some(file) => {
            let bytes = fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
            RecoveryKey::from_bytes(&bytes).ok_or("no .pub file of this format: make it again with `pub`")?
        }
        None => {
            let secret = asked()?;
            eprintln!("making the key in each suite, which takes a few seconds");
            for suite in SUITES {
                let key = RecoveryKey::of_in(*secret, suite);
                println!("The master recovery key in {}: {}", suite.name(), key.id().to_hex());
            }
            return Ok(());
        }
    };
    println!("The master recovery key {}", key.id().to_hex());
    Ok(())
}

/// Tells where the public half is.
fn told(public_file: &Path, key: &RecoveryKey) {
    println!("  public: {} ({} bytes)", public_file.display(), key.to_bytes().len());
    println!("          hand on this file alone");
}

/// The secret, 64 hex digits, as its person pastes it on a line of its own.
fn asked() -> Result<Zeroizing<[u8; 32]>, String> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        eprint!("the secret (64 hex digits), then Enter: ");
        _ = std::io::stderr().flush();
    }
    let mut line = Zeroizing::new(String::new());
    stdin.lock().read_line(&mut line).map_err(|e| format!("no secret: {e}"))?;
    from_hex(line.trim()).ok_or_else(|| "that is no secret: 64 hex digits".into())
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
    let mut source = fs::File::open("/dev/urandom").map_err(|e| format!("no randomness from the machine: {e}"))?;
    source.read_exact(&mut *bytes).map_err(|e| format!("no randomness from the machine: {e}"))?;
    Ok(bytes)
}

/// Writes `bytes` as file `path`, which must not be there yet.
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let open = OpenOptions::new().write(true).create_new(true).open(path);
    let mut file = open.map_err(|e| format!("{}: {e}", path.display()))?;
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
