//! `sec`: the scripts of our security skills in one binary, one subcommand each. Ports of Trail of Bits' Python tools
//! (trailofbits/skills, CC-BY-SA 4.0), each behaving as its original did; see ../NOTICE.md.
//!
//!   cargo build --release --manifest-path .claude/skills/security-auditor/tools/Cargo.toml
//!   .claude/skills/security-auditor/tools/target/release/sec <command> [args]

mod ct;
mod rust_review;
mod util;
mod zeroize;

const COMMANDS: &[(&str, fn(&[String]) -> i32, &str)] = &[
    ("rust-plan", rust_review::plan_main, "rust-security: build plan.json and the worker prompts"),
    ("rust-validate", rust_review::validate_main, "rust-security: check the workers' shards, coverage and finding files"),
    ("rust-sarif", rust_review::sarif_main, "rust-security: write the surviving findings as SARIF"),
    ("ct", ct::main, "constant-time: variable-time instructions in Rust assembly, JS bytecode or a listing"),
    ("zeroize-toolchain", zeroize::toolchain::main, "zeroize: preflight (cargo, nightly, cargo-expand, the crate builds)"),
    ("zeroize-apis", zeroize::apis::main, "zeroize: source scan for APIs that bypass wiping and secrets across .await"),
    ("zeroize-semantic", zeroize::semantic::main, "zeroize: trait-aware audit of sensitive types from rustdoc JSON"),
    ("zeroize-emit-rustdoc", zeroize::emit::rustdoc_main, "zeroize: a crate's rustdoc JSON, for the semantic audit"),
    ("zeroize-emit-mir", zeroize::emit::mir_main, "zeroize: a crate's MIR at one optimization level"),
    ("zeroize-emit-ir", zeroize::emit::ir_main, "zeroize: a crate's LLVM IR at one optimization level"),
    ("zeroize-emit-asm", zeroize::emit::asm_main, "zeroize: a crate's assembly at one optimization level"),
    ("zeroize-mir", zeroize::mir::main, "zeroize: MIR patterns of missing or broken wipes"),
    ("zeroize-diff-mir", zeroize::diff_mir::main, "zeroize: MIR diffed across levels, where wipes and drop glue vanish"),
    ("zeroize-llvm", zeroize::llvm::main, "zeroize: LLVM IR across levels (wipes removed, stack and register leftovers)"),
    ("zeroize-asm", zeroize::asm::main, "zeroize: x86-64 / AArch64 assembly (stack retention, register spills)"),
    ("zeroize-gates", zeroize::gates::main, "zeroize: the report's confidence gates"),
];

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = argv.first() else { usage(2) };
    if cmd == "-h" || cmd == "--help" || cmd == "help" {
        usage(0);
    }
    match COMMANDS.iter().find(|(name, _, _)| name == cmd) {
        Some((_, run, _)) => std::process::exit(run(&argv[1..])),
        None => {
            eprintln!("sec: unknown command '{cmd}'");
            usage(2)
        }
    }
}

fn usage(code: i32) -> ! {
    let out: Vec<String> = COMMANDS.iter().map(|(n, _, d)| format!("  {n:<26}{d}")).collect();
    let text = format!("usage: sec <command> [args]\n\ncommands:\n{}", out.join("\n"));
    if code == 0 { println!("{text}") } else { eprintln!("{text}") }
    std::process::exit(code)
}
