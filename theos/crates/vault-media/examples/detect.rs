//! Each movie's colour as the studio tells it: `cargo run -p vault-media --example detect -- <movie or folder>…`

fn main() {
    let mut files = Vec::new();
    for a in std::env::args().skip(1) {
        let p = std::path::PathBuf::from(&a);
        if p.is_dir() {
            let mut inside: Vec<_> = std::fs::read_dir(&p).into_iter().flatten().flatten().map(|e| e.path()).filter(|f| f.is_file()).collect();
            inside.sort();
            files.extend(inside);
        } else {
            files.push(p);
        }
    }
    for f in files {
        let name = f.file_name().unwrap_or_default().to_string_lossy().into_owned();
        match vault_media::probe(&f) {
            Ok(p) => {
                let c = vault_media::detect(&p);
                println!("{name:40} {}×{} {:>5.1}s  {:12} {}", p.width, p.height, p.seconds, c.profile, c.from);
            }
            Err(e) => println!("{name:40} {e:#}"),
        }
    }
}
