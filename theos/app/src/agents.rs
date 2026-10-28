//! The agents' processes running on this Mac, for avenDB's Settings (Samuel 2026-10-21: "kick all legacy old
//! agents"): each `maiacity-studio agent <harness>` or legacy `avendb-device agent <harness>`, its pid, when it started, the binary it
//! runs and whether that is an old build, one no longer on disk (as "The OS.app" after the app became theOS.app) or not
//! this app's own; and one stopped on the person's press (`agent_stop`), only ever a process this list names.

use std::path::Path;
use std::process::Command;

/// One agent process: `{ pid, started, exe, harness, old }`.
fn processes() -> Result<Vec<serde_json::Value>, String> {
    let out = Command::new("ps").args(["-axww", "-o", "pid=,lstart=,command="]).output().map_err(|e| format!("ps: {e}"))?;
    let ours = std::env::current_exe().ok();
    Ok(String::from_utf8_lossy(&out.stdout).lines().filter_map(|line| parse(line, ours.as_deref())).collect())
}

/// Line `line` of `ps -o pid=,lstart=,command=` as an agent process, if it is one: lstart is five words
/// (`Tue Oct 21 13:36:02 2026`), the command the binary's path, which may hold spaces, then ` agent <harness> …`.
fn parse(line: &str, ours: Option<&Path>) -> Option<serde_json::Value> {
    let mut words = line.split_whitespace();
    let pid: u32 = words.next()?.parse().ok()?;
    let started: Vec<&str> = words.by_ref().take(5).collect();
    let command = words.collect::<Vec<_>>().join(" ");
    let (exe, rest) = command.split_once(" agent ")?;
    if !matches!(Path::new(exe).file_name().and_then(|name| name.to_str()), Some("maiacity-studio" | "avendb-device")) {
        return None;
    }
    let harness = rest.split_whitespace().next().unwrap_or_default();
    let gone = !Path::new(exe).exists();
    let old = gone || ours.is_some_and(|o| Path::new(exe) != o);
    Some(serde_json::json!({
        "pid": pid,
        "started": started.join(" "),
        "exe": exe,
        "harness": harness,
        "gone": gone,
        "old": old,
    }))
}

/// The agents' processes running on this Mac.
#[tauri::command]
pub async fn agent_processes() -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(processes).await.map_err(|e| e.to_string())?
}

/// Stops agent process `pid` (SIGTERM), only where it is one `agent_processes` names now: its harness's session starts
/// it again from this app the next time it needs it.
#[tauri::command]
pub async fn agent_stop(pid: u32) -> Result<(), String> {
    let known = tauri::async_runtime::spawn_blocking(processes).await.map_err(|e| e.to_string())??;
    if !known.iter().any(|p| p["pid"].as_u64() == Some(u64::from(pid))) {
        return Err(format!("{pid} is no agent's process running now"));
    }
    let pid = libc::pid_t::try_from(pid).map_err(|e| e.to_string())?;
    // SAFETY: kill(2) with a pid this Mac's ps just named as an agent's process, and a signal number
    if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
        return Err(format!("stopping {pid}: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_line_reads_and_one_from_a_binary_gone_or_not_ours_is_old() {
        let ours = Path::new("/Applications/theOS.app/Contents/MacOS/maiacity-studio");
        let gone = parse(
            "2156 Tue Oct 21 11:40:02 2026 /Users/s/Applications/The OS.app/Contents/MacOS/avendb-device agent claude --dir /Users/s/avenDB/mac",
            Some(ours),
        )
        .unwrap();
        assert_eq!(gone["pid"], 2156);
        assert_eq!(gone["started"], "Tue Oct 21 11:40:02 2026");
        assert_eq!(gone["exe"], "/Users/s/Applications/The OS.app/Contents/MacOS/avendb-device");
        assert_eq!(gone["harness"], "claude");
        assert_eq!(gone["gone"], true);
        assert_eq!(gone["old"], true);
        assert!(parse("12 Tue Oct 21 11:40:02 2026 /usr/bin/vim agent notes", Some(ours)).is_none());
        assert!(parse("13 Tue Oct 21 11:40:02 2026 /bin/zsh", Some(ours)).is_none());
    }

    #[test]
    fn embedded_agents_are_listed_but_gui_and_lookalike_processes_are_not() {
        let executable = "/Applications/The OS.app/Contents/MacOS/maiacity-studio";
        let line = format!("23 Tue Oct 21 11:40:02 2026 {executable} agent codex --dir /Users/s/avenDB/mac");
        let agent = parse(&line, Some(Path::new(executable))).unwrap();
        assert_eq!(agent["exe"], executable);
        assert_eq!(agent["harness"], "codex");
        assert_eq!(agent["old"], agent["gone"]);
        assert!(parse(&format!("23 Tue Oct 21 11:40:02 2026 {executable}"), None).is_none());
        assert!(parse("23 Tue Oct 21 11:40:02 2026 /tmp/not-avendb-device agent codex", None).is_none());
    }
}
