// The host holds modules of up to 64 MiB each in its own memory, so its own may grow past the 64 MiB the workspace
// gives every runtime module (.cargo/config.toml): to wasm32's 4 GiB, the last word to the linker.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg-cdylib=--max-memory=4294967296");
    }
}
