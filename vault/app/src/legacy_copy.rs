//! The legacy media vault copied into avenDB (Studio 2), once, so the legacy vault can be let go: every file its
//! catalog lists (footage, voice takes, stills, proxies, the journal's published media, the films' files, the speech
//! models), its bytes read in place from its store and put into the Maia City COOP vault as a file entry by the Mac's
//! own device acting for Maia City (`aven::put_source`: read twice, sealed, read back, its BLAKE3 compared with the
//! legacy hash before it counts). It copies, never moves: the legacy vault is left as it is.
//!
//! Each file entry is tagged `legacy:<hash>`, the name the film scripts find a file by (scripts/film/vault.mjs), and
//! what it is to the studio:
//!   `media:original`   footage, voice takes, pictures (an original the rules probe, proxy and hear: jobs/rules.js);
//!                      its legacy transcript and analysis beside it as `<stem>.transcript.json` and
//!                      `<stem>.analysis.json`, tagged `media:<rule>` and `legacy:<hash>`, which the rules take as they
//!                      are (jobs/executors.js `legacyValue`), as aven.rs `studio_import` puts them;
//!   `media:delivery`   a film rendered before;
//!   `media:derived`    what the legacy studio made of another file (a proxy, an audio proxy, a grading still), kept
//!                      for its bytes, never an original the rules work on again;
//!   `media:model`      a pinned speech model file (models.rs keeps them in Application Support too);
//!   `legacy:public`    a file the legacy vault published (the journal's pictures, voice and films): Public by one share
//!                      of Maia City on this tag, made before the first of them, so avenDB's server serves it to
//!                      everyone at `/feed/legacy/<hash>` (avendb-server's feed; src/lib/media/url.ts).
//! Its legacy tags without a `:` come along (a day's "Day 01"); everything else known about it (title, description,
//! tags, meta: a hand-set colour profile, a voice take's words, …) goes into its "about", the JSON file entry beside it
//! tagged `about:<entry>` (vault.mjs). A colour profile set by hand in the legacy studio is written into the copied
//! original's probe once the probe is done (`settle`, as src/lib/studio/cuts.js `setProfile` does by hand).
//!
//! It runs by itself once per generation of avenDB's shelf on this Mac (`avendb::generation`) and Maia City vault,
//! once avenDB's device is open here and reaches Maia City; again by hand (`legacy_copy`). Idempotent: a file a live
//! entry of Maia City already carries `legacy:<hash>` for is not copied again (a published one only where that entry
//! is public). Resumable: a run the app quit in goes on where it was at the next start. Throttled: one file at a time
//! in the disk's lane of the Mac's jobs (jobs.rs), letting each job that waits for that lane go first, a pause between
//! files. The Jobs list shows it as one job (`keep:legacy-copy`); each run ends with a line in the app's log. What each
//! run found is kept beside the app's settings (`legacy-copy.json`).

use std::collections::{BTreeMap, HashMap};
use std::io::{self, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager as _};
use tokio::io::{AsyncReadExt as _, AsyncSeekExt as _};
use vault_core::{Meta, Vault};
use vault_media::{ByteSource, Source};

use crate::jobs::{self, Kind, Lane};

/// The job's subject in the Mac's jobs: one at a time.
const SUBJECT: &str = "legacy-copy";
/// The tag before a file's legacy hash.
const MARK: &str = "legacy:";
/// The tag of a file the legacy vault published, which one Public share of Maia City reaches.
const PUBLIC: &str = "legacy:public";
/// The tag that marks an entry deleted in avenDB (aven.rs `DELETED`).
const DELETED: &str = "avendb:deleted";
/// The pause between two files.
const PAUSE: Duration = Duration::from_millis(400);
/// How often it looks whether a copy is due.
const EVERY: Duration = Duration::from_secs(60);
/// How long after a run that left files behind (missing bytes, a refusal) it tries again by itself.
const AGAIN: Duration = Duration::from_secs(30 * 60);
/// How many failures in a row end a run: the device may not create in Maia City (yet).
const MOST_FAILED: usize = 5;
/// How many bytes a read of the legacy store takes at a time.
const WINDOW: u64 = 4 << 20;
/// How many files it copies before it reads avenDB's world again (what the page brought meanwhile).
const FRESH_EVERY: usize = 50;

/// A run going now.
static RUNNING: AtomicBool = AtomicBool::new(false);

