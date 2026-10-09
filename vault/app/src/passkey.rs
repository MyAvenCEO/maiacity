//! avenDB's passkey in the app: a sign-in sheet on maia.city. The app's web view may not use maia.city's passkeys
//! (WebKit lets an app's web view use a relying party's passkeys only with an Apple-signed entitlement that ties the
//! app to its domain), so avenDB's page asks for each ceremony here ($lib/avendb/device/passkey.js, `inSheet`):
//! macOS's sign-in sheet (ASWebAuthenticationSession) shows maia.city's own page for it over the studio's window
//! (src/routes/app/avendb/sheet/), which runs it in the passkey prompt as the site does and sends back what it brings,
//! sealed to a key only the asking page holds, to `city.maia.studio://`: the sheet hands that here instead of loading
//! it. Nothing passes through here open, and nothing stays on the Mac. The sheet is ephemeral: it shares no cookies
//! with Safari, and so asks no leave to.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_authentication_services::{
    ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession, ASWebAuthenticationSessionErrorCode,
};
use objc2_foundation::{NSError, NSString, NSURL};
use tokio::sync::oneshot;

/// The page the sheet may show: maia.city's sheet page, whose passkeys these are.
const SHEET: &str = "https://maia.city/app/avendb/sheet/";
/// The scheme the sheet's page sends its answer to, which the sheet hands to the app.
const BACK: &str = "city.maia.studio";

/// What a sheet ends with: the URL its page sent back, or why there is none.
type Answer = Result<String, String>;
/// Where a sheet's answer goes: the command awaiting it, once.
type Reply = Arc<Mutex<Option<oneshot::Sender<Answer>>>>;

thread_local! {
    /// The sheet showing, with what anchors it and what it calls as it ends, kept on the main thread until then: the
    /// session holds its anchor only weakly.
    static SHOWING: RefCell<Option<Showing>> = const { RefCell::new(None) };
}

struct Showing {
    _session: Retained<ASWebAuthenticationSession>,
    _anchor: Retained<Anchor>,
    _done: RcBlock<dyn Fn(*mut NSURL, *mut NSError)>,
}

/// Shows maia.city's sheet page `url`, which names the ceremony in its fragment, in a sign-in sheet over the calling
/// window: the URL the page sent back to `city.maia.studio://`, whose fragment holds the ceremony sealed, or why the
/// sheet ended without one.
#[tauri::command]
pub async fn passkey_sheet(window: tauri::WebviewWindow, url: String) -> Result<String, String> {
    if !url.starts_with(SHEET) || url.len() > 16 * 1024 {
        return Err("the sign-in sheet shows maia.city's passkey page alone".into());
    }
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    let (tx, rx) = oneshot::channel();
    let to: Reply = Arc::new(Mutex::new(Some(tx)));
    let (main, on_main) = (window.clone(), to.clone());
    window
        .run_on_main_thread(move || {
            if let Err(why) = start(&main, ns_window, &url, on_main.clone()) {
                reply(&on_main, Err(why));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "the sign-in sheet went away".to_string())?
}

/// On the main thread: the sheet for `url`, started over the window whose NSWindow is at `ns_window`; its answer goes
/// to `to`.
fn start(window: &tauri::WebviewWindow, ns_window: usize, url: &str, to: Reply) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("the sign-in sheet starts on the main thread")?;
    if SHOWING.with(|s| s.borrow().is_some()) {
        return Err("a sign-in sheet is open already".into());
    }
    // SAFETY: the NSWindow tao made for this window, alive while the window is, which outlives the sheet over it
    let ns = unsafe { Retained::retain(ns_window as *mut NSObject) }.ok_or("the window has no NSWindow")?;
    let anchor = Anchor::new(ns, mtm);
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or("the sheet's page has no URL")?;
    let main = window.clone();
    let done = RcBlock::new(move |back: *mut NSURL, error: *mut NSError| {
        // SAFETY: the session passes a URL or an error, each null or valid for the call
        let answer = match unsafe { (back.as_ref(), error.as_ref()) } {
            (Some(back), _) => back.absoluteString().map(|s| s.to_string()).ok_or_else(|| "the sheet sent back no URL".into()),
            (None, Some(e)) if e.code() == ASWebAuthenticationSessionErrorCode::CanceledLogin.0 => {
                Err("You closed the sign-in sheet.".into())
            }
            (None, Some(e)) => Err(e.localizedDescription().to_string()),
            (None, None) => Err("the sign-in sheet ended with nothing".into()),
        };
        reply(&to, answer);
        // the session is done with what it holds: let go of it, after this call
        let _ = main.run_on_main_thread(|| drop(SHOWING.with(|s| s.borrow_mut().take())));
    });
    // initWithURL:callback: needs macOS 14.4; the app runs from 13
    #[allow(deprecated)]
    // SAFETY: a URL, a scheme and a completion block the sheet copies and calls once
    let session = unsafe {
        ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
            ASWebAuthenticationSession::alloc(),
            &url,
            Some(&NSString::from_str(BACK)),
            RcBlock::as_ptr(&done),
        )
    };
    // SAFETY: set before the session starts, on the main thread; `SHOWING` keeps the anchor alive while it shows
    let started = unsafe {
        session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor)));
        session.setPrefersEphemeralWebBrowserSession(true);
        session.start()
    };
    if !started {
        return Err("the sign-in sheet didn't open".into());
    }
    SHOWING.with(|s| *s.borrow_mut() = Some(Showing { _session: session, _anchor: anchor, _done: done }));
    Ok(())
}

fn reply(to: &Reply, answer: Answer) {
    if let Some(tx) = to.lock().ok().and_then(|mut tx| tx.take()) {
        let _ = tx.send(answer);
    }
}

/// What the sheet shows over: the studio's window.
struct AnchorIvars {
    window: Retained<NSObject>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and `Anchor` has no `Drop` of its own
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "MaiaCityPasskeySheetAnchor"]
    #[ivars = AnchorIvars]
    struct Anchor;

    unsafe impl NSObjectProtocol for Anchor {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for Anchor {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn presentation_anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSObject> {
            self.ivars().window.clone()
        }
    }
);

impl Anchor {
    fn new(window: Retained<NSObject>, mtm: MainThreadMarker) -> Retained<Anchor> {
        let this = Anchor::alloc(mtm).set_ivars(AnchorIvars { window });
        // SAFETY: NSObject's own init
        unsafe { msg_send![super(this), init] }
    }
}
