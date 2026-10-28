//! AVFoundation reading a file in place from a byte source — the vault's blob store, by hash — with no copy, no
//! export, no link into the store's own files. The asset's URL is `vaultblob://<name>`, a scheme AVFoundation cannot
//! open itself, so it asks the asset's resource loader; our delegate answers: what the bytes are (their UTI, told by
//! the name's extension), how many, that any range can be read — and then each range AVFoundation asks for, read from
//! the source in chunks, while the request is not cancelled.
//!
//! The loader holds its delegate weakly: the delegate is tied to the asset (an associated object) and lives as long
//! as it does. Delegate calls arrive on the asset's own serial queue and are served on a concurrent one, so a
//! long read never keeps a cancellation, or a second request, waiting.

use std::{ffi::c_void, sync::Arc};

use anyhow::Result;
use dispatch2::{DispatchQoS, DispatchQueue, DispatchRetained, GlobalQueueIdentifier};
use objc2::{
    AnyThread, DefinedClass, Message, define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject},
};
use objc2_av_foundation::{AVAssetResourceLoader, AVAssetResourceLoaderDelegate, AVAssetResourceLoadingRequest, AVURLAsset};
use objc2_foundation::{NSData, NSError, NSString, NSURL};

use crate::source::ByteSource;

/// How much is read and handed over at a time.
const CHUNK: u64 = 4 << 20;

/// The URL scheme of a byte source's asset.
pub const SCHEME: &str = "vaultblob";

/// The Uniform Type Identifier AVFoundation reads bytes as, by their extension.
pub fn uti_for(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mov" | "qt" => "com.apple.quicktime-movie",
        "mp4" => "public.mpeg-4",
        "m4v" => "com.apple.m4v-video",
        "m4a" => "com.apple.m4a-audio",
        "m4b" => "com.apple.protected-mpeg-4-audio",
        "mp3" => "public.mp3",
        "wav" | "wave" => "com.microsoft.waveform-audio",
        "aif" | "aiff" => "public.aiff-audio",
        "aifc" => "public.aifc-audio",
        "caf" => "com.apple.coreaudio-format",
        "aac" => "public.aac-audio",
        "3gp" => "public.3gpp",
        "3g2" => "public.3gpp2",
        "mpg" | "mpeg" => "public.mpeg",
        "ts" | "mts" | "m2ts" => "public.mpeg-2-transport-stream",
        // an ISO media file of a kind not named: QuickTime's reader is the widest
        _ => "com.apple.quicktime-movie",
    }
}

struct Shared {
    bytes: Arc<dyn ByteSource>,
    uti: String,
}

pub struct Ivars {
    shared: Arc<Shared>,
    /// the queue the loader calls us on (kept alive with us)
    _calls: DispatchRetained<DispatchQueue>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; BlobLoader does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "VaultMediaBlobLoader"]
    #[ivars = Ivars]
    struct BlobLoader;

    unsafe impl NSObjectProtocol for BlobLoader {}

    unsafe impl AVAssetResourceLoaderDelegate for BlobLoader {
        #[unsafe(method(resourceLoader:shouldWaitForLoadingOfRequestedResource:))]
        fn should_wait(&self, _loader: &AVAssetResourceLoader, request: &AVAssetResourceLoadingRequest) -> bool {
            let job = Job { shared: self.ivars().shared.clone(), request: request.retain() };
            DispatchQueue::global_queue(GlobalQueueIdentifier::QualityOfService(DispatchQoS::UserInitiated)).exec_async(move || job.serve());
            true
        }

        #[unsafe(method(resourceLoader:didCancelLoadingRequest:))]
        fn did_cancel(&self, _loader: &AVAssetResourceLoader, _request: &AVAssetResourceLoadingRequest) {
            // the request says so itself (`isCancelled`), and its serving stops at the next chunk
        }
    }
);

/// One loading request, served off the loader's queue.
struct Job {
    shared: Arc<Shared>,
    request: Retained<AVAssetResourceLoadingRequest>,
}

// SAFETY: a loading request is answered from any thread (it is made for answers arriving from the network); the
// source is Send + Sync.
unsafe impl Send for Job {}

impl Job {
    fn serve(self) {
        let Job { shared, request } = self;
        let len = shared.bytes.len();
        // SAFETY: AVFoundation's loading-request API, used as documented; the request is retained until we finish it.
        unsafe {
            if request.isCancelled() || request.isFinished() {
                return;
            }
            if let Some(info) = request.contentInformationRequest() {
                info.setContentType(Some(&NSString::from_str(&shared.uti)));
                info.setContentLength(len as i64);
                info.setByteRangeAccessSupported(true);
                info.setEntireLengthAvailableOnDemand(true);
            }
            if let Some(data) = request.dataRequest() {
                let mut at = (data.currentOffset().max(0) as u64).min(len);
                let end = if data.requestsAllDataToEndOfResource() {
                    len
                } else {
                    (data.requestedOffset().max(0) as u64).saturating_add(data.requestedLength().max(0) as u64).min(len)
                };
                while at < end {
                    if request.isCancelled() {
                        return;
                    }
                    let n = CHUNK.min(end - at) as usize;
                    let mut buf = vec![0u8; n];
                    if let Err(e) = shared.bytes.read_exact_at(at, &mut buf) {
                        let err = NSError::errorWithDomain_code_userInfo(&NSString::from_str(SCHEME), e.raw_os_error().unwrap_or(-1) as isize, None);
                        request.finishLoadingWithError(Some(&err));
                        return;
                    }
                    data.respondWithData(&NSData::from_vec(buf));
                    at += n as u64;
                }
            }
            if !request.isCancelled() {
                request.finishLoading();
            }
        }
    }
}

static DELEGATE_KEY: u8 = 0;

/// An AVFoundation asset reading `bytes` in place, by range. `name` names it ("<hash>.mov"): its extension tells
/// AVFoundation what the bytes are.
pub fn blob_asset(bytes: Arc<dyn ByteSource>, name: &str) -> Result<Retained<AVURLAsset>> {
    let ext = std::path::Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("");
    let shared = Arc::new(Shared { bytes, uti: uti_for(ext).to_string() });
    let calls = DispatchQueue::new("city.maia.vault-media.blob-loader", None);
    let enc: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c.to_string() } else { format!("%{:02X}", c as u32 & 0xff) }).collect();
    let url = NSURL::URLWithString(&NSString::from_str(&format!("{SCHEME}://{enc}"))).ok_or_else(|| anyhow::anyhow!("no URL for {name}"))?;
    let delegate = BlobLoader::alloc().set_ivars(Ivars { shared, _calls: calls.clone() });
    // SAFETY: NSObject's init on our freshly allocated subclass.
    let delegate: Retained<BlobLoader> = unsafe { msg_send![super(delegate), init] };
    // SAFETY: the asset is ours; the delegate outlives it (associated, retained); its queue is serial and ours.
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        asset.resourceLoader().setDelegate_queue(Some(ProtocolObject::from_ref(&*delegate)), Some(&calls));
        objc2::ffi::objc_setAssociatedObject(
            Retained::as_ptr(&asset) as *mut AnyObject,
            &DELEGATE_KEY as *const u8 as *const c_void,
            Retained::as_ptr(&delegate) as *mut AnyObject,
            objc2::ffi::OBJC_ASSOCIATION_RETAIN,
        );
        Ok(asset)
    }
}
