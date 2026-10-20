//! A page whose web process died opens again, never left white. WebKit's GPU or web content process can crash when
//! the Mac runs short of memory (2026-10-20 14:37, while another WebKit ran a speed test beside the app); Tauri's own
//! answer is to ask WebKit to reload, and WebKit refuses when the page has no current item ("launchProcessForReload:
//! no current item to reload"), so the window stayed white until the app was quit. Here the webview opens its page
//! again by its address, which starts a new web process. If it dies again within half a minute, the webview opens the
//! first page it loaded instead, and after three deaths in a row it is left as it is, so a page that kills WebKit as
//! it loads can't loop.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use tauri::{
    Url, Webview,
    webview::{PageLoadEvent, PageLoadPayload},
};

/// Deaths closer together than this are one run.
const RUN: Duration = Duration::from_secs(30);
/// Deaths in a run after which the webview is left as it is.
const GIVE_UP: u32 = 3;
/// How long WebKit is given to let go of the dead process before the page opens again.
const SETTLE: Duration = Duration::from_millis(500);

#[derive(Default)]
struct Seen {
    /// each webview's first page, by its label
    first: HashMap<String, Url>,
    /// each webview's last death and how many came in that run
    died: HashMap<String, (Instant, u32)>,
}

static SEEN: LazyLock<Mutex<Seen>> = LazyLock::new(Default::default);

/// A page a webview finished loading: the first is the one it falls back to.
pub fn loaded(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Finished && payload.url().scheme() != "about" {
        SEEN.lock().unwrap().first.entry(webview.label().to_string()).or_insert_with(|| payload.url().clone());
    }
}

/// A webview whose web process died (WebKit's delegate, on the main thread): its page opens again from another
/// thread, once WebKit has let go of the old process.
pub fn died(webview: &Webview) {
    let label = webview.label().to_string();
    let now = Instant::now();
    let (run, first) = {
        let mut seen = SEEN.lock().unwrap();
        let run = match seen.died.get(&label) {
            Some((at, n)) if now.duration_since(*at) < RUN => n + 1,
            _ => 1,
        };
        seen.died.insert(label.clone(), (now, run));
        (run, seen.first.get(&label).cloned())
    };
    if run > GIVE_UP {
        return tracing::error!(target: "webview", "{label}: its web process died {run} times in a row, left as it is");
    }
    let webview = webview.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        let at = webview.url().ok().filter(|u| u.scheme() != "about");
        let url = if run == 1 { at.or(first) } else { first.or(at) };
        tracing::warn!(target: "webview", "{label}: its web process died, opening {} again", url.as_ref().map_or("its page", |u| u.as_str()));
        let opened = match url {
            Some(url) => webview.navigate(url),
            None => webview.reload(),
        };
        if let Err(e) = opened {
            tracing::error!(target: "webview", "{label}: the page didn't open again: {e}");
        }
    });
}
