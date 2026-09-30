//! A still's or an EXR sequence's ACEScct proxy: `cargo run --release -p vault-media --example still_check -- <still|seq.tar> <out>`.
//! A still is taken as sRGB unless its EXR header names a linear space; a sequence by its first frame's header.

use std::path::Path;

use anyhow::{Context, Result};
use vault_media::still;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (src, out) = (Path::new(args.get(1).context("usage: still_check <still|seq.tar> <out>")?), Path::new(args.get(2).context("no out")?));
    let t = std::time::Instant::now();
    if src.extension().is_some_and(|e| e == "tar") {
        let made = still::make_sequence_proxy(src, out, None, 24.0, &mut |_| {})?;
        println!("sequence proxy {}×{} · {:.2} s · {} in {:.2} s", made.width, made.height, made.seconds, made.profile, t.elapsed().as_secs_f64());
    } else {
        let bytes = std::fs::read(src)?;
        let profile = still::exr_profile(&bytes).unwrap_or("srgb");
        let (w, h) = still::make_still_proxy(src, out, profile)?;
        println!("still proxy {w}×{h} from {profile} in {:.2} s", t.elapsed().as_secs_f64());
    }
    Ok(())
}
