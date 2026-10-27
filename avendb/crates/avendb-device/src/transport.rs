//! Optional host network configuration, separate from the account and its persisted identity.
use anyhow::{Context as _, Result, bail};
use avendb_net::transports::{RtcConfig, WtConfig};

/// The explicitly configured browser listener, disabled unless all three variables are present.
/// These are host deployment settings, never stored in account Meta or inferred from iroh addresses.
pub fn webtransport_from_env() -> Result<Option<WtConfig>> {
    from_vars(|name| match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => bail!("{name} must be UTF-8"),
    })
}

/// The node's own WebRTC peer, for the pages among its peers (an iPhone's) to reach it straight: on unless
/// `AVENDB_WEBRTC=false`. It asks the relay's own STUN server for the address its network shows, or those
/// `AVENDB_STUN` names (`host:port`, comma-separated), or none with `off`: then it offers its own addresses alone.
pub fn webrtc_from_env() -> Result<Option<RtcConfig>> {
    webrtc_from_vars(|name| match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => bail!("{name} must be UTF-8"),
    })
}

fn webrtc_from_vars(var: impl Fn(&str) -> Result<Option<String>>) -> Result<Option<RtcConfig>> {
    if var("AVENDB_WEBRTC")?.is_some_and(|on| on.trim() == "false") {
        return Ok(None);
    }
    let stun = match var("AVENDB_STUN")? {
        None => None,
        Some(off) if off.trim() == "off" => Some(Vec::new()),
        Some(list) => {
            let servers: Vec<String> = list.split(',').map(|s| s.trim().trim_start_matches("stun:").to_string()).filter(|s| !s.is_empty()).collect();
            for server in &servers {
                let (host, port) = server.rsplit_once(':').context("AVENDB_STUN names host:port servers")?;
                port.parse::<u16>().ok().filter(|_| !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-[]:".contains(c)))
                    .context("AVENDB_STUN names host:port servers")?;
            }
            Some(servers)
        }
    };
    Ok(Some(RtcConfig { stun, hosts: None }))
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
            certificate: None,
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
    fn webrtc_is_on_unless_turned_off_and_asks_the_relays_stun_unless_told() {
        let read = |values: &'static [(&'static str, &'static str)]| move |name: &str| {
            Ok(values.iter().find(|(key, _)| *key == name).map(|(_, value)| value.to_string()))
        };
        assert_eq!(webrtc_from_vars(read(&[])).unwrap(), Some(RtcConfig { stun: None, hosts: None }));
        assert_eq!(webrtc_from_vars(read(&[("AVENDB_WEBRTC", "false")])).unwrap(), None);
        assert_eq!(webrtc_from_vars(read(&[("AVENDB_STUN", "off")])).unwrap().unwrap().stun, Some(vec![]));
        assert_eq!(
            webrtc_from_vars(read(&[("AVENDB_STUN", "stun:a.example:3478, b.example:19302")])).unwrap().unwrap().stun,
            Some(vec!["a.example:3478".into(), "b.example:19302".into()])
        );
        for bad in ["a.example", "a.example:port", ":3478", "turn:user:pass@x.example:3478"] {
            let values: &'static [(&str, &str)] = Box::leak(Box::new([("AVENDB_STUN", bad)]));
            assert!(webrtc_from_vars(read(values)).is_err(), "{bad}");
        }
    }
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
