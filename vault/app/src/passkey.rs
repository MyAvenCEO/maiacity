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
    reply: Reply,
    _session: Retained<ASWebAuthenticationSession>,
    _anchor: Retained<Anchor>,
    _done: RcBlock<dyn Fn(*mut NSURL, *mut NSError)>,
}

/// Shows maia.city's sheet page `url`, which names the ceremony in its fragment, in a sign-in sheet over the calling
/// window: the URL the page sent back to `city.maia.studio://`, whose fragment holds the ceremony sealed, or why the
/// sheet ended without one.
#[tauri::command]
pub async fn passkey_sheet(window: tauri::WebviewWindow, url: String) -> Result<String, String> {
    sheet(&window, url).await
}

/// Dropping an async ceremony is cancellation too, including task abort and
/// caller/window teardown before the timeout future can finish.
struct OnAbandon<F: FnOnce()>(Option<F>);
impl<F: FnOnce()> OnAbandon<F> {
    fn disarm(&mut self) { self.0 = None; }
}
impl<F: FnOnce()> Drop for OnAbandon<F> {
    fn drop(&mut self) {
        if let Some(cancel) = self.0.take() { cancel(); }
    }
}

fn cancel_request(window: &tauri::WebviewWindow, request: &Reply) {
    reply(request, Err("The sign-in request ended. Please try again.".into()));
    let request = request.clone();
    let _ = window.run_on_main_thread(move || {
        if let Some(showing) = take_showing(&request) {
            // SAFETY: remove only this session before cancelling on the main
            // thread; cancel may synchronously invoke its completion callback.
            unsafe { showing._session.cancel(); }
        }
    });
}

/// The sheet for `url` over `window`, for the page (`passkey_sheet`) or for avenDB's native device (avendb.rs), which
/// asks for its ceremonies itself and opens what comes back with a key of its own.
pub async fn sheet(window: &tauri::WebviewWindow, url: String) -> Result<String, String> {
    if !url.starts_with(SHEET) || url.len() > 16 * 1024 {
        return Err("the sign-in sheet shows maia.city's passkey page alone".into());
    }
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    let (tx, rx) = oneshot::channel();
    let to: Reply = Arc::new(Mutex::new(Some(tx)));
    let mut abandoned = OnAbandon(Some(|| cancel_request(window, &to)));
    let (main, on_main) = (window.clone(), to.clone());
    window
        .run_on_main_thread(move || {
            if let Err(why) = start(&main, ns_window, &url, on_main.clone()) {
                reply(&on_main, Err(why));
            }
        })
        .map_err(|e| e.to_string())?;
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(answer)) => {
            abandoned.disarm(); // the OS completed normally, including denial
            answer
        }
        Ok(Err(_)) => Err("the sign-in sheet went away".into()),
        Err(_) => Err("The sign-in request timed out. Please try again.".into()),
    }
    // All other exits (including dropped future) run identity-bound cleanup.
}

/// A late completion/timeout owns only its original session.
fn take_showing(request: &Reply) -> Option<Showing> {
    SHOWING.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_ref().is_some_and(|shown| Arc::ptr_eq(&shown.reply, request)) {
            slot.take()
        } else {
            None
        }
    })
}

/// On the main thread: the sheet for `url`, started over the window whose NSWindow is at `ns_window`; its answer goes
/// to `to`.
fn start(window: &tauri::WebviewWindow, ns_window: usize, url: &str, to: Reply) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("the sign-in sheet starts on the main thread")?;
    if to.lock().map_err(|_| "the sign-in request failed")?.is_none() {
        return Err("the sign-in request already ended".into());
    }
    if SHOWING.with(|s| s.borrow().is_some()) {
        return Err("a sign-in sheet is open already".into());
    }
    // SAFETY: the NSWindow tao made for this window, alive while the window is, which outlives the sheet over it
    let ns = unsafe { Retained::retain(ns_window as *mut NSObject) }.ok_or("the window has no NSWindow")?;
    let anchor = Anchor::new(ns, mtm);
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or("the sheet's page has no URL")?;
    let main = window.clone();
    let completion = to.clone();
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
        reply(&completion, answer);
        // A delayed callback cannot release a newer sheet.
        let completed = completion.clone();
        let _ = main.run_on_main_thread(move || drop(take_showing(&completed)));
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
    // SAFETY: configured on the main thread before starting.
    unsafe {
        session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor)));
        session.setPrefersEphemeralWebBrowserSession(true);
    }
    // Install ownership before start, including a synchronous completion.
    SHOWING.with(|s| *s.borrow_mut() = Some(Showing {
        reply: to.clone(), _session: session.clone(), _anchor: anchor, _done: done,
    }));
    // SAFETY: configured session, retained above, on the main thread.
    if !unsafe { session.start() } {
        drop(take_showing(&to));
        return Err("the sign-in sheet didn't open".into());
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropping_pending_ceremony_retires_only_its_request() {
        use std::future::Future;
        use std::task::{Context, Poll, Wake, Waker};
        struct Noop;
        impl Wake for Noop { fn wake(self: Arc<Self>) {} }
        let (tx, mut rx) = oneshot::channel();
        let request: Reply = Arc::new(Mutex::new(Some(tx)));
        let (new_tx, mut new_rx) = oneshot::channel();
        let replacement: Reply = Arc::new(Mutex::new(Some(new_tx)));
        let mut future = Box::pin(async {
            let _guard = OnAbandon(Some(|| reply(&request, Err("abandoned".into()))));
            std::future::pending::<()>().await;
        });
        let waker = Waker::from(Arc::new(Noop));
        assert!(matches!(future.as_mut().poll(&mut Context::from_waker(&waker)), Poll::Pending));
        drop(future);
        reply(&request, Ok("late approval".into()));
        assert_eq!(rx.try_recv().unwrap(), Err("abandoned".into()));
        assert!(new_rx.try_recv().is_err());
        reply(&replacement, Ok("replacement".into()));
        assert_eq!(new_rx.try_recv().unwrap(), Ok("replacement".into()));
    }

    #[test]
    fn normal_completion_disarms_abandonment() {
        let mut cancelled = false;
        {
            let mut guard = OnAbandon(Some(|| cancelled = true));
            guard.disarm();
        }
        assert!(!cancelled);
    }

    #[test]
    fn timed_out_ceremony_rejects_late_approval() {
        let (tx, mut rx) = oneshot::channel();
        let request: Reply = Arc::new(Mutex::new(Some(tx)));
        reply(&request, Err("timed out".into()));
        reply(&request, Ok("late approval".into()));
        assert_eq!(rx.try_recv().unwrap(), Err("timed out".into()));
        assert!(request.lock().unwrap().is_none());
    }

    #[test]
    fn replacement_ceremony_has_independent_ownership() {
        let (old_tx, _old_rx) = oneshot::channel();
        let (new_tx, mut new_rx) = oneshot::channel();
        let old: Reply = Arc::new(Mutex::new(Some(old_tx)));
        let new: Reply = Arc::new(Mutex::new(Some(new_tx)));
        assert!(!Arc::ptr_eq(&old, &new));
        reply(&old, Err("timed out".into()));
        assert!(new_rx.try_recv().is_err());
        reply(&new, Ok("new approval".into()));
        assert_eq!(new_rx.try_recv().unwrap(), Ok("new approval".into()));
    }
}
