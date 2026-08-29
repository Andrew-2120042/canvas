use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

/// A running agent process, spoken to in newline-delimited JSON.
struct Session {
    child: Child,
    stdin: ChildStdin,
    /// The session's `init` event, kept so a reloaded window can be told what
    /// it is attached to. The process outlives the webview, so without this a
    /// reload leaves the panel connected but with no idea to what.
    last_init: Arc<Mutex<Option<serde_json::Value>>>,
}

#[derive(Default)]
pub struct AgentState {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, serde::Serialize)]
struct AgentEvent {
    id: String,
    /// One parsed event from the agent, forwarded verbatim.
    event: serde_json::Value,
}

#[derive(Clone, serde::Serialize)]
struct AgentClosed {
    id: String,
    code: Option<i32>,
}

/// Canvas tools the agent may call without asking.
///
/// Scoped deliberately: the whole point of the app is that the agent can work
/// the canvas freely, but that is not a reason to hand it the user's shell and
/// filesystem by default. Anything outside this list still goes through the
/// agent's own permission flow.
const ALLOWED_TOOLS: &str = concat!(
    "mcp__canvas__get_status,",
    "mcp__canvas__get_canvas_state,",
    "mcp__canvas__get_selection,",
    "mcp__canvas__get_node,",
    "mcp__canvas__get_screenshot,",
    "mcp__canvas__create_node,",
    "mcp__canvas__update_node,",
    "mcp__canvas__delete_node,",
    "mcp__canvas__duplicate_node,",
    "mcp__canvas__set_selection"
);

/// Start the headless agent.
///
/// `session_id` is the conversation id, held by the app rather than left to
/// the agent, so the same conversation can be picked up elsewhere — the
/// terminal resumes this id to get an interactive view of it. `resume` says
/// whether that conversation already exists.
#[tauri::command]
pub fn agent_start(
    app: AppHandle,
    state: tauri::State<'_, AgentState>,
    id: String,
    cwd: String,
    session_id: String,
    resume: bool,
) -> Result<(), String> {
    // Reattaching to a session that outlived a window reload: replay what the
    // panel needs to render its header rather than starting a second agent.
    if let Some(session) = state.sessions.lock().unwrap().get(&id) {
        if let Some(init) = session.last_init.lock().unwrap().clone() {
            let _ = app.emit("agent:event", AgentEvent { id: id.clone(), event: init });
        }
        return Ok(());
    }

    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--allowedTools", ALLOWED_TOOLS,
    ]);
    if resume {
        cmd.args(["--resume", &session_id]);
    } else {
        cmd.args(["--session-id", &session_id]);
    }

    // Same reasoning as the pty: this agent owns its conversation, and an
    // inherited session marker would stop its transcript being written.
    for key in [
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDECODE",
    ] {
        cmd.env_remove(key);
    }

    let mut child = cmd
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the agent: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin on the agent process")?;
    let stdout = child.stdout.take().ok_or("no stdout on the agent process")?;
    let stderr = child.stderr.take();

    // One JSON object per line. A line that does not parse is skipped rather
    // than killing the stream — the agent may print diagnostics.
    let last_init: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
    let init_for_thread = Arc::clone(&last_init);
    let out_id = id.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(event) => {
                    if event.get("type").and_then(|v| v.as_str()) == Some("system")
                        && event.get("subtype").and_then(|v| v.as_str()) == Some("init")
                    {
                        *init_for_thread.lock().unwrap() = Some(event.clone());
                    }
                    let _ = handle.emit("agent:event", AgentEvent { id: out_id.clone(), event });
                }
                Err(_) => eprintln!("[agent] unparsed: {}", &trimmed[..trimmed.len().min(160)]),
            }
        }
        let _ = handle.emit("agent:closed", AgentClosed { id: out_id, code: None });
    });

    if let Some(err) = stderr {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[agent] {line}");
            }
        });
    }

    state.sessions.lock().unwrap().insert(id, Session { child, stdin, last_init });
    Ok(())
}

#[tauri::command]
pub fn agent_send(
    state: tauri::State<'_, AgentState>,
    id: String,
    text: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("no such agent session")?;

    let payload = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
    });
    let line = format!("{}\n", payload);
    session
        .stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("could not reach the agent: {e}"))?;
    session.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_stop(state: tauri::State<'_, AgentState>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[tauri::command]
pub fn agent_running(state: tauri::State<'_, AgentState>, id: String) -> bool {
    state.sessions.lock().unwrap().contains_key(&id)
}

impl AgentState {
    /// An agent must never outlive the window that started it.
    pub fn shutdown(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}
