//! The Mac's own dialogs, straight from AppKit: the file and folder picker (NSOpenPanel), a yes-or-no question and a
//! notice (NSAlert). Each runs app-modal on the main thread; a command awaits its answer. They replace the dialog
//! plugin, whose few calls here did not need its own crates.

use objc2::MainThreadMarker;
use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSApplication, NSModalResponseOK, NSOpenPanel};
use objc2_foundation::NSString;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tokio::sync::oneshot;

/// How an alert looks: a question before something that can't be taken back, or a failure.
#[derive(Clone, Copy)]
pub enum Kind {
    Warning,
    Error,
}

/// Runs `f` on the main thread with its marker and hands back what it returns; none when the app could not run it.
async fn on_main<R: Runtime, T: Send + 'static>(app: &AppHandle<R>, f: impl FnOnce(MainThreadMarker) -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = oneshot::channel();
    app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = tx.send(f(mtm));
        }
    })
    .ok()?;
    rx.await.ok()
}

/// The picker, for files (or for folders, with `folders`), several at once: what its person picked; none when they
/// cancel.
pub async fn pick<R: Runtime>(app: &AppHandle<R>, folders: bool) -> Vec<PathBuf> {
    on_main(app, move |mtm| {
        NSApplication::sharedApplication(mtm).activate();
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseFiles(!folders);
        panel.setCanChooseDirectories(folders);
        panel.setAllowsMultipleSelection(true);
        if panel.runModal() != NSModalResponseOK {
            return Vec::new();
        }
        panel.URLs().iter().filter_map(|url| url.path()).map(|path| PathBuf::from(path.to_string())).collect()
    })
    .await
    .unwrap_or_default()
}

/// An alert saying `message` (under `title`, when given), with OK, and Cancel when `cancel`: whether its person
/// chose OK.
pub async fn alert<R: Runtime>(app: &AppHandle<R>, title: Option<String>, message: String, kind: Kind, cancel: bool) -> bool {
    on_main(app, move |mtm| {
        let alert = NSAlert::new(mtm);
        match &title {
            Some(title) => {
                alert.setMessageText(&NSString::from_str(title));
                alert.setInformativeText(&NSString::from_str(&message));
            }
            None => alert.setMessageText(&NSString::from_str(&message)),
        }
        alert.setAlertStyle(match kind {
            Kind::Warning => NSAlertStyle::Warning,
            Kind::Error => NSAlertStyle::Critical,
        });
        alert.addButtonWithTitle(&NSString::from_str("OK"));
        if cancel {
            alert.addButtonWithTitle(&NSString::from_str("Cancel"));
        }
        NSApplication::sharedApplication(mtm).activate();
        alert.runModal() == NSAlertFirstButtonReturn
    })
    .await
    .unwrap_or(false)
}

/// A yes-or-no question before something that can't be taken back ($lib/app/sure.js): whether its person said yes.
#[tauri::command]
pub async fn sure(app: AppHandle, message: String) -> bool {
    alert(&app, None, message, Kind::Warning, true).await
}
