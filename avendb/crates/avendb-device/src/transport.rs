//! Optional host network configuration, separate from the account and its persisted identity.
use anyhow::{Context as _, Result, bail};
use avendb_net::transports::WtConfig;

/// The explicitly configured browser listener, disabled unless all three variables are present.
/// These are host deployment settings, never stored in account Meta or inferred from iroh addresses.
pub fn webtransport_from_env() -> Result<Option<WtConfig>> {
    from_vars(|name| match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => bail!("{name} must be UTF-8"),
    })
}

fn from_vars(var: impl Fn(&str) -> Result<Option<String>>) -> Result<Option<WtConfig>> {
    let (bind, url, origins) = (var("AVENDB_WT_BIND")?, var("AVENDB_WT_URL")?, var("AVENDB_WT_ORIGINS")?);
    let config = match (bind, url, origins) {
        (None, None, None) => return Ok(None),
        (Some(bind), Some(public_url), Some(origins)) => WtConfig {
            bind: bind.parse().context("AVENDB_WT_BIND must be a UDP socket address")?,
            public_url,
            allowed_origins: serde_json::from_str(&origins)
                .context("AVENDB_WT_ORIGINS must be a JSON array of exact origins")?,
        },
        _ => bail!("AVENDB_WT_BIND, AVENDB_WT_URL and AVENDB_WT_ORIGINS must be configured together"),
    };
    config
        .validate()
        .context("invalid optional WebTransport configuration")?;
    Ok(Some(config))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_host_listener_requires_complete_valid_configuration() {
        assert!(from_vars(|_| Ok(None)).unwrap().is_none());
        let good = [
            ("AVENDB_WT_BIND", "127.0.0.1:0"),
            ("AVENDB_WT_URL", "https://localhost:0/avendb"),
            ("AVENDB_WT_ORIGINS", "[\"https://maia.city\"]"),
        ];
        let read = |values: &[(&str, &str)], name: &str| {
            Ok(values
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string()))
        };
        assert!(from_vars(|name| read(&good, name)).unwrap().is_some());
        for missing in 0..3 {
            let mut values = good.to_vec();
            values.remove(missing);
            assert!(from_vars(|name| read(&values, name)).is_err());
        }
        for (index, bad) in [
            (0, "localhost:7402"),
            (1, "http://localhost/avendb"),
            (1, "https://user:pass@localhost/avendb"),
            (2, "[]"),
            (2, "[\"*\"]"),
            (2, "[\"https://maia.city/app\"]"),
        ] {
            let mut values = good;
            values[index].1 = bad;
            assert!(from_vars(|name| read(&values, name)).is_err());
        }
    }
}
