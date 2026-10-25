//! Explicit metadata/content boundary for an authenticated own warm receipt.
//! Not a peer admission path. Warm restore uses this only after authenticating
//! its own exact-basis receipt; ordinary history reads hydrate through current keys.
use std::sync::{Arc, Mutex, OnceLock};
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

/// Shared only by bodies from one authenticated own warm receipt. Its exact
/// basis advances solely across a guarded strict canonical content append; it
/// does not hold keys or grant authority. Whole refresh/restore replaces it.
pub(crate) struct DeferredContext(Mutex<LogRevision>);
impl DeferredContext {
    pub(crate) fn new(basis: LogRevision) -> Arc<Self> { Arc::new(Self(Mutex::new(basis))) }
    pub(crate) fn matches(&self, current: &LogRevision) -> bool {
        *self.0.lock().expect("deferred context") == *current
    }
    pub(crate) fn advance_content_append(&self, before: &LogRevision, after: LogRevision) -> bool {
        let mut basis=self.0.lock().expect("deferred context");
        if *basis != *before { return false; }
        *basis=after;
        true
    }
}

/// Metadata certified by the device's encrypted exact-state receipt, plus the
/// original ciphertext. No decrypted content and no secret key are retained
/// until a demand supplies its CURRENT authorized entry key.
pub(crate) struct DeferredBody {
    basis: Arc<DeferredContext>,
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
        basis: Arc<DeferredContext>, metadata: BodyMetadata, ciphertext: Arc<[u8]>, context: Vec<u8>,
    ) -> Option<Self> {
        if !metadata.ordinary() || keys::edit_key(&ciphertext).is_none() { return None; }
        Some(Self { basis, metadata, ciphertext, context, opened: OnceLock::new() })
    }
    pub(crate) fn metadata(&self, current: &LogRevision) -> Result<&BodyMetadata, OpenError> {
        if !self.basis.matches(current) { return Err(OpenError::StaleBasis); }
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
        let deferred = DeferredBody::from_own_receipt(DeferredContext::new(basis.clone()), BodyMetadata::of(&Body::default()), ciphertext.into(), context).unwrap();
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
            assert!(DeferredBody::from_own_receipt(DeferredContext::new(basis),metadata,body.ciphertext,body.context).is_none());
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
        let (body, before, key) = fixture(vec![42;4096]);
        let after = Log::new().revision();
        assert!(!body.basis.advance_content_append(&after, before.clone()));
        let ciphertext = body.ciphertext.clone();
        let metadata = body.metadata(&before).unwrap().clone();
        let plaintext = body.open(&before, &key).unwrap() as *const Body;
        assert!(body.basis.advance_content_append(&before, after.clone()));
        assert!(Arc::ptr_eq(&ciphertext, &body.ciphertext), "no ciphertext-sized copy");
        assert_eq!(&metadata, body.metadata(&after).unwrap());
        assert_eq!(body.open(&before, &key).unwrap_err(), OpenError::StaleBasis);
        assert_eq!(body.open(&after, &Secret::from_bytes([8;32])).unwrap_err(), OpenError::WrongKey);
        assert_eq!(body.open(&after, &key).unwrap() as *const Body, plaintext, "no plaintext copy/redecode");
        let allocation = body.open(&after, &key).unwrap().content.as_ptr();
        let owned = body.into_opened(&after, &key).unwrap();
        assert_eq!(owned.content.as_ptr(), allocation, "working-set transfer moves the existing buffer");
    }

    #[test]
    fn shared_context_advances_unrelated_immutable_receipts_once() {
        let (template, before, key) = fixture(vec![42;32]);
        let context = template.basis.clone();
        let bodies: Vec<_> = (0..128).map(|_| Arc::new(DeferredBody::from_own_receipt(
            context.clone(), template.metadata.clone(), template.ciphertext.clone(),
            template.context.clone()).unwrap())).collect();
        let externally_held = bodies[0].clone();
        let plaintext = externally_held.open(&before, &key).unwrap() as *const Body;
        let after = Log::new().revision();
        let stale = Log::new().revision();
        assert!(!context.advance_content_append(&stale, after.clone()));
        assert!(context.matches(&before));
        assert!(context.advance_content_append(&before, after.clone()));
        for body in &bodies {
            assert!(Arc::ptr_eq(&body.basis, &context));
            assert!(body.metadata(&after).is_ok());
            assert_eq!(body.metadata(&before).unwrap_err(), OpenError::StaleBasis);
            assert_eq!(body.open(&after, &Secret::from_bytes([8;32])).unwrap_err(), OpenError::WrongKey);
        }
        assert_eq!(externally_held.open(&after, &key).unwrap() as *const Body, plaintext);
        assert!(!context.advance_content_append(&before, stale.clone()));
        assert!(context.matches(&after));
        let replacement = DeferredContext::new(stale.clone());
        assert!(replacement.matches(&stale));
        assert_eq!(externally_held.metadata(&stale).unwrap_err(), OpenError::StaleBasis);
    }

}
