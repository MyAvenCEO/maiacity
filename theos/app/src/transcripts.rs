//! The speech model, held here while a run of recordings lasts (`RECOGNIZER`): words are made by the `transcript` rule
//! on avenDB's files (aven.rs `transcript`, Phonon-2 through vault-asr). The words set by hand on the old media vault's
//! files went with that vault (#1112).

use std::sync::Mutex;

/// the loaded model, kept for a run of recordings
pub(crate) static RECOGNIZER: Mutex<Option<vault_asr::Recognizer>> = Mutex::new(None);
