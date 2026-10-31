//! Docs in the Peer-Light (docs README, "Importing", (c); the architect, 31 Oct 2026). Loro can panic on bytes it
//! should have refused, and wasm32 aborts, so the docs layer runs in a docs worker of its own: a second instance of
//! this one module, spawned by the Peer-Light's worker (`os/web/peer/docs.js`), one for all open Docs. The keys stay in
//! the Peer-Light's worker (rule 13); the docs worker sees only plaintext envelopes.
//!
//! **One writer per store** (store, rule 1): the docs worker keeps no store of its own. Its [`Remote`] store asks the
//! Peer-Light's worker, which answers from its own (`storeOp`), so the Doc's shelf (`aven_peer::docs::Shelf`) writes
//! through the one store the Peer-Light holds.

use wasm_bindgen::prelude::*;

/// A store call's error as it crosses the workers: a compare-and-set that found another hash (`{stale, current}`), or
/// the store's reason as text.
fn crossed(e: aven_db_store::Error) -> JsValue {
    match e {
        aven_db_store::Error::Stale { current } => {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&o, &"stale".into(), &JsValue::TRUE);
            let _ = js_sys::Reflect::set(
                &o,
                &"current".into(),
                &current.map_or(JsValue::NULL, |h| h.to_hex().into()),
            );
            o.into()
        }
        e => JsValue::from_str(&e.to_string()),
    }
}

fn hash_of(v: &JsValue) -> Result<aven_db_store::Hash, JsValue> {
    v.as_string()
        .ok_or("a hash is hex text")?
        .parse()
        .map_err(|e: aven_db_store::Error| JsValue::from_str(&e.to_string()))
}

