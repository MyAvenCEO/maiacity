//! Bytes as lowercase hex, the way keys and authenticator data are written.

pub fn encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn decode(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 || !hex.is_ascii() {
        return None;
    }
    (0..hex.len() / 2)
        .map(|at| u8::from_str_radix(&hex[2 * at..2 * at + 2], 16).ok())
        .collect()
}
