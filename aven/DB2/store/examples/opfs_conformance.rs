//! The conformance suite on OPFS, in a browser: `opfs/run.sh` builds this to wasm and `opfs/run.mjs` calls
//! `conformance(root)` in a dedicated worker (the only place every engine has sync access handles) in Chromium, WebKit
//! and Firefox, each case and each of the model's traces on a fresh folder under `root` in the origin's private file
//! system. The bench's times are printed, and the real workload is the gate (`conformance::workload`).

#[cfg(target_arch = "wasm32")]
mod browser {
    use aven_db_store::{backend, conformance};
    use wasm_bindgen::prelude::*;

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
            Ok(store) => {
                match conformance::bench(&store, now).await {
                    Ok(times) => times
                        .iter()
                        .for_each(|(what, ms)| out.push_str(&format!("bench {what}: {ms:.0} ms\n"))),
                    Err(e) => out.push_str(&format!("bench failed: {e}\n")),
                }
                match conformance::workload(&store, now).await {
                    Ok(gates) => {
                        for (what, ms, gate) in gates {
                            let under = ms < gate;
                            passed &= under;
                            out.push_str(&format!(
                                "gate {what}: {ms:.1} ms, {} {gate:.0} ms\n",
                                if under { "under" } else { "OVER" }
                            ));
                        }
                    }
                    Err(e) => {
                        passed = false;
                        out.push_str(&format!("workload failed: {e}\n"));
                    }
                }
            }
            Err(e) => {
                passed = false;
                out.push_str(&format!("bench's store failed: {e}\n"));
            }
        }
        format!("{}\n{out}", if passed { "passed" } else { "FAILED" })
    }
}
