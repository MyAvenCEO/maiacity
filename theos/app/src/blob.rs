//! A file name's type, as the readers of vault-media and vault-render tell it (AVFoundation tells a movie by its
//! extension).

/// A file name's extension, lower case ("bin" without one).
pub fn ext_of(name: &str) -> String {
    std::path::Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).filter(|e| !e.is_empty()).unwrap_or_else(|| "bin".into())
}
