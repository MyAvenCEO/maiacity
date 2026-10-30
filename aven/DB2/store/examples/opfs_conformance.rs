//! The conformance suite on OPFS, in a browser: `opfs/run.sh` builds this to wasm and `opfs/run.mjs` calls
//! `conformance(root)` in a dedicated worker (the only place every engine has sync access handles) in Chromium, WebKit
//! and Firefox, each case and each of the model's traces on a fresh folder under `root` in the origin's private file
//! system. The bench is a gate (store/README.md): 200 puts of 4 KiB in under 250 ms.

#[cfg(target_arch = "wasm32")]
mod browser {
    use aven_db_store::{backend, conformance};
    use wasm_bindgen::prelude::*;

    /// The most 200 puts of 4 KiB may take, in every engine (measured 4 to 45 ms, 30 Oct 2026).
    const GATE_MS: f64 = 250.0;

    fn now() -> f64 {
        js_sys::Reflect::get(&js_sys::global(), &"performance".into())
            .ok()
            .and_then(|p| js_sys::Reflect::get(&p, &"now".into()).ok().map(|f| (p, f)))
            .and_then(|(p, f)| f.dyn_into::<js_sys::Function>().ok()?.call0(&p).ok()?.as_f64())
            .unwrap_or_else(js_sys::Date::now)
    }

    /// The suite's report and the bench's times, as text; the first line says `passed` or `FAILED`.
    #[wasm_bindgen]
    pub async fn conformance(root: String) -> String {
        let mut n = 0;
        let report = conformance::run(
            async || {
                n += 1;
                backend::opfs(&format!("{root}/case-{n}/")).await.expect("opfs")
            },
            include_str!("../../db/spec/vectors/store.json"),
        )
        .await;
        let mut passed = report.passed();
        let mut out = format!("{report}\n");
        match backend::opfs(&format!("{root}/bench/")).await {
            Ok(store) => match conformance::bench(&store, now).await {
                Ok(times) => {
                    for (what, ms) in &times {
                        out.push_str(&format!("bench {what}: {ms:.0} ms\n"));
                    }
                    if let Some((_, ms)) = times.iter().find(|(what, _)| what.starts_with("put 200")) {
                        let under = *ms < GATE_MS;
                        passed &= under;
                        out.push_str(&format!(
                            "gate: 200 puts of 4 KiB in {ms:.0} ms, {} {GATE_MS:.0} ms\n",
                            if under { "under" } else { "OVER" }
                        ));
                    }
                }
                Err(e) => {
                    passed = false;
                    out.push_str(&format!("bench failed: {e}\n"));
                }
            },
            Err(e) => {
                passed = false;
                out.push_str(&format!("bench's store failed: {e}\n"));
            }
        }
        format!("{}\n{out}", if passed { "passed" } else { "FAILED" })
    }
}
