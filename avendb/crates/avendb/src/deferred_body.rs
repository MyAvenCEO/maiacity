//! Explicit metadata/content boundary for an authenticated own warm receipt.
//! Not a peer admission path. Warm restore uses this only after authenticating
//! its own exact-basis receipt; ordinary history reads hydrate through current keys.
use std::sync::{Arc, OnceLock};
use crate::{keys::{self, Secret}, policy::LogRevision, slice::Body, wire::Wire};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OpenError { StaleBasis, WrongKey, InvalidContent }

/// A distinct type: metadata must never masquerade as Body with empty content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BodyMetadata {
    body: Body,
}
impl BodyMetadata {
    pub(crate) fn fields(&self) -> &Body { &self.body }
    pub(crate) fn bytes(&self) -> Vec<u8> { self.body.to_wire() }
    pub(crate) fn decode(bytes: &[u8]) -> Option<Self> {
        let body = Body::from_wire(bytes).ok()?;
        if !body.content.is_empty() { return None; }
        Some(Self { body })
    }
    pub(crate) fn ordinary(&self) -> bool {
        self.body.defines.is_none() && self.body.header.as_ref().is_none_or(|h|
            !h.ty.of_lane() && h.ty.as_str() != crate::slice::CAP_GROUP_TYPE)
    }
    pub(crate) fn of(body: &Body) -> Self {
        Self { body: Body { header: body.header.clone(), tags: body.tags.clone(),
            answers: body.answers.clone(), content: Vec::new(), proof: body.proof.clone(),
            files: body.files.clone(), defines: body.defines.clone() } }
    }
}

