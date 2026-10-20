// Golden tests: each case runs `sec` on the fixtures of Trail of Bits' zeroize-audit and constant-time-analysis
// (CC-BY-SA 4.0) and compares its output with what the original Python and shell scripts wrote for the same
// arguments, from the same folder. JSON is compared parsed, so only the escaping of non-ASCII text may differ.
use std::path::{Path, PathBuf};
use std::process::Command;

fn golden() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

fn out_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("golden");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run(args: &[&str]) -> (i32, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_sec")).args(args).current_dir(golden()).output().unwrap();
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned())
}

fn json(text: &str, what: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("{what} is not JSON: {e}"))
}

fn expected(name: &str) -> String {
    std::fs::read_to_string(golden().join("expected").join(name)).unwrap()
}

// A command that writes its JSON to `--out`.
fn check_out(name: &str, args: &[&str]) {
    let out = out_dir().join(format!("{name}.json"));
    let mut all: Vec<&str> = args.to_vec();
    all.extend(["--out", out.to_str().unwrap()]);
    let (code, _) = run(&all);
    assert_eq!(code, 0, "{name}: exit code");
    let got = json(&std::fs::read_to_string(&out).unwrap(), name);
    assert_eq!(got, json(&expected(&format!("{name}.json")), name), "{name}: output differs from the original's");
}

#[test]
fn dangerous_apis() {
    check_out("apis-pos", &["zeroize-apis", "--src", "fixtures/dangerous_apis_src"]);
    check_out("apis-neg", &["zeroize-apis", "--src", "fixtures/safe_src"]);
}

#[test]
fn semantic_audit() {
    check_out("semantic-pos", &[
        "zeroize-semantic", "--rustdoc", "fixtures/semantic_positive.rustdoc.json",
        "--cargo-toml", "fixtures/semantic_zeroize.Cargo.toml",
    ]);
    check_out("semantic-neg", &["zeroize-semantic", "--rustdoc", "fixtures/semantic_negative.rustdoc.json"]);
}

#[test]
fn mir_patterns() {
    check_out("mir", &["zeroize-mir", "--mir", "fixtures/sample.mir", "--secrets", "fixtures/secrets.json"]);
    check_out("mir-clean", &["zeroize-mir", "--mir", "fixtures/sample_clean.mir", "--secrets", "fixtures/secrets.json"]);
}

#[test]
fn llvm_patterns() {
    check_out("llvm", &[
        "zeroize-llvm", "--o0", "fixtures/sample.O0.ll", "--o1", "fixtures/sample.O1.ll", "--o2", "fixtures/sample.O2.ll",
    ]);
}

#[test]
fn asm_patterns() {
    for name in ["sample", "sample_aarch64", "sample_leaf_x86", "sample_clean"] {
        let asm = format!("fixtures/{name}.s");
        check_out(&format!("asm-{name}"), &["zeroize-asm", "--asm", &asm, "--secrets", "fixtures/secrets.json"]);
    }
}

#[test]
fn confidence_gates() {
    check_out("gates", &["zeroize-gates", "--input", "fixtures/gates-report.json"]);
    check_out("gates-adv", &["zeroize-gates", "--input", "fixtures/gates-report.json", "--require-mcp-for-advanced"]);
}

#[test]
fn diff_mir() {
    let (code, text) = run(&["zeroize-diff-mir", "fixtures/sample.mir", "fixtures/sample_clean.mir", "fixtures/sample.mir"]);
    assert_eq!(code, 1, "diff-mir exits 1 when the files differ");
    assert_eq!(text, expected("diff-mir.txt"));
}

#[test]
fn constant_time_assembly() {
    for (name, arch) in [("sample", "x86_64"), ("sample_aarch64", "arm64")] {
        let asm = format!("fixtures/{name}.s");
        let (code, text) = run(&["ct", "--assembly", "--arch", arch, "--warnings", "--json", &asm]);
        assert_eq!(code, 0, "ct {name}: exit code");
        assert_eq!(json(&text, name), json(&expected(&format!("ct-{name}.json")), name), "ct {name}: output differs");
    }
}
