use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// The local MCP sidecar, owned by the app so it lives and dies with a file
/// being open rather than lingering as a background service.
#[derive(Default)]
pub struct McpState {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

/// The port the agent config points at. Preferred rather than fixed: a stable
/// port keeps the written config valid across restarts, so the user's agent
/// is not reconfigured on every launch and an entry left behind by a crash
/// still points somewhere correct.
const PREFERRED_PORT: u16 = 4319;

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Prefer the stable port; fall back to whatever the OS offers if something
/// else already holds it.
fn choose_port() -> Result<u16, String> {
    if port_is_free(PREFERRED_PORT) {
        return Ok(PREFERRED_PORT);
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn server_entry() -> std::path::PathBuf {
    // In development the server runs from source next to the app crate.
    // A packaged build ships it as a bundled sidecar binary instead.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate has a parent directory")
        .join("mcp-server/src/index.js")
}

#[tauri::command]
pub fn start_mcp_server(state: tauri::State<'_, McpState>) -> Result<u16, String> {
    if let Some(port) = *state.port.lock().unwrap() {
        return Ok(port); // already running
    }

    let port = choose_port()?;
    let entry = server_entry();
    if !entry.exists() {
        return Err(format!("MCP server not found at {}", entry.display()));
    }

    let mut child = Command::new("node")
        .arg(&entry)
        .arg(port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start the MCP server: {e}"))?;

    // Wait for the server to announce its port, so callers never hand out an
    // address that is not listening yet.
    let stdout = child.stdout.take().ok_or("no stdout from the MCP server")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    if !line.starts_with("CANVAS_MCP_LISTENING") {
        let _ = child.kill();
        return Err(format!("unexpected MCP server output: {line}"));
    }

    // Keep draining stderr so a chatty server cannot fill its pipe and stall.
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[mcp] {line}");
            }
        });
    }
    std::thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[mcp] {line}");
        }
    });

    *state.child.lock().unwrap() = Some(child);
    *state.port.lock().unwrap() = Some(port);

    // Point the user's agent at this server now, so the connection exists
    // before they ever open the terminal — there is no setup step to perform.
    match crate::agent_config::configure_agent(port) {
        Ok(path) => eprintln!("[mcp] agent config updated at {path}"),
        Err(e) => eprintln!("[mcp] could not update the agent config: {e}"),
    }

    Ok(port)
}

#[tauri::command]
pub fn stop_mcp_server(state: tauri::State<'_, McpState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.port.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn mcp_port(state: tauri::State<'_, McpState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

impl McpState {
    /// Called on window teardown; a sidecar must never outlive the app.
    pub fn shutdown(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.port.lock().unwrap() = None;
    }
}
