use std::path::PathBuf;

use serde_json::{Map, Value};

/// The name the canvas server appears under in the agent's config.
const SERVER_NAME: &str = "canvas";

/// Claude Code keeps user-scoped MCP servers at the top level of this file.
fn claude_config_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude.json"))
}

/// Write `value` to `path` without risking a partial file.
///
/// This config belongs to the user and can be hundreds of kilobytes holding
/// unrelated state, so a crash mid-write must not truncate it: serialise to a
/// sibling temp file, then rename, which is atomic within a filesystem.
fn write_atomic(path: &PathBuf, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.canvas-tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("could not replace config: {e}"))
}

fn load(path: &PathBuf) -> Value {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Map::new())),
        Err(_) => Value::Object(Map::new()),
    }
}

/// Point the user's agent CLI at this app's MCP server.
///
/// Written directly rather than shelling out to `claude mcp add`, because:
///
/// * the port changes every launch, so this runs on every start and must be
///   idempotent — `claude mcp add` fails when the name already exists, so
///   shelling out would need a remove-then-add dance that can leave the entry
///   missing if it fails halfway;
/// * it does not depend on `claude` being on the PATH of the process that
///   spawns it, which differs from the user's interactive shell;
/// * it does not depend on the CLI's flag surface staying stable.
///
/// The file holds unrelated user state, so this merges one key and leaves
/// everything else byte-for-byte as it was.
pub fn configure_agent(port: u16) -> Result<String, String> {
    let path = claude_config_path().ok_or("no HOME directory")?;
    let mut root = load(&path);

    let obj = root.as_object_mut().ok_or("agent config is not a JSON object")?;
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let servers = servers
        .as_object_mut()
        .ok_or("mcpServers in the agent config is not an object")?;

    let mut entry = Map::new();
    entry.insert("type".into(), Value::String("http".into()));
    entry.insert(
        "url".into(),
        Value::String(format!("http://127.0.0.1:{port}/mcp")),
    );
    servers.insert(SERVER_NAME.into(), Value::Object(entry));

    write_atomic(&path, &root)?;
    Ok(path.display().to_string())
}

/// Remove the entry. Not called on a normal quit: the server uses a stable
/// port, so the entry stays valid across restarts and rewriting the user's
/// config twice per session would be churn for no benefit. Kept for an
/// explicit teardown.
#[allow(dead_code)]
pub fn unconfigure_agent() {
    let Some(path) = claude_config_path() else { return };
    if !path.exists() {
        return;
    }
    let mut root = load(&path);
    let Some(obj) = root.as_object_mut() else { return };
    let Some(servers) = obj.get_mut("mcpServers").and_then(|v| v.as_object_mut()) else {
        return;
    };
    if servers.remove(SERVER_NAME).is_some() {
        let _ = write_atomic(&path, &root);
    }
}
