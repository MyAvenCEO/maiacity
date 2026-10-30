//! TLS for the relay's QUIC address discovery (QAD, iroh's `/iroh-qad/0`): the Aven Peer's relay answers each Peer's
//! probe on UDP with the address it came from, so a member at home learns its public address and can hole-punch to
//! another home. The probe is QUIC, so TLS 1.3: the relay serves a certificate it is given (`--relay-cert`,
//! `--relay-key`), and every Peer trusts the public roots and, given `--relay-ca`, the box's test CA.

use std::sync::Arc;

use iroh_relay::tls::CaTlsConfig;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};

/// Every certificate in a PEM file.
pub fn certs(path: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let certs = CertificateDer::pem_file_iter(path)
        .map_err(|e| format!("{path}: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("{path}: {e}"))?;
    if certs.is_empty() {
        return Err(format!("{path} holds no certificate"));
    }
    Ok(certs)
}

/// The relay's QAD server: its certificate chain and key, TLS 1.3 only, as QUIC needs.
pub fn qad_server(cert: &str, key: &str) -> Result<rustls::ServerConfig, String> {
    let key = PrivateKeyDer::from_pem_file(key).map_err(|e| format!("{key}: {e}"))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    rustls::ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(certs(cert)?, key)
        .map_err(|e| format!("--relay-cert: {e}"))
}

/// What a Peer trusts on its relay: the public roots, and the extra CA if it is given one.
pub fn trust(ca: Option<&str>) -> Result<CaTlsConfig, String> {
    Ok(match ca {
        Some(path) => CaTlsConfig::default().with_extra_roots(certs(path)?),
        None => CaTlsConfig::default(),
    })
}
