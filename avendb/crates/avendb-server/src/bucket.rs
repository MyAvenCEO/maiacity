//! The server's bucket on S3 (blobs B3a, `avendb_net::bucket`): Hetzner's object storage, which holds the server's
//! store, every object already sealed under the server's seal (`avendb_net::bucket::Sealed`). Each request is signed
//! (AWS Signature V4, by rusty-s3) for a few minutes, and goes over TLS of avenDB's own making (`tls`): X25519MLKEM768
//! first, as everywhere, and X25519 after it, as Hetzner's endpoint agrees no post-quantum group; what it carries is
//! sealed post-quantum anyway. Every upload carries its Content-MD5, as a bucket with Object Lock asks for it. A
//! download whose body breaks off goes on from where it broke, by a range of the same version (`S3::get`).

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result, bail};
use avendb_net::bucket::{Bucket, Fut};
use data_encoding::BASE64;
use md5::{Digest as _, Md5};
use reqwest::header::{CONTENT_RANGE, ETAG, IF_MATCH, RANGE};
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

/// Reads the rest of `response`'s body onto `bytes`, a chunk at a time, so what came before the body broke off, if it
/// does, stays there.
async fn read_onto(mut response: Response, bytes: &mut Vec<u8>) -> reqwest::Result<()> {
    while let Some(chunk) = response.chunk().await? {
        bytes.extend_from_slice(&chunk);
    }
    Ok(())
}

/// Where the range `response` sends starts, and the whole object's length, as its Content-Range says
/// (`bytes <first>-<last>/<length>`).
fn range_of(response: &Response) -> Option<(u64, u64)> {
    let range = response.headers().get(CONTENT_RANGE)?.to_str().ok()?.strip_prefix("bytes ")?;
    let (span, length) = range.split_once('/')?;
    Some((span.split_once('-')?.0.parse().ok()?, length.parse().ok()?))
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

    /// The object under `name`. A body that breaks off, as Hetzner's did, mid-part, all through a slow spell on
    /// 2026-10-20, goes on from where it broke: the rest of that same version (its ETag), asked for again and again so
    /// long as each answer brings more of it. A request that brings nothing fails it, for `Retrying` to try anew.
    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        Box::pin(async move {
            let url = self.bucket.get_object(Some(&self.credentials), name).sign(SIGNED);
            let response = self.client.get(url).send().await?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            let response = through(response, name).await?;
            let (tag, length) = (response.headers().get(ETAG).cloned(), response.content_length());
            let mut bytes = Vec::with_capacity(length.unwrap_or(0) as usize);
            let Err(mut broke) = read_onto(response, &mut bytes).await else { return Ok(Some(bytes)) };
            loop {
                let had = bytes.len() as u64;
                let url = self.bucket.get_object(Some(&self.credentials), name).sign(SIGNED);
                let mut request = self.client.get(url).header(RANGE, format!("bytes={had}-"));
                if let Some(tag) = &tag {
                    request = request.header(IF_MATCH, tag.clone());
                }
                let response = through(request.send().await?, name).await?;
                // the rest of that same object, from where it broke
                let rest = |(from, total)| from == had && length.is_none_or(|l| l == total);
                if response.status() != StatusCode::PARTIAL_CONTENT || !range_of(&response).is_some_and(rest) {
                    bail!("{name}: its body broke off after {had} bytes ({broke}), and the bucket sends no rest of it");
                }
                match read_onto(response, &mut bytes).await {
                    Ok(()) => return Ok(Some(bytes)),
                    Err(e) if bytes.len() as u64 > had => broke = e,
                    Err(e) => return Err(anyhow::Error::from(e).context(format!("{name}: cut after {had} bytes"))),
                }
            }
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

    /// The objects under `prefix` and their bytes, as its listing says them, a page of 1,000 at a time.
    fn usage<'a>(&'a self, prefix: &'a str) -> Fut<'a, (u64, u64)> {
        Box::pin(async move {
            let (mut objects, mut bytes, mut after) = (0, 0, None::<String>);
            loop {
                let mut action = self.bucket.list_objects_v2(Some(&self.credentials));
                action.with_prefix(prefix);
                if let Some(token) = &after {
                    action.with_continuation_token(token.as_str());
                }
                let response = through(self.client.get(action.sign(SIGNED)).send().await?, prefix).await?;
                let page = ListObjectsV2::parse_response(&response.text().await?)
                    .map_err(|e| anyhow::anyhow!("listing {prefix}: the bucket's answer doesn't read: {e}"))?;
                objects += page.contents.len() as u64;
                bytes += page.contents.iter().map(|object| object.size).sum::<u64>();
                match page.next_continuation_token {
                    Some(token) => after = Some(token),
                    None => break,
                }
            }
            Ok((objects, bytes))
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;
    use zeroize::Zeroizing;

    use super::*;

    /// An S3 endpoint on this machine whose one object is `object`, each answer of which breaks off after `cut` bytes
    /// of its body, as Hetzner's did, and which sends a range of it where asked: where it is, and how many requests it
    /// took.
    async fn breaking(object: Vec<u8>, cut: usize) -> (String, Arc<AtomicU32>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("a socket");
        let at = format!("http://{}", listener.local_addr().expect("its address"));
        let asked = Arc::new(AtomicU32::new(0));
        let counted = asked.clone();
        let object = Arc::new(object);
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                counted.fetch_add(1, Ordering::Relaxed);
                let object = object.clone();
                tokio::spawn(async move {
                    let mut head = vec![0; 16 * 1024];
                    let n = socket.read(&mut head).await.expect("a request");
                    let head = String::from_utf8_lossy(&head[..n]).to_lowercase();
                    let from =
                        head.lines().find_map(|l| l.strip_prefix("range: bytes=")?.strip_suffix('-')?.parse().ok());
                    let (status, rest, range) = match from {
                        Some(f) => {
                            let range = format!("bytes {f}-{}/{}", object.len() - 1, object.len());
                            ("206 Partial Content", &object[f..], range)
                        }
                        None => ("200 OK", &object[..], String::new()),
                    };
                    let range = if range.is_empty() { range } else { format!("content-range: {range}\r\n") };
                    let len = rest.len();
                    let head = format!(
                        "HTTP/1.1 {status}\r\ncontent-length: {len}\r\netag: \"v1\"\r\n{range}connection: close\r\n\r\n"
                    );
                    socket.write_all(head.as_bytes()).await.expect("its head");
                    // then it hangs up, the body cut short
                    socket.write_all(&rest[..len.min(cut)]).await.expect("its body");
                });
            }
        });
        (at, asked)
    }

    #[tokio::test]
    async fn a_body_that_breaks_off_goes_on_from_where_it_broke() {
        let object: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let (endpoint, asked) = breaking(object.clone(), 30_000).await;
        let (name, region, access_key, secret_key) = ("b".into(), "hel1".into(), "k".into(), "s".into());
        let config = BucketConfig { name, endpoint, region, access_key, secret_key, seal: Zeroizing::new([0; 32]) };
        let bucket = S3::new(&config).expect("the bucket");
        let read = bucket.get("vaults/v/blobs/b/000000").await.expect("it reads it whole");
        assert_eq!(read.as_deref(), Some(&object[..]));
        assert_eq!(asked.load(Ordering::Relaxed), 4, "30,000 bytes at a time");
    }
}
