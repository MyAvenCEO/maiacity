//! The Mac's Secure Enclave for avenDB's Touch ID key: avenDB's device asks for each touch in a line
//! `{"enclave": n, ...}` (avendb-device's `touch`), and avendb.rs hands it here, then gives the device the answer. The
//! Enclave's own work is in Swift (enclave/Enclave.swift, which says what each ask makes), built into the app by
//! build.rs where it builds, with `cfg(enclave)`; without it every ask fails, and the page offers no Touch ID.

use serde_json::{Value, json};

/// Whether this Mac can hold avenDB's Touch ID key: macOS 26 or later, a Secure Enclave, and a finger enrolled.
#[tauri::command]
pub async fn avendb_touch_ready() -> bool {
    let asked = tauri::async_runtime::spawn_blocking(|| ask(&json!({ "ready": true })));
    matches!(asked.await, Ok(Ok(answer)) if answer.get("ready") == Some(&Value::Bool(true)))
}

/// The Enclave's answer to `ask`, after a touch where it asks for one: it blocks until the person is done with the
/// Touch ID sheet, so it runs off the async runtime's threads.
pub fn ask(ask: &Value) -> Result<Value, String> {
    let answer = bridge::ask(&ask.to_string())?;
    let answer: Value = serde_json::from_str(&answer).map_err(|e| format!("the Secure Enclave's answer: {e}"))?;
    match answer.get("error").and_then(Value::as_str) {
        Some(why) => Err(why.to_string()),
        None => Ok(answer),
    }
}

#[cfg(enclave)]
mod bridge {
    use std::ffi::{CStr, CString, c_char};

    unsafe extern "C" {
        /// One ask in JSON: the answer in JSON, which `avendb_enclave_free` frees (enclave/Enclave.swift).
        fn avendb_enclave(ask: *const c_char) -> *mut c_char;
        fn avendb_enclave_free(answer: *mut c_char);
    }

    pub fn ask(ask: &str) -> Result<String, String> {
        let ask = CString::new(ask).map_err(|_| "an ask with a NUL in it")?;
        // SAFETY: `ask` is a C string that lives through the call; the answer is a C string the bridge made with
        // strdup, read once and freed once by the bridge
        unsafe {
            let answer = avendb_enclave(ask.as_ptr());
            if answer.is_null() {
                return Err("the Secure Enclave gave no answer".into());
            }
            let text = CStr::from_ptr(answer).to_string_lossy().into_owned();
            avendb_enclave_free(answer);
            Ok(text)
        }
    }
}

#[cfg(not(enclave))]
mod bridge {
    pub fn ask(_: &str) -> Result<String, String> {
        Err("this build of the app has no Secure Enclave bridge: its build log says why".into())
    }
}
