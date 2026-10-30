//! Only for measuring the wasm each way adds: one export that runs an endpoint and a Router on our store (the
//! baseline) and, with `wasm-a` or `wasm-b`, serves and fetches a file that way, so the linker keeps exactly it.

use std::sync::Arc;

use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, SecretKey};

use crate::adapter::Shared;

#[unsafe(no_mangle)]
pub extern "C" fn spike(seed: u8) {
    n0_future::task::spawn(async move {
        let store: Shared = Arc::new(aven_db_store::backend::memory().unwrap());
        let ep = Endpoint::builder(presets::Minimal).bind().await.unwrap();
        let at = EndpointAddr::new(SecretKey::from_bytes(&[seed; 32]).public());
        let file = aven_db_store::Hash::of(&[seed]);
        let router = Router::builder(ep.clone());
        #[cfg(feature = "wasm-a")]
        let router = {
            let blobs = crate::adapter::blobs(store.clone());
            let conn = ep.connect(at.clone(), iroh_blobs::ALPN).await.unwrap();
            let h = iroh_blobs::Hash::from_bytes(*file.as_bytes());
            blobs.remote().fetch(conn.clone(), iroh_blobs::HashAndFormat::hash_seq(h)).await.ok();
            let req = iroh_blobs::protocol::GetRequest::builder()
                .root(bao_tree::ChunkRanges::all())
                .child(seed as u64, bao_tree::ChunkRanges::all())
                .build(h);
            blobs.remote().execute_get(conn, req).await.ok();
            router.accept(iroh_blobs::ALPN, iroh_blobs::BlobsProtocol::new(&blobs, None))
        };
        #[cfg(feature = "wasm-b")]
        let router = {
            let conn = ep.connect(at.clone(), crate::bao::ALPN).await.unwrap();
            let index = crate::bao::get_blob(&conn, &store, file).await.unwrap();
            for h in crate::files::chunks(&index) {
                crate::bao::get_blob(&conn, &store, h).await.ok();
            }
            router.accept(crate::bao::ALPN, crate::bao::Serve::new(store.clone()))
        };
        let _ = (at, file, store);
        let _ = router.spawn();
    });
}
