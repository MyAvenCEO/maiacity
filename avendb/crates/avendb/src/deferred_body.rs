//! Explicit metadata/content boundary for an authenticated own warm receipt.
//! Not a peer admission path. Runtime activation requires demand-scoped history
//! hydration; until then the ordinary canonical read path remains eager.
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
        if metadata.body.defines.is_some()
            || metadata.body.header.as_ref().is_some_and(|h| h.ty.of_lane() || h.ty.as_str() == crate::slice::CAP_GROUP_TYPE)
            || keys::edit_key(&ciphertext).is_none() { return None; }
        Some(Self { basis, metadata, ciphertext, context, opened: OnceLock::new() })
    }
    pub(crate) fn metadata(&self, current: &LogRevision) -> Result<&BodyMetadata, OpenError> {
        if self.basis != *current { return Err(OpenError::StaleBasis); }
        Ok(&self.metadata)
    }
    /// Check basis and the current key even if content was opened previously.
    /// A missing/revoked key cannot be replaced by the memoized plaintext.
    pub(crate) fn open(&self, current: &LogRevision, key: &Secret) -> Result<&Body, OpenError> {
        self.metadata(current)?;
        if keys::edit_key(&self.ciphertext) != Some(key.id()) { return Err(OpenError::WrongKey); }
        self.opened.get_or_init(|| {
            let plain = keys::open_edit(key, &self.ciphertext, &self.context).ok_or(OpenError::InvalidContent)?;
            let body = Body::from_wire(&plain).map_err(|_| OpenError::InvalidContent)?;
            // Receipt corruption/implementation mismatch cannot silently change
            // the historical metadata previously supplied to authorization.
            if BodyMetadata::of(&body) != self.metadata { return Err(OpenError::InvalidContent); }
            Ok(body)
        }).as_ref().map_err(|e| *e)
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
}
