//! aven-id's queries for avenOS, in place of `os/web/cast.js`: `new Cast(json)` reads the cast's tree and refuses
//! one that is not well formed; its methods answer as the Rust API does, ids in the tree's order.

use wasm_bindgen::prelude::*;

use crate::tree::Tree;

#[wasm_bindgen]
pub struct Cast(Tree);

fn strings(ids: Vec<&str>) -> Vec<String> {
    ids.into_iter().map(str::to_string).collect()
}

#[wasm_bindgen]
impl Cast {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Cast, JsError> {
        Tree::from_cast(json)
            .map(Cast)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Every vault's id, in the tree's order.
    pub fn vaults(&self) -> Vec<String> {
        self.0.vaults().iter().map(|v| v.id.clone()).collect()
    }

    pub fn name(&self, id: &str) -> Option<String> {
        self.0.vault(id).map(|v| v.name.clone())
    }

    /// `person`, `network` or `device`.
    pub fn kind(&self, id: &str) -> Option<String> {
        self.0.kind(id).map(|k| k.as_str().to_string())
    }

    /// A vault's owners as the cast writes them: `key:<id>` or `vault:<id>`.
    pub fn owners(&self, id: &str) -> Vec<String> {
        self.0.vault(id).map_or_else(Vec::new, |v| {
            v.owners.iter().map(ToString::to_string).collect()
        })
    }

    /// The public half of a key, in hex.
    pub fn key(&self, id: &str) -> Option<String> {
        self.0.key(id).map(str::to_string)
    }

    pub fn owned(&self, id: &str) -> Vec<String> {
        strings(self.0.owned(id))
    }

    pub fn governs(&self, id: &str) -> Vec<String> {
        strings(self.0.governs(id))
    }

    pub fn chain(&self, id: &str) -> Vec<String> {
        strings(self.0.chain(id))
    }

    #[wasm_bindgen(js_name = actsFor)]
    pub fn acts_for(&self, device: &str) -> Option<String> {
        self.0.acts_for(device).map(str::to_string)
    }

    #[wasm_bindgen(js_name = actsThrough)]
    pub fn acts_through(&self, id: &str) -> Vec<String> {
        strings(self.0.acts_through(id))
    }

    /// Whom a device may act as; without a device, whom the box may.
    pub fn accounts(&self, device: Option<String>) -> Vec<String> {
        strings(self.0.accounts(device.as_deref()))
    }

    pub fn sees(&self, id: &str) -> Vec<String> {
        strings(self.0.sees(id))
    }

    #[wasm_bindgen(js_name = mayActOn)]
    pub fn may_act_on(&self, device: &str, vault: &str) -> bool {
        self.0.may_act_on(device, vault)
    }
}
