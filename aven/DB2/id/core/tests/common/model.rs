//! The running Lean model, `aven-id-model` (`id/spec`), for property tests (README rule 10): one JSON case per line,
//! one answer per line. Set `AVEN_ID_MODEL` to a built model to skip `lake`.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::OnceLock;

use serde_json::Value;

/// The built model, built once per run.
static EXE: OnceLock<PathBuf> = OnceLock::new();

pub struct Model {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Model {
    pub fn start() -> Model {
        let exe = EXE.get_or_init(|| match std::env::var("AVEN_ID_MODEL") {
            Ok(exe) => PathBuf::from(exe),
            Err(_) => {
                let spec = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec");
                let built = Command::new("lake")
                    .arg("build")
                    .arg("aven-id-model")
                    .current_dir(&spec)
                    .status();
                assert!(
                    built.is_ok_and(|s| s.success()),
                    "lake build aven-id-model failed in {}",
                    spec.display()
                );
                spec.join(".lake/build/bin/aven-id-model")
            }
        });
        let mut child = Command::new(exe)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("can't run {}: {e}", exe.display()));
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Model {
            _child: child,
            stdin,
            stdout,
        }
    }

    pub fn ask(&mut self, case: &Value) -> Value {
        writeln!(self.stdin, "{case}").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let answer: Value =
            serde_json::from_str(&line).unwrap_or_else(|e| panic!("model said {line:?}: {e}"));
        assert!(
            // a chain's answer names the rule it breaks under "error", beside "ok"; a refusal stands alone
            answer.get("error").is_none() || answer.get("ok").is_some(),
            "model refused {case}: {answer}"
        );
        answer
    }
}
