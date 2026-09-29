//! Hetzner Object Storage, the server peer's content store. Presigned requests (rusty-s3) sent with reqwest: HEAD,
//! ranged GET, single PUT, and multipart uploads for files of any size, streamed part by part — nothing on disk.
//!
//! Layout (bucket `maiacity`): `LIBRARY/blobs/<hash>` the bytes, `LIBRARY/meta/<hash>.json` the description,
//! `LIBRARY/catalog/<date>.json` the nightly catalog export. `BACKUPS/` belongs to the database dumps.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use bytes::Bytes;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle, actions::CreateMultipartUpload};
use tokio::task::JoinSet;

const SIGN: Duration = Duration::from_secs(3600);
/// Parts of 16 MiB: above S3's 5 MiB floor, few enough for a 100 GB file (6,400 of at most 10,000).
pub const PART: usize = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct S3 {
    bucket: Bucket,
    creds: Credentials,
    http: reqwest::Client,
}

pub fn blob_key(hash: &str) -> String {
    format!("LIBRARY/blobs/{hash}")
}
pub fn meta_key(hash: &str) -> String {
    format!("LIBRARY/meta/{hash}.json")
}

impl S3 {
    pub fn new(endpoint: &str, region: &str, bucket: &str, key: &str, secret: &str) -> Result<Self> {
        // Hetzner Object Storage: virtual-hosted names (maiacity.hel1.your-objectstorage.com)
        let bucket = Bucket::new(endpoint.parse()?, UrlStyle::VirtualHost, bucket.to_string(), region.to_string())?;
        let http = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build()?;
        Ok(Self { bucket, creds: Credentials::new(key.to_string(), secret.to_string()), http })
    }

    /// The object's size, or None when it is not there.
    pub async fn head(&self, key: &str) -> Result<Option<u64>> {
        let url = self.bucket.head_object(Some(&self.creds), key).sign(SIGN);
        let res = self.http.head(url).send().await?;
        match res.status().as_u16() {
            200 => Ok(res.headers().get("content-length").and_then(|v| v.to_str().ok()?.parse().ok())),
            404 => Ok(None),
            s => bail!("HEAD {key}: {s}"),
        }
    }

    /// A GET, whole or a byte range (`bytes=a-b`), as the response — the gateway streams its body on.
    pub async fn get(&self, key: &str, range: Option<&str>) -> Result<reqwest::Response> {
        let url = self.bucket.get_object(Some(&self.creds), key).sign(SIGN);
        let mut req = self.http.get(url);
        if let Some(r) = range {
            req = req.header("range", r);
        }
        Ok(req.send().await?)
    }

    pub async fn put(&self, key: &str, body: Bytes, content_type: &str) -> Result<()> {
        let url = self.bucket.put_object(Some(&self.creds), key).sign(SIGN);
        let res = self.http.put(url).header("content-type", content_type).body(body).send().await?;
        if !res.status().is_success() {
            bail!("PUT {key}: {} {}", res.status(), res.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Start a multipart upload: write parts into it, then finish (or abort — nothing half-made stays).
    pub async fn upload(&self, key: &str) -> Result<Upload> {
        let url = self.bucket.create_multipart_upload(Some(&self.creds), key).sign(SIGN);
        let res = self.http.post(url).send().await?;
        if !res.status().is_success() {
            bail!("create upload {key}: {} {}", res.status(), res.text().await.unwrap_or_default());
        }
        let body = res.text().await?;
        let id = CreateMultipartUpload::parse_response(&body).map_err(|e| anyhow::anyhow!("{e}"))?.upload_id().to_string();
        Ok(Upload {
            s3: self.clone(),
            key: key.to_string(),
            id,
            parts: 0,
            sending: JoinSet::new(),
            etags: Vec::new(),
            buf: Vec::with_capacity(PART),
        })
    }
}

/// Parts in flight at once: the bytes keep arriving from the device while earlier parts go to the bucket.
const IN_FLIGHT: usize = 3;

pub struct Upload {
    s3: S3,
    key: String,
    id: String,
    parts: u16,
    sending: JoinSet<Result<(u16, String)>>,
    etags: Vec<(u16, String)>,
    buf: Vec<u8>,
}

impl Upload {
    /// Add bytes; a full part goes out as soon as there is one.
    pub async fn write(&mut self, mut data: &[u8]) -> Result<()> {
        while !data.is_empty() {
            let take = (PART - self.buf.len()).min(data.len());
            self.buf.extend_from_slice(&data[..take]);
            data = &data[take..];
            if self.buf.len() == PART {
                self.flush().await?;
            }
        }
        Ok(())
    }

    /// Send the buffered part in the background; wait only when too many are already on their way.
    async fn flush(&mut self) -> Result<()> {
        self.parts = self.parts.checked_add(1).context("more than 65,535 parts")?;
        let number = self.parts;
        let url = self.s3.bucket.upload_part(Some(&self.s3.creds), &self.key, number, &self.id).sign(SIGN);
        let body = Bytes::from(std::mem::replace(&mut self.buf, Vec::with_capacity(PART)));
        let (http, key) = (self.s3.http.clone(), self.key.clone());
        self.sending.spawn(async move {
            let mut tries = 0;
            loop {
                match http.put(url.clone()).body(body.clone()).send().await {
                    Ok(r) if r.status().is_success() => {
                        let etag = r.headers().get("etag").and_then(|v| v.to_str().ok()).context("no ETag")?.to_string();
                        return Ok((number, etag));
                    }
                    Ok(r) if tries >= 3 => bail!("part {number} of {key}: {}", r.status()),
                    Err(e) if tries >= 3 => return Err(e.into()),
                    _ => {
                        tries += 1;
                        tokio::time::sleep(Duration::from_secs(1 << tries)).await;
                    }
                }
            }
        });
        while self.sending.len() >= IN_FLIGHT {
            self.collect_one().await?;
        }
        Ok(())
    }

    async fn collect_one(&mut self) -> Result<()> {
        if let Some(done) = self.sending.join_next().await {
            self.etags.push(done??);
        }
        Ok(())
    }

    /// The last part, then the whole object appears at once.
    pub async fn finish(mut self) -> Result<()> {
        if !self.buf.is_empty() || self.parts == 0 {
            self.flush().await?;
        }
        while !self.sending.is_empty() {
            self.collect_one().await?;
        }
        self.etags.sort_by_key(|(n, _)| *n);
        let action = self.s3.bucket.complete_multipart_upload(Some(&self.s3.creds), &self.key, &self.id, self.etags.iter().map(|(_, e)| e.as_str()));
        let url = action.sign(SIGN);
        let res = self.s3.http.post(url).body(action.body()).send().await?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        // S3 can answer 200 with an error inside the body
        if !status.is_success() || text.contains("<Error>") {
            bail!("complete {}: {status} {text}", self.key);
        }
        Ok(())
    }

    /// Give up: S3 drops the parts, and no object appears.
    pub async fn abort(mut self) {
        self.sending.abort_all();
        while self.sending.join_next().await.is_some() {}
        let url = self.s3.bucket.abort_multipart_upload(Some(&self.s3.creds), &self.key, &self.id).sign(SIGN);
        self.s3.http.delete(url).send().await.ok();
    }
}