/// Maia City as this device reaches it: its vault and who acts there.
#[derive(Clone, Debug)]
struct City {
    vault: String,
    as_: String,
}

/// What became of one run.
#[derive(Default, serde::Serialize)]
struct Summary {
    total: usize,
    copied: usize,
    skipped: usize,
    /// files whose bytes this Mac's legacy store doesn't hold whole
    missing: Vec<String>,
    /// files that didn't come, and why
    failed: Vec<(String, String)>,
    /// copied originals whose hand-set colour profile waits for their probe: entry → profile
    profiles: BTreeMap<String, String>,
    /// why the run stopped early, if it did
    stopped: Option<String>,
}

/// Starts the watch: every minute, a copy where one is due (`due`), and the colour profiles still waiting written.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            if let Err(e) = tick(&app).await {
                tracing::debug!("legacy copy: {e}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Copies the legacy vault into Maia City again now, in the background (the Jobs list shows it), whether a run this
/// generation ended or not: started, or why not.
#[tauri::command]
pub async fn legacy_copy(app: AppHandle) -> Result<Value, String> {
    let world = crate::aven::world(&app).await?;
    let city = city_of(&world).ok_or("this device doesn't reach the Maia City vault (yet)")?;
    if RUNNING.load(Ordering::SeqCst) {
        return Err("the copy out of the legacy vault is running already".into());
    }
    let key = key_of(&city).ok_or("avenDB has no shelf on this Mac yet")?;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(&app, &city, &key).await {
            tracing::warn!("legacy copy: {e}");
        }
    });
    Ok(json!({ "started": true, "vault": city_vault(&world) }))
}

/// One look: a copy where one is due, else the colour profiles still waiting for their probes.
async fn tick(app: &AppHandle) -> Result<(), String> {
    if RUNNING.load(Ordering::SeqCst) || !crate::avendb::running(app).await {
        return Ok(());
    }
    let world = crate::aven::world(app).await?;
    let city = city_of(&world).ok_or("no Maia City here yet")?;
    let key = key_of(&city).ok_or("no shelf yet")?;
    let kept = load();
    let at = &kept[&key];
    let tried_long_ago = at["tried"].as_str().and_then(seconds_ago).is_none_or(|s| s >= AGAIN.as_secs());
    if at["done"].is_null() && tried_long_ago {
        return run(app, &city, &key).await.map(|_| ());
    }
    let waiting: BTreeMap<String, String> = serde_json::from_value(at["profiles"].clone()).unwrap_or_default();
    if !waiting.is_empty() {
        let left = settle(app, &city, &world, waiting).await;
        save(&key, |r| r["profiles"] = json!(left));
    }
    Ok(())
}

/// The key of this generation of avenDB's shelf and Maia City vault, what a run is kept under.
fn key_of(city: &City) -> Option<String> {
    Some(format!("g{}:{}", crate::avendb::generation()?, city.vault))
}

/// The Maia City COOP vault in world `world`, as this device reaches it, and who acts there (src/lib/studio/
/// legacyfilms.js `cityOf`); a coop of that name before any other.
fn city_of(world: &Value) -> Option<City> {
    let vaults = world["vaults"].as_array()?;
    let named = |v: &&Value| {
        v["kind"] != "device" && v["acting"]["reaches"] == true && v["name"].as_str().is_some_and(|n| n.to_lowercase().contains("maia city"))
    };
    let v = vaults.iter().filter(named).find(|v| v["kind"] == "coop").or_else(|| vaults.iter().find(named))?;
    let vault = v["id"].as_str()?.to_string();
    let as_ = v["acting"]["as"].as_str().unwrap_or(&vault).to_string();
    Some(City { vault, as_ })
}

fn city_vault(world: &Value) -> Option<String> {
    city_of(world).map(|c| c.vault)
}

/// Where the runs are kept: beside the app's settings.
fn kept_file() -> PathBuf {
    crate::settings_file().with_file_name("legacy-copy.json")
}

