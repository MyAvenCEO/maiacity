//! The server peer and Postgres: the paired devices it lets in, what it tells new devices (vault_config), and the
//! mirror of the catalog (vault_files) the website and the admin read. Postgres never decides what exists — the
//! catalog does; these rows follow it.

use anyhow::Result;
use iroh::EndpointId;
use tokio_postgres::{Client, NoTls};

pub async fn connect(url: &str) -> Result<Client> {
    let (client, conn) = tokio_postgres::connect(url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::error!("postgres: {e}");
        }
    });
    Ok(client)
}

/// Devices the admin paired and did not revoke.
pub async fn devices(db: &Client) -> Result<Vec<EndpointId>> {
    let rows = db.query("SELECT endpoint_id FROM vault_devices WHERE revoked_at IS NULL", &[]).await?;
    Ok(rows.iter().filter_map(|r| r.get::<_, String>(0).parse().ok()).collect())
}

pub async fn publish(db: &Client, key: &str, value: &str) -> Result<()> {
    db.execute(
        "INSERT INTO vault_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        &[&key, &value],
    )
    .await?;
    Ok(())
}

/// One catalog entry's description, mirrored.
pub async fn mirror(db: &Client, meta: &serde_json::Value, stored: bool) -> Result<()> {
    // Postgres keeps no NUL in text or jsonb (some cameras write them into their metadata): dropped here
    let meta = &without_nul(meta.clone());
    let s = |k: &str| meta.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let hash = s("hash");
    let size = meta.get("size").and_then(|v| v.as_i64()).unwrap_or(0);
    let tags: Vec<String> =
        meta.get("tags").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default();
    let public = meta.get("public").and_then(|v| v.as_bool()).unwrap_or(false);
    db.execute(
        "INSERT INTO vault_files (hash, size, mime, kind, title, tags, public, meta, stored)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (hash) DO UPDATE SET size = EXCLUDED.size, mime = EXCLUDED.mime, kind = EXCLUDED.kind,
           title = EXCLUDED.title, tags = EXCLUDED.tags, public = EXCLUDED.public, meta = EXCLUDED.meta,
           stored = vault_files.stored OR EXCLUDED.stored, updated = now()",
        &[&hash, &size, &s("mime"), &s("kind"), &s("title"), &tags, &public, meta, &stored],
    )
    .await?;
    Ok(())
}

/// Every file Object Storage is known to hold (its hash).
pub async fn stored_all(db: &Client) -> Result<std::collections::HashSet<String>> {
    Ok(db.query("SELECT hash FROM vault_files WHERE stored", &[]).await?.iter().map(|r| r.get::<_, String>(0)).collect())
}

pub async fn stored(db: &Client, hash: &str) -> Result<()> {
    db.execute("UPDATE vault_files SET stored = true, updated = now() WHERE hash = $1", &[&hash]).await?;
    Ok(())
}

/// Is this file public (served without a login)? Unknown files are not.
pub async fn public(db: &Client, hash: &str) -> Result<Option<(bool, String)>> {
    let row = db.query_opt("SELECT public, mime FROM vault_files WHERE hash = $1", &[&hash]).await?;
    Ok(row.map(|r| (r.get(0), r.get(1))))
}

/// A JSON value with every NUL taken out of its strings (and keys).
fn without_nul(v: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::String(s) => Value::String(s.replace('\0', "")),
        Value::Array(a) => Value::Array(a.into_iter().map(without_nul).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k.replace('\0', ""), without_nul(v))).collect()),
        other => other,
    }
}
