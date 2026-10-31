//! A file's name as the manifest writes it, `b3:<hex>`: `cargo run -p aven-runtimes-host --example hash -- FILE`.

fn main() {
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        println!("{} {path}", aven_core::blake3(&bytes).text());
    }
}