fn load() -> Value {
    std::fs::read(kept_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

/// Changes what is kept under `key` by `f`, written at once.
fn save(key: &str, f: impl FnOnce(&mut Value)) {
    let mut all = load();
    if !all[key].is_object() {
        all[key] = json!({});
    }
    f(&mut all[key]);
    let path = kept_file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    let part = path.with_extension("json.part");
    if std::fs::write(&part, serde_json::to_vec_pretty(&all).unwrap_or_default()).is_ok() {
        std::fs::rename(&part, &path).ok();
    }
}

/// How many seconds ago time `iso` (as `ingest::now_iso` writes it) was, if it reads.
fn seconds_ago(iso: &str) -> Option<u64> {
    let then = chrono_secs(iso)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(now.saturating_sub(then))
}

/// Seconds since 1970 of `YYYY-MM-DDTHH:MM:SS…Z`.
fn chrono_secs(iso: &str) -> Option<u64> {
    let n = |r: std::ops::Range<usize>| iso.get(r)?.parse::<i64>().ok();
    let (y, m, d, hh, mm, ss) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    // days from civil (Howard Hinnant)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss).ok()
}

/// The legacy vault, as the app opened it.
fn legacy(app: &AppHandle) -> Arc<Vault> {
    app.state::<crate::App>().vault.clone()
}

/// One run: the models kept, the Public share made where a published file needs it, then every file of the legacy
/// catalog that Maia City lacks copied, one at a time; the colour profiles written that can be. Kept under `key`.
async fn run(app: &AppHandle, city: &City, key: &str) -> Result<Summary, String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("a copy is running already".into());
    }
    struct Done;
    impl Drop for Done {
        fn drop(&mut self) {
            RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _done = Done;
    jobs::queue(Kind::Keep, SUBJECT, "The legacy vault, copied into avenDB");
    let mut turn = match jobs::turn(Kind::Keep, SUBJECT).await {
        Ok(t) => Some(t),
        Err(_) => return Err("cancelled".into()),
    };
    let ran = copy(app, city, &mut turn).await;
    drop(turn);
    let summary = match ran {
        Ok(s) => s,
        Err(e) => {
            jobs::end(Kind::Keep, SUBJECT, Err(e.clone()));
            save(key, |r| r["tried"] = json!(vault_core::ingest::now_iso()));
            return Err(e);
        }
    };
    let whole = summary.missing.is_empty() && summary.failed.is_empty() && summary.stopped.is_none();
    let line = format!(
        "legacy copy into {}: {} files, {} copied, {} there already, {} missing here, {} failed{}",
        city.vault,
        summary.total,
        summary.copied,
        summary.skipped,
        summary.missing.len(),
        summary.failed.len(),
        summary.stopped.as_deref().map(|s| format!(", stopped: {s}")).unwrap_or_default()
    );
    // the app logs warnings and up by default: a run's line must show
    tracing::warn!("{line}");
    let now = vault_core::ingest::now_iso();
    let mut profiles: BTreeMap<String, String> = serde_json::from_value(load()[key]["profiles"].clone()).unwrap_or_default();
    profiles.extend(summary.profiles.clone());
    let profiles = match crate::aven::world(app).await {
        Ok(world) => settle(app, city, &world, profiles).await,
        Err(_) => profiles,
    };
    save(key, |r| {
        r["tried"] = json!(now);
        r["done"] = if whole { json!(now) } else { Value::Null };
        r["total"] = json!(summary.total);
        r["copied"] = json!(r["copied"].as_u64().unwrap_or(0) + summary.copied as u64);
        r["missing"] = json!(summary.missing);
        r["failed"] = json!(summary.failed);
        r["stopped"] = json!(summary.stopped);
        r["profiles"] = json!(profiles);
    });
    jobs::end(Kind::Keep, SUBJECT, if whole { Ok(()) } else { Err(line) });
    Ok(summary)
}

/// The live file entries of Maia City that carry a legacy hash, by it: each one's tags. A sidecar (a transcript or
/// an analysis put beside an original) is none of them.
fn held_of(world: &Value, city: &City) -> HashMap<String, Vec<Vec<String>>> {
    let mut held: HashMap<String, Vec<Vec<String>>> = HashMap::new();
    for e in world["entries"].as_array().into_iter().flatten() {
        if e["vault"] != city.vault.as_str() || e["type"] != "file" || e["deleted"] == true {
            continue;
        }
        let tags: Vec<String> = e["tags"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(String::from)).collect();
        if tags.iter().any(|t| t == DELETED || t == "media:transcript" || t == "media:analysis") {
            continue;
        }
        if let Some(h) = tags.iter().find_map(|t| t.strip_prefix(MARK).filter(|h| h.len() == 64)) {
            held.entry(h.to_string()).or_default().push(tags.clone());
        }
    }
    held
}

/// Whether Maia City holds legacy file `m` already: a live entry tagged with its hash, a public one where it was
/// published.
fn holds(held: &HashMap<String, Vec<Vec<String>>>, m: &Meta) -> bool {
    held.get(&m.hash).is_some_and(|all| all.iter().any(|tags| !m.public || tags.iter().any(|t| t == PUBLIC)))
}

/// The copy itself: what became of each file. `turn` is its turn on the disk's lane, let go to any job that waits for
/// that lane and taken again after it.
async fn copy(app: &AppHandle, city: &City, turn: &mut Option<jobs::Turn>) -> Result<Summary, String> {
    let vault = legacy(app);
    jobs::stage(Kind::Keep, SUBJECT, "keeping the speech models", 0.0);
    if let Err(e) = crate::models::keep_all(&vault).await {
        tracing::warn!("legacy copy: the speech models: {e}");
    }
    let mut list = vault.catalog.list_view().await.map_err(|e| format!("the legacy catalog: {e:#}"))?;
    // the published first, so the site moves soonest, then the smallest
    list.sort_by(|a, b| b.public.cmp(&a.public).then(a.size.cmp(&b.size)).then(a.hash.cmp(&b.hash)));
    let mut world = crate::aven::world(app).await?;
    let mut held = held_of(&world, city);
    let mut s = Summary { total: list.len(), ..Default::default() };
    if list.iter().any(|m| m.public && !holds(&held, m)) {
        public_share(app, city, &world).await?;
    }
    let mut failed_in_a_row = 0;
    let mut since_fresh = 0;
    for (i, m) in list.iter().enumerate() {
        let id = jobs::id(Kind::Keep, SUBJECT);
        if jobs::waiting_for(Lane::Io, &id) {
            *turn = None;
            jobs::requeue(Kind::Keep, SUBJECT, "letting a job that waits for the disk go first");
            *turn = Some(jobs::turn(Kind::Keep, SUBJECT).await.map_err(|_| "cancelled".to_string())?);
        }
        if since_fresh >= FRESH_EVERY {
            if let Ok(w) = crate::aven::world(app).await {
                world = w;
                held = held_of(&world, city);
            }
            since_fresh = 0;
        }
        let name = name_of(m);
        jobs::stage(Kind::Keep, SUBJECT, &format!("{} of {}: {name}", i + 1, s.total), i as f64 / s.total.max(1) as f64);
        if holds(&held, m) {
            s.skipped += 1;
            continue;
        }
        let Ok(hash) = m.hash.parse::<Hash>() else {
            s.failed.push((m.hash.clone(), "no BLAKE3 hash".into()));
            continue;
        };
        if !matches!(vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. })) {
            s.missing.push(m.hash.clone());
            continue;
        }
        match one(app, city, &vault, m, hash, i, s.total).await {
            Ok((entry, tags, profile)) => {
                s.copied += 1;
                failed_in_a_row = 0;
                since_fresh += 1;
                held.entry(m.hash.clone()).or_default().push(tags);
                if let Some(p) = profile {
                    s.profiles.insert(entry, p);
                }
            }
            Err(e) => {
                tracing::warn!("legacy copy: {} ({name}): {e}", m.hash);
                s.failed.push((m.hash.clone(), e.clone()));
                failed_in_a_row += 1;
                if failed_in_a_row >= MOST_FAILED {
                    s.stopped = Some(format!("{MOST_FAILED} failed in a row, the last: {e}"));
                    break;
                }
            }
        }
        tokio::time::sleep(PAUSE).await;
    }
    Ok(s)
}

