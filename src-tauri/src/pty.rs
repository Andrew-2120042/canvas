use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{AppHandle, Emitter};

/// A live pseudo-terminal: the writer half plus the handle used to resize it.
struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, serde::Serialize)]
struct Output {
    id: String,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct Exit {
    id: String,
}

/// The user's own login shell, so their prompt, aliases and PATH are intact —
/// the terminal has to be the one they already know, not a bare sh.
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    if state.sessions.lock().unwrap().contains_key(&id) {
        return Ok(()); // already running
    }

    let pty = NativePtySystem::default();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    // A login shell so the user's profile is sourced, matching what they get
    // when they open Terminal themselves.
    cmd.arg("-l");
    cmd.cwd(cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/".into())
    }));
    cmd.env("TERM", "xterm-256color");
    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Pump output to the webview. Bytes are forwarded as UTF-8 lossily so a
    // split multi-byte sequence never kills the stream.
    let emit_id = id.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = handle.emit("pty:output", Output { id: emit_id.clone(), data });
                }
            }
        }
        let _ = handle.emit("pty:exit", Exit { id: emit_id });
    });

    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { writer, master: pair.master, child });
    Ok(())
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("no such terminal session")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("no such terminal session")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyState>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

impl PtyState {
    /// A shell must never outlive the window that hosted it.
    pub fn shutdown(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}

/// Keeps the Arc import meaningful if the state is shared more widely later.
pub type Shared = Arc<PtyState>;
