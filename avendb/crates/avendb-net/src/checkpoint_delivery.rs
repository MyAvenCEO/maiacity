//! Owner-approved, read-only checkpoints on the existing authenticated sync connection.
//! The hosted peer has no special role. Transport evidence is checked by ordinary signed receive.
use crate::{Authenticator, Node, Peer, Shared, Step, session};
use anyhow::{Result, ensure};
use avendb::{
    engine::{self, Approval, Refused, Then},
    id::{EditId, EntryId},
    lab::PreparedEntryProjection,
    policy::LogRevision,
    sealed::FileRoot,
    wire::{Reply, Wire},
};
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use n0_future::time::{self, Duration, Instant};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::AsyncReadExt;

pub(crate) const KIND: u8 = 19;
pub(crate) const REQUEST_LIMIT: usize = 65;
pub(crate) const DEADLINE: Duration = Duration::from_secs(2);
const CIPHER_LIMIT: usize = (1 << 20) + 128;
const EVIDENCE_LIMIT: usize = 512 << 10;
const RESPONSE_LIMIT: usize = CIPHER_LIMIT + EVIDENCE_LIMIT + 41;

fn tag(entry: EntryId) -> Vec<u8> {
    [b"avendb/checkpoint/".as_slice(), &entry.0].concat()
}
fn request(bytes: &[u8]) -> Result<(EntryId, Option<EditId>)> {
    ensure!(
        (bytes.len() == 33 || bytes.len() == REQUEST_LIMIT) && bytes[0] == 1,
        "unsupported checkpoint request"
    );
    let entry = EntryId(bytes[1..33].try_into().expect("32 bytes"));
    let known = (bytes.len() == 65).then(|| EditId(bytes[33..65].try_into().expect("32 bytes")));
    Ok((entry, known))
}
fn encode(snapshot: EditId, evidence: Reply, sealed: &[u8]) -> Result<Vec<u8>> {
    let evidence = evidence.to_wire();
    ensure!(
        evidence.len() <= EVIDENCE_LIMIT && sealed.len() <= CIPHER_LIMIT,
        "checkpoint response limit"
    );
    let mut out = Vec::with_capacity(41 + evidence.len() + sealed.len());
    out.push(1);
    out.extend_from_slice(&snapshot.0);
    out.extend_from_slice(&(evidence.len() as u32).to_le_bytes());
    out.extend(evidence);
    out.extend_from_slice(&(sealed.len() as u32).to_le_bytes());
    out.extend_from_slice(sealed);
    Ok(out)
}
fn decode(bytes: &[u8]) -> Result<(EditId, Reply, Vec<u8>)> {
    ensure!(
        bytes.len() >= 41 && bytes.len() <= RESPONSE_LIMIT && bytes[0] == 1,
        "checkpoint response limit/version"
    );
    let snapshot = EditId(bytes[1..33].try_into().expect("32 bytes"));
    let n = u32::from_le_bytes(bytes[33..37].try_into().expect("4 bytes")) as usize;
    ensure!(
        n <= EVIDENCE_LIMIT && bytes.len() >= 41 + n,
        "checkpoint evidence limit"
    );
    let evidence = Reply::from_wire(&bytes[37..37 + n])?;
    ensure!(
        !evidence.more && evidence.edits.len() <= 64 && evidence.blobs.len() <= 64,
        "checkpoint evidence count"
    );
    let size = u32::from_le_bytes(bytes[37 + n..41 + n].try_into().expect("4 bytes")) as usize;
    ensure!(
        size <= CIPHER_LIMIT && bytes.len() == 41 + n + size,
        "checkpoint ciphertext limit"
    );
    Ok((snapshot, evidence, bytes[41 + n..].to_vec()))
}

