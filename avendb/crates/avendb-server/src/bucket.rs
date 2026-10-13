//! The server's bucket on S3 (blobs B3a, `avendb_net::bucket`): Hetzner's object storage, which holds the server's
//! store, every object already sealed under the server's seal (`avendb_net::bucket::Sealed`). Each request is signed
//! (AWS Signature V4, by rusty-s3) for a few minutes, and goes over TLS of avenDB's own making (`tls`): X25519MLKEM768
//! first, as everywhere, and X25519 after it, as Hetzner's endpoint agrees no post-quantum group; what it carries is
//! sealed post-quantum anyway. Every upload carries its Content-MD5, as a bucket with Object Lock asks for it.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result, bail};
use avendb_net::bucket::{Bucket, Fut};
use data_encoding::BASE64;
use md5::{Digest as _, Md5};
use reqwest::{Client, Response, StatusCode, Url};
use rusty_s3::actions::ListObjectsV2;
use rusty_s3::{Credentials, S3Action as _, UrlStyle};
use rustls::crypto::CryptoProvider;
use rustls::{ClientConfig, RootCertStore};

use crate::BucketConfig;

/// How long a signed request stays good.
const SIGNED: Duration = Duration::from_secs(300);

/// A bucket on S3.
pub struct S3 {
    bucket: rusty_s3::Bucket,
    credentials: Credentials,
    client: Client,
}

impl S3 {
    /// The bucket `config` names.
    pub fn new(config: &BucketConfig) -> Result<S3> {
        let endpoint: Url = config.endpoint.parse().with_context(|| format!("{} is no URL", config.endpoint))?;
        let bucket = rusty_s3::Bucket::new(endpoint, UrlStyle::Path, config.name.clone(), config.region.clone())
            .with_context(|| format!("the bucket {} at {}", config.name, config.endpoint))?;
        let credentials = Credentials::new(config.access_key.clone(), config.secret_key.clone());
        let client = Client::builder()
            .tls_backend_preconfigured(tls()?)
            .connect_timeout(Duration::from_secs(20))
            .timeout(SIGNED)
            .build()
            .context("the bucket's HTTP client")?;
        Ok(S3 { bucket, credentials, client })
    }
}

/// The TLS the server reaches its bucket over: aws-lc-rs, X25519MLKEM768 first and X25519 after it, the web's roots.
fn tls() -> Result<ClientConfig> {
    use rustls::crypto::aws_lc_rs::{default_provider, kx_group};
    let provider = CryptoProvider { kx_groups: vec![kx_group::X25519MLKEM768, kx_group::X25519], ..default_provider() };
    let roots = RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
    let config = ClientConfig::builder_with_provider(Arc::new(provider)).with_safe_default_protocol_versions()?;
    Ok(config.with_root_certificates(roots).with_no_client_auth())
}

/// `response`, if it says the request went through; else what it says, as an error about `what`.
async fn through(response: Response, what: &str) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let said = response.text().await.unwrap_or_default();
    bail!("{what}: the bucket answers {status}: {}", said.chars().take(300).collect::<String>())
}

impl Bucket for S3 {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        Box::pin(async move {
            let md5 = BASE64.encode(&Md5::digest(&bytes));
            let mut action = self.bucket.put_object(Some(&self.credentials), name);
            action.headers_mut().insert("content-md5", md5.clone());
            let request = self.client.put(action.sign(SIGNED)).header("content-md5", md5).body(bytes);
            through(request.send().await?, name).await?;
            Ok(())
        })
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        Box::pin(async move {
            let url = self.bucket.get_object(Some(&self.credentials), name).sign(SIGNED);
            let response = self.client.get(url).send().await?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            Ok(Some(through(response, name).await?.bytes().await?.to_vec()))
        })
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        Box::pin(async move {
            let (mut names, mut after) = (Vec::new(), None::<String>);
            loop {
                let mut action = self.bucket.list_objects_v2(Some(&self.credentials));
                action.with_prefix(prefix);
                if let Some(token) = &after {
                    action.with_continuation_token(token.as_str());
                }
                let response = through(self.client.get(action.sign(SIGNED)).send().await?, prefix).await?;
                let page = ListObjectsV2::parse_response(&response.text().await?)
                    .map_err(|e| anyhow::anyhow!("listing {prefix}: the bucket's answer doesn't read: {e}"))?;
                names.extend(page.contents.into_iter().map(|object| object.key));
                match page.next_continuation_token {
                    Some(token) => after = Some(token),
                    None => break,
                }
            }
            names.sort();
            Ok(names)
        })
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        Box::pin(async move {
            let url = self.bucket.delete_object(Some(&self.credentials), name).sign(SIGNED);
            let response = self.client.delete(url).send().await?;
            if response.status() != StatusCode::NOT_FOUND {
                through(response, name).await?;
            }
            Ok(())
        })
    }
}