/// The Public share of Maia City on `PUBLIC`, made where world `world` shows none yet.
async fn public_share(app: &AppHandle, city: &City, world: &Value) -> Result<(), String> {
    let shared = world["shares"].as_array().into_iter().flatten().any(|c| {
        c["over"] == city.vault.as_str() && c["who"] == "everyone" && c["slice"]["where"]["tag"] == PUBLIC
    });
    if shared {
        return Ok(());
    }
    let op = json!({ "op": "share", "over": city.vault, "who": "everyone", "level": "Public", "what": { "tag": PUBLIC }, "as": city.as_ });
    crate::aven::run(app, op).await.map(|_| ()).map_err(|e| format!("the Public share of what the legacy vault published: {e}"))
}

/// What a legacy file is to the studio, as its role tag (the module's list), if any.
fn role_of(m: &Meta) -> Option<&'static str> {
    let derived = ["proxy_of", "audio_of", "grade_still_of", "preview_of"].iter().any(|k| m.meta.get(*k).is_some_and(|v| !v.is_null()));
    if crate::models::pinned(&m.hash) {
        Some("media:model")
    } else if m.class == "delivery" {
        Some("media:delivery")
    } else if m.class == "proxy" || derived {
        Some("media:derived")
    } else if matches!(m.kind.as_str(), "video" | "audio" | "image") {
        Some("media:original")
    } else {
        None
    }
}

