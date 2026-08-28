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

/// Ask the OS for a free loopback port, then hand it to the server. Binding
/// and immediately releasing leaves a small race, but it beats a hardcoded
/// port that collides with whatever else the user is running.
fn free_port() -> Result<u16, String> {
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

    let port = free_port()?;
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
