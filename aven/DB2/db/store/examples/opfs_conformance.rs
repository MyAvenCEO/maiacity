//! The conformance suite on OPFS, in a browser: `opfs/run.sh` builds this to wasm and `opfs/run.mjs` calls
//! `conformance(root)` in Chromium, each case and each of the model's traces on a fresh folder under `root` in the
//! origin's private file system.

#[cfg(target_arch = "wasm32")]
mod browser {
    use aven_db_store::{backend, conformance};
    use wasm_bindgen::prelude::*;

    fn now() -> f64 {
        js_sys::Date::now()
    }

    /// The suite's report and the bench's times, as text; the first line says `passed` or `FAILED`.
    #[wasm_bindgen]
    pub async fn conformance(root: String) -> String {
        let mut n = 0;
        let report = conformance::run(
            async || {
                n += 1;
                backend::opfs(&format!("{root}/case-{n}/")).expect("opfs")
            },
            include_str!("../../spec/vectors/store.json"),
        )
        .await;
        let mut out = format!(
            "{}\n{report}\n",
            if report.passed() { "passed" } else { "FAILED" }
        );
        match conformance::bench(
            &backend::opfs(&format!("{root}/bench/")).expect("opfs"),
            now,
        )
        .await
        {
            Ok(times) => times
                .iter()
                .for_each(|(what, ms)| out.push_str(&format!("bench {what}: {ms:.0} ms\n"))),
            Err(e) => out.push_str(&format!("bench failed: {e}\n")),
        }
        out
    }
}