/// Metadata certified by the device's encrypted exact-state receipt, plus the
/// original ciphertext. No decrypted content and no secret key are retained
/// until a demand supplies its CURRENT authorized entry key.
pub(crate) struct DeferredBody {
    basis: LogRevision,
    metadata: BodyMetadata,
    ciphertext: Arc<[u8]>,
    context: Vec<u8>,
    opened: OnceLock<Result<Body, OpenError>>,
}
impl DeferredBody {
    /// Call only after authenticating an own receipt and matching its exact log.
    /// Metadata must omit content explicitly; authorization dependencies must not
    /// use this path. This constructor itself does NOT authenticate that receipt.
    pub(crate) fn from_own_receipt(
        basis: LogRevision, metadata: BodyMetadata, ciphertext: Arc<[u8]>, context: Vec<u8>,
    ) -> Option<Self> {
        if !metadata.ordinary() || keys::edit_key(&ciphertext).is_none() { return None; }
        Some(Self { basis, metadata, ciphertext, context, opened: OnceLock::new() })
    }
    pub(crate) fn metadata(&self, current: &LogRevision) -> Result<&BodyMetadata, OpenError> {
        if self.basis != *current { return Err(OpenError::StaleBasis); }
        Ok(&self.metadata)
    }
    pub(crate) fn permits(&self, current: &LogRevision, key: &Secret) -> Result<(), OpenError> {
        self.metadata(current)?;
        if keys::edit_key(&self.ciphertext) != Some(key.id()) { return Err(OpenError::WrongKey); }
        Ok(())
    }
    /// Check basis and the current key even if content was opened previously.
    /// A missing/revoked key cannot be replaced by the memoized plaintext.
    pub(crate) fn open(&self, current: &LogRevision, key: &Secret) -> Result<&Body, OpenError> {
        self.permits(current, key)?;
        self.opened.get_or_init(|| {
            let plain = keys::open_edit(key, &self.ciphertext, &self.context).ok_or(OpenError::InvalidContent)?;
            let body = Body::from_wire(&plain).map_err(|_| OpenError::InvalidContent)?;
            // Receipt corruption/implementation mismatch cannot silently change
            // the historical metadata previously supplied to authorization.
            if BodyMetadata::of(&body) != self.metadata { return Err(OpenError::InvalidContent); }
            Ok(body)
        }).as_ref().map_err(|e| *e)
    }
    /// Only the local content-append path may advance an exclusively owned receipt
    /// after strict canonical tail replay and unchanged old key/authorization inputs.
    /// Current key/content validation remains mandatory even for a cached plaintext.
    pub(crate) fn advance_content_append(&mut self, before: &LogRevision, after: LogRevision) -> bool {
        if self.basis != *before { return false; }
        self.basis = after;
        true
    }
    /// Move validated plaintext into the active working set without a second
    /// content-sized allocation. The caller must own the receipt exclusively.
    pub(crate) fn into_opened(self, current: &LogRevision, key: &Secret) -> Result<Body, OpenError> {
        self.open(current, key)?;
        self.opened.into_inner().expect("successful open initialized plaintext")
    }
    pub(crate) fn content_ready(&self) -> bool { matches!(self.opened.get(), Some(Ok(_))) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{keys::SeededRng, policy::Log};

    fn fixture(content: Vec<u8>) -> (DeferredBody, LogRevision, Secret) {
        let key = Secret::from_bytes([7; 32]);
        let context = b"bound canonical write".to_vec();
        let body = Body { content, ..Body::default() };
        let mut rng = SeededRng::new("deferred body test", b"fixture");
        let ciphertext = keys::seal_edit(&key, &body.to_wire(), &context, &mut rng);
        let basis = Log::new().revision();
        let deferred = DeferredBody::from_own_receipt(basis.clone(), BodyMetadata::of(&Body::default()), ciphertext.into(), context).unwrap();
        (deferred, basis, key)
    }
    #[test]
    fn metadata_does_not_claim_empty_content_and_demand_checks_current_key() {
        let (body, basis, key) = fixture(vec![42; 4096]);
        assert!(!body.content_ready());
        assert_eq!(body.metadata(&basis).unwrap(), &BodyMetadata::of(&Body::default()));
        assert!(!body.content_ready(), "metadata reads never decrypt content");
        assert_eq!(body.open(&basis, &key).unwrap().content, vec![42;4096]);
        assert!(body.content_ready());
        assert_eq!(body.open(&basis, &Secret::from_bytes([8;32])).unwrap_err(), OpenError::WrongKey);
        assert_eq!(body.open(&Log::new().revision(), &key).unwrap_err(), OpenError::StaleBasis);
    }
    #[test]
    fn authorization_dependency_metadata_is_never_deferred() {
        for ty in [crate::slice::SCHEMA_TYPE, crate::slice::LENS_TYPE, crate::slice::CAP_GROUP_TYPE] {
            let (body, basis, _key) = fixture(vec![]);
            let metadata = BodyMetadata::of(&Body { header: Some(crate::slice::Header {
                ty: ty.into(), created:0 }), ..Body::default() });
            assert!(DeferredBody::from_own_receipt(basis,metadata,body.ciphertext,body.context).is_none());
        }
    }
    #[test]
    fn invalid_ciphertext_is_not_a_valid_empty_update() {
        let (mut body, basis, key) = fixture(vec![1]);
        let mut broken = body.ciphertext.to_vec(); *broken.last_mut().unwrap() ^= 1;
        body.ciphertext = broken.into();
        assert_eq!(body.open(&basis, &key).unwrap_err(), OpenError::InvalidContent);
        assert!(!body.content_ready());
        let (empty, basis, key) = fixture(vec![]);
        assert!(empty.open(&basis, &key).unwrap().content.is_empty());
        assert!(empty.content_ready());
    }
    #[test]
    fn metadata_mismatch_and_context_swap_fail_closed() {
        let (mut body, basis, key) = fixture(vec![1]);
        body.metadata.body.answers.push(crate::id::EditId::from_u64(1));
        assert_eq!(body.open(&basis, &key).unwrap_err(), OpenError::InvalidContent);
        let (mut body, basis, key) = fixture(vec![1]); body.context.push(0);
        assert_eq!(body.open(&basis, &key).unwrap_err(), OpenError::InvalidContent);
    }
    #[test]
    fn content_append_rebind_preserves_bytes_and_current_key_checks() {
        let (mut body, before, key) = fixture(vec![42;4096]);
        let after = Log::new().revision();
        assert!(!body.advance_content_append(&after, before.clone()));
        let ciphertext = body.ciphertext.clone();
        let metadata = body.metadata(&before).unwrap().clone();
        let plaintext = body.open(&before, &key).unwrap() as *const Body;
        assert!(body.advance_content_append(&before, after.clone()));
        assert!(Arc::ptr_eq(&ciphertext, &body.ciphertext), "no ciphertext-sized copy");
        assert_eq!(&metadata, body.metadata(&after).unwrap());
        assert_eq!(body.open(&before, &key).unwrap_err(), OpenError::StaleBasis);
        assert_eq!(body.open(&after, &Secret::from_bytes([8;32])).unwrap_err(), OpenError::WrongKey);
        assert_eq!(body.open(&after, &key).unwrap() as *const Body, plaintext, "no plaintext copy/redecode");
        let allocation = body.open(&after, &key).unwrap().content.as_ptr();
        let owned = body.into_opened(&after, &key).unwrap();
        assert_eq!(owned.content.as_ptr(), allocation, "working-set transfer moves the existing buffer");
    }

}