impl Node {
    /// Explicit owner approval using the same authenticator ceremony as every other owner action.
    /// Without an authenticator this only returns an approval request: no signed edit or blob pin.
    pub(crate) async fn publish_checkpoint<A: Authenticator>(
        &self,
        op: &Value,
        authenticator: Option<&A>,
    ) -> Result<Value> {
        let entry = op
            .get("entry")
            .and_then(Value::as_str)
            .and_then(EntryId::from_hex);
        let Some(entry) = entry.filter(|_| op.as_object().is_some_and(|o| o.len() == 2)) else {
            return Ok(Refused::BadOp("checkpoint_view requires one entry ID".into()).to_json());
        };
        let prepared = self
            .try_act(move |lab, me| {
                let passkey =
                    engine::passkey_of(lab, me).ok_or(avendb::policy::Refusal::BelowThreshold)?;
                let PreparedEntryProjection {
                    draft,
                    root,
                    sealed,
                } = lab.draft_entry_projection(me, &[passkey], entry)?;
                let keys = lab.keys_of(passkey);
                let approval = Approval {
                    passkey,
                    signers: vec![passkey],
                    drafts: vec![draft],
                    then: Then::Edit,
                };
                Ok::<_, avendb::policy::Refusal>((approval, keys, root, sealed))
            })
            .await?;
        let (approval, keys, root, sealed) = match prepared {
            Ok(prepared) => prepared,
            Err(why) => return Ok(Refused::from(why).to_json()),
        };
        let Some(authenticator) = authenticator else {
            return Ok(approval.to_json());
        };
        let ceremony =
            crate::ceremony_of(authenticator, keys, approval.challenge(), Step::Approve).await?;
        // Bytes must already be available when approval announces the snapshot. Keep a temporary
        // pin across signing; failed approval drops it instead of publishing a durable checkpoint.
        ensure!(
            sealed.len() <= CIPHER_LIMIT
                && root.size == sealed.len() as u64
                && Hash::new(&sealed).as_bytes() == &root.hash,
            "checkpoint content hash"
        );
        let temporary = self
            .shared
            .store
            .add_bytes_with_opts((sealed, BlobFormat::Raw))
            .temp_tag()
            .await?;
        ensure!(
            temporary.hash().as_bytes() == &root.hash,
            "stored checkpoint hash"
        );
        let approved = self
            .try_act(move |lab, me| engine::approve(lab, me, approval, &ceremony))
            .await?;
        let answer = match approved {
            Ok(answer) => answer,
            Err(why) => return Ok(why.to_json()),
        };
        self.shared
            .store
            .tags()
            .set(
                tag(entry),
                HashAndFormat::new(temporary.hash(), BlobFormat::Raw),
            )
            .await?;
        self.shared.changed.notify_one();
        Ok(
            json!({"ok": {"edit": answer["edit"], "entry": entry.to_hex(), "checkpoint": true,
            "root": Hash::from_bytes(root.hash).to_string(), "size": root.size}}),
        )
    }
}

impl Shared {
    async fn store_checkpoint(
        &self,
        entry: EntryId,
        root: FileRoot,
        sealed: Vec<u8>,
    ) -> Result<()> {
        ensure!(
            sealed.len() <= CIPHER_LIMIT
                && root.size == sealed.len() as u64
                && Hash::new(&sealed).as_bytes() == &root.hash,
            "checkpoint content hash"
        );
        let temporary = self
            .store
            .add_bytes_with_opts((sealed, BlobFormat::Raw))
            .temp_tag()
            .await?;
        ensure!(
            temporary.hash().as_bytes() == &root.hash,
            "stored checkpoint hash"
        );
        self.store
            .tags()
            .set(
                tag(entry),
                HashAndFormat::new(temporary.hash(), BlobFormat::Raw),
            )
            .await?;
        Ok(())
    }
}