/// A legacy file's name in avenDB: its original name, else its title, else its hash, with its type's extension.
fn name_of(m: &Meta) -> String {
    let ext = ext_of_mime(&m.mime);
    let name = [&m.original_name, &m.title].into_iter().find(|n| !n.is_empty() && !n.contains('/')).cloned().unwrap_or_else(|| format!("{}.{ext}", &m.hash[..12]));
    if crate::blob::ext_of(&name) == "bin" && ext != "bin" { format!("{}.{ext}", stem(&name)) } else { name }
}

/// A file name's stem.
fn stem(name: &str) -> String {
    std::path::Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into())
}

/// The extension a file of type `mime` is named with.
fn ext_of_mime(mime: &str) -> &'static str {
    match mime {
        "video/quicktime" => "mov",
        "video/mp4" => "mp4",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "audio/aac" => "aac",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "application/json" => "json",
        "text/plain" => "txt",
        _ => "bin",
    }
}

/// Legacy file `m` (`hash`, whole in this Mac's legacy store) put into Maia City with its sidecars and its about: its
/// entry, its tags, and the colour profile set by hand that waits for its probe, if any.
async fn one(app: &AppHandle, city: &City, vault: &Arc<Vault>, m: &Meta, hash: Hash, i: usize, total: usize) -> Result<(String, Vec<String>, Option<String>), String> {
    let name = name_of(m);
    let mime = if m.mime.is_empty() { "application/octet-stream".to_string() } else { m.mime.clone() };
    let role = role_of(m);
    let mut tags = vec![format!("{MARK}{}", m.hash)];
    tags.extend(role.map(String::from));
    if m.public {
        tags.push(PUBLIC.into());
    }
    // its own tags without a namespace (a day's "Day 01"); one with a `:` might read as one of avenDB's, so it stays in
    // the about alone
    for t in m.tags.iter().filter(|t| !t.is_empty() && !t.contains(':')) {
        if !tags.contains(t) {
            tags.push(t.clone());
        }
    }
    let op = json!({ "op": "put_file", "vault": city.vault, "name": name, "media": mime, "tags": tags, "as": city.as_ });
    let len = match vault.store.blobs().status(hash).await {
        Ok(BlobStatus::Complete { size }) => size,
        _ => return Err("its bytes are not whole here".into()),
    };
    let bytes = Arc::new(LegacyBytes { vault: vault.clone(), hash, len, rt: tokio::runtime::Handle::current(), held: Mutex::new((0, Arc::new(vec![]))) });
    let src = Source::blob(bytes, format!("{}.{}", m.hash, crate::blob::ext_of(&name)));
    let total_bytes = (3 * len).max(1);
    let told = move |moved: u64| {
        let within = moved as f64 / total_bytes as f64;
        jobs::stage(Kind::Keep, SUBJECT, &format!("{} of {total}: {}", i + 1, &name_short(&m.hash)), (i as f64 + within) / total.max(1) as f64);
    };
    let put = crate::aven::put_source(app, op, &src, told).await?;
    let entry = put["entry"].as_str().ok_or("the device named no entry")?.to_string();
    if put["blake3"].as_str() != Some(m.hash.as_str()) {
        let op = json!({ "op": "insert", "entry": entry, "path": ["tags"], "value": DELETED, "as": city.as_ });
        crate::aven::run(app, op).await.ok();
        return Err(format!("its copy's BLAKE3 is {}, not its legacy hash: not counted", put["blake3"]));
    }
    let work = std::env::temp_dir().join("maiacity-legacy-copy").join(&m.hash);
    std::fs::create_dir_all(&work).map_err(|e| format!("{}: {e}", work.display()))?;
    let sidecars = async {
        // its words and its analysis beside an original, as the rules keep a long value (aven.rs `studio_import`)
        if role == Some("media:original") {
            for k in ["transcript", "analysis"] {
                let Some(v) = m.meta.get(k).filter(|v| v.is_object()) else { continue };
                let file = format!("{}.{k}.json", stem(&name));
                let tags = json!([format!("media:{k}"), format!("{MARK}{}", m.hash)]);
                put_json(app, city, &work.join(&file), &file, tags, v).await?;
            }
        }
        // everything else known about it, in its about (scripts/film/vault.mjs)
        let mut meta = m.meta.clone();
        if let Some(o) = meta.as_object_mut() {
            for k in vault_core::catalog::VIEW_KEYS {
                o.remove(k);
            }
        }
        let about = json!({
            "title": m.title, "description": m.description, "tags": m.tags, "meta": meta, "public": m.public,
            "original_name": m.original_name, "source": m.source, "ingest": m.ingest, "added": m.added,
            "story": m.story, "class": m.class, "kind": m.kind, "mime": m.mime, "size": m.size, "legacy": m.hash,
        });
        let file = format!("{entry}.about.json");
        put_json(app, city, &work.join(&file), &file, json!([format!("about:{entry}")]), &about).await
    }
    .await;
    std::fs::remove_dir_all(&work).ok();
    sidecars?;
    // a colour profile set by hand in the legacy studio, for the copied original's probe once it is done
    let profile = m.meta["color"]["override"].as_str().filter(|p| !p.is_empty() && role == Some("media:original") && m.kind == "video").map(String::from);
    Ok((entry, tags, profile))
}

