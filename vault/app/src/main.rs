//! maiaCITY Studio — the Mac app. Every admin and studio function that touches media runs here, natively; the
//! browser build never carries them. The window shows the studio's pages; this side runs avenDB's device (avendb.rs),
//! the studio's jobs on avenDB's files (aven.rs, jobs.rs), the player, the render and the world window.

mod analyse;
mod auth;
mod aven;
mod avendb;
mod blob;
mod enclave;
mod files;
mod jobs;
mod models;
mod page;
mod passkey;
mod player;
mod proxies;
mod render;
#[cfg(target_os = "macos")]
mod revive;
mod transcripts;
mod world;

use std::path::PathBuf;

use tauri::Manager;

type Res<T> = Result<T, String>;

/// The admin gate: nothing in the studio answers until this Mac is signed in with the admin's passkey.
fn gate() -> Res<()> {
    if auth::signed_in() { Ok(()) } else { Err("Sign in with your passkey first.".into()) }
}

/// An error as the page shows it, its causes after it: the player's, the render's and the world's commands answer so.
fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

/// The web view's warnings and errors (the studio's, the world frame's), into the app's log — its console is not
/// open to anyone.
#[tauri::command]
fn log_js(level: String, from: String, message: String) {
    if level == "error" {
        tracing::error!(target: "webview", "{from}: {message}");
    } else {
        tracing::warn!(target: "webview", "{from}: {message}");
    }
}

/// The app's own settings, beside which it keeps the speech models (models.rs) and its avenDB folder's old place.
pub(crate) fn settings_file() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/settings.json")
}

/// Runs harness `args[0]`'s agent device beside the app's avenDB folder (or `--dir <folder>`), as an MCP server on its
/// stdin and stdout, logging on its stderr (`avendb_device::agent`). What the process exits with.
fn agent(args: &[String]) -> i32 {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into()))
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let (harness, dir) = match args {
        [harness] => (harness.clone(), avendb::folder()),
        [harness, flag, dir] if flag == "--dir" => (harness.clone(), PathBuf::from(dir)),
        _ => {
            eprintln!("usage: maiacity-studio agent <harness> [--dir <folder>]");
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().thread_stack_size(8 << 20).build() {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    match runtime.block_on(avendb_device::agent::serve(dir, harness, tokio::io::stdin(), tokio::io::stdout())) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e:#}");
            1
        }
    }
}

fn main() {
    // the TLS of whatever names none: aws-lc-rs; avenDB's node names its own, post-quantum only
    rustls::crypto::aws_lc_rs::default_provider().install_default().expect("no TLS provider before the app's");
    // `agent <harness> [--dir <folder>]`: a harness's agent device, the command avenDB's device names for it
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "agent") {
        std::process::exit(agent(&args[1..]));
    }
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into())).init();

    let app = tauri::Builder::default();
    // a page whose web process died opens again, never left white (revive.rs)
    #[cfg(target_os = "macos")]
    let app = app.on_page_load(revive::loaded).on_web_content_process_terminate(revive::died);
    app.plugin(tauri_plugin_dialog::init())
        .manage(auth::Auth::default())
        .manage(avendb::Avendb::default())
        .setup(|app| {
            aven::init(app.handle());
            // every process this Mac runs, in one registry (jobs.rs): the studio's Processes tab is its view
            jobs::init(app.handle().clone());
            Ok(())
        })
        // the studio's window closed: the unseen world window goes with it, so the app quits as it always did
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                world::close_window(window.app_handle());
            }
        })
        .register_asynchronous_uri_scheme_protocol("aven", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move { responder.respond(aven::serve(app, request).await) });
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_sign_out,
            auth::api,
            passkey::passkey_sheet,
            avendb::avendb,
            enclave::avendb_touch_ready,
            aven::studio_ingest,
            aven::studio_job,
            page::page_answer,
            log_js,
            jobs::jobs_list,
            jobs::jobs_cancel,
            jobs::jobs_bump,
            jobs::jobs_retry,
            proxies::color_lut,
            proxies::color_grade,
            proxies::studio_sound,
            proxies::color_frame,
            player::player_load,
            player::player_play,
            player::player_pause,
            player::player_sync,
            player::player_drawn,
            render::sound_measure,
            render::eq_response,
            world::world_proxy_next,
            world::world_proxy_frame,
            world::world_proxy_end
        ])
        .build(tauri::generate_context!())
        .expect("start maiaCITY Studio")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                // avenDB's device, which closes its own store
                tauri::async_runtime::block_on(avendb::stop(&handle.state::<avendb::Avendb>()));
            }
        });
}
