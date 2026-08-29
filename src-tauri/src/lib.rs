mod agent;
mod agent_config;
mod mcp;
mod pty;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use agent::AgentState;
use mcp::McpState;
use pty::PtyState;
use tauri::Manager;

/// Read a user-picked image and hand it back as a data URL.
///
/// The webview cannot open an HTML file picker, so the path comes from the
/// native dialog and the bytes are read here rather than granting the
/// frontend filesystem scope over arbitrary paths.
#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let mime = match std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        other => return Err(format!("unsupported image type: {other:?}")),
    };

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Documents embed images inline, so keep a ceiling on what can be added.
    const MAX_BYTES: usize = 8 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(format!("image is {} bytes; limit is {MAX_BYTES}", bytes.len()));
    }

    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Environment variables that mark a process as belonging to an existing
/// agent session.
///
/// When the app is launched from inside one it inherits them, and anything it
/// spawns then looks like a child of that session. That produced a visible
/// "transcript saving is off" warning in the terminal, so they are cleared —
/// though testing showed they do not actually suppress persistence.
fn inherited_agent_vars() -> Vec<String> {
    std::env::vars()
        .map(|(k, _)| k)
        .filter(|k| k.starts_with("CLAUDE_") || k == "CLAUDECODE")
        .collect()
}

pub fn clear_inherited_agent_env(cmd: &mut std::process::Command) {
    for key in inherited_agent_vars() {
        cmd.env_remove(key);
    }
}

pub fn clear_inherited_agent_env_pty(cmd: &mut portable_pty::CommandBuilder) {
    for key in inherited_agent_vars() {
        cmd.env_remove(key);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentState::default())
        .manage(McpState::default())
        .manage(PtyState::default())
        .plugin(tauri_plugin_opener::init())
        // Local document persistence writes into the app data directory.
        .plugin(tauri_plugin_fs::init())
        // Native file picker: WKWebView does not open HTML file inputs.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_image_data_url,
            mcp::start_mcp_server,
            mcp::stop_mcp_server,
            mcp::mcp_port,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::workspace_dir,
            agent::agent_start,
            agent::agent_send,
            agent::agent_stop,
            agent::agent_running,
            agent::agent_session_exists,
        ])
        .on_window_event(|window, event| {
            // The sidecar is a child of this app, not a background service.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<McpState>().shutdown();
                window.state::<PtyState>().shutdown();
                window.state::<AgentState>().shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