pub(crate) async fn answer(
    shared: &Arc<Shared>,
    peer: &Peer,
    bytes: &[u8],
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<Vec<u8>> {
    let (entry, known) = request(bytes)?;
    let requester = peer.device;
    let preparing = permit.clone();
    let (revision, offer) = shared
        .read(move |lab, me| {
            let _preparing = preparing;
            (
                lab.log(me).revision(),
                lab.entry_projection_offer_after(me, requester, entry, known),
            )
        })
        .await;
    let Some(offer) = offer else {
        return Ok(vec![1, 0]);
    };
    ensure!(offer.root.size <= CIPHER_LIMIT as u64, "checkpoint size");
    // Read at most the signed length plus one, never get_bytes on a potentially oversized blob.
    let mut reader = shared.store.reader(Hash::from_bytes(offer.root.hash));
    let mut sealed = vec![0; offer.root.size as usize + 1];
    let mut at = 0;
    while at < sealed.len() {
        let n = reader.read(&mut sealed[at..]).await?;
        if n == 0 {
            break;
        }
        at += n;
    }
    ensure!(at == offer.root.size as usize, "checkpoint length mismatch");
    sealed.truncate(at);
    ensure!(
        Hash::new(&sealed).as_bytes() == &offer.root.hash,
        "checkpoint hash mismatch"
    );
    let body = encode(
        offer.snapshot,
        Reply {
            edits: offer.evidence,
            blobs: offer.blobs,
            more: false,
        },
        &sealed,
    )?;
    shared
        .read(move |lab, me| {
            let _permit = permit;
            finish(lab.log(me).revision(), revision, body)
        })
        .await
}
fn finish(current: LogRevision, prepared: LogRevision, body: Vec<u8>) -> Result<Vec<u8>> {
    ensure!(
        current == prepared,
        "checkpoint authorization changed during preparation"
    );
    Ok(body)
}

impl Shared {
    /// One bounded foreground attempt; stale/cancelled demand cannot adopt its result. Legacy peers
    /// refuse this kind and ordinary history scheduling continues unchanged.
    pub(crate) async fn fetch_view_checkpoint(
        self: &Arc<Self>,
        peer: &Peer,
        entry: EntryId,
        scope: &str,
        revision: u64,
        deadline: Instant,
    ) -> Result<bool> {
        ensure!(
            self.discovery_current(scope, revision),
            "checkpoint demand expired"
        );
        let mut body = vec![1];
        body.extend_from_slice(&entry.0);
        if let Some(known) = self
            .read(move |lab, me| lab.retained_projection_hint(me, entry))
            .await
        {
            body.extend_from_slice(&known.0);
        }
        let deadline = deadline.min(Instant::now() + DEADLINE);
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(!remaining.is_zero(), "checkpoint deadline");
        let permit = time::timeout(remaining, self.pulls.page(false, false)).await??;
        let remaining = remaining.min(deadline.saturating_duration_since(Instant::now()));
        let bytes = time::timeout(
            remaining,
            session::exchange(&peer.conn, KIND, &body, RESPONSE_LIMIT),
        )
        .await??;
        ensure!(
            self.discovery_current(scope, revision),
            "checkpoint demand expired"
        );
        if bytes == [1, 0] {
            return Ok(false);
        }
        let (snapshot, evidence, sealed) = decode(&bytes)?;
        drop(bytes); // the transport envelope need not survive verification or cache adoption
        // Auxiliary sealing keys stay on ordinary background sync; they must not delay an
        // already readable view. Signatures use the same prepared receive path as normal pages.
        #[cfg(not(target_arch = "wasm32"))]
        let (prepared, permit, activity, ()) = self
            .prepare_received_page(
                evidence.edits,
                permit,
                (),
                #[cfg(test)]
                None,
            )
            .await?;
        #[cfg(target_arch = "wasm32")]
        let (prepared, permit, activity, ()) = self
            .prepare_received_page(evidence.edits, permit, ())
            .await?;
        // Keep page admission through durable storage too; otherwise slow disk writes from
        // many scopes could accumulate ciphertext after releasing the receive budget.
        let retained_permit = Arc::new(permit);
        let permit = retained_permit.clone();
        let scope = scope.to_owned();
        let shared = self.clone();
        let root = FileRoot {
            hash: *Hash::new(&sealed).as_bytes(),
            size: sealed.len() as u64,
        };
        let (kept, sealed) = self
            .try_lab(move |lab, me| {
                let (_permit, _activity) = (permit, activity);
                if Instant::now() >= deadline || !shared.discovery_current(&scope, revision) {
                    return (false, sealed);
                }
                lab.receive_prepared(me, prepared, true);
                let kept = lab.retain_entry_projection(me, snapshot, entry, sealed.clone());
                (kept, sealed)
            })
            .await?;
        if kept {
            // Verified view readiness is independent of blob persistence. Do not delay reactive
            // rendering behind disk I/O, or lose the notification if persistence reports failure.
            self.size.send_modify(|_| {});
            self.changed.notify_one();
            self.store_checkpoint(entry, root, sealed).await?;
        }
        drop(retained_permit);
        Ok(kept)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{NoBytes, Options};
    use avendb::{
        cast::{document, world},
        sign::{Ceremony, Passkey},
    };
    use n0_future::future;
    use std::sync::Mutex;

    struct Owner(Mutex<Passkey>);
    impl Authenticator for Owner {
        async fn ceremony(&self, challenge: [u8; 32], step: Step) -> Result<Ceremony> {
            assert_eq!(step, Step::Approve);
            Ok(self.0.lock().unwrap().ceremony(challenge))
        }
    }

    struct Declined;
    impl Authenticator for Declined {
        async fn ceremony(&self, _: [u8; 32], _: Step) -> Result<Ceremony> {
            anyhow::bail!("owner declined checkpoint approval")
        }
    }

    #[test]
    fn checkpoint_wire_rejects_truncation_versions_and_unbounded_lengths() {
        let valid = encode(
            EditId([7; 32]),
            Reply {
                edits: vec![],
                blobs: vec![],
                more: false,
            },
            b"sealed",
        )
        .unwrap();
        assert_eq!(decode(&valid).unwrap().2, b"sealed");
        for n in 0..valid.len() {
            assert!(decode(&valid[..n]).is_err());
        }
        let mut bad = valid.clone();
        bad[0] = 2;
        assert!(decode(&bad).is_err());
        let mut bad = valid.clone();
        bad[33..37].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(&bad).is_err());
        let mut bad = valid;
        bad.push(0);
        assert!(decode(&bad).is_err());
        assert!(request(&[1; 34]).is_err());
    }

    #[test]
    fn checkpoint_prepared_response_is_fenced_by_pending_revocation() {
        use avendb::policy::{Action, Revoking};
        let mut w = world();
        let entry = w
            .lab
            .create(
                w.mac_a,
                w.alice,
                w.alice,
                "private",
                &[],
                document("Private", "state", w.mac_a),
            )
            .unwrap();
        let prepared = w
            .lab
            .draft_entry_projection(w.mac_a, &[w.passkey_a], entry)
            .unwrap();
        w.lab.complete(w.mac_a, prepared.draft, &[]).unwrap();
        let offer = w
            .lab
            .entry_projection_offer(w.mac_a, w.phone_a, entry)
            .unwrap();
        let body = encode(
            offer.snapshot,
            Reply {
                edits: offer.evidence,
                blobs: offer.blobs,
                more: false,
            },
            &prepared.sealed,
        )
        .unwrap();
        let before = w.lab.backup(w.mac_a);
        w.lab
            .submit(
                w.mac_a,
                &[w.passkey_a],
                Action::Revoke(Revoking::Device {
                    vault: w.alice,
                    device: w.phone_a,
                    keep: vec![],
                }),
            )
            .unwrap();
        let revoked = w.lab.backup(w.mac_a).signed().to_vec();
        let mut provider = w.lab.split(w.mac_a, &[], [133; 32]);
        provider.restore_from(w.mac_a, before);
        let revision = provider.log(w.mac_a).revision();
        assert!(
            finish(
                provider.log(w.mac_a).revision(),
                revision.clone(),
                body.clone()
            )
            .is_ok()
        );
        provider.receive_whose_now(w.mac_a, revoked, vec![], false);
        assert!(finish(provider.log(w.mac_a).revision(), revision, body).is_err());
        assert!(
            provider
                .entry_projection_offer(w.mac_a, w.phone_a, entry)
                .is_none()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn owner_checkpoint_reaches_a_type_only_view_before_its_history() {
        let mut w = world();
        let (sender, receiver, owner, vault) = (w.mac_a, w.phone_a, w.passkey_a, w.alice);
        let secret = *w.lab.passkey_secret(owner).unwrap();
        let phone_lab = w.lab.split(receiver, &[], [131; 32]);
        let entry = w
            .lab
            .create(
                sender,
                vault,
                vault,
                "checkpoint-note",
                &[],
                document("Before", "initial", sender),
            )
            .unwrap();
        for n in 0..8 {
            w.lab
                .edit(sender, vault, entry, |item| {
                    item.set_text(2, &format!("Latest {n}"))
                })
                .unwrap();
        }
        let expected = w.lab.item(sender, entry).unwrap().record();
        let unrelated = w
            .lab
            .create(
                sender,
                vault,
                vault,
                "unrelated",
                &[],
                document("Other", "history", sender),
            )
            .unwrap();
        let mac = Node::spawn(
            w.lab.split(sender, &[owner], [132; 32]),
            sender,
            Options::local(),
        )
        .await
        .unwrap();
        let phone = Node::spawn(phone_lab, receiver, Options::local())
            .await
            .unwrap();
        let publish = json!({"op":"checkpoint_view", "entry":entry.to_hex()});
        let before = mac.read(|lab, me| lab.log(me).ids().len()).await;
        let asked = mac.op(publish.clone()).await.unwrap();
        assert!(
            asked.get("approve").is_some(),
            "publication requires owner ceremony: {asked}"
        );
        assert_eq!(mac.read(|lab, me| lab.log(me).ids().len()).await, before);
        assert!(
            mac.shared
                .store
                .tags()
                .get(tag(entry))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            mac.run(publish.clone(), None::<NoBytes>, Some(&Declined))
                .await
                .is_err()
        );
        assert_eq!(mac.read(|lab, me| lab.log(me).ids().len()).await, before);
        assert!(
            mac.shared
                .store
                .tags()
                .get(tag(entry))
                .await
                .unwrap()
                .is_none(),
            "declined ceremony pins nothing"
        );
        let auth = Owner(Mutex::new(Passkey::from_seed(secret)));
        let (published, _) = mac
            .run(publish, None::<NoBytes>, Some(&auth))
            .await
            .unwrap();
        assert_eq!(published["ok"]["checkpoint"], true, "{published}");
        let mut stalled = Vec::new();
        loop {
            // Hold every ordinary history pull, including the live lane. Checkpoint transport
            // has its own bounded page admission and must independently establish first view.
            let mut permit = Box::pin(phone.shared.pulls.enter(false, None));
            let Some(permit) = future::poll_once(&mut permit).await else {
                break;
            };
            stalled.push(permit.unwrap());
        }
        assert!(!stalled.is_empty());
        phone.know(mac.addr());
        mac.know(phone.addr());
        phone.shared.connection(mac.id()).await.unwrap();
        let scope = "cd".repeat(16);
        let ack = phone
            .op(
                json!({"op":"demand", "scope":scope,"revision":1,"entries":[],
            "queries":[{"vault":vault.to_hex(), "types":["checkpoint-note"]}]}),
            )
            .await
            .unwrap();
        assert_eq!(ack["ok"]["discovery_supported"], true);
        let query = json!({"op":"query","schema":"stored","where":{"type":["checkpoint-note"]}});
        let result = time::timeout(Duration::from_secs(15), async {
            loop {
                let answer = phone.op(query.clone()).await.unwrap();
                if answer["ok"]["rows"][0]["checkpoint"]["partial"] == true {
                    break answer;
                }
                time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        if result.is_err() {
            eprintln!("last query: {}", phone.op(query).await.unwrap());
            eprintln!(
                "phone state: {:?}",
                phone
                    .read(move |lab, me| (
                        lab.log(me).ids().len(),
                        lab.item(me, entry).is_some(),
                        lab.retained_projection_hint(me, entry)
                    ))
                    .await
            );
        }
        let absent = phone
            .read(move |lab, me| lab.item(me, unrelated).is_none())
            .await;
        drop(stalled);
        phone.shutdown().await.unwrap();
        mac.shutdown().await.unwrap();
        let result = result.expect("scoped owner checkpoint is visible before full history");
        assert_eq!(result["ok"]["rows"][0]["record"], expected);
        assert_eq!(result["ok"]["rows"][0]["readOnly"], true);
        assert!(absent, "unrelated history stays withheld");
    }
}
