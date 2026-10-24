const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub root: String,
    pub size: u64,
    pub len: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaRef {
    pub file: File,
    pub media: String,
}

impl File {
    pub fn new(root: String, size: u64, len: u64) -> Result<Self, String> {
        if root.len() != 64
            || !root
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("not an avenDB file root".into());
        }
        if size > MAX_SAFE_INTEGER || len > size {
            return Err("invalid avenDB file sizes".into());
        }
        Ok(Self { root, size, len })
    }
}

impl MediaRef {
    pub fn parse(value: &str) -> Result<Self, String> {
        let invalid = || {
            "not a readable avenDB media reference; import legacy media into avenDB first"
                .to_string()
        };
        let mut parts = value.strip_prefix("aven:").ok_or_else(invalid)?.split(':');
        let root = parts.next().ok_or_else(invalid)?;
        let number = |part: Option<&str>| -> Result<u64, String> {
            let part = part.ok_or_else(invalid)?;
            if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(invalid());
            }
            part.parse().map_err(|_| invalid())
        };
        let size = number(parts.next())?;
        let len = number(parts.next())?;
        let media = decode(parts.next().unwrap_or_default()).ok_or_else(invalid)?;
        if parts.next().is_some()
            || media
                .chars()
                .any(|char| char <= '\u{1f}' || char == '\u{7f}')
        {
            return Err(invalid());
        }
        Ok(Self {
            file: File::new(root.into(), size, len)?,
            media,
        })
    }

    pub fn encode(file: &File, media: &str) -> String {
        let encoded: String = media
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
                    (byte as char).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect();
        format!("aven:{}:{}:{}:{encoded}", file.root, file.size, file.len)
    }
}

fn decode(value: &str) -> Option<String> {
    let mut bytes = value.bytes();
    let mut decoded = Vec::with_capacity(value.len());
    while let Some(byte) = bytes.next() {
        decoded.push(if byte == b'%' {
            let high = (bytes.next()? as char).to_digit(16)?;
            let low = (bytes.next()? as char).to_digit(16)?;
            (high * 16 + low) as u8
        } else {
            byte
        });
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_reference_vectors() {
        for line in include_str!("../../../tests/fixtures/media-refs.tsv")
            .lines()
            .filter(|line| !line.is_empty())
        {
            let mut fields = line.split('\t');
            let valid = fields.next().unwrap() == "aven";
            let reference = fields.next().unwrap();
            let parsed = MediaRef::parse(reference);
            assert_eq!(parsed.is_ok(), valid, "{reference}");
            if let Ok(parsed) = parsed {
                assert_eq!(
                    parsed.media,
                    fields.next().unwrap_or_default(),
                    "{reference}"
                );
                assert_eq!(
                    MediaRef::parse(&MediaRef::encode(&parsed.file, &parsed.media)).unwrap(),
                    parsed
                );
            }
        }
    }
}