fn ref_of(v: &JsValue) -> Result<aven_db_store::RefName, JsValue> {
    aven_db_store::RefName::new(v.as_string().ok_or("a ref's name is text")?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn hexes(hs: impl IntoIterator<Item = aven_db_store::Hash>) -> JsValue {
    hs.into_iter()
        .map(|h| JsValue::from(h.to_hex()))
        .collect::<js_sys::Array>()
        .into()
}

/// The Peer-Light's worker answers a docs worker's store call from its own store: `op` and its `args` as [`Remote`]
/// sends them.
#[wasm_bindgen(js_name = storeOp)]
pub async fn store_op(op: String, args: js_sys::Array) -> Result<JsValue, JsValue> {
    let (store, _) = crate::store().await.map_err(JsValue::from)?;
    let arg = |i: u32| args.get(i);
    let opt_hash = |v: JsValue| -> Result<Option<aven_db_store::Hash>, JsValue> {
        if v.is_null() || v.is_undefined() {
            Ok(None)
        } else {
            hash_of(&v).map(Some)
        }
    };
    Ok(match op.as_str() {
        "put" => {
            let bytes = js_sys::Uint8Array::new(&arg(0)).to_vec();
            store
                .put(bytes.into())
                .await
                .map_err(crossed)?
                .to_hex()
                .into()
        }
        "get" => match store.get(&hash_of(&arg(0))?).await.map_err(crossed)? {
            Some(b) => js_sys::Uint8Array::from(b.as_ref()).into(),
            None => JsValue::NULL,
        },
        "get_range" => {
            let (from, to) = (
                arg(1).as_f64().ok_or("a range's start")? as u64,
                arg(2).as_f64().ok_or("a range's end")? as u64,
            );
            match store
                .get_range(&hash_of(&arg(0))?, from..to)
                .await
                .map_err(crossed)?
            {
                Some(b) => js_sys::Uint8Array::from(b.as_ref()).into(),
                None => JsValue::NULL,
            }
        }
        "has" => store.has(&hash_of(&arg(0))?).await.map_err(crossed)?.into(),
        "size" => match store.size(&hash_of(&arg(0))?).await.map_err(crossed)? {
            Some(n) => JsValue::from_f64(n as f64),
            None => JsValue::NULL,
        },
        "list" => hexes(store.list().await.map_err(crossed)?),
        "delete" => {
            store.delete(&hash_of(&arg(0))?).await.map_err(crossed)?;
            JsValue::UNDEFINED
        }
        "get_ref" => match store.get_ref(&ref_of(&arg(0))?).await.map_err(crossed)? {
            Some(h) => h.to_hex().into(),
            None => JsValue::NULL,
        },
        "set_ref" => {
            store
                .set_ref(&ref_of(&arg(0))?, opt_hash(arg(1))?, hash_of(&arg(2))?)
                .await
                .map_err(crossed)?;
            JsValue::UNDEFINED
        }
        "delete_ref" => {
            store
                .delete_ref(&ref_of(&arg(0))?, hash_of(&arg(1))?)
                .await
                .map_err(crossed)?;
            JsValue::UNDEFINED
        }
        "list_refs" => store
            .list_refs()
            .await
            .map_err(crossed)?
            .into_iter()
            .map(|r| JsValue::from(r.as_str()))
            .collect::<js_sys::Array>()
            .into(),
        other => return Err(JsValue::from_str(&format!("no store call {other}"))),
    })
}

/// The docs worker's store: every call asks the Peer-Light's worker, through `ask(op, args) -> Promise` (`storeOp`
/// there), so one store has one writer.
#[cfg(target_arch = "wasm32")]
pub struct Remote {
    ask: js_sys::Function,
}

#[cfg(target_arch = "wasm32")]
mod remote {
    use std::ops::Range;

    use aven_db_store::{Error, Hash, RefName, Result, Store};
    use bytes::Bytes;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_futures::JsFuture;

    use super::Remote;

    fn back(v: JsValue) -> Error {
        if js_sys::Reflect::get(&v, &"stale".into()).is_ok_and(|s| s.is_truthy()) {
            let current = js_sys::Reflect::get(&v, &"current".into())
                .ok()
                .and_then(|c| c.as_string())
                .and_then(|c| c.parse().ok());
            return Error::Stale { current };
        }
        Error::Backend(v.as_string().unwrap_or_else(|| format!("{v:?}")))
    }

    fn hash(v: JsValue) -> Result<Hash> {
        v.as_string()
            .ok_or_else(|| Error::Backend("a hash is hex text".into()))?
            .parse()
    }

    fn bytes(v: JsValue) -> Option<Bytes> {
        (!v.is_null() && !v.is_undefined()).then(|| js_sys::Uint8Array::new(&v).to_vec().into())
    }

    impl Remote {
        pub fn new(ask: js_sys::Function) -> Remote {
            Remote { ask }
        }

        async fn call(&self, op: &str, args: Vec<JsValue>) -> Result<JsValue> {
            let args: js_sys::Array = args.into_iter().collect();
            let p = self
                .ask
                .call2(&JsValue::NULL, &JsValue::from_str(op), &args)
                .map_err(back)?;
            JsFuture::from(js_sys::Promise::from(p)).await.map_err(back)
        }
    }

    #[async_trait::async_trait(?Send)]
    impl Store for Remote {
        async fn put(&self, b: Bytes) -> Result<Hash> {
            hash(
                self.call("put", vec![js_sys::Uint8Array::from(b.as_ref()).into()])
                    .await?,
            )
        }

        async fn get(&self, h: &Hash) -> Result<Option<Bytes>> {
            Ok(bytes(self.call("get", vec![h.to_hex().into()]).await?))
        }

        async fn get_range(&self, h: &Hash, r: Range<u64>) -> Result<Option<Bytes>> {
            let args = vec![
                h.to_hex().into(),
                JsValue::from_f64(r.start as f64),
                JsValue::from_f64(r.end as f64),
            ];
            Ok(bytes(self.call("get_range", args).await?))
        }

        async fn has(&self, h: &Hash) -> Result<bool> {
            Ok(self.call("has", vec![h.to_hex().into()]).await?.is_truthy())
        }

        async fn size(&self, h: &Hash) -> Result<Option<u64>> {
            Ok(self
                .call("size", vec![h.to_hex().into()])
                .await?
                .as_f64()
                .map(|n| n as u64))
        }

        async fn list(&self) -> Result<Vec<Hash>> {
            js_sys::Array::from(&self.call("list", vec![]).await?)
                .iter()
                .map(hash)
                .collect()
        }

        async fn delete(&self, h: &Hash) -> Result<()> {
            self.call("delete", vec![h.to_hex().into()])
                .await
                .map(|_| ())
        }

        async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>> {
            let v = self.call("get_ref", vec![name.as_str().into()]).await?;
            if v.is_null() || v.is_undefined() {
                Ok(None)
            } else {
                hash(v).map(Some)
            }
        }

        async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
            let expected = expected.map_or(JsValue::NULL, |h| h.to_hex().into());
            let args = vec![name.as_str().into(), expected, new.to_hex().into()];
            self.call("set_ref", args).await.map(|_| ())
        }

        async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()> {
            let args = vec![name.as_str().into(), expected.to_hex().into()];
            self.call("delete_ref", args).await.map(|_| ())
        }

        async fn list_refs(&self) -> Result<Vec<RefName>> {
            js_sys::Array::from(&self.call("list_refs", vec![]).await?)
                .iter()
                .map(|v| RefName::new(v.as_string().unwrap_or_default()))
                .collect()
        }
    }
}
