//! The vault core end to end on a temporary folder: three-hash ingest, duplicates, the catalog, describing a file.

use vault_core::{Vault, Verdict, ingest::Batch};

fn temp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("vault-core-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn ingest_checks_three_hashes_and_records_the_file() {
    let dir = temp("ingest");
    let src = dir.join("clip.mov");
    // 5 MiB of varied bytes: more than one BLAKE3 chunk group, not a multiple of anything round
    let bytes: Vec<u8> = (0..5 * 1024 * 1024 + 123).map(|i: u32| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    std::fs::write(&src, &bytes).unwrap();

    let vault = Vault::open(dir.join("vault")).await.unwrap();
    let batch = Batch { session: "test".into(), tags: vec!["Day 99".into()], title: Some("a clip".into()), ..Default::default() };
    let o = vault.ingest_file(&src, &batch).await.unwrap();

    // the name is plain BLAKE3 of the bytes, and all three hashes agree
    assert_eq!(o.verdict, Verdict::Verified);
    assert_eq!(o.hash, blake3::hash(&bytes).to_hex().to_string());
    assert_eq!(o.source_hash, o.disk_hash);
    assert_eq!(o.disk_hash, o.iroh_hash);
    assert_eq!(o.size, bytes.len() as u64);

    // the catalog knows it, with its description
    let list = vault.catalog.list().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "a clip");
    assert_eq!(list[0].tags, vec!["Day 99".to_string()]);
    assert_eq!(list[0].mime, "video/quicktime");
    assert_eq!(list[0].kind, "video");

    // the same bytes again: nothing stored twice
    let again = vault.ingest_file(&src, &batch).await.unwrap();
    assert_eq!(again.verdict, Verdict::Duplicate);
    assert_eq!(vault.catalog.list().await.unwrap().len(), 1);

    // library enrichment: a new description, the rest kept
    let hash = o.hash.parse().unwrap();
    let meta = vault
        .catalog
        .describe(hash, &serde_json::json!({ "title": "the opening shot", "public": true, "meta": { "scene": "the dip" } }))
        .await
        .unwrap();
    assert_eq!(meta.title, "the opening shot");
    assert!(meta.public);
    assert_eq!(meta.tags, vec!["Day 99".to_string()]);
    assert_eq!(meta.meta["scene"], "the dip");
    assert_eq!(vault.catalog.meta(hash).await.unwrap().unwrap().title, "the opening shot");

    // the bytes in the store are the bytes that came in
    let back = vault.store.blobs().get_bytes(hash).await.unwrap();
    assert_eq!(back.as_ref(), bytes.as_slice());

    vault.close().await.unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn junk_is_left_out() {
    use std::path::Path;
    assert!(vault_core::ingest::is_junk(Path::new("/Volumes/CARD/.DS_Store")));
    assert!(vault_core::ingest::is_junk(Path::new("/Volumes/CARD/._C0001.MP4")));
    assert!(!vault_core::ingest::is_junk(Path::new("/Volumes/CARD/C0001.MP4")));
}