/// A short name for a file in the Jobs list: its hash's first digits.
fn name_short(hash: &str) -> String {
    hash.chars().take(12).collect()
}

/// Value `v` put into Maia City as JSON file `name` (written at `path` first), tagged `tags`.
async fn put_json(app: &AppHandle, city: &City, path: &std::path::Path, name: &str, tags: Value, v: &Value) -> Result<(), String> {
    std::fs::write(path, v.to_string()).map_err(|e| format!("{}: {e}", path.display()))?;
    let op = json!({ "op": "put_file", "vault": city.vault, "name": name, "media": "application/json", "tags": tags, "as": city.as_ });
    crate::aven::put_path(app, op, path, |_| {}).await.map(|_| ())
}

/// Each copied original's colour profile set by hand (`waiting`: entry → profile) written into its probe's journey
/// where world `world` shows its probe done, as cuts.js `setProfile` writes it: the ones still waiting for a probe.
async fn settle(app: &AppHandle, city: &City, world: &Value, waiting: BTreeMap<String, String>) -> BTreeMap<String, String> {
    let entries = world["entries"].as_array().cloned().unwrap_or_default();
    let mut left = BTreeMap::new();
    for (entry, profile) in waiting {
        let probe = entries
            .iter()
            .filter(|e| e["type"] == "task" && e["deleted"] != true)
            .filter(|e| e["record"]["rule"] == "probe" && e["record"]["status"] == "done" && e["record"]["inputs"][0]["entry"] == entry.as_str())
            .max_by_key(|e| e["record"]["at"].as_i64().unwrap_or(0));
        let Some(t) = probe else {
            left.insert(entry, profile);
            continue;
        };
        let mut result: Value = t["record"]["result"].as_str().and_then(|r| serde_json::from_str(r).ok()).unwrap_or_else(|| json!({}));
        let journey = journey_with(&result["journey"], &profile);
        if result["journey"] == journey {
            continue;
        }
        result["journey"] = journey;
        let op = json!({ "op": "set", "entry": t["entry"], "path": ["result"], "value": result.to_string(), "as": city.as_ });
        if let Err(e) = crate::aven::run(app, op).await {
            tracing::warn!("legacy copy: the colour profile of {entry}: {e}");
            left.insert(entry, profile);
        }
    }
    left
}

/// A probe's colour journey with its profile set by hand to `profile`, the detected one kept beside it (cuts.js
/// `journeyWith`).
fn journey_with(journey: &Value, profile: &str) -> Value {
    let mut rest = journey.as_object().cloned().unwrap_or_default();
    rest.remove("override");
    let detected = rest.remove("detected");
    let found = detected.as_ref().and_then(Value::as_str).or(rest.get("profile").and_then(Value::as_str)).unwrap_or("unknown").to_string();
    if profile != found {
        rest.insert("profile".into(), json!(profile));
        rest.insert("override".into(), json!(profile));
        rest.insert("detected".into(), json!(found));
    } else {
        rest.insert("profile".into(), json!(found));
    }
    Value::Object(rest)
}

/// A file of the legacy store read in place, a window of it held for the next read (as aven.rs `AvenBytes` reads
/// avenDB's).
struct LegacyBytes {
    vault: Arc<Vault>,
    hash: Hash,
    len: u64,
    rt: tokio::runtime::Handle,
    held: Mutex<(u64, Arc<Vec<u8>>)>,
}

impl ByteSource for LegacyBytes {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        if offset >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let (at, bytes) = self.held.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let (at, bytes) = if offset >= at && offset < at + bytes.len() as u64 {
            (at, bytes)
        } else {
            let n = (WINDOW.max(buf.len() as u64)).min(self.len - offset) as usize;
            let (vault, hash) = (self.vault.clone(), self.hash);
            let read = async move {
                let mut r = vault.store.blobs().reader(hash);
                r.seek(SeekFrom::Start(offset)).await?;
                let mut out = vec![0u8; n];
                r.read_exact(&mut out).await?;
                Ok::<_, io::Error>(out)
            };
            let got = if tokio::runtime::Handle::try_current().is_ok() {
                tokio::task::block_in_place(|| self.rt.block_on(read))
            } else {
                self.rt.block_on(read)
            };
            let bytes = Arc::new(got?);
            *self.held.lock().unwrap_or_else(|p| p.into_inner()) = (offset, bytes.clone());
            (offset, bytes)
        };
        let from = (offset - at) as usize;
        let n = buf.len().min(bytes.len() - from);
        buf[..n].copy_from_slice(&bytes[from..from + n]);
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(v: Value) -> Meta {
        let mut base = json!({ "hash": "ab".repeat(32), "size": 1, "mime": "video/quicktime", "kind": "video" });
        for (k, x) in v.as_object().cloned().unwrap_or_default() {
            base[k] = x;
        }
        serde_json::from_value(base).expect("a Meta")
    }

    #[test]
    fn a_legacy_file_is_an_original_unless_it_was_made_of_another() {
        assert_eq!(role_of(&meta(json!({}))), Some("media:original"));
        assert_eq!(role_of(&meta(json!({ "class": "proxy" }))), Some("media:derived"));
        assert_eq!(role_of(&meta(json!({ "meta": { "audio_of": "cd".repeat(32) } }))), Some("media:derived"));
        assert_eq!(role_of(&meta(json!({ "class": "delivery" }))), Some("media:delivery"));
        assert_eq!(role_of(&meta(json!({ "kind": "other", "mime": "application/pdf" }))), None);
        let model = "45c31fc9296461324ce2788deb5e0a00b1d9879db27c6816d5a8e65ffb629cee";
        assert_eq!(role_of(&meta(json!({ "hash": model, "kind": "other" }))), Some("media:model"));
    }

    #[test]
    fn a_name_gets_its_types_extension() {
        assert_eq!(name_of(&meta(json!({ "original_name": "IMG_1.MOV" }))), "IMG_1.MOV");
        assert_eq!(name_of(&meta(json!({ "title": "frame 9x16", "mime": "image/jpeg", "kind": "image" }))), "frame 9x16.jpg");
        assert_eq!(name_of(&meta(json!({}))), format!("{}.mov", &"ab".repeat(32)[..12]));
    }

    #[test]
    fn a_published_file_is_held_only_by_a_public_entry() {
        let m = meta(json!({ "public": true }));
        let mut held = HashMap::new();
        held.insert(m.hash.clone(), vec![vec![format!("legacy:{}", m.hash), "media:original".to_string()]]);
        assert!(!holds(&held, &m), "a private copy doesn't serve the site");
        held.get_mut(&m.hash).expect("its copies").push(vec![format!("legacy:{}", m.hash), PUBLIC.to_string()]);
        assert!(holds(&held, &m));
        assert!(holds(&held, &meta(json!({}))), "an unpublished one by any copy");
    }

    #[test]
    fn a_hand_set_profile_keeps_the_detected_one_beside_it() {
        let found = json!({ "profile": "apple-log", "from": "tags" });
        let set = journey_with(&found, "rec709");
        assert_eq!(set, json!({ "profile": "rec709", "override": "rec709", "detected": "apple-log", "from": "tags" }));
        assert_eq!(journey_with(&set, "apple-log"), found);
    }

    #[test]
    fn a_time_reads_as_seconds_since_1970() {
        assert_eq!(chrono_secs("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(chrono_secs("2026-10-18T12:00:00.123Z"), Some(1_792_324_800));
    }
}
